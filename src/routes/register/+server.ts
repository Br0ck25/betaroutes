// src/routes/register/+server.ts
import { dev } from '$app/environment';
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

    // 2. Prepare Pending Record
    const hashedPassword = await hashPassword(password);
    const verificationToken = randomUUID();
    
    // We store this in KV with a 24-hour expiration
    const pendingUser = {
        username,
        email,
        password: hashedPassword,
        createdAt: new Date().toISOString()
    };

    // Store in KV: "pending_verify:TOKEN" -> UserData
    await usersKV.put(
        `pending_verify:${verificationToken}`, 
        JSON.stringify(pendingUser), 
        { expirationTtl: 86400 } // Expires in 24 hours
    );

    // 3. Send Email
    // Note: We DO NOT set a session cookie here. The user is NOT logged in yet.
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