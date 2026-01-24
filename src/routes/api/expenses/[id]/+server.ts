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

		// [!code fix] Strictly use ID. Prevents username spoofing.
		const storageId = user.id || '';

		const expenseId = event.params.id;

		// Use the expenses KV so tombstones are written to the expenses namespace
		const svc = makeExpenseService(safeKV(env, 'BETA_EXPENSES_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);

		// SECURITY: Verify the expense exists and belongs to this user (IDOR prevention)
		const existing = await svc.get(storageId, expenseId);
		if (!existing) {
			return new Response(JSON.stringify({ error: 'Expense not found' }), { status: 404 });
		}

		await svc.delete(storageId, expenseId);

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

		// [!code fix] Strictly use ID. Prevents username spoofing.
		const storageId = user.id || '';

		const expenseId = event.params.id;

		const svc = makeExpenseService(safeKV(env, 'BETA_EXPENSES_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);

		// SECURITY: Verify the expense exists and belongs to this user (IDOR prevention)
		const existing = await svc.get(storageId, expenseId);
		if (!existing) {
			return new Response(JSON.stringify({ error: 'Expense not found' }), { status: 404 });
		}

		const body = (await event.request.json()) as unknown;

		// Ensure ID and userId cannot be overwritten by client
		const expense = {
			...(body as Record<string, unknown>),
			id: expenseId,
			userId: storageId
		};
		await svc.put(expense as ExpenseRecord);

		return new Response(JSON.stringify(expense));
	} catch (err: unknown) {
		log.error('PUT Expense Error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
	}
};
