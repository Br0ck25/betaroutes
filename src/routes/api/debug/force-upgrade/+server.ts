// src/routes/api/debug/force-upgrade/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform }) => {
	try {
		const kv = platform?.env?.BETA_USERS_KV;
		if (!kv) return json({ error: 'KV not found' }, { status: 500 });

		let checked = 0;
		let upgradedCount = 0;
		const logs: string[] = [];

		// [!code fix] Implement pagination loop to fetch more than 1,000 keys
		let list = await kv.list({ prefix: '' });
		const keys = [...list.keys];

		while (!list.list_complete && list.cursor) {
			list = await kv.list({ prefix: '', cursor: list.cursor });
			keys.push(...list.keys);
		}

		for (const key of keys) {
			const raw = await kv.get(key.name);
			if (!raw) continue;

			try {
				const data = JSON.parse(raw);
				checked++;

				if (data && typeof data === 'object' && data.id && data.email) {
					data.plan = 'pro';
					data.maxTrips = 10000;
					await kv.put(key.name, JSON.stringify(data));
					upgradedCount++;
					logs.push(`✅ Updated [${key.name}] for ${data.email}`);
				}
			} catch (_e: unknown) {
				void _e;
			}
		}

		return json({
			success: true,
			message: `Universal upgrade complete. Scanned ${checked} keys. Updated ${upgradedCount}.`,
			logs
		});
	} catch (err) {
		return json({ error: String(err) }, { status: 500 });
	}
};
