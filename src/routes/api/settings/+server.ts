// src/routes/api/settings/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { log } from '$lib/server/log';

const settingsSchema = z.object({
	defaultStartAddress: z.string().max(500).optional(),
	defaultEndAddress: z.string().max(500).optional(),
	defaultMPG: z.number().positive().nullish(),
	defaultGasPrice: z.number().nonnegative().nullish(),
	vehicleName: z.string().max(100).optional(),
	distanceUnit: z.enum(['mi', 'km']).optional(),
	currency: z.enum(['USD', 'EUR', 'GBP', 'JPY']).optional(),
	theme: z.enum(['light', 'dark', 'system']).optional(),
	expenseCategories: z.array(z.string()).optional(),
	maintenanceCategories: z.array(z.string()).optional(),
	supplyCategories: z.array(z.string()).optional(),

	// Vehicle & maintenance settings
	serviceIntervalMiles: z.number().nonnegative().optional(),
	lastServiceOdometer: z.number().nonnegative().optional(),
	lastServiceDate: z.string().optional(),
	reminderThresholdMiles: z.number().nonnegative().optional(),
	vehicleOdometerStart: z.number().nonnegative().optional()
});

export const GET: RequestHandler = async ({ locals, platform }) => {
	const user = locals.user as any;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { getEnv, safeKV } = await import('$lib/server/env');
	const env = getEnv(platform);
	const kv = safeKV(env, 'BETA_USER_SETTINGS_KV');
	if (!kv) return json({});

	try {
		// [!code fix] Ensure consistency with write key
		const raw = await kv.get(`settings:${(user as any).id}`);
		const settings = raw ? JSON.parse(raw) : {};
		return json(settings);
	} catch (err: any) {
		log.error('Failed to load settings', { message: err?.message });
		return json({});
	}
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const user = locals.user as any;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { getEnv, safeKV } = await import('$lib/server/env');
	const env = getEnv(platform);
	const kv = safeKV(env, 'BETA_USER_SETTINGS_KV');
	if (!kv) return json({ error: 'Service Unavailable' }, { status: 503 });

	try {
		const body: any = await request.json();

		// Handle both wrapped { settings: {...} } and flat payloads
		const payload = body.settings || body;
		const result = settingsSchema.safeParse(payload);

		if (!result.success) {
			return json(
				{
					error: 'Invalid settings',
					details: result.error.flatten()
				},
				{ status: 400 }
			);
		}

		// [!code fix] Use the namespaced key
		const key = `settings:${(user as any).id}`;
		const existingRaw = await kv.get(key);
		const existing = existingRaw ? JSON.parse(existingRaw) : {};

		const updated = { ...existing, ...result.data };
		await kv.put(key, JSON.stringify(updated));

		return json(updated);
	} catch (e: any) {
		log.error('Settings update failed', { message: e?.message });
		return json({ error: 'Internal Error' }, { status: 500 });
	}
};
