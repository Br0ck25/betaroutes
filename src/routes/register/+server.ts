// src/routes/register/+server.ts
import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
import { findUserByEmail, findUserByUsername } from '$lib/server/userService';
import { checkRateLimit } from '$lib/server/rateLimit';
import { sendVerificationEmail } from '$lib/server/email';
import { randomUUID } from 'node:crypto';

export const POST: RequestHandler = async ({ request, platform, url }) => {
    const usersKV = platform?.env?.BETA_USERS_KV;
    if (!usersKV) {
        return json({ message: 'Database not available' }, { status: 500 });
    }

    // 1. Security: Rate Limiting
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rate = await checkRateLimit(usersKV, ip, 'register', 3, 3600); // 3 attempts per hour per IP
    
    if (!rate.allowed) {
        return json({ message: 'Too many registration attempts. Please try again later.' }, { status: 429 });
    }

    const { username, email, password } = await request.json();

    if (!username || !email || !password) {
        return json({ message: 'Missing fields' }, { status: 400 });
    }

    // 2. Check Duplicates
    const existingEmail = await findUserByEmail(usersKV, email);
    if (existingEmail) return json({ message: 'Email already in use.' }, { status: 409 });

    const existingUser = await findUserByUsername(usersKV, username);
    if (existingUser) return json({ message: 'Username taken.' }, { status: 409 });

    // 3. Prepare Pending Record
    const hashedPassword = await hashPassword(password);
    const verificationToken = randomUUID();
    
    // Store temporarily (expires in 24 hours)
    const pendingUser = {
        username,
        email,
        password: hashedPassword,
        createdAt: new Date().toISOString()
    };

    await usersKV.put(
        `pending_verify:${verificationToken}`, 
        JSON.stringify(pendingUser), 
        { expirationTtl: 86400 } // 24 hours
    );

    // 4. Send Email
    const emailSent = await sendVerificationEmail(email, verificationToken, url.origin);

    if (!emailSent) {
        // Rollback if email fails
        await usersKV.delete(`pending_verify:${verificationToken}`);
        return json({ message: 'Failed to send verification email.' }, { status: 500 });
    }

    return json({ 
        success: true, 
        message: 'Verification email sent. Please check your inbox.' 
    }, { status: 200 });
};