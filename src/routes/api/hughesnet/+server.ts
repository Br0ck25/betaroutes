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

        console.log(`[API] HughesNet Action for User: ${userId} (Settings ID: ${settingsId})`);

        // [!code changed] Use PRIVATE_GOOGLE_MAPS_API_KEY
        const service = new HughesNetService(
            platform.env.BETA_HUGHESNET_KV, 
            platform.env.HNS_ENCRYPTION_KEY,
            platform.env.BETA_LOGS_KV,
            platform.env.BETA_LOGS_TRASH_KV, 
            platform.env.BETA_USER_SETTINGS_KV,
            platform.env.PRIVATE_GOOGLE_MAPS_API_KEY, // <--- Updated
            platform.env.BETA_DIRECTIONS_KV 
        );

        if (body.action === 'connect') {
            const success = await service.connect(userId, body.username, body.password);
            return json({ success, error: success ? undefined : 'Login failed', logs: service.logs });
        }
        
        if (body.action === 'disconnect') {
            const success = await service.disconnect(userId);
            return json({ success, logs: service.logs });
        }

        if (body.action === 'sync') {
            const installPay = Number(body.installPay) || 0;
            const repairPay = Number(body.repairPay) || 0;
            const upgradePay = Number(body.upgradePay) || 0;
            const poleCost = Number(body.poleCost) || 0;
            const concreteCost = Number(body.concreteCost) || 0;
            const poleCharge = Number(body.poleCharge) || 0;
            
            const skipScan = body.skipScan === true;

            const result = await service.sync(
                userId, 
                settingsId, 
                installPay, 
                repairPay, 
                upgradePay,
                poleCost,
                concreteCost,
                poleCharge,
                skipScan
            );
            
            return json({ 
                success: true, 
                orders: result.orders, 
                incomplete: result.incomplete, 
                logs: service.logs 
            });
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
        
        // [!code changed] Use PRIVATE_GOOGLE_MAPS_API_KEY
        const service = new HughesNetService(
            platform.env.BETA_HUGHESNET_KV, 
            platform.env.HNS_ENCRYPTION_KEY,
            platform.env.BETA_LOGS_KV,
            platform.env.BETA_LOGS_TRASH_KV,
            platform.env.BETA_USER_SETTINGS_KV,
            platform.env.PRIVATE_GOOGLE_MAPS_API_KEY, // <--- Updated
            platform.env.BETA_DIRECTIONS_KV 
        );
        const orders = await service.getOrders(userId);
        return json({ orders });
    } catch (err) {
        return json({ orders: {} });
    }
};