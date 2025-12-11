import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';

export const GET: RequestHandler = async ({ platform }) => {
    const env = platform?.env || {};
    // @ts-ignore
    const placesKV = env.BETA_PLACES_KV as KVNamespace;
    
    const diagnostics = {
        environment: 'production',
        hasPlatform: !!platform,
        hasEnv: !!platform?.env,
        hasKVBinding: !!placesKV,
        kvStatus: 'Checking...',
        sampleKeys: [] as any[],
        totalKeys: 0
    };

    if (!placesKV) {
        diagnostics.kvStatus = 'MISSING BINDING - Check Cloudflare Dashboard > Settings > Functions';
        return json(diagnostics);
    }

    try {
        // Try to list the first 5 keys to prove connection and data existence
        const list = await placesKV.list({ limit: 5 });
        diagnostics.kvStatus = 'CONNECTED';
        diagnostics.sampleKeys = list.keys;
        diagnostics.totalKeys = list.keys.length;
        
        // If empty, we know the connection works but DB is just empty
        if (list.keys.length === 0) {
            diagnostics.kvStatus = 'CONNECTED BUT EMPTY';
        }
    } catch (e) {
        diagnostics.kvStatus = `ERROR: ${String(e)}`;
    }

    return json(diagnostics);
};