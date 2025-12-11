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
        
        const userId = locals.user?.name || locals.user?.token || locals.user?.id || 'default_user';
        const settingsId = locals.user?.id;

        console.log(`[API] HughesNet Action for User: ${userId}`);

        const service = new HughesNetService(
            platform.env.BETA_HUGHESNET_KV, 
            platform.env.HNS_ENCRYPTION_KEY,
            platform.env.BETA_LOGS_KV,
            platform.env.BETA_USER_SETTINGS_KV,
            platform.env.PUBLIC_GOOGLE_MAPS_API_KEY
        );

        if (body.action === 'connect') {
            const success = await service.connect(userId, body.username, body.password);
            if (!success) return json({ success: false, error: 'Login failed' });
            return json({ success: true });
        }

        if (body.action === 'sync') {
            // Extract all config parameters
            const installPay = Number(body.installPay) || 0;
            const repairPay = Number(body.repairPay) || 0;
            const installTime = Number(body.installTime) || 90;
            const repairTime = Number(body.repairTime) || 60;
            const overrideTimes = body.overrideTimes === true;

            const orders = await service.sync(
                userId, 
                settingsId, 
                installPay, 
                repairPay, 
                installTime, 
                repairTime, 
                overrideTimes
            );
            return json({ success: true, orders });
        }

        if (body.action === 'clear') {
            const count = await service.clearAllTrips(userId);
            return json({ success: true, count });
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
            platform.env.BETA_USER_SETTINGS_KV,
            platform.env.PUBLIC_GOOGLE_MAPS_API_KEY
        );
        const orders = await service.getOrders(userId);
        return json({ orders });
    } catch (err) {
        return json({ orders: {} });
    }
};