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
        
        // Atomic Add Operation
        if (request.method === "POST" && url.pathname === "/add") {
            try {
                const { address } = await request.json() as { address: string };
                if (!address) return new Response("Missing address", { status: 400 });

                // 1. Read-Modify-Write in DO Storage (Atomic)
                let list = await this.state.storage.get<string[]>("list") || [];
                
                if (!list.includes(address)) {
                    list.push(address);
                    if (list.length > 50) list.shift(); // Keep last 50

                    await this.state.storage.put("list", list);

                    // 2. Write-Through to KV for fast reads
                    const kv = this.env.BETA_PLACES_KV as KVNamespace;
                    const key = url.searchParams.get('key');
                    if (kv && key) {
                        await kv.put(key, JSON.stringify(list));
                    }
                }
                return new Response("OK");
            } catch (err) {
                // [!code fix] Log internal error details privately
                console.error("[PlacesIndexDO] Error:", err);
                // Return safe, generic error to client
                return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
            }
        }
        return new Response("Not Found", { status: 404 });
    }
}