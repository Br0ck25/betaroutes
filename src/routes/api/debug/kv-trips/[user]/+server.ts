// src/routes/api/debug/kv-trips/[user]/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensureDebugEnabled } from '$lib/server/debug';

export const GET: RequestHandler = async ({ params, url, platform }) => {
	try {
		ensureDebugEnabled(platform);
	} catch {
		return new Response(null, { status: 404 });
	}

	try {
		const user = String(params.user || '');
		if (!user) return json({ error: 'Missing user param' }, { status: 400 });

		const kv = platform?.env?.BETA_LOGS_KV as unknown as KVNamespace | undefined;
		if (!kv) return json({ error: 'BETA_LOGS_KV binding not found' }, { status: 503 });

		const limitParam = url.searchParams.get('limit');
		const limit = limitParam ? Math.min(Number(limitParam), 500) : 200;

		const prefix = `trip:${user}:`;
		let list = await kv.list({ prefix });
		let keys = list.keys || [];
		while (!list.list_complete && list.cursor) {
			list = await kv.list({ prefix, cursor: list.cursor });
			keys = keys.concat(list.keys || []);
		}

		// Trim to requested limit
		keys = keys.slice(0, limit);

		const items = await Promise.all(
			keys.map(async (k) => {
				const raw = await kv.get(k.name);
				let parsed: any = null;
				try {
					parsed = raw ? JSON.parse(raw) : null;
				} catch (e) {
					parsed = { _raw: raw };
				}

				// Provide a minimal summary to avoid huge payloads
				const summary = parsed
					? {
							key: k.name,
							id: parsed.id,
							date: parsed.date,
							createdAt: parsed.createdAt,
							updatedAt: parsed.updatedAt
						}
					: { key: k.name, value: null };

				return summary;
			})
		);

		return json({ count: items.length, items });
	} catch (err) {
		return json({ error: String(err) }, { status: 500 });
	}
};
