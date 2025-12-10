// src/routes/api/trips/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';

function fakeKV() {
	return {
		get: async () => null,
		put: async () => {},
		delete: async () => {},
		list: async () => ({ keys: [] })
	};
}

/**
 * GET /api/trips/[id] - Retrieve a single trip
 */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	try {
		const user = locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = params;
		const kv = platform?.env?.BETA_LOGS_KV ?? fakeKV();
		const trashKV = platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
		const svc = makeTripService(kv, trashKV);

		// FIX: Check ALL storage locations
		const storageIds = [user.id, user.name, user.token].filter(Boolean);
		let trip = null;

		for (const uid of storageIds) {
			trip = await svc.get(uid!, id);
			if (trip) break;
		}

		if (!trip) {
			return new Response('Not Found', { status: 404 });
		}

		return new Response(JSON.stringify(trip), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('GET /api/trips/[id] error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};

/**
 * PUT /api/trips/[id] - Update a trip
 */
export const PUT: RequestHandler = async ({ request, params, locals, platform }) => {
	try {
		const user = locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = params;
		const body = await request.json();

		const kv = platform?.env?.BETA_LOGS_KV ?? fakeKV();
		const trashKV = platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
		const svc = makeTripService(kv, trashKV);

		// FIX: Find where the trip lives before updating
		const storageIds = [user.id, user.name, user.token].filter(Boolean);
		let existing = null;
		let ownerId = null;

		for (const uid of storageIds) {
			existing = await svc.get(uid!, id);
			if (existing) {
				ownerId = uid;
				break;
			}
		}

		if (!existing || !ownerId) {
			return new Response('Not Found', { status: 404 });
		}

		const updated = {
			...existing,
			...body,
			id,
			userId: ownerId, // Keep it in the same storage bucket
			updatedAt: new Date().toISOString()
		};

		await svc.put(updated);

		return new Response(JSON.stringify(updated), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('PUT /api/trips/[id] error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};

/**
 * DELETE /api/trips/[id] - Soft delete trip
 */
export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	try {
		const user = locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = params;
		const kv = platform?.env?.BETA_LOGS_KV ?? fakeKV();
		const trashKV = platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
		const svc = makeTripService(kv, trashKV);

		// FIX: Find where the trip lives before deleting
		const storageIds = [user.id, user.name, user.token].filter(Boolean);
		let existing = null;
		let ownerId = null;

		for (const uid of storageIds) {
			existing = await svc.get(uid!, id);
			if (existing) {
				ownerId = uid;
				break;
			}
		}

		if (!existing || !ownerId) {
			// If it's already gone, consider it a success (idempotent)
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}

		// Perform soft delete on the correct owner ID
		await svc.delete(ownerId, id);

		// Decrement trip count (using token as that's usually the counter key)
		await svc.incrementUserCounter(user.token, -1);

		return new Response(JSON.stringify({ success: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('DELETE /api/trips/[id] error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};