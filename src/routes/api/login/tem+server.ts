// src/routes/api/login/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateUser } from '$lib/server/auth';
import { createSession } from '$lib/server/sessionService';
import { findUserById } from '$lib/server/userService';
// [!code ++] Import dev to check environment
import { dev } from '$app/environment';

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
    try {
        const { email, password } = await request.json();

        const kv = platform?.env?.BETA_USERS_KV;
        const sessionKv = platform?.env?.BETA_SESSIONS_KV;

        if (!kv || !sessionKv) {
             return json({ error: 'Service Unavailable' }, { status: 503 });
        }

        const authResult = await authenticateUser(kv, email, password);
        
        if (!authResult) {
            return json({ error: 'Invalid credentials' }, { status: 401 });
        }

        const fullUser = await findUserById(kv, authResult.id);
        const now = new Date().toISOString();
        
        const sessionData = {
            id: authResult.id,
            name: authResult.username,
            email: authResult.email,
            plan: fullUser?.plan || 'free',
            tripsThisMonth: fullUser?.tripsThisMonth || 0,
            maxTrips: fullUser?.maxTrips || 10,
            resetDate: fullUser?.resetDate || now,
            role: fullUser?.role || 'user'
        };

        const sessionId = await createSession(sessionKv, sessionData);
        
        // [!code fix] Only require 'secure' in production
        cookies.set('session_id', sessionId, {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: !dev, 
            maxAge: 60 * 60 * 24 * 7 
        });

        return json({ user: sessionData });

    } catch (err) {
        console.error('Login error:', err);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};