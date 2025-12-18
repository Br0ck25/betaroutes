// src/lib/server/PlacesIndexDO.ts
import type { DurableObjectState, KVNamespace } from "@cloudflare/workers-types";

export class PlacesIndexDO {
    state: DurableObjectState;
    env: any;

    constructor(state: DurableObjectState, env: any) {
        this.state = state;
        this.env = env;
    }

    async fetch(request: Request) {
        const url = new URL(request.url);
        
        // POST /add - Atomically add an address to this prefix bucket
        if (request.method === "POST" && url.pathname === "/add") {
            try {
                const { address } = await request.json() as { address: string };
                if (!address) return new Response("Missing address", { status: 400 });

                // 1. Atomic Read-Modify-Write in DO Storage
                // This is the source of truth preventing the race condition
                let list = await this.state.storage.get<string[]>("list") || [];
                
                // Avoid duplicates
                if (!list.includes(address)) {
                    list.push(address);
                    
                    // Maintain max size (50)
                    if (list.length > 50) {
                        list.shift(); // Remove oldest
                    }

                    // 2. Save back to DO Storage
                    await this.state.storage.put("list", list);

                    // 3. "Write-Through" to KV
                    // This allows the autocomplete endpoint to keep reading from KV fast
                    // without needing to call this DO.
                    const kv = this.env.BETA_PLACES_KV as KVNamespace;
                    if (kv) {
                        // The DO's name (ID) is derived from the prefix key, e.g., "prefix:123 m"
                        // We use the same key for KV to keep them in sync.
                        // We can pass the key in the request or infer it, but passing it is safer.
                        const key = url.searchParams.get('key');
                        if (key) {
                            await kv.put(key, JSON.stringify(list));
                        }
                    }
                }

                return new Response("OK");

            } catch (err) {
                return new Response((err as Error).message, { status: 500 });
            }
        }

        return new Response("Not Found", { status: 404 });
    }
}