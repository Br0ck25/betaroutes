// src/routes/api/user/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ request, fetch, cookies }) => {
  try {
    const body = await request.json();
    const token = request.headers.get('Authorization');

    // Forward the request to the external API
    const response = await fetch('https://logs.gorouteyourself.com/api/delete-account', {
      method: 'POST', // The external API expects POST
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': token } : {})
      },
      body: JSON.stringify(body)
    });

    // If successful, clear the cookie immediately
    if (response.ok) {
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