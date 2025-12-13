// src/routes/api/verify/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createUser } from '$lib/server/userService';
import { createSession } from '$lib/server/sessionService';

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
    const token = url.searchParams.get('token');
    const usersKV = platform?.env?.BETA_USERS_KV;
    const sessionKv = platform?.env?.BETA_SESSIONS_KV; // Ensure you have this binding

    if (!token || !usersKV || !sessionKv) {
        throw redirect(303, '/login?error=invalid_verification');
    }

    // 1. Retrieve Pending Data
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
        password: pendingData.password, // Already hashed
        plan: 'free',
        tripsThisMonth: 0,
        maxTrips: 10,
        name: pendingData.username,
        resetDate: new Date().toISOString()
    });

    // 3. Auto-Login (Create Session)
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
        maxAge: 60 * 60 * 24 * 7 // 1 week
    });

    // 4. Cleanup
    await usersKV.delete(pendingKey);

    // 5. Success Redirect
    throw redirect(303, '/dashboard?welcome=true');
};