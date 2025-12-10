// src/routes/api/hughesnet/+server.ts
import { json } from '@sveltejs/kit';
import { HughesNetService } from '$lib/server/hughesnet';
import type { RequestHandler } from './$types';

const getService = (platform: App.Platform) => {
    return new HughesNetService(
        platform.env.BETA_HUGHESNET_KV, 
        platform.env.HNS_ENCRYPTION_KEY,
        platform.env.BETA_LOGS_KV, // Pass the Trips KV
        platform.env.BETA_USER_SETTINGS_KV, // Pass the Settings KV
        platform.env.PUBLIC_GOOGLE_MAPS_API_KEY // Pass Google Maps Key
    );
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
    if (!platform) return json({ error: 'No platform' }, { status: 500 });
    
    const body = await request.json();
    const userId = locals.user?.name || locals.user?.email || 'default_user';
    
    const service = getService(platform);

    if (body.action === 'connect') {
        const success = await service.connect(userId, body.username, body.password);
        return json({ success });
    }

    if (body.action === 'sync') {
        const orders = await service.sync(userId);
        return json({ success: true, orders });
    }

    return json({ error: 'Invalid action' }, { status: 400 });
};

export const GET: RequestHandler = async ({ url, platform, locals }) => {
    if (!platform) return json({ error: 'No platform' }, { status: 500 });
    
    const userId = locals.user?.name || locals.user?.email || 'default_user';
    const service = getService(platform);
    
    const orders = await service.getOrders(userId);
    return json({ orders });
};