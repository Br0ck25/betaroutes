// src/routes/+layout.server.ts
import type { LayoutServerLoad } from './$types';
import type { PublicUser } from '$lib/types';
import { getUserDisplayName } from '$lib/utils/user-display';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	const publicUser: PublicUser | null =
		locals.user && typeof locals.user.id === 'string'
			? {
					id: locals.user.id, // [!code fix] Explicitly expose ID to frontend
					name: getUserDisplayName(locals.user),
					plan: locals.user.plan,
					tripsThisMonth: locals.user.tripsThisMonth
				}
			: null;
	return {
		user: publicUser,
		path: url.pathname,
		googleMapsApiKey: process.env['GOOGLE_MAPS_API_KEY'] || ''
	};
};
