// src/routes/login/+server.ts
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { authenticateUser } from '$lib/server/auth';
import { randomUUID } from 'node:crypto';

export const POST: RequestHandler = async ({ request, cookies, platform }) => {
    const usersKV = platform?.env?.BETA_USERS_KV;
    if (!usersKV) {
        return new Response(JSON.stringify({ message: 'Internal Server Error: Database not available' }), { status: 500 });
    }

    const { identifier, password } = await request.json();

    if (!identifier || !password) {
        return new Response(JSON.stringify({ message: 'Missing fields' }), { status: 400 });
    }

    const user = await authenticateUser(usersKV, identifier, password);

    if (!user) {
        return new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 });
    }

    // Create Session
    const newToken = randomUUID();
    const now = new Date().toISOString();

    const sessionData = {
        id: user.id,
        name: user.username, 
        email: user.email,
        plan: 'free',
        tripsThisMonth: 0,
        maxTrips: 10,
        resetDate: now,
    };

    // Store session in KV
    await usersKV.put(newToken, JSON.stringify(sessionData));

    // Set 'token' cookie (Critical: Must match hooks.server.ts)
    cookies.set('token', newToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: !dev,
        maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    return new Response(JSON.stringify({ user }), { status: 200 });
};