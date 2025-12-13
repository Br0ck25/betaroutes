// src/routes/api/verify/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createUser } from '$lib/server/userService';
import { createSession } from '$lib/server/sessionService';

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
    const token = url.searchParams.get('token');
    const usersKV = platform?.env?.BETA_USERS_KV;
    const sessionKv = platform?.env?.BETA_SESSIONS_KV;

    if (!token || !usersKV || !sessionKv) {
        throw redirect(303, '/login?error=invalid_link');
    }

    // 1. Get Pending Data
    const pendingDataRaw = await usersKV.get(`pending_verify:${token}`);
    if (!pendingDataRaw) {
        throw redirect(303, '/login?error=expired_link');
    }

    const pendingData = JSON.parse(pendingDataRaw);

    // 2. Create Real User (Now it's safe)
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

    // 3. Log them in immediately
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

    const sessionId = await createSession(sessionKv, sessionData);

    cookies.set('session_id', sessionId, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        maxAge: 60 * 60 * 24 * 7
    });

    // 4. Delete pending record so link can't be reused
    await usersKV.delete(`pending_verify:${token}`);

    throw redirect(303, '/dashboard?welcome=true');
};