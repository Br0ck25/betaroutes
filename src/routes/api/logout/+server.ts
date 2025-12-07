// src/routes/api/logout/+server.ts
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ cookies }) => {
	// FIX: Clear the 'token' cookie, not 'session'
	cookies.delete('token', {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: false // set to true in production if using https
	});

	return json({ success: true });
};
