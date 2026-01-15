// src/routes/api/trash/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { log } from '$lib/server/log';

function fakeKV() {
	return {
		get: async () => null,
		put: async () => {},
		delete: async () => {},
		list: async () => ({ keys: [] })
	};
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

export const GET: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const platformEnv = event.platform?.env as Record<string, unknown> | undefined;
		const kv = (platformEnv?.['BETA_LOGS_KV'] as unknown) ?? fakeKV();
		const trashKV = (platformEnv?.['BETA_LOGS_TRASH_KV'] as unknown) ?? fakeKV();
		const placesKV = (platformEnv?.['BETA_PLACES_KV'] as unknown) ?? fakeKV();
		// Expenses-specific trash KV (optional)
		const expensesTrashKV = (platformEnv?.['BETA_EXPENSES_TRASH_KV'] as unknown) ?? fakeKV();

		// Durable Object bindings (mock or real)
		const tripIndexDO = (platformEnv?.['TRIP_INDEX_DO'] as unknown) ?? fakeDO();
		const placesIndexDO = (platformEnv?.['PLACES_INDEX_DO'] as unknown) ?? tripIndexDO;

		// Create service for trips
		const svc = makeTripService(
			kv as any,
			trashKV as any,
			placesKV as any,
			tripIndexDO as any,
			placesIndexDO as any
		);

		const currentUser = user as { name?: string; token?: string };
		const storageId = currentUser.name || currentUser.token;

		if (!storageId)
			return new Response(JSON.stringify([]), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});

		// Support optional type filter: ?type=expense|trip
		const typeParam = event.url.searchParams.get('type');

		// Return current cloud trash items
		let cloudTrash: unknown[] = [];
		try {
			if (typeParam === 'expense') {
				// List expense trash from expensesTrashKV
				const prefix = `trash:${storageId}:`;
				const list = await (expensesTrashKV as any).list({ prefix });
				for (const k of list.keys) {
					const raw = await (expensesTrashKV as any).get(k.name);
					if (!raw) continue;
					const parsed = JSON.parse(raw);
					// Normalize to TrashItem-like structure
					const item = {
						id:
							parsed.data?.id || parsed.id || (parsed.metadata?.originalKey || '').split(':').pop(),
						userId:
							parsed.data?.userId ||
							parsed.userId ||
							(parsed.metadata?.originalKey || '').split(':')[1],
						metadata: parsed.metadata || null,
						recordType: 'expense'
					};
					cloudTrash.push(item);
				}
			} else if (typeParam === 'trip') {
				cloudTrash = await svc.listTrash(storageId);
			} else {
				// Combine both trip and expense trash
				cloudTrash = await svc.listTrash(storageId);
				const prefix = `trash:${storageId}:`;
				const list = await (expensesTrashKV as any).list({ prefix });
				for (const k of list.keys) {
					const raw = await (expensesTrashKV as any).get(k.name);
					if (!raw) continue;
					const parsed = JSON.parse(raw);
					const item = {
						id:
							parsed.data?.id || parsed.id || (parsed.metadata?.originalKey || '').split(':').pop(),
						userId:
							parsed.data?.userId ||
							parsed.userId ||
							(parsed.metadata?.originalKey || '').split(':')[1],
						metadata: parsed.metadata || null,
						recordType: 'expense'
					};
					cloudTrash.push(item);
				}
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn('Failed to list cloud trash', { message });
		}

		return new Response(JSON.stringify(cloudTrash), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('GET /api/trash error', { message });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500
		});
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		// This bulk DELETE endpoint is currently a placeholder
		// Individual items are deleted via /api/trash/[id]
		const deleted = 0;

		return new Response(
			JSON.stringify({
				deleted,
				message: `${deleted} cloud trash items permanently removed`
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('DELETE /api/trash error', { message });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500
		});
	}
};
