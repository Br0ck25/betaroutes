// src/routes/api/verify/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createUser } from '$lib/server/userService';
import { randomUUID } from 'node:crypto'; // [!code ++] Use standard crypto
import { dev } from '$app/environment';   // [!code ++] For cookie security

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
    const token = url.searchParams.get('token');
    
    // [!code fix] Use ONLY BETA_USERS_KV (Single Source of Truth)
    const usersKV = platform?.env?.BETA_USERS_KV;
    
    if (!token || !usersKV) {
        throw redirect(303, '/login?error=invalid_verification');
    }

    // 1. Get Pending Data
    const pendingKey = `pending_verify:${token}`;
    const pendingDataRaw = await usersKV.get(pendingKey);

    if (!pendingDataRaw) {
        throw redirect(303, '/login?error=expired_verification');
    }

    const pendingData = JSON.parse(pendingDataRaw);

    // 2. Create Real User
    const user = await createUser(usersKV, {
        username: pendingData.username,
        email: pendingData.email,
        password: pendingData.password, 
        plan: 'free',
        tripsThisMonth: 0,
        maxTrips: 10,
        name: pendingData.username,
        resetDate: new Date().toISOString()
    });

    // 3. Login Immediately (Corrected to match login/+server.ts)
    const sessionToken = randomUUID(); // [!code ++] Generate new token
    
    const sessionData = {
        id: user.id,
        name: user.username,
        email: user.email,
        plan: user.plan,
        tripsThisMonth: user.tripsThisMonth,
        maxTrips: user.maxTrips,
        resetDate: user.resetDate,
        role: 'user'
    };

    // [!code fix] Store session in USERS_KV using the token as key
    await usersKV.put(sessionToken, JSON.stringify(sessionData));

    // [!code fix] Set 'token' cookie (NOT 'session_id')
    cookies.set('token', sessionToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: !dev,
        maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    // 4. Cleanup and Redirect
    await usersKV.delete(pendingKey);
    throw redirect(303, '/dashboard?welcome=true');
};