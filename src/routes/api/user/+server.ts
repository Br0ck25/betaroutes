// src/routes/api/user/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ request, fetch, cookies, platform }) => {
	try {
		const body = await request.json();
		const token = request.headers.get('Authorization');

		// 1. Forward request to external API
		const response = await fetch('https://logs.gorouteyourself.com/api/delete-account', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: token } : {})
			},
			body: JSON.stringify(body)
		});

		if (response.ok) {
			// 2. Remove from Local KV
			const usersKV = platform?.env?.BETA_USERS_KV;
			if (usersKV && token) {
				await usersKV.delete(token);
				console.log('[API] User removed from local KV');
			}

			// 3. Clear cookie
			cookies.delete('token', { path: '/' });
		}

		let data;
		try {
			data = await response.json();
		} catch (e) {
			data = { error: 'Failed to parse external API response' };
		}

		return json(data, { status: response.status });
	} catch (err) {
		console.error('Delete account proxy error:', err);
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};
