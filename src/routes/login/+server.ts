import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { authenticateUser } from '$lib/server/auth';
import { randomUUID } from 'node:crypto';

export const POST: RequestHandler = async ({ request, cookies, platform }) => {
    // 1. Setup DB
    const usersKV = platform?.env?.BETA_USERS_KV;
    if (!usersKV) {
        return new Response(JSON.stringify({ message: 'Database not available' }), { status: 500 });
    }

    // 2. Parse Request
    const { email, password } = await request.json(); // Frontend sends 'email' key

    if (!email || !password) {
        return new Response(JSON.stringify({ message: 'Missing fields' }), { status: 400 });
    }

    // 3. Authenticate
    const user = await authenticateUser(usersKV, email, password);

    if (!user) {
        return new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 });
    }

    // 4. Create Session (New System)
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
        role: 'user'
    };

    // Store in USERS_KV (not sessions KV)
    await usersKV.put(newToken, JSON.stringify(sessionData));

    // 5. Set 'token' Cookie
    cookies.set('token', newToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: !dev,
        maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    return new Response(JSON.stringify({ success: true, user }), { status: 200 });
};