// src/routes/dashboard/mileage/+page.server.ts
import type { PageServerLoad } from './$types';
import { makeMileageService } from '$lib/server/mileageService';
import { safeKV, safeDO } from '$lib/server/env';
import { getStorageId } from '$lib/server/user';

export const load: PageServerLoad = async ({ locals, platform }) => {
  const user = locals.user;
  if (!user) return { mileage: [] };

  // Safely access bindings
  const kv = safeKV(platform?.env, 'BETA_MILEAGE_KV');
  const tripDO = safeDO(platform?.env, 'TRIP_INDEX_DO');

  if (!kv || !tripDO) {
    return { mileage: [] };
  }

  const service = makeMileageService(kv, tripDO);
  const userId = getStorageId(user);

  // Fetch full list without 'since' to get all active records
  const mileage = await service.list(userId);

  return {
    mileage
  };
};
