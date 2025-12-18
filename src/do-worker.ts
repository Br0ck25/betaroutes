// src/do-worker.ts
import { TripIndexDO } from './lib/server/TripIndexDO';
import { PlacesIndexDO } from './lib/server/PlacesIndexDO';

// 1. Export the OLD names to satisfy Cloudflare's safety checks.
// (Cloudflare complains if you remove a class that was previously deployed)
export { TripIndexDO, PlacesIndexDO };

// 2. Export the NEW names for our new SQLite bindings.
// We extend the classes so they are treated as "new" logic, allowing 
// the 'new_sqlite_classes' migration to provision them with SQL storage.
export class TripIndexSQL extends TripIndexDO {}
export class PlacesIndexSQL extends PlacesIndexDO {}

export default {
  async fetch(request: Request, env: any) {
    return new Response("Data Worker (SQL) is Running", { status: 200 });
  }
};