// src/routes/api/hughesnet/+server.ts
import { json } from '@sveltejs/kit';
import { HughesNetService } from '$lib/server/hughesnet';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
    // 1. Enforce Authentication & Use Immutable ID
    // Prevent unauthorized access and avoid using mutable names or tokens as IDs
    if (!locals.user || !locals.user.id) {
        return json({ success: false, error: 'Unauthorized: Please log in.' }, { status: 401 });
    }
    const userId = locals.user.id;
    const settingsId = locals.user.id; // Use ID for settings lookup as well

    // 2. Validate Environment Configuration
    if (!platform?.env?.BETA_HUGHESNET_KV || !platform?.env?.HNS_ENCRYPTION_KEY || !platform?.env?.BETA_USER_SETTINGS_KV) {
        console.error('[API] Critical: Missing database configuration.');
        return json({ success: false, error: 'Server configuration error.' }, { status: 500 });
    }

    try {
        const body = await request.json();

        // 3. Service Instantiation (Scoped to Request)
        const service = new HughesNetService(
            platform.env.BETA_HUGHESNET_KV,
            platform.env.HNS_ENCRYPTION_KEY,
            platform.env.BETA_LOGS_KV,
            platform.env.BETA_LOGS_TRASH_KV,
            platform.env.BETA_USER_SETTINGS_KV,
            platform.env.PRIVATE_GOOGLE_MAPS_API_KEY,
            platform.env.BETA_DIRECTIONS_KV
        );

        console.log(`[API] HughesNet Action: ${body.action} for User ID: ${userId}`);

        // --- CONNECT ---
        if (body.action === 'connect') {
            if (!body.username || !body.password) {
                return json({ success: false, error: 'Username and password required.' }, { status: 400 });
            }
            const success = await service.connect(userId, body.username, body.password);
            // Security: Do NOT return raw logs to client
            return json({ success, error: success ? undefined : 'Login failed. Check credentials.' });
        }

        // --- DISCONNECT ---
        if (body.action === 'disconnect') {
            const success = await service.disconnect(userId);
            return json({ success });
        }

        // --- SYNC ---
        if (body.action === 'sync') {
            // 4. Securely Fetch Pay Rates from Server Settings
            // Do NOT trust rates sent in the request body
            let installPay = 0, repairPay = 0, upgradePay = 0;
            let poleCost = 0, concreteCost = 0, poleCharge = 0;

            try {
                const settingsRaw = await platform.env.BETA_USER_SETTINGS_KV.get(settingsId);
                if (settingsRaw) {
                    const s = JSON.parse(settingsRaw);
                    // Handle potential nested 'settings' object or flat structure
                    const vals = s.settings || s; 
                    installPay = Number(vals.installPay) || 0;
                    repairPay = Number(vals.repairPay) || 0;
                    upgradePay = Number(vals.upgradePay) || 0;
                    poleCost = Number(vals.poleCost) || 0;
                    concreteCost = Number(vals.concreteCost) || 0;
                    poleCharge = Number(vals.poleCharge) || 0;
                }
            } catch (e) {
                console.warn(`[API] Failed to load settings for user ${userId}, using defaults.`, e);
            }

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
                // Logs redacted
            });
        }

        // --- CLEAR ---
        if (body.action === 'clear') {
            const count = await service.clearAllTrips(userId);
            return json({ success: true, count });
        }

        return json({ success: false, error: 'Invalid action provided.' }, { status: 400 });

    } catch (err: any) {
        console.error('[API] Error:', err);
        // 5. Explicit Error Serialization
        // Ensure the error message is actually sent to the client
        return json({ success: false, error: err.message || 'An unexpected server error occurred.' }, { status: 500 });
    }
};

export const GET: RequestHandler = async ({ platform, locals }) => {
    // 6. Secure GET Endpoint
    // Remove 'default_user' fallback to prevent data leaks
    if (!locals.user || !locals.user.id) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!platform?.env?.BETA_HUGHESNET_KV || !platform?.env?.HNS_ENCRYPTION_KEY) {
        return json({ orders: {}, error: 'Database unavailable' });
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
    } catch (err: any) {
        console.error('[API] GET Error:', err);
        return json({ orders: {}, error: err.message });
    }
};