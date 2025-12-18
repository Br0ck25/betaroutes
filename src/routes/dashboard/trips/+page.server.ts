import type { PageServerLoad } from './$types';
import { makeTripService } from '$lib/server/tripService';

export const load: PageServerLoad = async ({ locals, platform }) => {
    if (!locals.user) {
        return { 
            user: null, 
            streamed: { tripsPromise: Promise.resolve([]) } 
        };
    }

    // [!code fix] Instantiate the service using Cloudflare bindings from platform.env
    // This fixes the "undefined" error you were seeing.
    const tripService = makeTripService(
        platform!.env.BETA_LOGS_KV,
        platform!.env.BETA_LOGS_TRASH_KV,
        platform!.env.BETA_PLACES_KV,
        platform!.env.TRIP_INDEX_DO
    );

    // Start streaming the data
    const tripsPromise = tripService.list(locals.user.id);

    return {
        user: locals.user,
        streamed: {
            tripsPromise
        }
    };
};