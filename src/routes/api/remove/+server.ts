// src/routes/api/remove/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ request, fetch, cookies, locals }) => {
	try {
		// SECURITY: Require authentication before processing delete request
		if (!locals.user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const body: any = await request.json();
		const token = request.headers.get('Authorization');

		// 1. Forward the request to the real backend
		const response = await fetch('https://logs.gorouteyourself.com/api/delete-account', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: token } : {})
			},
			body: JSON.stringify(body)
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
		log.error('Delete account proxy error', { message: (err as any)?.message });
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};
