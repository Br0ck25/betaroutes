// src/routes/api/reset-password/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
import { findUserById, updatePasswordHash } from '$lib/server/userService';
import { z } from 'zod';

// Input validation schema
const resetSchema = z.object({
    token: z.string().min(1, 'Token is required'),
    password: z.string().min(8, 'Password must be at least 8 characters')
});

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
    try {
        const kv = platform?.env?.BETA_USERS_KV;
        const sessionsKV = platform?.env?.BETA_SESSIONS_KV;

        if (!kv) {
            return json({ message: 'Service Unavailable' }, { status: 503 });
        }

        const body = await request.json();
        
        // 1. Validate Input
        const result = resetSchema.safeParse(body);
        if (!result.success) {
            return json({ 
                message: 'Invalid input', 
                errors: result.error.flatten().fieldErrors 
            }, { status: 400 });
        }

        const { token, password } = result.data;

        // 2. Validate Token
        // Look up the User ID associated with this reset token
        const resetKey = `reset_token:${token}`;
        const userId = await kv.get(resetKey);

        if (!userId) {
            return json({ message: 'Invalid or expired reset token.' }, { status: 400 });
        }

        // 3. Fetch User Record
        // Must use service to ensure we get the full record (Core + Stats)
        const user = await findUserById(kv, userId);
        if (!user) {
            return json({ message: 'User not found.' }, { status: 404 });
        }

        // 4. Hash New Password
        const newHash = await hashPassword(password);

        // 5. Update Password Securely
        // [Corrective Action] Use updatePasswordHash to prevent phantom writes/data loss
        await updatePasswordHash(kv, user, newHash);

        // 6. Security: Cleanup & Session Invalidation
        // Delete the used token immediately
        await kv.delete(resetKey);

        // Optional: Invalidate all existing sessions for this user to force re-login
        // (Highly recommended after a password reset)
        if (sessionsKV) {
            const activeSessionKey = `active_session:${userId}`;
            const activeSessionId = await sessionsKV.get(activeSessionKey);
            if (activeSessionId) {
                await sessionsKV.delete(activeSessionId);
                await sessionsKV.delete(activeSessionKey);
            }
        }

        // Clear any session cookies on this client
        cookies.delete('session_id', { path: '/' });
        cookies.delete('__Host-session_id', { path: '/' });

        return json({ success: true, message: 'Password reset successfully. Please log in.' });

    } catch (err) {
        console.error('Reset password error:', err);
        return json({ message: 'Internal Server Error' }, { status: 500 });
    }
};