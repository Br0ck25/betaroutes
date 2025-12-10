import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform }) => {
	try {
		const kv = platform?.env?.BETA_USERS_KV;
		if (!kv) {
			return json({ error: 'KV not found' }, { status: 500 });
		}

		let checked = 0;
		let upgradedCount = 0;
		const logs: string[] = [];

		// 1. List ALL keys (no prefix restriction)
		const list = await kv.list({ prefix: '' });

		for (const key of list.keys) {
			const raw = await kv.get(key.name);
			if (!raw) continue;

			try {
				// 2. Try to parse every value
				const data = JSON.parse(raw);
				checked++;

				// 3. Duck-typing: Does this look like a user record?
				// It must have 'id', 'email', and 'plan' (or be a target for a plan)
				if (data && typeof data === 'object' && data.id && data.email) {
                    
                    // Force the upgrade
					data.plan = 'pro';
					data.maxTrips = 10000;

					// Save it back to the exact same key
					await kv.put(key.name, JSON.stringify(data));
					
					upgradedCount++;
					logs.push(`✅ Updated key [${key.name}] for user ${data.email}`);
				}
			} catch (e) {
				// Not a JSON object or not a user record; ignore
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