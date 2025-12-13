// src/routes/api/login/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateUser } from '$lib/server/authService';
import { createSession } from '$lib/server/sessionService';
import { findUserById } from '$lib/server/userService';

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
    try {
        const { email, password } = await request.json();

        const kv = platform?.env?.BETA_USERS_KV;
        const sessionKv = platform?.env?.BETA_SESSIONS_KV;

        if (!kv || !sessionKv) {
             return json({ error: 'Service Unavailable' }, { status: 503 });
        }

        // 1. Authenticate (Check credentials)
        const authResult = await authenticateUser(kv, email, password);
        
        if (!authResult) {
            return json({ error: 'Invalid credentials' }, { status: 401 });
        }

        // 2. Fetch Full User Record (CRITICAL FIX)
        // We must retrieve the full record to get their actual Plan,
        // otherwise we might accidentally downgrade them to 'free' defaults.
        const fullUser = await findUserById(kv, authResult.id);
        
        const now = new Date().toISOString();
        
        // 3. Construct Session Data using REAL database values
        const sessionData = {
            id: authResult.id,
            name: authResult.username,
            email: authResult.email,
            
            // Use DB data, fallback to defaults only if genuinely missing (new users)
            plan: fullUser?.plan || 'free',
            tripsThisMonth: fullUser?.tripsThisMonth || 0,
            maxTrips: fullUser?.maxTrips || 10,
            resetDate: fullUser?.resetDate || now,
            
            role: fullUser?.role || 'user'
        };

        // 4. Create Session in KV
        const sessionId = await createSession(sessionKv, sessionData);
        
        // 5. Set HttpOnly Cookie
        cookies.set('session_id', sessionId, {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 24 * 7 // 1 week
        });

        // Return user info to the client (for the Svelte Store)
        return json({ user: sessionData });

    } catch (err) {
        console.error('Login error:', err);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};