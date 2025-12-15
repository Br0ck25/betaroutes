// src/routes/login/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateUser } from '$lib/server/auth';
import { createSession, deleteSession } from '$lib/server/sessionService';
import { findUserById } from '$lib/server/userService';
import { checkRateLimit } from '$lib/server/rateLimit';
import { dev } from '$app/environment';

export const POST: RequestHandler = async ({ request, platform, cookies, getClientAddress }) => {
    try {
        const body = await request.json();
        const { email, password } = body;

        // 1. Get bindings
        const kv = platform?.env?.BETA_USERS_KV;
        const sessionKv = platform?.env?.BETA_SESSIONS_KV;
        const logsKv = platform?.env?.BETA_LOGS_KV;

        if (!kv || !sessionKv || !logsKv) {
             console.error('KV Binding Missing. Check wrangler.toml');
             return json({ error: 'Service Unavailable' }, { status: 503 });
        }

        // 2. Rate Limiting (10 attempts per minute)
        const ip = getClientAddress();
        const limit = await checkRateLimit(logsKv, ip, 'login_attempt', 10, 60);
        if (!limit.allowed) {
            return json({ error: 'Too many login attempts. Please wait.' }, { status: 429 });
        }

        // 3. Authenticate
        const authResult = await authenticateUser(kv, email, password);
        
        if (!authResult) {
            return json({ error: 'Invalid credentials' }, { status: 401 });
        }

        // 4. Fetch Full User details (to ensure we have roles/plans)
        const fullUser = await findUserById(kv, authResult.id);
        const now = new Date().toISOString();
        
        // 5. Concurrent Session Invalidation
        // Check if there is already an active session for this user and invalidate it
        const activeKey = `active_session:${authResult.id}`;
        const oldSessionId = await sessionKv.get(activeKey);
        if (oldSessionId) {
            await deleteSession(sessionKv, oldSessionId);
        }

        // 6. Prepare New Session Data
        const sessionData = {
            id: authResult.id,
            name: authResult.username,
            email: authResult.email,
            plan: fullUser?.plan || 'free',
            tripsThisMonth: fullUser?.tripsThisMonth || 0,
            maxTrips: fullUser?.maxTrips || 10,
            resetDate: fullUser?.resetDate || now,
            role: fullUser?.role || 'user',
            createdAt: Date.now() // For rolling sessions
        };

        // 7. Create Session & Update Active Mapping
        const sessionId = await createSession(sessionKv, sessionData);
        await sessionKv.put(activeKey, sessionId, { expirationTtl: 60 * 60 * 24 * 30 });
        
        // 8. Set Cookie
        // Use __Host- prefix in production
        const cookieName = dev ? 'session_id' : '__Host-session_id';

        cookies.set(cookieName, sessionId, {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: !dev, 
            maxAge: 60 * 60 * 24 * 30 // 30 days matches session TTL
        });

        // 9. Return User & Token (for client-side state)
        return json({ 
            success: true, 
            user: sessionData,
            token: sessionId
        });

    } catch (err) {
        console.error('Login error:', err);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};