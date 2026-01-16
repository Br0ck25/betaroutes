// src/routes/api/trash/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { safeKV, safeDO } from '$lib/server/env';
import { log } from '$lib/server/log';

// Fake DO helper
function fakeDO() {
	return {
		idFromName: () => ({ name: 'fake' }),
		get: () => ({
			fetch: async () => new Response(JSON.stringify([]))
		})
	};
}

export const POST: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;
		const platformEnv = event.platform?.env as Record<string, unknown> | undefined;

		const kv = safeKV(platformEnv, 'BETA_LOGS_KV');
		const trashKV = undefined;
		void trashKV;
		const placesKV = safeKV(platformEnv, 'BETA_PLACES_KV');
		const tripIndexDO = (platformEnv?.['TRIP_INDEX_DO'] as unknown) ?? fakeDO();
		const placesIndexDO = (platformEnv?.['PLACES_INDEX_DO'] as unknown) ?? tripIndexDO;

		const svc = makeTripService(
			kv as any,
			undefined,
			placesKV as any,
			tripIndexDO as any,
			placesIndexDO as any
		);

		const currentUser = user as { name?: string; token?: string };
		const storageId = currentUser.name || currentUser.token;

		if (storageId) {
			// Try trip restore first, then expense restore
			let restored: unknown | null = null;
			try {
				restored = await svc.restore(storageId, id);
			} catch (e) {
				// Try expense
				try {
					const expenseSvc = (await import('$lib/server/expenseService')).makeExpenseService(
						safeKV(platformEnv, 'BETA_EXPENSES_KV') as any,
						safeDO(platformEnv, 'TRIP_INDEX_DO') as any
					);
					restored = await expenseSvc.restore(storageId, id);
				} catch (err) {
					throw err;
				}
			}

			// If it was a trip, increment counter
			if (restored) {
				try {
					await (
						svc as unknown as { incrementUserCounter?: (t: string, n: number) => Promise<void> }
					).incrementUserCounter?.(currentUser.token || '', 1);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					log.warn('Failed to increment user counter', { message });
				}
			}
		}

		return new Response(JSON.stringify({ success: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		log.error('POST /api/trash/[id]/restore error', { message: errMsg });
		const status = errMsg.includes('not found') ? 404 : 500;
		return new Response(JSON.stringify({ error: errMsg }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;
		const platformEnv = event.platform?.env as Record<string, unknown> | undefined;

		const kv = safeKV(platformEnv, 'BETA_LOGS_KV');
		const trashKV = undefined;
		void trashKV;
		const placesKV = safeKV(platformEnv, 'BETA_PLACES_KV');
		const tripIndexDO = (platformEnv?.['TRIP_INDEX_DO'] as unknown) ?? fakeDO();
		const placesIndexDO = (platformEnv?.['PLACES_INDEX_DO'] as unknown) ?? tripIndexDO;

		const svc = makeTripService(
			kv as any,
			undefined,
			placesKV as any,
			tripIndexDO as any,
			placesIndexDO as any
		);

		const currentUser = user as { name?: string; token?: string };
		const storageId = currentUser.name || currentUser.token;

		if (storageId) {
			// Attempt to remove from both trip and expense namespaces
			try {
				// Log pre-delete presence for diagnostics
				try {
					const expKv = safeKV(platformEnv, 'BETA_EXPENSES_KV') as any;
					const logsKv = safeKV(platformEnv, 'BETA_LOGS_KV') as any;
					const expenseKey = `expense:${storageId}:${id}`;
					const tripKey = `trip:${storageId}:${id}`;
					const expPresent = expKv ? !!(await expKv.get(expenseKey)) : false;
					const logsPresent = logsKv ? !!(await logsKv.get(expenseKey)) : false;
					log.info('Pre-delete presence', {
						expenseKey,
						expPresent,
						logsPresent,
						tripKey,
						tripPresent: !!(await logsKv.get(tripKey))
					});
				} catch (diagErr) {
					log.warn('Failed to read pre-delete KV presence', { message: String(diagErr) });
				}

				await svc.permanentDelete(storageId, id);
			} catch (err) {
				log.warn('Trip permanentDelete failed or not applicable', { message: String(err) });
			}
			try {
				const expenseSvc = (await import('$lib/server/expenseService')).makeExpenseService(
					safeKV(platformEnv, 'BETA_EXPENSES_KV') as any,
					safeDO(platformEnv, 'TRIP_INDEX_DO') as any
				);
				await expenseSvc.permanentDelete(storageId, id);
			} catch (err) {
				log.warn('Expense permanentDelete failed', { message: String(err) });
			}

			// Also attempt to delete expense key from legacy logs KV in case old entries exist
			try {
				const logsKv = safeKV(platformEnv, 'BETA_LOGS_KV') as any;
				if (logsKv) {
					const legacyExpenseKey = `expense:${storageId}:${id}`;
					await logsKv.delete(legacyExpenseKey);
					const legPresent = !!(await logsKv.get(legacyExpenseKey));
					if (!legPresent)
						log.info('Removed legacy expense key from logs KV', { legacyExpenseKey });
				}
			} catch (legacyErr) {
				log.warn('Failed to remove legacy expense key from BETA_LOGS_KV', {
					message: String(legacyErr)
				});
			}

			// Log post-delete presence for diagnostics
			try {
				const expKv = safeKV(platformEnv, 'BETA_EXPENSES_KV') as any;
				const logsKv = safeKV(platformEnv, 'BETA_LOGS_KV') as any;
				const expenseKey = `expense:${storageId}:${id}`;
				const tripKey = `trip:${storageId}:${id}`;
				let expPresent = expKv ? !!(await expKv.get(expenseKey)) : false;
				let logsPresent = logsKv ? !!(await logsKv.get(expenseKey)) : false;
				log.info('Post-delete presence', {
					expenseKey,
					expPresent,
					logsPresent,
					tripKey,
					tripPresent: !!(await logsKv.get(tripKey))
				});

				// If the key still exists, attempt one more delete to be safe
				if (expPresent && expKv) {
					try {
						await expKv.delete(expenseKey);
						expPresent = !!(await expKv.get(expenseKey));
						log.warn('Second attempt to delete from BETA_EXPENSES_KV', {
							expenseKey,
							stillPresent: expPresent
						});
					} catch (e) {
						log.warn('Failed second delete attempt on BETA_EXPENSES_KV', { message: String(e) });
					}
				}

				if (logsPresent && logsKv) {
					try {
						await logsKv.delete(expenseKey);
						logsPresent = !!(await logsKv.get(expenseKey));
						log.warn('Second attempt to delete from BETA_LOGS_KV', {
							expenseKey,
							stillPresent: logsPresent
						});
					} catch (e) {
						log.warn('Failed second delete attempt on BETA_LOGS_KV', { message: String(e) });
					}
				}
				if (expPresent || logsPresent) {
					log.error('Expense key still present after deletion attempts', {
						expenseKey,
						expPresent,
						logsPresent
					});
				}
			} catch (diagErr) {
				log.warn('Failed to read post-delete KV presence', { message: String(diagErr) });
			}
		}

		return new Response(null, { status: 204 });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('DELETE /api/trash/[id] error', { message });
		return new Response(JSON.stringify({ error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
