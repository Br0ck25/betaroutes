import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform }) => {
	try {
		const kv = platform?.env?.BETA_USERS_KV;
		if (!kv) {
			return json({ error: 'KV not found' }, { status: 500 });
		}

		// Cutoff Date: January 31, 2026
		const cutoffDate = new Date('2026-01-31T23:59:59.999Z');
		
		let checked = 0;
		let upgraded = 0;
		const errors: any[] = [];

		// 1. List all keys starting with "user:" (skips index keys like "idx:email:...")
		const list = await kv.list({ prefix: 'user:' });

		for (const key of list.keys) {
			try {
				const raw = await kv.get(key.name);
				if (!raw) continue;

				const user = JSON.parse(raw);
				checked++;

				// 2. Check strict criteria:
				// - Must have a createdAt date
				// - Must be currently 'free'
				// - Created date must be strictly BEFORE the cutoff
				if (user.createdAt && user.plan === 'free') {
					const created = new Date(user.createdAt);

					if (created < cutoffDate) {
						// 3. Apply Upgrade
						user.plan = 'pro';
						
						// Update maxTrips to reflect unlimited (visually for the UI)
						// The app logic mainly checks 'plan', but this helps the settings UI progress bar.
						user.maxTrips = 10000; 

						await kv.put(key.name, JSON.stringify(user));
						upgraded++;
						console.log(`[UPGRADE] User ${user.email} (${user.id}) upgraded to Pro.`);
					}
				}
			} catch (err) {
				console.error(`Failed to process key ${key.name}`, err);
				errors.push({ key: key.name, error: String(err) });
			}
		}

		return json({
			success: true,
			message: `Migration complete. Checked ${checked} users.`,
			results: {
				totalChecked: checked,
				totalUpgraded: upgraded,
				errors
			}
		});

	} catch (err) {
		return json({ error: String(err) }, { status: 500 });
	}
};