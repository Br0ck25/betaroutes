// src/routes/api/delete-account/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, fetch, cookies }) => {
	try {
		const body = await request.json();
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
		}

		// 3. Return the backend's response to the client
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
