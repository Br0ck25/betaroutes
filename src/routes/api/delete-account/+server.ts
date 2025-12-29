// src/routes/api/delete-account/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ request, fetch, cookies }) => {
	try {
		// Use standard Promise methods for the body
		const body = (await request.json()) as any;
		const token = request.headers.get('Authorization');

		// 1. Forward the request to the real backend
		const externalResponse = await fetch('https://logs.gorouteyourself.com/api/delete-account', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: token } : {})
			},
			body: JSON.stringify(body)
		});

		// 2. If successful, clear the authentication cookies immediately
		if (externalResponse.ok) {
			cookies.delete('token', { path: '/' });
			// Ensure 'session_id' is also cleared if it exists (common pattern in this app)
			cookies.delete('session_id', { path: '/' });
		}

		// 3. Return the backend's response to the client
		let data;
		try {
			data = await externalResponse.json();
		} catch (_e: unknown) {
			void _e;
			// Fallback if external API doesn't return JSON (e.g. 204 No Content)
			data = { success: externalResponse.ok };
		}

		return json(data, { status: externalResponse.status });
	} catch (err) {
		log.error('Delete account proxy error', { message: (err as any)?.message });
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};
