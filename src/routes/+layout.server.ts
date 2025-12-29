// src/routes/+layout.server.ts

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	// Pass user data to all pages
	return {
		user: locals.user
	};
};
