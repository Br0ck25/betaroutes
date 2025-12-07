// src/routes/api/debug/users/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	try {
		const kv = platform?.env?.BETA_USERS_KV;
		if (!kv) {
			return json({ error: 'KV not found' });
		}

		// List all keys (users)
		const list = await kv.list({ prefix: '' });

		// Fetch details for each key
		const users = await Promise.all(
			list.keys.map(async (key: { name: string }) => {
				const value = await kv.get(key.name);
				return {
					key: key.name,
					value: value ? JSON.parse(value) : null
				};
			})
		);

		return json({
			count: users.length,
			users
		});
	} catch (err) {
		return json({ error: String(err) }, { status: 500 });
	}
};

// NEW: Add capability to delete users manually
export const DELETE: RequestHandler = async ({ url, platform }) => {
	const kv = platform?.env?.BETA_USERS_KV;
	const key = url.searchParams.get('key'); // ?key=...

	if (!kv) return json({ error: 'KV not found' }, { status: 500 });

	if (key) {
		// Delete specific user
		await kv.delete(key);
		return json({ success: true, message: `Deleted user: ${key}` });
	} else {
		// Delete ALL users (Cleanup)
		const list = await kv.list({ prefix: '' });
		for (const k of list.keys) {
			await kv.delete(k.name);
		}
		return json({ success: true, message: `Deleted all ${list.keys.length} users` });
	}
};
