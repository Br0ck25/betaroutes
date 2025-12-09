// src/routes/register/+server.ts
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
// CRITICAL FIX: Import all necessary functions from the user service
import { findUserByEmail, findUserByUsername, createUser } from '$lib/server/userService';
import { randomUUID } from 'node:crypto'; // Used to generate the session token

// ... (Helper functions from previous step are now in userService.ts and can be removed/imported)

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
    // 1. Get KV Store
    const usersKV = platform?.env?.BETA_USERS_KV;
    if (!usersKV) {
        return new Response(JSON.stringify({ message: 'Internal Server Error: Database not available' }), { status: 500 });
    }

    const { username, email, password } = await request.json();

    // 2. Validate Input
    if (!username || !email || !password) {
        return new Response(JSON.stringify({ message: 'Missing fields: username, email, and password are required.' }), { status: 400 });
    }

    // --- CRITICAL FIX: DUPLICATE USER CHECK ---
    
    // Check if email is already in use
    const existingUserByEmail = await findUserByEmail(usersKV, email);
    if (existingUserByEmail) {
        return new Response(JSON.stringify({ message: 'This email is already registered.' }), { status: 409 });
    }

    // Check if username is already in use
    const existingUserByUsername = await findUserByUsername(usersKV, username);
    if (existingUserByUsername) {
        return new Response(JSON.stringify({ message: 'This username is already taken.' }), { status: 409 });
    }
    // -------------------------------------------


    // 3. Security: Hash the password
    const hashedPassword = await hashPassword(password);
    
    // 4. Prepare data for service function
    const userData = {
        username,
        email,
        password: hashedPassword,
        plan: 'free',
        tripsThisMonth: 0,
        maxTrips: 10,
        // The resetDate and name will be set by the createUser service function
    };

    // 5. Create new user and indices via service (returns the created User object)
    const user = await createUser(usersKV, {
        ...userData,
        name: username, // Default name
        resetDate: new Date().toISOString(),
    });


    // 6. Store the session token record in KV
    const newToken = randomUUID();
    const now = new Date().toISOString();
    
    // Value: The user data object that hooks.server.ts expects to retrieve/parse.
    const sessionData = {
        id: user.id,
        name: user.username, 
        email: user.email,
        plan: user.plan,
        tripsThisMonth: user.tripsThisMonth,
        maxTrips: user.maxTrips,
        resetDate: user.resetDate,
    };
    
    // Key: The token string itself (as expected by hooks.server.ts)
    await usersKV.put(newToken, JSON.stringify(sessionData));


    // 7. Set the secure session token cookie
    cookies.set('token', newToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: !dev,
        maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    // 8. Return success response
    return new Response(JSON.stringify({ user: { id: user.id, username, email } }), { status: 201 });
};