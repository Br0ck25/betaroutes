// src/lib/server/TripIndexDO.ts
import type { DurableObjectState } from "@cloudflare/workers-types";

interface TripSummary {
    id: string;
    date?: string;
    createdAt: string;
    updatedAt: string;
    [key: string]: any;
}

interface ExpenseRecord {
    id: string;
    userId: string;
    date: string;
    category: string;
    amount: number;
    description?: string;
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
            
            CREATE TABLE IF NOT EXISTS expenses (
                id TEXT PRIMARY KEY,
                date TEXT,
                category TEXT,
                createdAt TEXT,
                data TEXT
            );
        `);

        // 2. Safe Trip Migration Logic (Legacy KV -> SQLite)
        this.state.blockConcurrencyWhile(async () => {
            try {
                // Attempt to load legacy data.
                const legacyTrips = await this.state.storage.get<TripSummary[]>("trips");

                if (legacyTrips && Array.isArray(legacyTrips) && legacyTrips.length > 0) {
                    console.log(`[TripIndexDO] Migrating ${legacyTrips.length} legacy trips to SQLite...`);
                    
                    const stmt = this.state.storage.sql.prepare(`
                        INSERT OR REPLACE INTO trips (id, date, createdAt, data) 
                        VALUES (?, ?, ?, ?)
                    `);

                    // Process in chunks to manage memory and transaction log size
                    const CHUNK_SIZE = 100;
                    for (let i = 0; i < legacyTrips.length; i += CHUNK_SIZE) {
                        const chunk = legacyTrips.slice(i, i + CHUNK_SIZE);
                        
                        this.state.storage.sql.exec("BEGIN TRANSACTION");
                        try {
                            for (const trip of chunk) {
                                stmt.run(
                                    trip.id, 
                                    trip.date || "", 
                                    trip.createdAt || "", 
                                    JSON.stringify(trip)
                                );
                            }
                            this.state.storage.sql.exec("COMMIT");
                        } catch (err) {
                            this.state.storage.sql.exec("ROLLBACK");
                            throw err; // Re-throw to trigger the outer catch
                        }
                    }

                    // Only delete legacy data if migration completed successfully
                    await this.state.storage.delete("trips");
                    console.log("[TripIndexDO] Migration complete.");
                }
            } catch (err) {
                // Log the error but DO NOT crash the worker. 
                console.error("[TripIndexDO] Startup Migration Failed (Recovered):", err);
            }
        });
    }

    async fetch(request: Request) {
        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // Helper for safely parsing JSON
            const parseBody = async <T>() => {
                try {
                    return await request.json() as T;
                } catch {
                    throw new Error("INVALID_JSON");
                }
            };

            // --- TRIP OPERATIONS ---

            if (path === "/list") {
                const limitParam = url.searchParams.get('limit');
                const offsetParam = url.searchParams.get('offset');

                let query = `SELECT data FROM trips ORDER BY date DESC, createdAt DESC`;
                const params: (string | number)[] = [];

                if (limitParam) {
                    const limit = parseInt(limitParam) || 50;
                    const offset = parseInt(offsetParam || '0') || 0;
                    query += ` LIMIT ? OFFSET ?`;
                    params.push(limit, offset);
                }

                const cursor = this.state.storage.sql.exec(query, ...params);
                
                // Get total count (Typed safely)
                const countRes = this.state.storage.sql.exec("SELECT COUNT(*) as total FROM trips");
                const total = (countRes.one() as { total: number }).total;

                const trips = [];
                for (const row of cursor) {
                    trips.push(JSON.parse(row.data as string));
                }

                return new Response(JSON.stringify({
                    trips,
                    pagination: {
                        total,
                        limit: limitParam ? parseInt(limitParam) : trips.length,
                        offset: offsetParam ? parseInt(offsetParam) : 0
                    }
                }));
            }

            if (path === "/migrate") {
                const trips = await parseBody<TripSummary[]>();
                const stmt = this.state.storage.sql.prepare(`
                    INSERT OR REPLACE INTO trips (id, date, createdAt, data) 
                    VALUES (?, ?, ?, ?)
                `);
                
                // Wrap bulk inserts in a transaction for performance
                this.state.storage.sql.exec("BEGIN TRANSACTION");
                try {
                    for (const trip of trips) {
                        stmt.run(trip.id, trip.date || "", trip.createdAt || "", JSON.stringify(trip));
                    }
                    this.state.storage.sql.exec("COMMIT");
                } catch (err) {
                    this.state.storage.sql.exec("ROLLBACK");
                    throw err;
                }
                return new Response("OK");
            }

            if (path === "/put") {
                const trip = await parseBody<TripSummary>();
                // Explicit validation
                if (!trip || !trip.id) return new Response("Invalid Data: Missing ID", { status: 400 });

                this.state.storage.sql.exec(`
                    INSERT OR REPLACE INTO trips (id, date, createdAt, data)
                    VALUES (?, ?, ?, ?)
                `, trip.id, trip.date || "", trip.createdAt || "", JSON.stringify(trip));
                
                return new Response("OK");
            }

            if (path === "/delete") {
                const { id } = await parseBody<{ id: string }>();
                if (!id) return new Response("Missing ID", { status: 400 });

                this.state.storage.sql.exec("DELETE FROM trips WHERE id = ?", id);
                return new Response("OK");
            }

            // --- EXPENSE OPERATIONS ---

            if (path === "/expenses/list") {
                const cursor = this.state.storage.sql.exec(`
                    SELECT data FROM expenses 
                    ORDER BY date DESC, createdAt DESC
                `);
                const expenses = [];
                for (const row of cursor) {
                    expenses.push(JSON.parse(row.data as string));
                }
                return new Response(JSON.stringify(expenses));
            }

            if (path === "/expenses/put") {
                const item = await parseBody<ExpenseRecord>();
                if (!item || !item.id) return new Response("Invalid Data: Missing ID", { status: 400 });

                this.state.storage.sql.exec(`
                    INSERT OR REPLACE INTO expenses (id, date, category, createdAt, data)
                    VALUES (?, ?, ?, ?, ?)
                `, item.id, item.date, item.category, item.createdAt, JSON.stringify(item));
                
                return new Response("OK");
            }

            if (path === "/expenses/delete") {
                const { id } = await parseBody<{ id: string }>();
                if (!id) return new Response("Missing ID", { status: 400 });

                this.state.storage.sql.exec("DELETE FROM expenses WHERE id = ?", id);
                return new Response("OK");
            }

            if (path === "/expenses/migrate") {
                const items = await parseBody<ExpenseRecord[]>();
                const stmt = this.state.storage.sql.prepare(`
                    INSERT OR REPLACE INTO expenses (id, date, category, createdAt, data) 
                    VALUES (?, ?, ?, ?, ?)
                `);

                // Wrap bulk inserts in a transaction
                this.state.storage.sql.exec("BEGIN TRANSACTION");
                try {
                    for (const item of items) {
                        stmt.run(item.id, item.date, item.category, item.createdAt, JSON.stringify(item));
                    }
                    this.state.storage.sql.exec("COMMIT");
                } catch (err) {
                    this.state.storage.sql.exec("ROLLBACK");
                    throw err;
                }

                await this.state.storage.put("expenses_migrated", true);
                return new Response("OK");
            }

            if (path === "/expenses/status") {
                const countRes = this.state.storage.sql.exec("SELECT COUNT(*) as c FROM expenses");
                // Typed safely
                const count = (countRes.one() as { c: number }).c;
                const migrated = await this.state.storage.get("expenses_migrated");
                return new Response(JSON.stringify({ 
                    needsMigration: !migrated && count === 0 
                }));
            }

            // --- BILLING COUNTERS ---

            if (path === "/billing/check-increment") {
                const { monthKey, limit } = await parseBody<{ monthKey: string, limit: number }>();
                if (!monthKey || typeof limit !== 'number') return new Response("Invalid Payload", { status: 400 });

                const key = `count:${monthKey}`;
                const current = await this.state.storage.get<number>(key) || 0;
                
                if (current >= limit) return new Response(JSON.stringify({ allowed: false, count: current }));
                
                await this.state.storage.put(key, current + 1);
                const lifetime = await this.state.storage.get<number>("count:lifetime") || 0;
                await this.state.storage.put("count:lifetime", lifetime + 1);
                
                return new Response(JSON.stringify({ allowed: true, count: current + 1 }));
            }

            if (path === "/billing/decrement") {
                const { monthKey } = await parseBody<{ monthKey: string }>();
                if (!monthKey) return new Response("Invalid Payload", { status: 400 });

                const key = `count:${monthKey}`;
                const current = await this.state.storage.get<number>(key) || 0;
                const newCount = Math.max(0, current - 1);
                await this.state.storage.put(key, newCount);
                return new Response(JSON.stringify({ count: newCount }));
            }

            return new Response("Not Found", { status: 404 });

        } catch (err: any) {
            console.error("[TripIndexDO] Error:", err);
            
            // Handle specific errors for better client debugging
            if (err.message === "INVALID_JSON") {
                return new Response("Invalid JSON Body", { status: 400 });
            }
            if (err.message && err.message.includes("constraint")) {
                return new Response(JSON.stringify({ error: "Conflict: Data constraint violation" }), { status: 409 });
            }
            
            return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
        }
    }
}