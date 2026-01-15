// src/routes/api/expenses/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeExpenseService, type ExpenseRecord } from '$lib/server/expenseService';
import { getEnv, safeKV, safeDO } from '$lib/server/env';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import { log } from '$lib/server/log';

export const DELETE: RequestHandler = async (event) => {
	try {
		const user = event.locals.user as { id?: string; name?: string; token?: string } | undefined;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const env = getEnv(event.platform);
		const storageId = user.name || user.token || user.id || '';

		// Pass both the Main KV and Trash KV to the service
		const svc = makeExpenseService(
			safeKV(env, 'BETA_LOGS_KV')!,
			safeDO(env, 'TRIP_INDEX_DO')!,
			safeKV(env, 'BETA_LOGS_TRASH_KV')
		);
		await svc.delete(storageId, event.params.id);

		return new Response(JSON.stringify({ success: true }));
	} catch (err: unknown) {
		log.error('DELETE Expense Error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
	}
};

export const PUT: RequestHandler = async (event) => {
	try {
		const user = event.locals.user as { id?: string; name?: string; token?: string } | undefined;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const env = getEnv(event.platform);
		const storageId = user.name || user.token || user.id || '';

		const body = (await event.request.json()) as unknown;
		const svc = makeExpenseService(safeKV(env, 'BETA_EXPENSES_KV')!, safeDO(env, 'TRIP_INDEX_DO')!); // Trash KV not needed for update

		// Ensure ID matches URL
		const expense = {
			...(body as Record<string, unknown>),
			id: event.params.id,
			userId: storageId
		};
		await svc.put(expense as ExpenseRecord);

		return new Response(JSON.stringify(expense));
	} catch (err: unknown) {
		log.error('PUT Expense Error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
	}
};
