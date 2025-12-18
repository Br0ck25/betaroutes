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

// Helper: Safely extract a string for sorting
function getSortValue(t: any): string {
    if (!t) return "";
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
                // Check migration status
                const initialized = await this.state.storage.get<boolean>("initialized");
                if (!initialized) {
                    return new Response(JSON.stringify({ needsMigration: true }));
                }

                // [!code fix] Fetch all items prefixed with "trip:" (Scalable)
                const tripsMap = await this.state.storage.list<TripSummary>({ prefix: "trip:" });
                const trips = Array.from(tripsMap.values());

                // Sort in memory (fast for metadata objects)
                trips.sort((a, b) => 
                    getSortValue(b).localeCompare(getSortValue(a))
                );

                return new Response(JSON.stringify(trips));
            }

            // POST /migrate - Receive bulk data (Batch processing)
            if (path === "/migrate") {
                const trips = await request.json() as TripSummary[];
                
                if (trips.length > 0) {
                    // [!code fix] Prepare object for bulk write
                    const entries: Record<string, TripSummary> = {};
                    for (const t of trips) {
                        entries[`trip:${t.id}`] = t;
                    }
                    await this.state.storage.put(entries);
                }

                const urlParams = new URLSearchParams(url.search);
                if (urlParams.get('complete') === 'true') {
                    await this.state.storage.put("initialized", true);
                }

                return new Response("OK");
            }

            // POST /put - Add or Update a trip
            if (path === "/put") {
                const trip = await request.json() as TripSummary;
                
                if (!trip || !trip.id) {
                    return new Response("Invalid Trip Data", { status: 400 });
                }

                // [!code fix] Direct O(1) Write
                await this.state.storage.put(`trip:${trip.id}`, trip);
                return new Response("OK");
            }

            // POST /delete - Remove a trip
            if (path === "/delete") {
                const { id } = await request.json() as { id: string };
                // [!code fix] Direct O(1) Delete
                await this.state.storage.delete(`trip:${id}`);
                return new Response("OK");
            }

            // --- BILLING ATOMIC COUNTERS ---
            if (path === "/billing/check-increment") {
                const { monthKey, limit } = await request.json() as { monthKey: string, limit: number };
                const storageKey = `count:${monthKey}`;
                const current = await this.state.storage.get<number>(storageKey) || 0;
                
                if (current >= limit) {
                    return new Response(JSON.stringify({ allowed: false, count: current }));
                }

                const newCount = current + 1;
                await this.state.storage.put(storageKey, newCount);
                
                const lifetime = await this.state.storage.get<number>("count:lifetime") || 0;
                await this.state.storage.put("count:lifetime", lifetime + 1);

                return new Response(JSON.stringify({ allowed: true, count: newCount }));
            }

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