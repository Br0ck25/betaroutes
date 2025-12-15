// src/routes/api/verify/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createUser } from '$lib/server/userService';
import { randomUUID } from 'node:crypto';
import { dev } from '$app/environment';

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
    const token = url.searchParams.get('token');
    
    const usersKV = platform?.env?.BETA_USERS_KV;
    // [!code fix] Get access to SESSIONS_KV to store the session correctly
    const sessionsKV = platform?.env?.BETA_SESSIONS_KV;
    
    if (!token || !usersKV || !sessionsKV) {
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

    // 3. Login Immediately
    const sessionId = randomUUID();
    
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

    // [!code fix] Store session in SESSIONS_KV (not USERS_KV)
    // [!code fix] Sync TTL with Cookie (30 Days = 2592000 seconds)
    await sessionsKV.put(sessionId, JSON.stringify(sessionData), {
        expirationTtl: 60 * 60 * 24 * 30
    });

    // [!code fix] Set 'session_id' cookie (Matches hooks.server.ts)
    cookies.set('session_id', sessionId, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: !dev,
        maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    // 4. Cleanup
    // [!code fix] Remove all pending keys:
    // - The pending user data
    // - The username reservation (unlocks the name, now owned by real user)
    // - The pending email index (used for resending emails)
    await Promise.all([
        usersKV.delete(pendingKey),
        usersKV.delete(`reservation:username:${pendingData.username.toLowerCase()}`),
        usersKV.delete(`idx:pending_email:${pendingData.email.toLowerCase()}`)
    ]);

    throw redirect(303, '/dashboard?welcome=true');
};