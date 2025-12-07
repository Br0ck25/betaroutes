// src/routes/api/trips/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';

function safeKV(env: any, name: string) {
	const kv = env?.[name];
	return kv ?? null;
}

export const GET: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;

		const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
		const trashKV = safeKV(event.platform?.env, 'BETA_LOGS_TRASH_KV');
		const svc = makeTripService(kv, trashKV);

		// FIX: Use stable user ID
		const storageId = user.name || user.token;
		const trip = await svc.get(storageId, id);

		if (!trip) {
			return new Response('Not Found', { status: 404 });
		}

		return new Response(JSON.stringify(trip), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('GET /api/trips/[id] error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};

export const PUT: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;
		const body = await event.request.json();

		const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
		const trashKV = safeKV(event.platform?.env, 'BETA_LOGS_TRASH_KV');
		const svc = makeTripService(kv, trashKV);

		// FIX: Use stable user ID
		const storageId = user.name || user.token;
		const existing = await svc.get(storageId, id);

		if (!existing) {
			return new Response('Not Found', { status: 404 });
		}

		const updated = {
			...existing,
			...body,
			id,
			userId: storageId,
			updatedAt: new Date().toISOString()
		};

		await svc.put(updated);

		return new Response(JSON.stringify(updated), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('PUT /api/trips/[id] error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) {
			return new Response('Unauthorized', { status: 401 });
		}

		const { id } = event.params;

		const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
		const trashKV = safeKV(event.platform?.env, 'BETA_LOGS_TRASH_KV');
		const svc = makeTripService(kv, trashKV);

		// FIX: Use stable user ID
		const storageId = user.name || user.token;
		const existing = await svc.get(storageId, id);

		if (!existing) {
			return new Response(JSON.stringify({ error: 'Trip not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		try {
			await svc.delete(storageId, id);
		} catch (err) {
			console.warn('[TRIPS API] delete failed:', err);
		}

		try {
			await svc.incrementUserCounter(user.token, -1);
		} catch (err) {
			console.warn('[TRIPS API] decrement counter failed:', err);
		}

		return new Response(JSON.stringify({ success: true, message: 'Trip moved to trash' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('DELETE /api/trips/[id] error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
