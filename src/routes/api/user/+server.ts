// src/routes/api/user/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ request, fetch, cookies }) => {
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

		// 2. Handle Success (Clear Cookie)
		if (response.ok) {
			cookies.delete('token', { path: '/' });
			return json({ success: true }, { status: 200 });
		}

		// 3. Handle Errors Robustly
		let data: any = {};
		const contentType = response.headers.get('content-type');

		if (contentType && contentType.includes('application/json')) {
			try {
				data = await response.json();
			} catch (e) {
				data = { error: 'Invalid JSON response from server' };
			}
		} else {
			// Fallback for plain text responses (common with 401/403)
			const text = await response.text();
			data = { error: text };
		}

		// Normalize 'message' to 'error' if present
		if (data.message && !data.error) {
			data.error = data.message;
		}

		// 4. Provide User-Friendly Error for 401
		// If the error is generic "Unauthorized" or empty, assume it's the password check
		if (response.status === 401) {
			const errorMsg = data.error?.toLowerCase() || '';
			if (!errorMsg || errorMsg === 'unauthorized') {
				data.error = 'Incorrect password.';
			}
		}

		// Ensure we always return an error string
		if (!data.error) {
			data.error = `Request failed with status ${response.status}`;
		}

		return json(data, { status: response.status });
	} catch (err) {
		console.error('Delete account proxy error:', err);
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};
