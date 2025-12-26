// src/routes/api/hughesnet/+server.ts
import { json } from '@sveltejs/kit';
import { HughesNetService } from '$lib/server/hughesnet/service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
    if (!platform?.env?.BETA_HUGHESNET_KV || !platform?.env?.TRIP_INDEX_DO) {
        return json({ success: false, error: 'Database configuration missing (KV or DO)' }, { status: 500 });
    }

    try {
        const body = await request.json();
        const userId = locals.user?.name || locals.user?.token || locals.user?.id || 'default_user';
        const settingsId = locals.user?.id;

        console.log(`[API] HughesNet Action: ${body.action} for ${userId}`);

        const service = new HughesNetService(
            platform.env.BETA_HUGHESNET_KV, 
            platform.env.HNS_ENCRYPTION_KEY,
            platform.env.BETA_LOGS_KV,
            platform.env.BETA_LOGS_TRASH_KV,
            platform.env.BETA_USER_SETTINGS_KV,
            platform.env.PRIVATE_GOOGLE_MAPS_API_KEY,
            platform.env.BETA_DIRECTIONS_KV,
            platform.env.BETA_HUGHESNET_ORDERS_KV,
            platform.env.BETA_LOGS_KV,
            platform.env.TRIP_INDEX_DO
        );

        if (body.action === 'save_settings') {
            if (!body.settings) {
                return json({ success: false, error: 'Settings data missing' }, { status: 400 });
            }
            await service.saveSettings(userId, body.settings);
            return json({ success: true, logs: service.logs });
        }

        if (body.action === 'get_settings') {
            const settings = await service.getSettings(userId);
            return json({ success: true, settings });
        }

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
            const wifiExtenderPay = Number(body.wifiExtenderPay) || 0; 
            const voipPay = Number(body.voipPay) || 0;
            const driveTimeBonus = Number(body.driveTimeBonus) || 0; 
            const skipScan = body.skipScan === true;
            const recentOnly = body.recentOnly === true;
            const forceDates = Array.isArray(body.forceDates) ? body.forceDates : []; // [!code ++] Extract forceDates

            const result = await service.sync(
                userId, 
                settingsId, 
                installPay, 
                repairPay, 
                upgradePay, 
                poleCost, 
                concreteCost, 
                poleCharge,
                wifiExtenderPay,
                voipPay,
                driveTimeBonus,
                skipScan,
                recentOnly,
                forceDates // [!code ++] Pass param
            );
            
            return json({ 
                success: true, 
                orders: result.orders, 
                incomplete: result.incomplete, 
                conflicts: result.conflicts, // [!code ++] Return conflicts
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
        
        const service = new HughesNetService(
            platform.env.BETA_HUGHESNET_KV, 
            platform.env.HNS_ENCRYPTION_KEY,
            platform.env.BETA_LOGS_KV,
            platform.env.BETA_LOGS_TRASH_KV,
            platform.env.BETA_USER_SETTINGS_KV,
            platform.env.PRIVATE_GOOGLE_MAPS_API_KEY,
            platform.env.BETA_DIRECTIONS_KV,
            platform.env.BETA_HUGHESNET_ORDERS_KV,
            platform.env.BETA_LOGS_KV,
            platform.env.TRIP_INDEX_DO
        );
        const orders = await service.getOrders(userId);
        
        return json({ orders });
    } catch (err) {
        return json({ orders: {} });
    }
};