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
        // 1. Debug Database Binding
        const usersKV = platform?.env?.BETA_USERS_KV;
        if (!usersKV) {
            throw new Error('BETA_USERS_KV is not bound in Cloudflare. Check Wrangler/Dashboard.');
        }

        // 2. Rate Limit
        const clientIp = request.headers.get('CF-Connecting-IP') || getClientAddress();
        // Wrap rate limit in its own try/catch to ensure it doesn't block critical flow if it fails
        let limitResult = { allowed: true };
        try {
             limitResult = await checkRateLimit(usersKV, clientIp, 'register_attempt', 5, 3600);
        } catch (e) {
             console.warn('Rate limit check failed (ignoring):', e);
        }

        if (!limitResult.allowed) {
            return json({ message: 'Too many registration attempts. Please try again later.' }, { status: 429 });
        }

        const { username, email, password } = await request.json();

        // 3. Validation
        if (!username || !email || !password) return json({ message: 'Missing fields' }, { status: 400 });
        
        const normEmail = email.toLowerCase().trim();
        const normUser = username.toLowerCase().trim();

        // 4. Check Existing
        const existingEmail = await findUserByEmail(usersKV, normEmail);
        if (existingEmail) return json({ message: 'Email already in use.' }, { status: 409 });

        const existingUser = await findUserByUsername(usersKV, normUser);
        if (existingUser) return json({ message: 'Username taken.' }, { status: 409 });

        // 5. Check Reservations
        const [resUser, resEmail] = await Promise.all([
            usersKV.get(`reservation:username:${normUser}`),
            usersKV.get(`reservation:email:${normEmail}`)
        ]);

        if (resUser || resEmail) {
            return json({ message: 'Username or Email is pending verification.' }, { status: 409 });
        }

        // 6. Create Pending Record
        const hashedPassword = await hashPassword(password);
        const verificationToken = randomUUID();
        
        const pendingUser = {
            username: normUser,
            email: normEmail,
            password: hashedPassword,
            createdAt: new Date().toISOString()
        };

        const ttl = 86400; // 24 hours

        // 7. Atomic Writes
        await Promise.all([
            usersKV.put(`pending_verify:${verificationToken}`, JSON.stringify(pendingUser), { expirationTtl: ttl }),
            usersKV.put(`reservation:username:${normUser}`, verificationToken, { expirationTtl: ttl }),
            usersKV.put(`reservation:email:${normEmail}`, verificationToken, { expirationTtl: ttl }),
            usersKV.put(`lookup:pending:${normEmail}`, verificationToken, { expirationTtl: ttl })
        ]);

        // 8. Send Email (Likely Failure Point)
        console.log(`[Register] Sending email to ${normEmail}...`);
        
        // Wrap email sending specifically to catch config errors
        let emailSent = false;
        try {
            emailSent = await sendVerificationEmail(normEmail, verificationToken, url.origin);
        } catch (emailErr: any) {
            throw new Error(`Email Service Failed: ${emailErr.message}`);
        }

        if (!emailSent) {
            // Rollback
            await Promise.all([
                usersKV.delete(`pending_verify:${verificationToken}`),
                usersKV.delete(`reservation:username:${normUser}`),
                usersKV.delete(`reservation:email:${normEmail}`),
                usersKV.delete(`lookup:pending:${normEmail}`)
            ]);
            return json({ message: 'Failed to send email. Check API Key or Spam folder.' }, { status: 500 });
        }

        return json({ success: true, message: 'Verification email sent.' });

    } catch (e: any) {
        console.error('[Register] Critical Error:', e);
        // [!code fix] Return the ACTUAL error message to the client for debugging
        return json({ 
            message: 'Internal Server Error', 
            debug_error: e.message,
            stack: e.stack 
        }, { status: 500 });
    }
};