// src/routes/api/user/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ request, fetch, cookies, platform }) => {
	try {
		const body = await request.json();
		const token = request.headers.get('Authorization');

		console.log('[PROXY] Delete Account Request');

		if (!body.username) {
			return json({ error: 'Username is missing from request' }, { status: 400 });
		}

		// 1. Forward the request to the external API
		const response = await fetch('https://logs.gorouteyourself.com/api/delete-account', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: token } : {})
			},
			body: JSON.stringify(body)
		});

		// 2. Handle Success
		if (response.ok) {
			console.log('[PROXY] External delete successful.');

			// 🔥 FIX: Remove from Local KV so it disappears from your debug list
			if (token && platform?.env?.BETA_USERS_KV) {
				await platform.env.BETA_USERS_KV.delete(token);
				console.log('[PROXY] Removed user from local KV.');
			}

			cookies.delete('token', { path: '/' });
			return json({ success: true }, { status: 200 });
		}

		// 3. Handle Errors
		const text = await response.text();
		console.error(`[PROXY] Upstream Failed: ${response.status} - ${text}`);

		let error = text;
		try {
			const jsonError = JSON.parse(text);
			error = jsonError.error || jsonError.message || text;
		} catch {
			/* use raw text */
		}

		if (response.status === 401 || response.status === 403) {
			const lowerError = error.toLowerCase();
			if (!error || lowerError.includes('unauthorized') || lowerError.includes('forbidden')) {
				error = 'Incorrect password.';
			}
		}

		return json({ error }, { status: response.status });
	} catch (err) {
		console.error('[PROXY] System Error:', err);
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};
