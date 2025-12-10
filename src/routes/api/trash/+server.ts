// src/routes/api/trash/+server.ts
import { json } from '@sveltejs/kit';
import { makeTripService } from '$lib/server/tripService';
import type { RequestHandler } from './$types';

function fakeKV() {
	return {
		get: async () => null,
		put: async () => {},
		delete: async () => {},
		list: async () => ({ keys: [] })
	};
}

export const GET: RequestHandler = async ({ locals, platform }) => {
	try {
		const user = locals.user;
		if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

		const kv = platform?.env?.BETA_LOGS_KV ?? fakeKV();
		const trashKV = platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
		const svc = makeTripService(kv, trashKV);

		// FIX: Scan ALL storage locations (UUID, Name, Token)
		// This aggregates trash items from all "versions" of your user
		const storageIds = new Set<string>();
        if (user.id) storageIds.add(user.id);
        if (user.name) storageIds.add(user.name);
        if (user.token) storageIds.add(user.token);

        let allTrash: any[] = [];
        for (const uid of storageIds) {
            const items = await svc.listTrash(uid);
            allTrash = allTrash.concat(items);
        }

        // Deduplicate items by ID
        const uniqueTrash = Array.from(new Map(allTrash.map(item => [item.id, item])).values());

		return json(uniqueTrash);
	} catch (err) {
		console.error('GET /api/trash error', err);
        // Return empty array instead of 500 error to keep UI alive
		return json([]); 
	}
};

export const DELETE: RequestHandler = async ({ locals, platform }) => {
	try {
		const user = locals.user;
		if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

		const kv = platform?.env?.BETA_LOGS_KV ?? fakeKV();
		const trashKV = platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
		const svc = makeTripService(kv, trashKV);

		// Empty trash for ALL IDs
		const storageIds = new Set<string>();
        if (user.id) storageIds.add(user.id);
        if (user.name) storageIds.add(user.name);
        if (user.token) storageIds.add(user.token);

		let deleted = 0;
        for (const uid of storageIds) {
		    deleted += await svc.emptyTrash(uid);
        }

		return json({
			deleted,
			message: `${deleted} cloud trash items permanently removed`
		});
	} catch (err) {
		console.error('DELETE /api/trash error', err);
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};