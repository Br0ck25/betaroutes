// src/lib/server/TripIndexDO.ts
import type { DurableObjectState } from "@cloudflare/workers-types";

// Types matching your app
interface TripSummary {
    id: string;
    date?: string;
    createdAt: string;
    updatedAt: string;
    [key: string]: any;
}

// Helper: Safely extract a string for sorting to prevent runtime crashes
function getSortValue(t: any): string {
    if (!t) return "";
    // Prioritize date, then createdAt, then fail safe to empty string
    const val = t.date || t.createdAt;
    return typeof val === 'string' ? val : "";
}

export class TripIndexDO {
    state: DurableObjectState;
    env: any;

    constructor(state: DurableObjectState, env: any) {
        this.state = state;
        this.env = env;
    }

    async fetch(request: Request) {
        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // --- INDEXING OPERATIONS ---

            // GET /list - Return all trips (sorted)
            if (path === "/list") {
                // Check if we need to migrate from KV (One-time lazy load)
                const initialized = await this.state.storage.get<boolean>("initialized");
                if (!initialized) {
                    return new Response(JSON.stringify({ needsMigration: true }));
                }

                const trips = await this.state.storage.get<TripSummary[]>("trips") || [];
                return new Response(JSON.stringify(trips));
            }

            // POST /migrate - Receive bulk data from KV to initialize
            if (path === "/migrate") {
                const trips = await request.json() as TripSummary[];
                
                // Safe Sort: Descending by date
                trips.sort((a, b) => 
                    getSortValue(b).localeCompare(getSortValue(a))
                );
                
                await this.state.storage.put("trips", trips);
                await this.state.storage.put("initialized", true);
                return new Response("OK");
            }

            // POST /put - Add or Update a trip
            if (path === "/put") {
                const trip = await request.json() as TripSummary;
                
                // Validate basic integrity before storing
                if (!trip || !trip.id) {
                    return new Response("Invalid Trip Data", { status: 400 });
                }

                let trips = await this.state.storage.get<TripSummary[]>("trips") || [];
                
                const idx = trips.findIndex(t => t.id === trip.id);
                if (idx >= 0) {
                    trips[idx] = trip; // Update
                } else {
                    trips.push(trip); // Insert
                }

                // Safe Sort
                trips.sort((a, b) => 
                    getSortValue(b).localeCompare(getSortValue(a))
                );

                await this.state.storage.put("trips", trips);
                return new Response("OK");
            }

            // POST /delete - Remove a trip
            if (path === "/delete") {
                const { id } = await request.json() as { id: string };
                let trips = await this.state.storage.get<TripSummary[]>("trips") || [];
                trips = trips.filter(t => t.id !== id);
                await this.state.storage.put("trips", trips);
                return new Response("OK");
            }

            // --- BILLING ATOMIC COUNTERS ---

            // GET /billing/check - Check & Increment in one atomic step
            // Returns: { allowed: boolean, newCount: number }
            if (path === "/billing/check-increment") {
                const { monthKey, limit } = await request.json() as { monthKey: string, limit: number };
                const storageKey = `count:${monthKey}`;
                
                const current = await this.state.storage.get<number>(storageKey) || 0;
                
                if (current >= limit) {
                    return new Response(JSON.stringify({ allowed: false, count: current }));
                }

                const newCount = current + 1;
                await this.state.storage.put(storageKey, newCount);
                
                // Track total lifetime count too
                const lifetime = await this.state.storage.get<number>("count:lifetime") || 0;
                await this.state.storage.put("count:lifetime", lifetime + 1);

                return new Response(JSON.stringify({ allowed: true, count: newCount }));
            }

            // POST /billing/decrement - Refund quota (e.g. on delete)
            if (path === "/billing/decrement") {
                const { monthKey } = await request.json() as { monthKey: string };
                const storageKey = `count:${monthKey}`;
                
                const current = await this.state.storage.get<number>(storageKey) || 0;
                const newCount = Math.max(0, current - 1);
                await this.state.storage.put(storageKey, newCount);
                
                return new Response(JSON.stringify({ count: newCount }));
            }

            return new Response("Not Found", { status: 404 });

        } catch (err) {
            return new Response((err as Error).message, { status: 500 });
        }
    }
}