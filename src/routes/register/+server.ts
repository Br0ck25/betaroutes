// src/routes/register/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
import { findUserByEmail, findUserByUsername } from '$lib/server/userService';
import { sendVerificationEmail } from '$lib/server/email';
import { checkRateLimit } from '$lib/server/rateLimit'; // [!code ++]
import { randomUUID } from 'node:crypto';

export const POST: RequestHandler = async ({ request, platform, url, getClientAddress }) => {
    const usersKV = platform?.env?.BETA_USERS_KV;
    if (!usersKV) {
        return json({ message: 'Database not available' }, { status: 500 });
    }

    // [!code fix] 1. Rate Limiting (5 requests per hour per IP)
    // Prevents spam registration attempts
    const ip = getClientAddress();
    const { allowed } = await checkRateLimit(usersKV, ip, 'register_attempt', 5, 3600);
    if (!allowed) {
        return json({ message: 'Too many registration attempts. Please try again later.' }, { status: 429 });
    }

    const { username, email, password } = await request.json();

    if (!username || !email || !password) {
        return json({ message: 'Missing fields' }, { status: 400 });
    }

    // 2. Check Duplicates (Existing Users)
    const existingEmail = await findUserByEmail(usersKV, email);
    if (existingEmail) return json({ message: 'Email already in use.' }, { status: 409 });

    const existingUser = await findUserByUsername(usersKV, username);
    if (existingUser) return json({ message: 'Username taken.' }, { status: 409 });

    // [!code fix] 3. Check Pending Reservations (Race Condition Protection)
    // Prevents someone from taking a username that is currently pending verification
    const isReserved = await usersKV.get(`reservation:username:${username.toLowerCase()}`);
    if (isReserved) {
        return json({ message: 'Username is pending verification.' }, { status: 409 });
    }

    // 4. Prepare Pending Record
    const hashedPassword = await hashPassword(password);
    const verificationToken = randomUUID();
    
    const pendingUser = {
        username,
        email,
        password: hashedPassword,
        createdAt: new Date().toISOString()
    };

    // [!code fix] 5. Atomic Writes (Pending Data + Reservations + Email Index)
    // We create:
    // A. The pending data itself
    // B. A username reservation to block others
    // C. An email index so we can find the token later if we need to Resend
    await Promise.all([
        usersKV.put(`pending_verify:${verificationToken}`, JSON.stringify(pendingUser), { expirationTtl: 86400 }),
        usersKV.put(`reservation:username:${username.toLowerCase()}`, verificationToken, { expirationTtl: 86400 }),
        usersKV.put(`idx:pending_email:${email.toLowerCase()}`, verificationToken, { expirationTtl: 86400 })
    ]);

    // 6. Send Email
    const emailSent = await sendVerificationEmail(email, verificationToken, url.origin);

    if (!emailSent) {
        // [!code fix] Rollback all keys if email fails
        await Promise.all([
            usersKV.delete(`pending_verify:${verificationToken}`),
            usersKV.delete(`reservation:username:${username.toLowerCase()}`),
            usersKV.delete(`idx:pending_email:${email.toLowerCase()}`)
        ]);
        return json({ message: 'Failed to send verification email. Please try again.' }, { status: 500 });
    }

    return json({ 
        success: true, 
        message: 'Verification email sent.' 
    });
};