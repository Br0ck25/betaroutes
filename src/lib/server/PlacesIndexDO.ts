// src/lib/server/PlacesIndexDO.ts
import type { DurableObjectState, KVNamespace } from "@cloudflare/workers-types";

export class PlacesIndexDO {
    state: DurableObjectState;
    env: any;

    constructor(state: DurableObjectState, env: any) {
        this.state = state;
        this.env = env;

        // 1. Initialize SQLite Schema
        this.state.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS places (
                address TEXT PRIMARY KEY,
                created_at INTEGER
            );
        `);

        // 2. Migration Logic (Legacy KV List -> SQLite)
        // Ensures we don't lose data during the deployment transition
        this.state.blockConcurrencyWhile(async () => {
            const list = await this.state.storage.get<string[]>("list");
            if (list && Array.isArray(list) && list.length > 0) {
                // Insert each item directly (avoid using .prepare which may not exist on SqlStorage)
                // Preserve existing order by assigning incremental timestamps
                const baseTime = Date.now() - (list.length * 1000);
                for (let i = 0; i < list.length; i++) {
                    this.state.storage.sql.exec(
                        "INSERT OR IGNORE INTO places (address, created_at) VALUES (?, ?)",
                        list[i],
                        baseTime + (i * 1000)
                    );
                }

                // Cleanup legacy storage
                await this.state.storage.delete("list");
            }
        });
    }

    async fetch(request: Request) {
        const url = new URL(request.url);
        
        // Atomic Add Operation
        if (request.method === "POST" && url.pathname === "/add") {
            try {
                const { address } = await request.json() as { address: string };
                if (!address) return new Response("Missing address", { status: 400 });

                // Check if address already exists (Read optimized)
                const existing = this.state.storage.sql.exec(
                    "SELECT 1 FROM places WHERE address = ?", 
                    address
                ).toArray();

                // Only proceed if it's a new address
                if (existing.length === 0) {
                    // 1. Insert new address with current timestamp
                    this.state.storage.sql.exec(
                        "INSERT INTO places (address, created_at) VALUES (?, ?)", 
                        address, 
                        Date.now()
                    );

                    // 2. Prune if list exceeds 50 items (FIFO)
                    const countRes = this.state.storage.sql.exec("SELECT COUNT(*) as total FROM places");
                    // [!code fix] improved type safety (was @ts-ignore)
                    const result = countRes.one() as { total: number };
                    
                    if (result.total > 50) {
                        const toDelete = result.total - 50;
                        // Delete the oldest records
                        this.state.storage.sql.exec(`
                            DELETE FROM places 
                            WHERE address IN (
                                SELECT address FROM places ORDER BY created_at ASC LIMIT ?
                            )
                        `, toDelete);
                    }

                    // 3. Write-Through to KV for fast reads
                    // Fetch the updated list (ordered by creation time to match array behavior)
                    const cursor = this.state.storage.sql.exec("SELECT address FROM places ORDER BY created_at ASC");
                    const list: string[] = [];
                    for (const row of cursor) {
                        list.push((row as any)['address'] as string);
                    }

                    const kv = this.env.BETA_PLACES_KV as KVNamespace;
                    const key = url.searchParams.get('key');
                    if (kv && key) {
                        await kv.put(key, JSON.stringify(list));
                    }
                }
                
                return new Response("OK");
            } catch (err) {
                console.error("[PlacesIndexDO] Error:", err);
                return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
            }
        }
        return new Response("Not Found", { status: 404 });
    }
}