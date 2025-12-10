// src/routes/api/hughesnet/+server.ts
import { json } from '@sveltejs/kit';
import { HughesNetService } from '$lib/server/hughesnet';
import type { RequestHandler } from './$types';

const getService = (platform: App.Platform) => {
    return new HughesNetService(
        platform.env.BETA_HUGHESNET_KV, 
        platform.env.HNS_ENCRYPTION_KEY,
        platform.env.BETA_LOGS_KV,
        platform.env.BETA_USER_SETTINGS_KV,
        platform.env.PUBLIC_GOOGLE_MAPS_API_KEY
    );
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
    console.log('[API] HughesNet request received');

    // 1. Check if we have access to Cloudflare bindings
    if (!platform || !platform.env) {
        console.error('[API] Error: Platform/Env is missing. Are you running "npm run dev"? Try "wrangler pages dev .svelte-kit/cloudflare" or ensure bindings are mocked.');
        return json({ 
            success: false, 
            error: 'Database connection missing. If running locally, ensure you are using a compatible adapter or wrangler.' 
        }, { status: 500 });
    }

    try {
        const body = await request.json();
        const userId = locals.user?.name || locals.user?.email || 'default_user';
        const service = getService(platform);

        if (body.action === 'connect') {
            console.log(`[API] Connecting user: ${userId}`);
            const success = await service.connect(userId, body.username, body.password);
            
            if (!success) {
                return json({ success: false, error: 'Login failed. Please check your username and password.' });
            }
            return json({ success: true });
        }

        if (body.action === 'sync') {
            console.log(`[API] Syncing orders for: ${userId}`);
            const orders = await service.sync(userId);
            return json({ success: true, orders });
        }

        return json({ success: false, error: 'Invalid action' }, { status: 400 });

    } catch (err: any) {
        console.error('[API] Critical Error:', err);
        return json({ success: false, error: err.message || 'Server error occurred' }, { status: 500 });
    }
};

export const GET: RequestHandler = async ({ url, platform, locals }) => {
    if (!platform || !platform.env) {
         // Return empty data instead of crashing if platform is missing in dev
        return json({ orders: {} });
    }
    
    try {
        const userId = locals.user?.name || locals.user?.email || 'default_user';
        const service = getService(platform);
        const orders = await service.getOrders(userId);
        return json({ orders });
    } catch (err) {
        console.error('[API] GET Error:', err);
        return json({ orders: {} });
    }
};