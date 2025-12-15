// src/routes/api/autocomplete/cache/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
    // [!code fix] Security: Disable client-side cache poisoning.
    // Caching is now handled server-side in the GET handler and TripService.
    return json({ error: 'Client caching is disabled.' }, { status: 405 });
};