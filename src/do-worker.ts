// src/do-worker.ts
import { TripIndexDO } from './lib/server/TripIndexDO';
import { PlacesIndexDO } from './lib/server/PlacesIndexDO';

// 1. Export the OLD names for compatibility with existing deployments
export { TripIndexDO, PlacesIndexDO };

// 2. Export the NEW SQL-suffixed names.
// These specific exports are granted storage.sql access via wrangler.toml
export class TripIndexSQL extends TripIndexDO {}
export class PlacesIndexSQL extends PlacesIndexDO {}

export default {
	async fetch() {
		return new Response('Data Worker (SQL) is Running', { status: 200 });
	}
};
