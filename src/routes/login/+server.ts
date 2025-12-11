// src/routes/login/+server.ts
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { authenticateUser } from '$lib/server/auth';
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

    // 2. Authenticate the user
    // This now returns the user's plan and usage stats thanks to the fix in auth.ts
    const user = await authenticateUser(usersKV, identifier, password);

    if (!user) {
        return new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 });
    }

    // --- Secure Session Setup ---

    // 3. Generate a secure, random session token
    const newToken = randomUUID();
    
    // 4. Create the session data payload for KV.
    const sessionData = {
        // Core User Data
        id: user.id,
        name: user.username, 
        email: user.email,
        
        // FIX: Use the actual values from the authenticated user record
        // instead of hardcoded defaults.
        plan: user.plan,                 
        tripsThisMonth: user.tripsThisMonth, 
        maxTrips: user.maxTrips,         
        resetDate: user.resetDate,       
    };

    // 5. Store the session token linked to the user's data in BETA_USERS_KV
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