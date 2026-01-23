import type { PageServerLoad } from './$types';
import { makeExpenseService } from '$lib/server/expenseService';
import { safeKV, safeDO } from '$lib/server/env';
import { getStorageId } from '$lib/server/user';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const user = locals.user;
	if (!user) return { expenses: [] };

	const kv = safeKV(platform?.env, 'BETA_EXPENSES_KV');
	const tripDO = safeDO(platform?.env, 'TRIP_INDEX_DO');

	if (!kv || !tripDO) {
		return { expenses: [] };
	}

	const service = makeExpenseService(kv, tripDO);
	const userId = getStorageId(user);

	// Fetch all active expenses
	const expenses = await service.list(userId);

	return {
		expenses
	};
};
