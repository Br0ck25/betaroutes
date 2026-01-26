// src/routes/api/delete-account/+server.ts
// DEPRECATED: This is a legacy proxy endpoint that forwards to an external backend.
// New code should use the local /api/user DELETE endpoint instead.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ request, fetch, cookies, locals }) => {
	try {
		// SECURITY (Issue #11): Verify user is authenticated before forwarding
		if (!locals.user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const token = request.headers.get('Authorization');

		// Parse and validate body to avoid mass-assignment (SECURITY)
		const rawBody: unknown = await request.json().catch(() => null);
		if (!rawBody || typeof rawBody !== 'object') {
			return json({ error: 'Invalid request' }, { status: 400 });
		}
		const body = rawBody as Record<string, unknown>;
		// Require explicit confirmation flag for account deletion
		if (body['confirm'] !== true) {
			return json({ error: 'Missing confirmation' }, { status: 400 });
		}

		// 1. Forward the request to the real backend (only safe fields)
		const response = await fetch('https://logs.gorouteyourself.com/api/delete-account', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: token } : {})
			},
			body: JSON.stringify({ confirm: true })
		});

		// 2. If successful, clear the cookie immediately so the user is logged out
		if (response.ok) {
			cookies.delete('token', { path: '/' });
			cookies.delete('session_id', { path: '/' });
		}

		// 3. Return the backend's response to the client
		let data;
		try {
			data = await response.json();
		} catch (_e: unknown) {
			void _e;
			data = { error: 'Failed to parse external API response' };
		}

		return json(data, { status: response.status });
	} catch (err) {
		log.error('Delete account proxy error', { message: (err as Error)?.message });
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};
