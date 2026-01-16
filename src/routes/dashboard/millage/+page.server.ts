// src/routes/dashboard/millage/+page.server.ts
import type { PageServerLoad } from './$types';
import { makeMillageService } from '$lib/server/millageService';
import { safeKV, safeDO } from '$lib/server/env';
import { getStorageId } from '$lib/server/user';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const user = locals.user;
	if (!user) return { millage: [] };

	// Safely access bindings
	const kv = safeKV(platform?.env, 'BETA_MILLAGE_KV');
	const tripDO = safeDO(platform?.env, 'TRIP_INDEX_DO');

	if (!kv || !tripDO) {
		return { millage: [] };
	}

	const service = makeMillageService(kv, tripDO);
	const userId = getStorageId(user);

	// Fetch full list without 'since' to get all active records
	const millage = await service.list(userId);

	return {
		millage
	};
};
