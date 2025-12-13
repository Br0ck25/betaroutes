// src/routes/login/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateUser } from '$lib/server/auth';
import { createSession } from '$lib/server/sessionService';
import { findUserById } from '$lib/server/userService';
import { dev } from '$app/environment';

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
    try {
        const { email, password } = await request.json();

        // 1. Get bindings
        const kv = platform?.env?.BETA_USERS_KV;
        const sessionKv = platform?.env?.BETA_SESSIONS_KV;

        if (!kv || !sessionKv) {
             console.error('KV Binding Missing. Check wrangler.toml');
             return json({ error: 'Service Unavailable' }, { status: 503 });
        }

        // 2. Authenticate
        const authResult = await authenticateUser(kv, email, password);
        
        if (!authResult) {
            return json({ error: 'Invalid credentials' }, { status: 401 });
        }

        // 3. Fetch Full User details
        const fullUser = await findUserById(kv, authResult.id);
        const now = new Date().toISOString();
        
        // 4. Prepare Session Data
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

        // 5. Create Session in SESSIONS_KV
        const sessionId = await createSession(sessionKv, sessionData);
        
        // 6. Set Cookie
        // CRITICAL: secure must be false in dev for localhost to work
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