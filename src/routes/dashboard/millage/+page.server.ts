import type { PageServerLoad } from './$types';
import { makeMillageService } from '$lib/server/millageService';
import { safeKV, safeDO } from '$lib/server/env';
import { getStorageId } from '$lib/server/user';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const user = locals.user;
	if (!user) return { millage: [] };

	const kv = safeKV(platform!.env, 'BETA_MILLAGE_KV');
	const tripDO = safeDO(platform!.env, 'TRIP_INDEX_DO');

	if (!kv || !tripDO) {
		return { millage: [] };
	}

	const service = makeMillageService(kv, tripDO);
	const userId = getStorageId(user);

	// Fetch full list (no 'since' param) so the page renders with data immediately
	const millage = await service.list(userId);

	return {
		millage
	};
};