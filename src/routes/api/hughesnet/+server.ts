// src/routes/api/hughesnet/+server.ts
import { json } from '@sveltejs/kit';
import { HughesNetService } from '$lib/server/hughesnet';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
    // 1. Configuration & Env Validation
    if (!platform?.env?.BETA_HUGHESNET_KV || !platform?.env?.HNS_ENCRYPTION_KEY) {
        console.error('[Configuration] Critical: Database or Encryption Key missing');
        return json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    // 2. Enforce Authentication (No 'default_user' fallback)
    if (!locals.user) {
        return json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        
        // 3. Use Immutable User ID
        const userId = locals.user.id;
        const settingsId = locals.user.id;

        console.log(`[API] HughesNet Action: ${body.action} | User: ${userId}`);

        // Service Instantiation
        // Note: For heavy scraping, this should eventually be offloaded to Cloudflare Queues.
        const service = new HughesNetService(
            platform.env.BETA_HUGHESNET_KV, 
            platform.env.HNS_ENCRYPTION_KEY,
            platform.env.BETA_LOGS_KV,
            platform.env.BETA_LOGS_TRASH_KV, 
            platform.env.BETA_USER_SETTINGS_KV,
            platform.env.PRIVATE_GOOGLE_MAPS_API_KEY,
            platform.env.BETA_DIRECTIONS_KV 
        );

        if (body.action === 'connect') {
            const success = await service.connect(userId, body.username, body.password);
            // 4. Redact Logs from Client Response
            return json({ success, error: success ? undefined : 'Login failed' });
        }
        
        if (body.action === 'disconnect') {
            const success = await service.disconnect(userId);
            return json({ success });
        }

        if (body.action === 'sync') {
            // 5. Fetch Pricing from Server (Source of Truth)
            // Do not trust body.installPay etc.
            let settings = {};
            try {
                const settingsRaw = await platform.env.BETA_USER_SETTINGS_KV.get(settingsId);
                if (settingsRaw) settings = JSON.parse(settingsRaw);
            } catch (e) {
                console.error('[API] Failed to load user settings', e);
            }

            // Default to 0 if not set in KV
            const installPay = Number(settings.installPay) || 0;
            const repairPay = Number(settings.repairPay) || 0;
            const upgradePay = Number(settings.upgradePay) || 0;
            const poleCost = Number(settings.poleCost) || 0;
            const concreteCost = Number(settings.concreteCost) || 0;
            const poleCharge = Number(settings.poleCharge) || 0;
            
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
                incomplete: result.incomplete 
                // Logs removed
            });
        }

        if (body.action === 'clear') {
            const count = await service.clearAllTrips(userId);
            return json({ success: true, count });
        }

        return json({ success: false, error: 'Invalid action' }, { status: 400 });

    } catch (err: any) {
        console.error('API Error:', err);
        // 6. Explicit Error Serialization
        const errorMessage = err instanceof Error ? err.message : String(err);
        return json({ success: false, error: errorMessage || 'Internal Server Error' }, { status: 500 });
    }
};

export const GET: RequestHandler = async ({ platform, locals }) => {
    // Validation
    if (!platform?.env?.BETA_HUGHESNET_KV || !platform?.env?.HNS_ENCRYPTION_KEY) {
        return json({ orders: {} }, { status: 500 });
    }

    // Auth Check
    if (!locals.user) {
        return json({ orders: {}, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const userId = locals.user.id;
        
        const service = new HughesNetService(
            platform.env.BETA_HUGHESNET_KV, 
            platform.env.HNS_ENCRYPTION_KEY,
            platform.env.BETA_LOGS_KV,
            platform.env.BETA_LOGS_TRASH_KV,
            platform.env.BETA_USER_SETTINGS_KV,
            platform.env.PRIVATE_GOOGLE_MAPS_API_KEY,
            platform.env.BETA_DIRECTIONS_KV 
        );
        
        const orders = await service.getOrders(userId);
        return json({ orders });
    } catch (err) {
        console.error('[API] GET Error:', err);
        return json({ orders: {} });
    }
};