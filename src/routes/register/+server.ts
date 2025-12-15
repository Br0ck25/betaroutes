// src/routes/register/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
import { findUserByEmail, findUserByUsername } from '$lib/server/userService';
import { sendVerificationEmail } from '$lib/server/email';
import { randomUUID } from 'node:crypto';

export const POST: RequestHandler = async ({ request, platform, url }) => {
    const usersKV = platform?.env?.BETA_USERS_KV;
    if (!usersKV) {
        return json({ message: 'Database not available' }, { status: 500 });
    }

    const { username, email, password } = await request.json();

    if (!username || !email || !password) {
        return json({ message: 'Missing fields' }, { status: 400 });
    }

    // 1. Check Duplicates
    const existingEmail = await findUserByEmail(usersKV, email);
    if (existingEmail) return json({ message: 'Email already in use.' }, { status: 409 });

    const existingUser = await findUserByUsername(usersKV, username);
    if (existingUser) return json({ message: 'Username taken.' }, { status: 409 });

    // 2. Prepare Pending Record (Do NOT create user yet)
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

    // 3. Send Email
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