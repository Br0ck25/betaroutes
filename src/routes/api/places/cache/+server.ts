// src/routes/api/places/cache/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
    // [!code fix] Security: Disable client-side cache poisoning.
    return json({ error: 'Client caching is disabled.' }, { status: 405 });
};