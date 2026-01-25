import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { log } from '$lib/server/log';
import { purgeExpiredTrash } from '$lib/server/trashPurge';

function safeCompare(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

async function handleCronRequest(event: Parameters<RequestHandler>[0]) {
	try {
		const platformEnv = event.platform?.env as Record<string, unknown> | undefined;
		const header = event.request.headers.get('Authorization') || '';
		const token = header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim();

		const secret =
			typeof platformEnv?.['CRON_ADMIN_SECRET'] === 'string'
				? String(platformEnv?.['CRON_ADMIN_SECRET'])
				: '';

		if (!token || !secret || !safeCompare(secret, token)) {
			log.warn('Unauthorized cron attempt', {
				ip: event.request.headers.get('x-forwarded-for') || ''
			});
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const summary = await purgeExpiredTrash(platformEnv);
		log.info('Cron: purgeExpiredTrash completed', { summary });
		return json({ success: true, summary }, { status: 200 });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('Cron: purgeExpiredTrash error', { message });
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
}

export const POST: RequestHandler = async (event) => {
	return handleCronRequest(event);
};

export const GET: RequestHandler = async (event) => {
	// Allow GET for cron services that do not support POST
	return handleCronRequest(event);
};
