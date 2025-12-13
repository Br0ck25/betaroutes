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

    // Check Duplicates
    const existingEmail = await findUserByEmail(usersKV, email);
    if (existingEmail) return json({ message: 'Email already in use.' }, { status: 409 });

    const existingUser = await findUserByUsername(usersKV, username);
    if (existingUser) return json({ message: 'Username taken.' }, { status: 409 });

    // Prepare Pending Record (Expires in 24h)
    const hashedPassword = await hashPassword(password);
    const verificationToken = randomUUID();
    
    const pendingUser = {
        username,
        email,
        password: hashedPassword,
        createdAt: new Date().toISOString()
    };

    await usersKV.put(
        `pending_verify:${verificationToken}`, 
        JSON.stringify(pendingUser), 
        { expirationTtl: 86400 }
    );

    // Send Email (Do NOT log in)
    const emailSent = await sendVerificationEmail(email, verificationToken, url.origin);

    if (!emailSent) {
        await usersKV.delete(`pending_verify:${verificationToken}`);
        return json({ message: 'Failed to send verification email.' }, { status: 500 });
    }

    return json({ success: true, message: 'Verification email sent.' });
};