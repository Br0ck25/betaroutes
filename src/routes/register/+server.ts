// src/routes/register/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
import { findUserByEmail, findUserByUsername } from '$lib/server/userService';
import { sendVerificationEmail } from '$lib/server/email';
import { checkRateLimit } from '$lib/server/rateLimit'; // [!code fix] Import rate limiter
import { randomUUID } from 'node:crypto';

export const POST: RequestHandler = async ({ request, platform, url, getClientAddress }) => {
    const usersKV = platform?.env?.BETA_USERS_KV;
    if (!usersKV) {
        return json({ message: 'Database not available' }, { status: 500 });
    }

    // [!code fix] 1. Rate Limiting (Prevent Spam/DoS)
    // Limit: 3 registrations per hour per IP
    const clientIp = request.headers.get('CF-Connecting-IP') || getClientAddress();
    const limitResult = await checkRateLimit(usersKV, clientIp, 'register_attempt', 3, 3600);

    if (!limitResult.allowed) {
        return json({ message: 'Too many registration attempts. Please try again later.' }, { status: 429 });
    }

    const { username, email, password } = await request.json();

    if (!username || !email || !password) {
        return json({ message: 'Missing fields' }, { status: 400 });
    }

    // [!code fix] 2. Input Validation
    // Email regex: simple but effective for catching obvious garbage
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return json({ message: 'Invalid email address.' }, { status: 400 });
    }

    // Username: Alphanumeric + underscores only, 3-20 chars
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
        return json({ message: 'Username must be 3-20 characters (letters, numbers, underscores).' }, { status: 400 });
    }

    // Password: Min 8 chars (Matches reset-password policy)
    if (password.length < 8) {
        return json({ message: 'Password must be at least 8 characters.' }, { status: 400 });
    }

    // 3. Check Duplicates
    const existingEmail = await findUserByEmail(usersKV, email);
    if (existingEmail) return json({ message: 'Email already in use.' }, { status: 409 });

    const existingUser = await findUserByUsername(usersKV, username);
    if (existingUser) return json({ message: 'Username taken.' }, { status: 409 });

    // 4. Prepare Pending Record (Do NOT create user yet)
    const hashedPassword = await hashPassword(password);
    const verificationToken = randomUUID();
    
    // Store temporarily in KV with 24h expiration
    const pendingUser = {
        username,
        email,
        password: hashedPassword,
        createdAt: new Date().toISOString()
    };

    // Save to KV: "pending_verify:TOKEN"
    await usersKV.put(
        `pending_verify:${verificationToken}`, 
        JSON.stringify(pendingUser), 
        { expirationTtl: 86400 }
    );

    // 5. Send Email
    const emailSent = await sendVerificationEmail(email, verificationToken, url.origin);

    if (!emailSent) {
        // Rollback if email fails
        await usersKV.delete(`pending_verify:${verificationToken}`);
        return json({ message: 'Failed to send verification email. Please try again.' }, { status: 500 });
    }

    return json({ 
        success: true, 
        message: 'Verification email sent.' 
    });
};