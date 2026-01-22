// src/routes/dashboard/mileage/+page.server.ts
import type { PageServerLoad } from './$types';
import { makeMileageService } from '$lib/server/mileageService';
import { safeKV, safeDO } from '$lib/server/env';
import { getStorageId } from '$lib/server/user';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const user = locals.user as { id?: string; name?: string; token?: string } | null;
	if (!user) return { mileage: [] };

	// Safely access bindings
	const kv = safeKV(platform?.env, 'BETA_MILLAGE_KV');
	const tripDO = safeDO(platform?.env, 'TRIP_INDEX_DO');

	if (!kv || !tripDO) {
		return { mileage: [] };
	}

	const service = makeMileageService(kv, tripDO);
	const userId = getStorageId(user);
	// [!code fix] Legacy migration: also check username-based keys
	const legacyUserId = user.name || undefined;

	// Fetch full list without 'since' to get all active records
	const mileage = await service.list(userId, undefined, legacyUserId);

	return {
		mileage
	};
};
