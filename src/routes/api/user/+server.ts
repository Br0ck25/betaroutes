import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ request, fetch, cookies }) => {
	try {
		const body = await request.json();
		const token = request.headers.get('Authorization');

		// Proxy to backend (Backend likely expects POST /api/delete-account)
		const response = await fetch(
			'[https://logs.gorouteyourself.com/api/delete-account](https://logs.gorouteyourself.com/api/delete-account)',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: token } : {})
				},
				body: JSON.stringify(body)
			}
		);

		if (response.ok) {
			cookies.delete('token', { path: '/' });
			return json({ success: true });
		}

		// Handle errors...
		// (copy error handling logic from previous successful response)
		return json({ error: 'Failed' }, { status: response.status });
	} catch (err) {
		return json({ error: 'Server Error' }, { status: 500 });
	}
};
