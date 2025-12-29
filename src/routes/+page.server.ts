// src/routes/+page.server.ts
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// If the user is already logged in (populated by hooks.server.ts),
	// redirect them straight to the dashboard.
	if (locals.user) {
		throw redirect(302, '/dashboard');
	}
};
