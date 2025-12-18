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

export class TripIndexDO {
    state: DurableObjectState;
    env: any;

    constructor(state: DurableObjectState, env: any) {
        this.state = state;
        this.env = env;

        // 1. Initialize SQLite Schema
        // We store the full object in 'data' but extract date/created columns for fast sorting
        this.state.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS trips (
                id TEXT PRIMARY KEY,
                date TEXT,
                createdAt TEXT,
                data TEXT
            );
        `);

        // 2. Internal Migration: Check for "Mega-Key" data and move to SQL
        // This ensures users who already hit the limit or have existing data don't lose it.
        // blockConcurrencyWhile prevents requests from hitting the DO until migration is done.
        this.state.blockConcurrencyWhile(async () => {
            const legacyTrips = await this.state.storage.get<TripSummary[]>("trips");
            
            if (legacyTrips && Array.isArray(legacyTrips) && legacyTrips.length > 0) {
                console.log(`[TripIndexDO] Migrating ${legacyTrips.length} legacy trips to SQLite...`);
                
                const stmt = this.state.storage.sql.prepare(`
                    INSERT OR REPLACE INTO trips (id, date, createdAt, data) 
                    VALUES (?, ?, ?, ?)
                `);

                for (const trip of legacyTrips) {
                    stmt.run(
                        trip.id, 
                        trip.date || "", 
                        trip.createdAt || "", 
                        JSON.stringify(trip)
                    );
                }

                // Delete the old key to free up space and prevent re-migration
                await this.state.storage.delete("trips");
                console.log(`[TripIndexDO] Migration complete.`);
            }
        });
    }

    async fetch(request: Request) {
        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // --- INDEXING OPERATIONS (SQLITE BACKED) ---

            // GET /list - Return all trips (sorted by date DESC, then createdAt DESC)
            if (path === "/list") {
                // Check if we need to migrate from External KV (User's first load logic from original code)
                const initialized = await this.state.storage.get<boolean>("initialized");
                if (!initialized) {
                    // Double check if we actually have data in SQL (internal migration might have populated it)
                    const result = this.state.storage.sql.exec("SELECT COUNT(*) as count FROM trips").one();
                    // @ts-ignore - count is typically returned, but strictly typing raw SQL results can be tricky
                    const count = result?.count || 0;

                    if (count === 0) {
                         return new Response(JSON.stringify({ needsMigration: true }));
                    }
                    // If we have data, mark initialized so we stop asking for migration
                    await this.state.storage.put("initialized", true);
                }

                // Efficient SQL Query for sorting
                // This replaces the memory-heavy JS sort() which caused issues
                const cursor = this.state.storage.sql.exec(`
                    SELECT data FROM trips 
                    ORDER BY date DESC, createdAt DESC
                `);

                // Parse the JSON strings back to objects
                const trips = [];
                for (const row of cursor) {
                    trips.push(JSON.parse(row.data as string));
                }

                return new Response(JSON.stringify(trips));
            }

            // POST /migrate - Receive bulk data from External KV to initialize
            if (path === "/migrate") {
                const trips = await request.json() as TripSummary[];
                
                const stmt = this.state.storage.sql.prepare(`
                    INSERT OR REPLACE INTO trips (id, date, createdAt, data) 
                    VALUES (?, ?, ?, ?)
                `);

                // Batch Insert
                for (const trip of trips) {
                    stmt.run(
                        trip.id, 
                        trip.date || "", 
                        trip.createdAt || "", 
                        JSON.stringify(trip)
                    );
                }
                
                await this.state.storage.put("initialized", true);
                return new Response("OK");
            }

            // POST /put - Add or Update a trip
            if (path === "/put") {
                const trip = await request.json() as TripSummary;
                
                if (!trip || !trip.id) {
                    return new Response("Invalid Trip Data", { status: 400 });
                }

                // Atomic Upsert (Insert or Replace)
                this.state.storage.sql.exec(`
                    INSERT OR REPLACE INTO trips (id, date, createdAt, data)
                    VALUES (?, ?, ?, ?)
                `, 
                    trip.id, 
                    trip.date || "", 
                    trip.createdAt || "", 
                    JSON.stringify(trip)
                );

                return new Response("OK");
            }

            // POST /delete - Remove a trip
            if (path === "/delete") {
                const { id } = await request.json() as { id: string };
                
                this.state.storage.sql.exec(`
                    DELETE FROM trips WHERE id = ?
                `, id);

                return new Response("OK");
            }

            // --- BILLING ATOMIC COUNTERS (REMAINS KV) ---
            // Note: KV is faster/cheaper for simple atomic counters and can coexist with SQL storage.

            // GET /billing/check - Check & Increment in one atomic step
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
            // Log to Cloudflare dashboard
            console.error("[TripIndexDO] Error:", err);
            // Return sanitized error to preventing leaking internal details
            return new Response(JSON.stringify({ error: "Internal Error" }), { status: 500 });
        }
    }
}