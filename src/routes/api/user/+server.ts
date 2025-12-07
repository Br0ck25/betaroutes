// src/routes/api/user/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ request, fetch, cookies }) => {
	try {
		const body = await request.json();
		const token = request.headers.get('Authorization');

		// Forward the request to the external API
		// Note: External API expects POST /api/delete-account
		const response = await fetch('https://logs.gorouteyourself.com/api/delete-account', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: token } : {})
			},
			body: JSON.stringify(body)
		});

		if (response.ok) {
			cookies.delete('token', { path: '/' });
			return json({ success: true }, { status: 200 });
		}

		const text = await response.text();
		let error = text;
		try {
			const jsonError = JSON.parse(text);
			error = jsonError.error || jsonError.message || text;
		} catch {
			/* use raw text */
		}

		if (response.status === 401 || response.status === 403) {
			error = 'Incorrect password.';
		}

		return json({ error }, { status: response.status });
	} catch (err) {
		console.error('Delete account proxy error:', err);
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};
