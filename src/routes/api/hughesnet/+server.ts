// src/routes/api/hughesnet/+server.ts
import { json } from '@sveltejs/kit';
import { HughesNetService } from '$lib/server/hughesnet/service';
import { getEnv, safeKV, safeDO } from '$lib/server/env';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import type { RequestHandler } from './$types';

type SessionUser = { id?: string; name?: string; token?: string };

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const env = getEnv(platform);
	if (!safeKV(env, 'BETA_HUGHESNET_KV') || !safeDO(env, 'TRIP_INDEX_DO')) {
		return json(
			{ success: false, error: 'Database configuration missing (KV or DO)' },
			{ status: 500 }
		);
	}

	try {
		const body = (await request.json()) as unknown;
		const bodyObj = body as Record<string, unknown>;
		const user = locals.user as SessionUser | undefined;
		const userId = user?.name || user?.token || user?.id || 'default_user';
		const settingsId = user?.id;

		const action = String(bodyObj['action'] || '');
		log.info('HughesNet action', { action, userId });

		const HNS_ENCRYPTION_KEY = String((env as Record<string, unknown>)['HNS_ENCRYPTION_KEY'] || '');
		const PRIVATE_GOOGLE_MAPS_API_KEY = String(
			(env as Record<string, unknown>)['PRIVATE_GOOGLE_MAPS_API_KEY'] || ''
		);
		const service = new HughesNetService(
			safeKV(env, 'BETA_HUGHESNET_KV')!,
			HNS_ENCRYPTION_KEY,
			safeKV(env, 'BETA_LOGS_KV')!,
			undefined,
			safeKV(env, 'BETA_USER_SETTINGS_KV')!,
			PRIVATE_GOOGLE_MAPS_API_KEY,
			safeKV(env, 'BETA_DIRECTIONS_KV')!,
			safeKV(env, 'BETA_HUGHESNET_ORDERS_KV')!,
			safeKV(env, 'BETA_LOGS_KV')!,
			safeDO(env, 'TRIP_INDEX_DO')!,
			safeKV(env, 'BETA_MILLAGE_KV')
		);

		if (action === 'save_settings') {
			if (!bodyObj['settings']) {
				return json({ success: false, error: 'Settings data missing' }, { status: 400 });
			}
			await service.saveSettings(
				userId,
				bodyObj['settings'] as unknown as import('$lib/server/hughesnet/types').SyncConfig
			);
			return json({ success: true, logs: service.logs });
		}

		if (action === 'get_settings') {
			const settings = await service.getSettings(userId);
			return json({ success: true, settings });
		}

		if (action === 'connect') {
			const username = String(bodyObj['username'] || '');
			const password = String(bodyObj['password'] || '');
			const success = await service.connect(userId, username, password);
			return json({ success, error: success ? undefined : 'Login failed', logs: service.logs });
		}

		if (action === 'disconnect') {
			const success = await service.disconnect(userId);
			return json({ success, logs: service.logs });
		}

		if (action === 'sync') {
			const installPay = Number(bodyObj['installPay'] as unknown) || 0;
			const repairPay = Number(bodyObj['repairPay'] as unknown) || 0;
			const upgradePay = Number(bodyObj['upgradePay'] as unknown) || 0;
			const poleCost = Number(bodyObj['poleCost'] as unknown) || 0;
			const concreteCost = Number(bodyObj['concreteCost'] as unknown) || 0;
			const poleCharge = Number(bodyObj['poleCharge'] as unknown) || 0;
			const wifiExtenderPay = Number(bodyObj['wifiExtenderPay'] as unknown) || 0;
			const voipPay = Number(bodyObj['voipPay'] as unknown) || 0;
			const driveTimeBonus = Number(bodyObj['driveTimeBonus'] as unknown) || 0;
			const skipScan = bodyObj['skipScan'] === true;
			const recentOnly = bodyObj['recentOnly'] === true;
			const forceDates = Array.isArray(bodyObj['forceDates'])
				? (bodyObj['forceDates'] as unknown[]).map(String)
				: []; // [!code ++] Extract forceDates

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
				forceDates as string[] // [!code ++] Pass param
			);

			return json({
				success: true,
				orders: result.orders,
				incomplete: result.incomplete,
				conflicts: result.conflicts, // [!code ++] Return conflicts
				logs: service.logs
			});
		}

		if (action === 'clear') {
			const count = await service.clearAllTrips(userId);
			return json({ success: true, count, logs: service.logs });
		}

		return json({ success: false, error: 'Invalid action' }, { status: 400 });
	} catch (err: unknown) {
		log.error('HughesNet API Error', { message: createSafeErrorMessage(err) });
		return json({ success: false, error: 'Server error' }, { status: 500 });
	}
};

export const GET: RequestHandler = async ({ platform, locals }) => {
	const env = getEnv(platform);
	if (!safeKV(env, 'BETA_HUGHESNET_KV')) return json({ orders: {} });
	try {
		const user = locals.user as SessionUser | undefined;
		const userId = user?.name || user?.token || user?.id || 'default_user';

		const HNS_ENCRYPTION_KEY = (env as Record<string, unknown>)['HNS_ENCRYPTION_KEY'] as
			| string
			| undefined;
		const PRIVATE_GOOGLE_MAPS_API_KEY = (env as Record<string, unknown>)[
			'PRIVATE_GOOGLE_MAPS_API_KEY'
		] as string | undefined;
		const service = new HughesNetService(
			safeKV(env, 'BETA_HUGHESNET_KV')!,
			HNS_ENCRYPTION_KEY ?? '',
			safeKV(env, 'BETA_LOGS_KV')!,
			undefined,
			safeKV(env, 'BETA_USER_SETTINGS_KV')!,
			PRIVATE_GOOGLE_MAPS_API_KEY ?? '',
			safeKV(env, 'BETA_DIRECTIONS_KV')!,
			safeKV(env, 'BETA_HUGHESNET_ORDERS_KV')!,
			safeKV(env, 'BETA_LOGS_KV')!,
			safeDO(env, 'TRIP_INDEX_DO')!,
			safeKV(env, 'BETA_MILLAGE_KV')
		);
		const orders = await service.getOrders(userId);

		return json({ orders });
	} catch (err: unknown) {
		log.warn('HughesNet GET failed', { message: createSafeErrorMessage(err) });
		return json({ orders: {} });
	}
};
