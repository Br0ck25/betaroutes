// src/lib/server/TripIndexDO.ts
import type { DurableObjectState } from "@cloudflare/workers-types";

interface TripSummary {
    id: string;
    userId: string;
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

        // 1. Initialize SQLite Schema with userId for integrity
        // Added userId to ensure data isolation if an instance is repurposed
        this.state.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS trips (
                id TEXT PRIMARY KEY,
                userId TEXT,
                date TEXT,
                createdAt TEXT,
                data TEXT
            );
            
            CREATE TABLE IF NOT EXISTS expenses (
                id TEXT PRIMARY KEY,
                userId TEXT,
                date TEXT,
                category TEXT,
                createdAt TEXT,
                data TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(userId);
            CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(userId);
        `);

        // 2. Safe Trip Migration Logic (Legacy KV -> SQLite)
        this.state.blockConcurrencyWhile(async () => {
            try {
                const legacyTrips = await this.state.storage.get<TripSummary[]>("trips");

                if (legacyTrips && Array.isArray(legacyTrips) && legacyTrips.length > 0) {
                    console.log(`[TripIndexDO] Migrating ${legacyTrips.length} legacy trips to SQLite...`);
                    
                    const CHUNK_SIZE = 100;
                    for (let i = 0; i < legacyTrips.length; i += CHUNK_SIZE) {
                        const chunk = legacyTrips.slice(i, i + CHUNK_SIZE);
                        
                        this.state.storage.sql.exec("BEGIN TRANSACTION");
                        try {
                            for (const trip of chunk) {
                                this.state.storage.sql.exec(
                                    "INSERT OR REPLACE INTO trips (id, userId, date, createdAt, data) VALUES (?, ?, ?, ?, ?)",
                                    trip.id,
                                    trip.userId || "",
                                    trip.date || "",
                                    trip.createdAt || "",
                                    JSON.stringify(trip)
                                );
                            }
                            this.state.storage.sql.exec("COMMIT");
                        } catch (err) {
                            this.state.storage.sql.exec("ROLLBACK");
                            throw err; 
                        }
                    }

                    await this.state.storage.delete("trips");
                    console.log("[TripIndexDO] Migration complete.");
                }
            } catch (err) {
                console.error("[TripIndexDO] Startup Migration Failed (Recovered):", err);
            }
        });
    }

    async fetch(request: Request) {
        const url = new URL(request.url);
        const path = url.pathname;

        try {
            const parseBody = async <T>() => {
                try {
                    return await request.json() as T;
                } catch {
                    throw new Error("INVALID_JSON");
                }
            };

            // --- ADMIN OPERATIONS ---
            
            if (path === "/admin/wipe-user") {
                 if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

                 this.state.storage.sql.exec("BEGIN TRANSACTION");
                 try {
                     this.state.storage.sql.exec("DELETE FROM trips");
                     this.state.storage.sql.exec("DELETE FROM expenses");
                     this.state.storage.sql.exec("COMMIT");
                 } catch (err) {
                     this.state.storage.sql.exec("ROLLBACK");
                     console.error("[TripIndexDO] Wipe Failed:", err);
                     return new Response("Wipe Failed", { status: 500 });
                 }
                 
                 return new Response("Account Data Wiped");
            }

            // --- TRIP OPERATIONS ---

            if (path === "/list") {
                const limitParam = url.searchParams.get('limit');
                const offsetParam = url.searchParams.get('offset');

                // Performance Fix: Only fetch necessary rows using SQL LIMIT/OFFSET
                // and defer JSON parsing until after pagination
                let query = `SELECT data FROM trips ORDER BY date DESC, createdAt DESC`;
                const params: (string | number)[] = [];

                if (limitParam) {
                    const limit = parseInt(limitParam) || 50;
                    const offset = parseInt(offsetParam || '0') || 0;
                    query += ` LIMIT ? OFFSET ?`;
                    params.push(limit, offset);
                }

                const cursor = this.state.storage.sql.exec(query, ...params);
                
                const countRes = this.state.storage.sql.exec("SELECT COUNT(*) as total FROM trips");
                const total = (countRes.one() as { total: number }).total;

                const trips = [];
                for (const row of cursor) {
                    // JSON parsing happens only for the returned page
                    trips.push(JSON.parse((row as any)['data'] as string));
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
                this.state.storage.sql.exec("BEGIN TRANSACTION");
                try {
                    for (const trip of trips) {
                        this.state.storage.sql.exec(
                            "INSERT OR REPLACE INTO trips (id, userId, date, createdAt, data) VALUES (?, ?, ?, ?, ?)",
                            trip.id,
                            trip.userId,
                            trip.date || "",
                            trip.createdAt || "",
                            JSON.stringify(trip)
                        );
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
                if (!trip || !trip.id || !trip.userId) return new Response("Invalid Data", { status: 400 });

                this.state.storage.sql.exec(`
                    INSERT OR REPLACE INTO trips (id, userId, date, createdAt, data)
                    VALUES (?, ?, ?, ?, ?)
                `, trip.id, trip.userId, trip.date || "", trip.createdAt || "", JSON.stringify(trip));
                
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
                // Performance Fix: Optimized query for expenses
                const cursor = this.state.storage.sql.exec(`
                    SELECT data FROM expenses 
                    ORDER BY date DESC, createdAt DESC
                `);
                const expenses = [];
                for (const row of cursor) {
                    expenses.push(JSON.parse((row as any)['data'] as string));
                }
                return new Response(JSON.stringify(expenses));
            }

            if (path === "/expenses/put") {
                const item = await parseBody<ExpenseRecord>();
                if (!item || !item.id || !item.userId) return new Response("Invalid Data", { status: 400 });

                this.state.storage.sql.exec(`
                    INSERT OR REPLACE INTO expenses (id, userId, date, category, createdAt, data)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, item.id, item.userId, item.date, item.category, item.createdAt, JSON.stringify(item));
                
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
                this.state.storage.sql.exec("BEGIN TRANSACTION");
                try {
                    for (const item of items) {
                        this.state.storage.sql.exec(
                            "INSERT OR REPLACE INTO expenses (id, userId, date, category, createdAt, data) VALUES (?, ?, ?, ?, ?, ?)",
                            item.id,
                            item.userId,
                            item.date,
                            item.category,
                            item.createdAt,
                            JSON.stringify(item)
                        );
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