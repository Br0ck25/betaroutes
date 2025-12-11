// src/routes/login/+server.ts
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { authenticateUser } from '$lib/server/auth';
// CRITICAL FIX: Removed insecure import of { setSessionCookie } from '$lib/server/session';
import { randomUUID } from 'node:crypto';

export const POST: RequestHandler = async ({ request, cookies, platform }) => {
    // 1. Get KV Store for authentication and session storage
    const usersKV = platform?.env?.BETA_USERS_KV;
    if (!usersKV) {
        return new Response(JSON.stringify({ message: 'Internal Server Error: Database not available' }), { status: 500 });
    }

    const { identifier, password } = await request.json();

    if (!identifier || !password) {
        return new Response(JSON.stringify({ message: 'Missing fields' }), { status: 400 });
    }

    // CRITICAL FIX: Pass the KV store (usersKV) to authenticateUser
    // This allows the migration logic and lookups to function.
    const user = await authenticateUser(usersKV, identifier, password);

    if (!user) {
        return new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 });
    }

    // --- CRITICAL FIX: Secure Session Setup ---

    // 3. Generate a secure, random session token
    const newToken = randomUUID();
    const now = new Date().toISOString();

    // 4. Create the session data payload for KV.
    const sessionData = {
        // Core User Data
        id: user.id,
        name: user.username, 
        email: user.email,
        
        // Subscription/Usage Data (Hooks will now successfully load these)
        plan: 'free',
        tripsThisMonth: 0,
        maxTrips: 10,
        resetDate: now,
    };

    // 5. Store the session token linked to the user's data in BETA_USERS_KV
    // The key is the token string itself, as expected by hooks.server.ts
    await usersKV.put(newToken, JSON.stringify(sessionData));

    // 6. Set the secure session token cookie
    cookies.set('token', newToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: !dev,
        maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    // 7. Return success response
    return new Response(JSON.stringify({ user }), { status: 200 });
};