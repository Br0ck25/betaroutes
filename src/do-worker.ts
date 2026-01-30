// src/do-worker.ts
import { TripIndexDO } from './lib/server/TripIndexDO';
import { PlacesIndexDO } from './lib/server/PlacesIndexDO';

// 1. Export the OLD names
export { TripIndexDO, PlacesIndexDO };

// 2. KEEP the old SQL class (Crucial to fix the deployment error)
export class TripIndexSQL extends TripIndexDO {}

// 3. ADD the new Fresh class (For the clean slate)
export class TripIndexFresh extends TripIndexDO {}

// 4. Export Places
export class PlacesIndexSQL extends PlacesIndexDO {}

export default {
  async fetch() {
    return new Response('Data Worker (SQL) is Running', { status: 200 });
  }
};
