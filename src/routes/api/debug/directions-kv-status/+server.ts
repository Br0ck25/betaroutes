import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';
import { ensureDebugEnabled } from '$lib/server/debug';

export const GET: RequestHandler = async ({ platform }) => {
	try {
		ensureDebugEnabled(platform);
	} catch {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const kv = (platform?.env as Record<string, unknown>)['BETA_DIRECTIONS_KV'] as
		| KVNamespace
		| undefined;
	if (!kv) return json({ error: 'No BETA_DIRECTIONS_KV binding' });

	try {
		const list = await kv.list({ limit: 10 });
		return json({
			status: 'Connected',
			total: list.keys.length,
			keys: list.keys.map((k) => k.name)
		});
	} catch (e: any) {
		return json({ error: String(e) });
	}
};
