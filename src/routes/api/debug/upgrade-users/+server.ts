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
		const skipped: any[] = [];

		const list = await kv.list({ prefix: 'user:' });

		for (const key of list.keys) {
			try {
				const raw = await kv.get(key.name);
				if (!raw) continue;

				const user = JSON.parse(raw);
				checked++;

				// 1. Determine if user is effectively 'free'
				// (Treat missing/null plan as 'free')
				const currentPlan = user.plan || 'free';
				const isFree = currentPlan === 'free';

				// 2. Check Creation Date
				// If missing createdAt, we assume they are an early user (upgrade them) 
				// OR skip them. Here we assume SAFE upgrade if missing (early alpha user).
				let isBeforeCutoff = false;
				if (user.createdAt) {
					const created = new Date(user.createdAt);
					isBeforeCutoff = created < cutoffDate;
				} else {
					// Edge case: No date? Assume early user -> Upgrade
					isBeforeCutoff = true; 
				}

				if (isFree && isBeforeCutoff) {
					// 3. Apply Upgrade
					user.plan = 'pro';
					user.maxTrips = 10000; 

					await kv.put(key.name, JSON.stringify(user));
					upgraded++;
					console.log(`[UPGRADE] User ${user.email} (${user.id}) upgraded to Pro.`);
				} else {
					// Log why we skipped
					skipped.push({
						id: user.id,
						email: user.email,
						reason: !isFree ? `Plan is '${currentPlan}'` : `Created after cutoff (${user.createdAt})`
					});
				}

			} catch (err) {
				console.error(`Failed to process key ${key.name}`, err);
				errors.push({ key: key.name, error: String(err) });
			}
		}

		return json({
			success: true,
			message: `Migration complete. Checked ${checked} users. Upgraded ${upgraded}.`,
			results: {
				totalChecked: checked,
				totalUpgraded: upgraded,
				skipped,
				errors
			}
		});

	} catch (err) {
		return json({ error: String(err) }, { status: 500 });
	}
};