// src/lib/server/TripIndexDO.ts
import type { DurableObjectState } from "@cloudflare/workers-types";

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
        this.state.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS trips (
                id TEXT PRIMARY KEY,
                date TEXT,
                createdAt TEXT,
                data TEXT
            );
        `);

        // 2. Migration Logic: Move legacy KV data to SQLite
        this.state.blockConcurrencyWhile(async () => {
            const legacyTrips = await this.state.storage.get<TripSummary[]>("trips");
            if (legacyTrips && Array.isArray(legacyTrips) && legacyTrips.length > 0) {
                const stmt = this.state.storage.sql.prepare(`
                    INSERT OR REPLACE INTO trips (id, date, createdAt, data) 
                    VALUES (?, ?, ?, ?)
                `);
                for (const trip of legacyTrips) {
                    stmt.run(trip.id, trip.date || "", trip.createdAt || "", JSON.stringify(trip));
                }
                await this.state.storage.delete("trips");
            }
        });
    }

    async fetch(request: Request) {
        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // --- INDEXING OPERATIONS ---

            // GET /list - Return all trips (sorted)
            if (path === "/list") {
                const cursor = this.state.storage.sql.exec(`
                    SELECT data FROM trips 
                    ORDER BY date DESC, createdAt DESC
                `);
                const trips = [];
                for (const row of cursor) {
                    trips.push(JSON.parse(row.data as string));
                }
                return new Response(JSON.stringify(trips));
            }

            // POST /migrate - Receive bulk data from KV to initialize
            if (path === "/migrate") {
                const trips = await request.json() as TripSummary[];
                const stmt = this.state.storage.sql.prepare(`
                    INSERT OR REPLACE INTO trips (id, date, createdAt, data) 
                    VALUES (?, ?, ?, ?)
                `);
                for (const trip of trips) {
                    stmt.run(trip.id, trip.date || "", trip.createdAt || "", JSON.stringify(trip));
                }
                return new Response("OK");
            }

            // POST /put - Add or Update a trip
            if (path === "/put") {
                const trip = await request.json() as TripSummary;
                if (!trip || !trip.id) return new Response("Invalid Data", { status: 400 });

                this.state.storage.sql.exec(`
                    INSERT OR REPLACE INTO trips (id, date, createdAt, data)
                    VALUES (?, ?, ?, ?)
                `, trip.id, trip.date || "", trip.createdAt || "", JSON.stringify(trip));
                
                return new Response("OK");
            }

            // POST /delete - Remove a trip
            if (path === "/delete") {
                const { id } = await request.json() as { id: string };
                this.state.storage.sql.exec("DELETE FROM trips WHERE id = ?", id);
                return new Response("OK");
            }

            // --- BILLING ATOMIC COUNTERS ---

            if (path === "/billing/check-increment") {
                const { monthKey, limit } = await request.json() as { monthKey: string, limit: number };
                const key = `count:${monthKey}`;
                const current = await this.state.storage.get<number>(key) || 0;
                
                if (current >= limit) return new Response(JSON.stringify({ allowed: false, count: current }));
                
                await this.state.storage.put(key, current + 1);
                const lifetime = await this.state.storage.get<number>("count:lifetime") || 0;
                await this.state.storage.put("count:lifetime", lifetime + 1);
                
                return new Response(JSON.stringify({ allowed: true, count: current + 1 }));
            }

            if (path === "/billing/decrement") {
                const { monthKey } = await request.json() as { monthKey: string };
                const key = `count:${monthKey}`;
                const current = await this.state.storage.get<number>(key) || 0;
                const newCount = Math.max(0, current - 1);
                await this.state.storage.put(key, newCount);
                return new Response(JSON.stringify({ count: newCount }));
            }

            return new Response("Not Found", { status: 404 });

        } catch (err) {
            // [!code fix] Log internal error details privately
            console.error("[TripIndexDO] Error:", err);
            // Return safe, generic error to client
            return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
        }
    }
}