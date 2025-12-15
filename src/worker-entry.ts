// src/worker-entry.ts
// This exports the Durable Object class so the runtime can find it
export { TripIndexDO } from '$lib/server/TripIndexDO';

// Re-export the default fetch handler (likely handled by SvelteKit's adapter automatically,
// but we need to ensure the class is part of the module graph).