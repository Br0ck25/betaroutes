// src/routes/dashboard/expenses/+page.server.ts
import type { PageServerLoad } from './$types';
import { makeExpenseService } from '$lib/server/expenseService';
import { safeKV, safeDO } from '$lib/server/env';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const user = locals.user as { id?: string; name?: string; token?: string } | undefined;
	// Ensure user exists and has an ID before proceeding
	if (!user || !user.id) return { expenses: [] };

	const kv = safeKV(platform?.env, 'BETA_EXPENSES_KV');
	const tripDO = safeDO(platform?.env, 'TRIP_INDEX_DO');

	if (!kv || !tripDO) {
		return { expenses: [] };
	}

	const service = makeExpenseService(kv, tripDO);

	// [!code fix] Strictly use ID. Prevents username spoofing.
	const userId = user.id;

	// Fetch all active expenses
	const expenses = await service.list(userId);

	return {
		expenses
	};
};
