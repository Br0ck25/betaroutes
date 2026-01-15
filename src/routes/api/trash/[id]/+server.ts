// src/routes/api/trash/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { log } from '$lib/server/log';

function safeKV(env: Record<string, unknown> | undefined, name: string) {
	const kv = env?.[name] as unknown;
	return kv ?? null;
}

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
				await svc.permanentDelete(storageId, id);
			} catch {}
			try {
				const expenseSvc = (await import('$lib/server/expenseService')).makeExpenseService(
					safeKV(platformEnv, 'BETA_EXPENSES_KV') as any,
					safeDO(platformEnv, 'TRIP_INDEX_DO') as any
				);
				await expenseSvc.permanentDelete(storageId, id);
			} catch {}
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
