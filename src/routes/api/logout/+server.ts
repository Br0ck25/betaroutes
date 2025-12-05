// src/routes/api/logout/+server.ts
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ cookies }) => {
	// remove session cookie
	cookies.set('session', '', {
		path: '/',
		expires: new Date(0)
	});

	return json({ success: true });
};
