import { redirect } from '@sveltejs/kit';

export const load = ({ locals }) => {
    console.log('[DASHBOARD LAYOUT] Checking auth...');
    console.log('[DASHBOARD LAYOUT] locals.user:', locals.user);
    
    if (!locals.user) {
        console.log('[DASHBOARD LAYOUT] No user found, redirecting to login');
        throw redirect(303, '/login');
    }

    console.log('[DASHBOARD LAYOUT] User authenticated, loading dashboard');
    return {
        user: locals.user
    };
};
