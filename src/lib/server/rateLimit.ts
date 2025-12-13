// src/lib/server/rateLimit.ts
import type { KVNamespace } from '@cloudflare/workers-types';

export async function checkRateLimit(
    kv: KVNamespace, 
    ip: string, 
    action: string, 
    limit: number = 5, 
    windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number }> {
    const key = `ratelimit:${action}:${ip}`;
    
    // Get current count
    const currentRaw = await kv.get(key);
    const current = currentRaw ? parseInt(currentRaw) : 0;

    if (current >= limit) {
        return { allowed: false, remaining: 0 };
    }

    // Increment
    // We set expirationTtl so the block clears automatically
    await kv.put(key, (current + 1).toString(), { expirationTtl: windowSeconds });

    return { allowed: true, remaining: limit - (current + 1) };
}