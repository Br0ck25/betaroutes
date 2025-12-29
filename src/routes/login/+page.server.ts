// src/routes/login/+page.server.ts
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// If the hook (src/hooks.server.ts) successfully found a user via the 'token' cookie,
	// they should not be on the login page. Redirect them to the dashboard.
	if (locals.user) {
		throw redirect(302, '/dashboard');
	}

	// If no user is found, the page is allowed to load.
	return {};
};
