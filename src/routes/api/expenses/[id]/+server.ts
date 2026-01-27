// src/routes/api/expenses/[id]/+server.ts
import { getEnv, safeDO, safeKV } from '$lib/server/env';
import { makeExpenseService, type ExpenseRecord } from '$lib/server/expenseService';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import { makeTripService, type TripRecord } from '$lib/server/tripService';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async (event) => {
	try {
		const user = event.locals.user as { id?: string } | undefined;
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
		const user = event.locals.user as { id?: string } | undefined;
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

		const rawBody = (await event.request.json()) as unknown;
		const body =
			typeof rawBody === 'object' && rawBody !== null ? (rawBody as Record<string, unknown>) : {};

		// Merge updates explicitly (prevent mass-assignment)
		const expense: ExpenseRecord = {
			id: expenseId,
			userId: storageId,
			date: existing.date,
			category: existing.category,
			amount: existing.amount,
			createdAt: existing.createdAt,
			updatedAt: new Date().toISOString(),
			// optional fields accessed via index signature
			...(existing['taxDeductible'] !== undefined
				? { taxDeductible: existing['taxDeductible'] as boolean }
				: {}),
			...(existing['store'] !== undefined ? { store: existing['store'] as string } : {})
		};

		if (typeof existing['description'] === 'string')
			(expense as Record<string, unknown>)['description'] = existing['description'] as string;

		if (typeof body['date'] === 'string') expense.date = body['date'] as string;
		if (typeof body['category'] === 'string') expense.category = body['category'] as string;
		if (body['amount'] !== undefined) {
			const num = Number(body['amount']);
			if (!Number.isNaN(num)) expense.amount = num;
		}
		if (typeof body['description'] === 'string')
			expense.description = body['description'] as string;
		if (typeof body['taxDeductible'] === 'boolean')
			(expense as Record<string, unknown>)['taxDeductible'] = body['taxDeductible'] as boolean;
		if (typeof body['store'] === 'string')
			(expense as Record<string, unknown>)['store'] = body['store'] as string;

		await svc.put(expense);

		// If this expense is a trip-linked expense, mirror changes back to the parent Trip
		try {
			// Determine tripId either from explicit tripId on expense or from trip-* id convention
			let tripId: string | null = null;
			if (expense.id && expense.id.startsWith('trip-')) {
				const m = String(expense.id).match(/^trip-(?:fuel|maint|supply)-([^-]+)/);
				tripId = m?.[1] ?? null;
			} else if (
				(expense as Record<string, unknown>)['tripId'] &&
				typeof (expense as Record<string, unknown>)['tripId'] === 'string'
			) {
				tripId = (expense as Record<string, unknown>)['tripId'] as string;
			}
			if (tripId) {
				// Recompute aggregated costs for this trip from expense index
				const env = getEnv(event.platform);
				const expenseSvc = makeExpenseService(
					safeKV(env, 'BETA_EXPENSES_KV')!,
					safeDO(env, 'TRIP_INDEX_DO')!
				);
				const all = await expenseSvc.list(storageId);
				let fuel = 0;
				let maintenance = 0;
				let supplies = 0;
				for (const e of all) {
					// Prefer explicit tripId field when available
					const eTrip = (e as Record<string, unknown>)['tripId'] as string | undefined;
					if (eTrip && eTrip === tripId) {
						if (String(e.id).startsWith('trip-fuel-')) fuel = (e.amount as number) || 0;
						else if (String(e.id).startsWith('trip-maint-'))
							maintenance += (e.amount as number) || 0;
						else if (String(e.id).startsWith('trip-supply-')) supplies += (e.amount as number) || 0;
						continue;
					}
					if (!e.id || !e.id.startsWith(`trip-`)) continue;
					const em = String(e.id).match(/^trip-(fuel|maint|supply)-([^-]+)/);
					if (!em) continue;
					const kind = em[1];
					const tid = em[2];
					if (tid !== tripId) continue;
					if (kind === 'fuel') fuel = (e.amount as number) || 0;
					else if (kind === 'maint') maintenance += (e.amount as number) || 0;
					else if (kind === 'supply') supplies += (e.amount as number) || 0;
				}

				// Update trip record with new aggregated costs
				try {
					const kv = safeKV(env, 'BETA_LOGS_KV');
					const tripSvc = makeTripService(
						kv as unknown as KVNamespace,
						safeKV(env, 'BETA_PLACES_KV') as unknown as KVNamespace | undefined,
						safeDO(env, 'TRIP_INDEX_DO')!,
						safeDO(env, 'PLACES_INDEX_DO') ?? safeDO(env, 'TRIP_INDEX_DO')!
					);
					const t = await tripSvc.get(storageId, tripId);
					if (t) {
						const patched = {
							...t,
							fuelCost: fuel,
							maintenanceCost: maintenance,
							suppliesCost: supplies,
							updatedAt: new Date().toISOString(),
							syncStatus: 'pending'
						};
						await tripSvc.put(patched as unknown as TripRecord);
						log.info('Mirrored expense update to trip', { tripId, expenseId: expense.id });
					}
				} catch (e) {
					log.warn('Failed to mirror expense update to trip', {
						id: expense.id,
						err: createSafeErrorMessage(e)
					});
				}
			}
		} catch (e) {
			log.warn('Failed to handle trip-linked expense mirror', {
				id: expense.id,
				err: createSafeErrorMessage(e)
			});
		}

		return new Response(JSON.stringify(expense));
	} catch (err: unknown) {
		log.error('PUT Expense Error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
	}
};
