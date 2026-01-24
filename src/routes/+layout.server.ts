// src/routes/+layout.server.ts
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	return {
		user: locals.user
			? {
					id: locals.user.id, // [!code fix] Explicitly expose ID to frontend
					name: locals.user.name,
					token: locals.user.token, // Keep token for legacy compatibility if needed
					plan: locals.user.plan
				}
			: null,
		path: url.pathname,
		googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ''
	};
};
