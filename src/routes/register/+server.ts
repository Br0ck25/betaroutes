// src/routes/register/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
import { findUserByEmail, findUserByUsername } from '$lib/server/userService';
import { sendVerificationEmail } from '$lib/server/email';
import { checkRateLimit } from '$lib/server/rateLimit';
import { randomUUID } from 'node:crypto';

const BLOCKED_USERNAMES = ['admin', 'root', 'support', 'default_user', 'system', 'betaroutes'];

export const POST: RequestHandler = async ({ request, platform, url, getClientAddress }) => {
    const usersKV = platform?.env?.BETA_USERS_KV;
    const logsKV = platform?.env?.BETA_LOGS_KV;

    if (!usersKV || !logsKV) {
        return json({ message: 'Service temporarily unavailable' }, { status: 503 });
    }

    // 1. Rate Limiting (5 requests per hour per IP)
    const ip = getClientAddress();
    const limit = await checkRateLimit(logsKV, ip, 'register', 5, 3600);
    if (!limit.allowed) {
        return json({ message: 'Too many registration attempts. Please try again later.' }, { status: 429 });
    }

    let body;
    try {
        body = await request.json();
    } catch (e) {
        return json({ message: 'Invalid request body' }, { status: 400 });
    }
    
    const { username, email, password } = body;

    // 2. Strict Input Validation
    if (!username || typeof username !== 'string' || username.length < 3 || username.length > 20) {
        return json({ message: 'Username must be between 3 and 20 characters.' }, { status: 400 });
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return json({ message: 'Username can only contain letters, numbers, and underscores.' }, { status: 400 });
    }

    if (BLOCKED_USERNAMES.includes(username.toLowerCase())) {
        return json({ message: 'Username is not available.' }, { status: 400 });
    }

    if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 100) {
        return json({ message: 'Invalid email address.' }, { status: 400 });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
        return json({ message: 'Password must be at least 8 characters long.' }, { status: 400 });
    }

    // 3. Check Duplicates
    // We check purely to avoid overwriting, but we return a generic message if possible
    // or handle specific conflicts if UI requires it. For security, we often hide this,
    // but for UX, we usually reveal it. We will reveal for better UX in this context.
    const existingEmail = await findUserByEmail(usersKV, email);
    if (existingEmail) return json({ message: 'Email already in use.' }, { status: 409 });

    const existingUser = await findUserByUsername(usersKV, username);
    if (existingUser) return json({ message: 'Username taken.' }, { status: 409 });

    // 4. Prepare Pending Record
    const hashedPassword = await hashPassword(password);
    const verificationToken = randomUUID();
    
    const pendingUser = {
        username,
        email,
        password: hashedPassword,
        createdAt: new Date().toISOString()
    };

    // Save to KV: "pending_verify:TOKEN" (Expires in 24h)
    await usersKV.put(
        `pending_verify:${verificationToken}`, 
        JSON.stringify(pendingUser), 
        { expirationTtl: 86400 }
    );

    // 5. Send Email
    const emailSent = await sendVerificationEmail(email, verificationToken, url.origin);

    if (!emailSent) {
        await usersKV.delete(`pending_verify:${verificationToken}`);
        return json({ message: 'Failed to send verification email. Please try again.' }, { status: 500 });
    }

    return json({ 
        success: true, 
        message: 'Verification email sent. Please check your inbox.' 
    });
};