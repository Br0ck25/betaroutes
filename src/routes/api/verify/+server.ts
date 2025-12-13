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
        throw redirect(303, '/login?error=invalid_verification');
    }

    const pendingKey = `pending_verify:${token}`;
    const pendingDataRaw = await usersKV.get(pendingKey);

    if (!pendingDataRaw) {
        throw redirect(303, '/login?error=expired_verification');
    }

    const pendingData = JSON.parse(pendingDataRaw);

    // Create Real User
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

    // Auto-Login
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
        secure: true, // Always true in prod
        maxAge: 60 * 60 * 24 * 7
    });

    await usersKV.delete(pendingKey);
    throw redirect(303, '/dashboard?welcome=true');
};