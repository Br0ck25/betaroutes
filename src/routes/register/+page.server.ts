import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// Redirect to the login page with the 'view' parameter set to 'register'
	throw redirect(302, '/login?view=register');
};
