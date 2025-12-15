// src/routes/reset-password/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
import { findUserById, updatePasswordHash } from '$lib/server/userService'; // [!code fix] Import correct helper

export const POST: RequestHandler = async ({ request, platform }) => {
    const usersKV = platform?.env?.BETA_USERS_KV;
    if (!usersKV) {
        return json({ message: 'Database Unavailable' }, { status: 503 });
    }

    const { token, password } = await request.json();

    if (!token || !password) {
        return json({ message: 'Missing fields' }, { status: 400 });
    }

    // 1. Retrieve Reset Token Data
    const resetKey = `reset_token:${token}`;
    const resetDataRaw = await usersKV.get(resetKey);

    if (!resetDataRaw) {
        return json({ message: 'Invalid or expired link' }, { status: 400 });
    }

    const resetData = JSON.parse(resetDataRaw);

    // 2. Fetch User to ensure they still exist
    const user = await findUserById(usersKV, resetData.userId);
    if (!user) {
        return json({ message: 'User not found' }, { status: 404 });
    }

    // 3. Hash New Password
    const hashedPassword = await hashPassword(password);

    // [!code fix] 4. Update User Password via Service
    // This handles the correct key prefixes (e.g. "user:123") and any necessary migrations.
    // Previous code wrote to `user.id` directly, which created a phantom record.
    await updatePasswordHash(usersKV, user, hashedPassword);

    // 5. Cleanup - Delete the used token
    await usersKV.delete(resetKey);

    return json({ success: true });
};