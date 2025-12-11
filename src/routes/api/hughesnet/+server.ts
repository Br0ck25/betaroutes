// src/routes/api/hughesnet/+server.ts
import { json } from '@sveltejs/kit';
import { HughesNetService } from '$lib/server/hughesnet';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
    if (!platform?.env?.BETA_HUGHESNET_KV) {
        return json({ success: false, error: 'Database configuration missing' }, { status: 500 });
    }

    try {
        const body = await request.json();
        
        // 1. Identity for TRIP STORAGE (use Name to match Dashboard)
        const userId = locals.user?.name || locals.user?.token || locals.user?.id || 'default_user';
        
        // 2. Identity for SETTINGS LOOKUP (use UUID to match Settings API)
        const settingsId = locals.user?.id;

        console.log(`[API] HughesNet Action for User: ${userId} (Settings ID: ${settingsId})`);

        const service = new HughesNetService(
            platform.env.BETA_HUGHESNET_KV, 
            platform.env.HNS_ENCRYPTION_KEY,
            platform.env.BETA_LOGS_KV,
            platform.env.BETA_LOGS_TRASH_KV, 
            platform.env.BETA_USER_SETTINGS_KV,
            platform.env.PUBLIC_GOOGLE_MAPS_API_KEY
        );

        if (body.action === 'connect') {
            const success = await service.connect(userId, body.username, body.password);
            
            // Return logs even if failed
            return json({ success, error: success ? undefined : 'Login failed', logs: service.logs });
        }

        if (body.action === 'sync') {
            // Extract Pay Rates (default to 0)
            const installPay = Number(body.installPay) || 0;
            const repairPay = Number(body.repairPay) || 0;

            // Pass params to sync
            const orders = await service.sync(userId, settingsId, installPay, repairPay);
            
            // Return logs with orders
            return json({ success: true, orders, logs: service.logs });
        }

        if (body.action === 'clear') {
            const count = await service.clearAllTrips(userId);
            return json({ success: true, count, logs: service.logs });
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
        const userId = locals.user?.name || locals.user?.token || locals.user?.id || 'default_user';
        
        const service = new HughesNetService(
            platform.env.BETA_HUGHESNET_KV, 
            platform.env.HNS_ENCRYPTION_KEY,
            platform.env.BETA_LOGS_KV,
            platform.env.BETA_LOGS_TRASH_KV,
            platform.env.BETA_USER_SETTINGS_KV,
            platform.env.PUBLIC_GOOGLE_MAPS_API_KEY
        );
        const orders = await service.getOrders(userId);
        return json({ orders });
    } catch (err) {
        return json({ orders: {} });
    }
};