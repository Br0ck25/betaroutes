import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
    // The profile management is now part of settings.
    // Redirect users to the settings page.
    throw redirect(302, '/dashboard/settings');
};