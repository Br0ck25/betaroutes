// src/routes/api/expenses/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeExpenseService, type ExpenseRecord } from '$lib/server/expenseService';
import { makeTripService } from '$lib/server/tripService';
import { getEnv, safeKV, safeDO } from '$lib/server/env';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import { log } from '$lib/server/log';
import { getStorageId } from '$lib/server/user';

export const DELETE: RequestHandler = async (event) => {
	try {
		const user = event.locals.user as { id?: string; name?: string; token?: string } | undefined;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const env = getEnv(event.platform);
		const storageId = getStorageId(user);
		const id = event.params.id;

		// Use the expenses KV so tombstones are written to the expenses namespace
		const svc = makeExpenseService(safeKV(env, 'BETA_EXPENSES_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);

		// Get the expense before deleting to check for linked trip
		const existing = await svc.get(storageId, id);

		await svc.delete(storageId, id);

		// If expense was linked to a trip, log for future sync needs
		// (Currently trips don't store expense references directly, but this allows for future expansion)
		if (existing && (existing as { tripId?: string }).tripId) {
			log.info('Deleted expense linked to trip', {
				expenseId: id,
				tripId: (existing as { tripId?: string }).tripId
			});
		}

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
		const storageId = getStorageId(user);
		const id = event.params.id;

		const body = (await event.request.json()) as unknown;
		const svc = makeExpenseService(safeKV(env, 'BETA_EXPENSES_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);

		// Ensure ID matches URL
		const expense = {
			...(body as Record<string, unknown>),
			id,
			userId: storageId,
			updatedAt: new Date().toISOString()
		} as ExpenseRecord;

		await svc.put(expense);

		// --- Bidirectional sync: If expense has tripId, update trip's expense info ---
		const tripId = (expense as { tripId?: string }).tripId;
		if (tripId && expense.category === 'fuel' && typeof expense.amount === 'number') {
			try {
				const tripIndexDO = safeDO(env, 'TRIP_INDEX_DO')!;
				const placesIndexDO = safeDO(env, 'PLACES_INDEX_DO') || tripIndexDO;
				const tripSvc = makeTripService(
					safeKV(env, 'BETA_LOGS_KV')!,
					undefined,
					safeKV(env, 'BETA_PLACES_KV'),
					tripIndexDO,
					placesIndexDO
				);
				const trip = await tripSvc.get(storageId, tripId);
				if (trip && !trip.deleted) {
					// If this is a fuel expense, update trip's fuelCost
					(trip as any).fuelCost = expense.amount;
					trip.updatedAt = new Date().toISOString();
					await tripSvc.put(trip);
					log.info('Updated trip fuelCost from expense log', {
						tripId,
						fuelCost: expense.amount
					});
				}
			} catch (e) {
				log.warn('Failed to sync expense to trip', {
					tripId,
					message: createSafeErrorMessage(e)
				});
			}
		}

		return new Response(JSON.stringify(expense));
	} catch (err: unknown) {
		log.error('PUT Expense Error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
	}
};
