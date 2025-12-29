import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
import { findUserById } from '$lib/server/userService'; // Ensure updateUser exists, see note below

export const POST: RequestHandler = async ({ request, platform }) => {
	const usersKV = platform?.env?.BETA_USERS_KV;
	if (!usersKV) {
		return json({ message: 'Database Unavailable' }, { status: 503 });
	}

	const body = (await request.json()) as { token?: string; password?: string };
	const { token, password } = body;

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
	const user = await findUserById(
		usersKV as unknown as import('@cloudflare/workers-types').KVNamespace,
		resetData.userId
	);
	if (!user) {
		return json({ message: 'User not found' }, { status: 404 });
	}

	// 3. Hash New Password
	const hashedPassword = await hashPassword(password);

	// 4. Update User Password
	// If you don't have a specific `updateUser` function, we manually update the user object here:
	user.password = hashedPassword;

	// Save updated user back to KV
	// Assuming users are stored by ID as well as secondary indices.
	// In typical KV setups we update the main record.
	await usersKV.put(user.id, JSON.stringify(user));

	// 5. Cleanup - Delete the used token
	await usersKV.delete(resetKey);

	return json({ success: true });
};
