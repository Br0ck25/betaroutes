// src/routes/api/change-password/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateUser, hashPassword } from '$lib/server/auth';
import { findUserById, updatePasswordHash } from '$lib/server/userService';
import { getEnv, safeKV } from '$lib/server/env';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
    // 1. Ensure user is logged in
    if (!locals.user) {
        return json({ message: 'Unauthorized' }, { status: 401 });
    }

    const body: any = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
        return json({ message: 'Current and new password are required' }, { status: 400 });
    }

    // [!code fix] Enforce Password Strength
    if (newPassword.length < 8) {
        return json({ message: 'New password must be at least 8 characters.' }, { status: 400 });
    }

    const env = getEnv(platform);
    const usersKV = safeKV(env, 'BETA_USERS_KV');
    if (!usersKV) {
        return json({ message: 'Database unavailable' }, { status: 500 });
    }

    // 2. Verify Current Password
    // Use the session's email or name to verify the "currentPassword" provided by the user
const authUser = await authenticateUser(usersKV, (locals.user as any).email || (locals.user as any).name, currentPassword);

    if (!authUser) {
        return json({ message: 'Incorrect current password' }, { status: 401 });
    }

    // 3. Get Full User Record
    // We need the full record (including internal fields) to update it safely
    const fullUser = await findUserById(usersKV, authUser.id);
    if (!fullUser) {
         return json({ message: 'User record not found' }, { status: 404 });
    }

    // 4. Hash New Password
    const newHash = await hashPassword(newPassword);

    // 5. Update in KV
    await updatePasswordHash(usersKV, fullUser, newHash);

    return json({ success: true });
};