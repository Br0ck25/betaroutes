// src/routes/register/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
import { findUserByEmail, findUserByUsername } from '$lib/server/userService';
import { sendVerificationEmail } from '$lib/server/email';
import { checkRateLimit } from '$lib/server/rateLimit';
import { randomUUID } from 'node:crypto';

export const POST: RequestHandler = async ({ request, platform, url, getClientAddress }) => {
    try {
        const usersKV = platform?.env?.BETA_USERS_KV;
        
        if (!usersKV) {
            console.error('[Register] BETA_USERS_KV is missing');
            return json({ message: 'Database not available' }, { status: 500 });
        }

        // 1. Rate Limiting (Prevent Spam)
        const clientIp = request.headers.get('CF-Connecting-IP') || getClientAddress();
        const limitRes = await checkRateLimit(usersKV, clientIp, 'register_attempt', 100, 3600); // 3 attempts/hour
        
        if (!limitRes.allowed) {
            return json({ message: 'Too many attempts. Please try again later.' }, { status: 429 });
        }

        const { username, email, password } = await request.json();

        if (!username || !email || !password) {
            return json({ message: 'Missing fields' }, { status: 400 });
        }

        // 2. Normalize
        const normEmail = email.toLowerCase().trim();
        const normUser = username.toLowerCase().trim();

        // 3. Check Existing Users
        const existingEmail = await findUserByEmail(usersKV, normEmail);
        if (existingEmail) return json({ message: 'Email already in use.' }, { status: 409 });

        const existingUser = await findUserByUsername(usersKV, normUser);
        if (existingUser) return json({ message: 'Username taken.' }, { status: 409 });

        // 4. Check Reservations (Race Condition Protection)
        const [resUser, resEmail] = await Promise.all([
            usersKV.get(`reservation:username:${normUser}`),
            usersKV.get(`reservation:email:${normEmail}`)
        ]);

        if (resUser || resEmail) {
            return json({ message: 'Username or Email is pending verification.' }, { status: 409 });
        }

        // 5. Prepare Pending Record
        const hashedPassword = await hashPassword(password);
        const verificationToken = randomUUID();
        
        const pendingUser = {
            username: normUser,
            email: normEmail,
            password: hashedPassword,
            createdAt: new Date().toISOString()
        };

        const ttl = 86400; // 24 hours

        // 6. Atomic Writes (Pending Data + Reservations + Resend Lookup)
        await Promise.all([
            // Main Pending Data
            usersKV.put(`pending_verify:${verificationToken}`, JSON.stringify(pendingUser), { expirationTtl: ttl }),
            // Reservations to block duplicates
            usersKV.put(`reservation:username:${normUser}`, verificationToken, { expirationTtl: ttl }),
            usersKV.put(`reservation:email:${normEmail}`, verificationToken, { expirationTtl: ttl }),
            // Lookup index for "Resend Verification Email" functionality
            usersKV.put(`lookup:pending:${normEmail}`, verificationToken, { expirationTtl: ttl })
        ]);

        // 7. Send Email
        console.log(`[Register] Sending email to ${normEmail}...`);
        const emailSent = await sendVerificationEmail(normEmail, verificationToken, url.origin);

        if (!emailSent) {
            console.error('[Register] Email sending failed');
            // Rollback on failure
            await Promise.all([
                usersKV.delete(`pending_verify:${verificationToken}`),
                usersKV.delete(`reservation:username:${normUser}`),
                usersKV.delete(`reservation:email:${normEmail}`),
                usersKV.delete(`lookup:pending:${normEmail}`)
            ]);
            return json({ message: 'Failed to send email. Please check the address.' }, { status: 500 });
        }

        return json({ success: true, message: 'Verification email sent.' });

    } catch (e: any) {
        // [!code fix] Catch unhandled errors to prevent 500 crashes
        console.error('[Register] Critical Error:', e);
        return json({ message: 'Internal Server Error' }, { status: 500 });
    }
};