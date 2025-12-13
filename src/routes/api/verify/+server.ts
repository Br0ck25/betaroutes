// src/routes/api/verify/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createUser } from '$lib/server/userService';
// [!code --] import { createSession } from '$lib/server/sessionService';
import { randomUUID } from 'node:crypto'; // [!code ++]
import { dev } from '$app/environment'; // [!code ++]

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
    const token = url.searchParams.get('token');
    const usersKV = platform?.env?.BETA_USERS_KV;
    // [!code --] const sessionKv = platform?.env?.BETA_SESSIONS_KV;

    // [!code --] if (!token || !usersKV || !sessionKv) {
    if (!token || !usersKV) { // [!code ++]
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

    // 3. Login Immediately (Using logic compatible with hooks.server.ts)
    const sessionToken = randomUUID(); // [!code ++]
    
    const sessionData = {
        id: user.id,
        name: user.username,
        email: user.email,
        plan: user.plan,
        tripsThisMonth: user.tripsThisMonth,
        maxTrips: user.maxTrips,
        resetDate: user.resetDate,
        role: 'user' // [!code ++]
    };

    // Store in USERS_KV using the token as key, matching the hook's expectation
    await usersKV.put(sessionToken, JSON.stringify(sessionData)); // [!code ++]

    // Set the cookie named 'token' (NOT 'session_id')
    cookies.set('token', sessionToken, { // [!code ++]
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: !dev, // [!code ++]
        maxAge: 60 * 60 * 24 * 30 // 30 days // [!code ++]
    });

    // [!code --] const sessionId = await createSession(sessionKv, sessionData);
    // [!code --] cookies.set('session_id', sessionId, { ... });

    await usersKV.delete(pendingKey);
    throw redirect(303, '/dashboard?welcome=true');
};