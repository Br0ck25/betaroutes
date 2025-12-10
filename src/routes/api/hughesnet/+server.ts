// src/routes/api/hughesnet/+server.ts
import { json } from '@sveltejs/kit';
import { HughesNetService } from '$lib/server/hughesnet';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
    // Check if platform is available (crucial for local dev)
    if (!platform?.env?.BETA_HUGHESNET_KV) {
        console.error('CRITICAL: BETA_HUGHESNET_KV is missing. Did you update src/hooks.server.ts?');
        return json({ success: false, error: 'Internal Error: Database configuration missing.' }, { status: 500 });
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
            const success = await service.connect(userId, body.username, body.password);
            if (!success) return json({ success: false, error: 'Login failed or invalid credentials.' });
            return json({ success: true });
        }

        if (body.action === 'sync') {
            const orders = await service.sync(userId);
            return json({ success: true, orders });
        }

        return json({ success: false, error: 'Invalid action' }, { status: 400 });

    } catch (err: any) {
        console.error('API Error:', err);
        return json({ success: false, error: err.message || 'Server error' }, { status: 500 });
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
        return json({ orders: {} });
    }
};