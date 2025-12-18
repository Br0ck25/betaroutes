// src/do-worker.ts
// Import both Durable Object classes
// We use relative paths to ensure resolution without SvelteKit aliases
import { TripIndexDO } from './lib/server/TripIndexDO';
import { PlacesIndexDO } from './lib/server/PlacesIndexDO';

// Export the classes so Cloudflare sees them
export { TripIndexDO, PlacesIndexDO };

// Default export for the Worker itself
export default {
  async fetch(request: Request, env: any) {
    return new Response("Data Worker (Trips + Places) is Running", { status: 200 });
  }
};