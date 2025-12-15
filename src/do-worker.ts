// src/do-worker.ts
// We use a relative path here to ensure Wrangler can resolve it without SvelteKit aliases
import { TripIndexDO } from './lib/server/TripIndexDO';

// Export the class so Cloudflare sees it
export { TripIndexDO };

// A Durable Object worker must have a default export handler
export default {
  async fetch(request: Request, env: any) {
    return new Response("Trip Index Durable Object Worker is Running", { status: 200 });
  }
};