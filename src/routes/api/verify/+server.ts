// src/routes/api/verify/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createUser, findUserByEmail, findUserByUsername } from '$lib/server/userService';
import { createSession } from '$lib/server/sessionService';
import { dev } from '$app/environment';

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
    const token = url.searchParams.get('token');
    
    const usersKV = platform?.env?.BETA_USERS_KV;
    const sessionKV = platform?.env?.BETA_SESSIONS_KV;
    
    if (!token || !usersKV || !sessionKV) {
        throw redirect(303, '/login?error=invalid_verification');
    }

    // 1. Get Pending Data
    const pendingKey = `pending_verify:${token}`;
    const pendingDataRaw = await usersKV.get(pendingKey);

    if (!pendingDataRaw) {
        throw redirect(303, '/login?error=expired_verification');
    }

    let pendingData;
    try {
        pendingData = JSON.parse(pendingDataRaw);
    } catch (e) {
        throw redirect(303, '/login?error=corrupted_data');
    }

    // 2. Idempotency & Race Condition Check
    // Prevent creating duplicate users if the user clicks the link twice rapidly
    const existingEmail = await findUserByEmail(usersKV, pendingData.email);
    const existingUser = await findUserByUsername(usersKV, pendingData.username);
    
    if (existingEmail || existingUser) {
        // User already exists, clean up pending and redirect to login
        await usersKV.delete(pendingKey);
        throw redirect(303, '/login?info=already_verified');
    }

    // 3. Create Real User
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

    // 4. Create Session
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

    const sessionId = await createSession(sessionKV, sessionData);
    
    // Store active session mapping for invalidation logic
    await sessionKV.put(`active_session:${user.id}`, sessionId);

    // 5. Set Secure Cookie
    // Use __Host- prefix in production for added security
    const cookieName = dev ? 'session_id' : '__Host-session_id';
    
    cookies.set(cookieName, sessionId, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: !dev,
        maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    // 6. Cleanup and Redirect
    await usersKV.delete(pendingKey);
    throw redirect(303, '/dashboard?welcome=true');
};