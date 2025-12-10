// src/routes/api/hughesnet/+server.ts
import { json } from '@sveltejs/kit';
import { HughesNetService } from '$lib/server/hughesnet';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
    console.log('[API] HughesNet POST Request');

    // Fail-safe check for bindings
    if (!platform?.env?.BETA_HUGHESNET_KV) {
        console.error('[API] CRITICAL: BETA_HUGHESNET_KV is undefined! Check src/hooks.server.ts');
        return json({ success: false, error: 'Database configuration error (KV missing)' }, { status: 500 });
    }

    try {
        const body = await request.json();
        const userId = locals.user?.name || locals.user?.email || 'default_user';
        
        const service = new HughesNetService(
            platform.env.BETA_HUGHESNET_KV, 
            platform.env.HNS_ENCRYPTION_KEY,
            platform.env.BETA_LOGS_KV,
            platform.env.BETA_USER_SETTINGS_KV,
            platform.env.PUBLIC_GOOGLE_MAPS_API_KEY
        );

        if (body.action === 'connect') {
            console.log(`[API] Connecting user: ${userId}`);
            const success = await service.connect(userId, body.username, body.password);
            if (!success) return json({ success: false, error: 'Invalid credentials or login failed.' });
            return json({ success: true });
        }

        if (body.action === 'sync') {
            console.log(`[API] Syncing orders for: ${userId}`);
            const orders = await service.sync(userId);
            return json({ success: true, orders });
        }

        return json({ success: false, error: 'Invalid action' }, { status: 400 });

    } catch (err: any) {
        console.error('[API] Server Error:', err);
        return json({ success: false, error: err.message || 'Unknown server error' }, { status: 500 });
    }
};

export const GET: RequestHandler = async ({ platform, locals }) => {
    if (!platform?.env?.BETA_HUGHESNET_KV) return json({ orders: {} });
    
    try {
        const userId = locals.user?.name || locals.user?.email || 'default_user';
        const service = new HughesNetService(
            platform.env.BETA_HUGHESNET_KV, 
            platform.env.HNS_ENCRYPTION_KEY,
            platform.env.BETA_LOGS_KV,
            platform.env.BETA_USER_SETTINGS_KV,
            platform.env.PUBLIC_GOOGLE_MAPS_API_KEY
        );
        const orders = await service.getOrders(userId);
        return json({ orders });
    } catch (err) {
        console.error('[API] GET Error:', err);
        return json({ orders: {} });
    }
};