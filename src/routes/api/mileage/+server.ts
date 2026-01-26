// src/routes/api/mileage/+server.ts
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { makeMileageService, type MileageRecord } from '$lib/server/mileageService';
import { getEnv, safeKV, safeDO } from '$lib/server/env';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import { PLAN_LIMITS } from '$lib/constants';
import { findUserById } from '$lib/server/userService';
import { getStorageId } from '$lib/server/user';
import { checkRateLimitEnhanced } from '$lib/server/rateLimit';

function hasGet(v: unknown): v is { get: (k: string) => Promise<string | null> } {
	return (
		typeof v === 'object' &&
		v !== null &&
		typeof (v as Record<string, unknown>)['get'] === 'function'
	);
}

const MAX_RECENT_MILEAGE = 1000;

const mileageSchema = z.object({
	// Allow any string ID to support HughesNet sync trip IDs (e.g., hns_James_2025-09-22)
	id: z.string().max(200).optional(),
	tripId: z.string().max(200).optional(),
	date: z.string().optional(),
	startOdometer: z.number().nonnegative().optional(),
	endOdometer: z.number().nonnegative().optional(),
	notes: z.string().max(1000).optional(),
	miles: z.number().nonnegative().optional(),
	mileageRate: z.number().nonnegative().optional(),
	vehicle: z.string().optional(),
	reimbursement: z.number().nonnegative().optional()
});

export const GET: RequestHandler = async (event) => {
	try {
		const user = event.locals.user as { id?: string } | undefined;
		if (!user || !user.id) return new Response('Unauthorized', { status: 401 });

		let env: App.Env;
		try {
			env = getEnv(event.platform) as App.Env;
		} catch {
			return new Response('Service Unavailable', { status: 503 });
		}

		// Capture 'since' for differential sync
		const since = event.url.searchParams.get('since') || undefined;

		const svc = makeMileageService(safeKV(env, 'BETA_MILEAGE_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);

		// Use canonical storage id only
		const storageId = getStorageId(user);
		if (!storageId) return new Response('Unauthorized', { status: 401 });
		const items = await svc.list(storageId, since);

		return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json' } });
	} catch (err) {
		log.error('GET /api/mileage error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		const sessionUser = event.locals.user as { id?: string; plan?: string } | undefined;
		if (!sessionUser || !sessionUser.id) return new Response('Unauthorized', { status: 401 });

		let env: App.Env;
		try {
			env = getEnv(event.platform) as App.Env;
		} catch {
			return new Response('Service Unavailable', { status: 503 });
		}

		// [!code fix] Strictly use ID for rate limiting and storage
		const storageId = sessionUser.id || '';

		const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');
		if (sessionsKV) {
			const rateLimitResult = await checkRateLimitEnhanced(
				sessionsKV,
				storageId,
				'mileage_create',
				100,
				60
			);
			if (!rateLimitResult.allowed) {
				log.warn('Mileage rate limit exceeded', { storageId });
				return new Response(
					JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
					{ status: 429 }
				);
			}
		}

		const raw = (await event.request.json()) as unknown;
		const parse = mileageSchema.safeParse(raw);
		if (!parse.success) {
			return new Response(JSON.stringify({ error: 'Invalid Data' }), { status: 400 });
		}

		const payload = parse.data;
		// Preserve existing behavior where a mileage that is linked to a trip uses the trip's id
		// but allow standalone mileage logs (no trip) by defaulting id to payload.id || payload.tripId || uuid
		const id = payload.id || payload.tripId || crypto.randomUUID();

		// [!code fix] Strictly use ID.
		const userId = sessionUser.id || '';

		// --- ENFORCE MILEAGE LIMIT FOR FREE USERS ---
		let currentPlan: 'free' | 'premium' | 'pro' | 'business' | undefined = undefined;
		const usersKV = safeKV(env, 'BETA_USERS_KV');
		if (usersKV) {
			try {
				const freshUser = await findUserById(usersKV, sessionUser?.id ?? '');
				if (freshUser) currentPlan = freshUser.plan;
			} catch (e) {
				log.warn('Failed to fetch fresh plan', { message: createSafeErrorMessage(e) });
			}
		}

		if (currentPlan === 'free') {
			const windowDays = PLAN_LIMITS.FREE.WINDOW_DAYS || 30;
			const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
			const svc = makeMileageService(
				safeKV(env, 'BETA_MILEAGE_KV')!,
				safeDO(env, 'TRIP_INDEX_DO')!
			);
			let recentMileage = await svc.list(userId, since);
			if (recentMileage.length > MAX_RECENT_MILEAGE)
				recentMileage = recentMileage.slice(-MAX_RECENT_MILEAGE);
			const allowed =
				PLAN_LIMITS.FREE.MAX_MILEAGE_PER_MONTH || PLAN_LIMITS.FREE.MAX_MILEAGE_IN_WINDOW || 10;

			if (recentMileage.length >= allowed) {
				return new Response(
					JSON.stringify({
						error: 'Plan Limit Exceeded',
						message: `The Free plan is limited to ${allowed} mileage logs per ${windowDays} days. Please upgrade to add more.`
					}),
					{ status: 403, headers: { 'Content-Type': 'application/json' } }
				);
			}
		}

		// Validate parent trip exists and is active only when payload.tripId is provided
		const tripKV = safeKV(env, 'BETA_LOGS_KV');
		const tripIdToCheck = payload.tripId || undefined;
		// Only validate if tripKV has a proper get method and a tripId was provided (skip validation in test mocks)
		if (tripKV && hasGet(tripKV) && tripIdToCheck) {
			const tripKey = `trip:${userId}:${tripIdToCheck}`;
			const tripRaw = await tripKV.get(tripKey);

			if (!tripRaw) {
				return new Response(
					JSON.stringify({ error: 'Parent trip not found. Cannot create mileage log.' }),
					{ status: 409, headers: { 'Content-Type': 'application/json' } }
				);
			}

			const trip = JSON.parse(tripRaw);
			if (trip.deleted) {
				return new Response(
					JSON.stringify({
						error: 'Parent trip is deleted. Cannot create mileage log for deleted trip.'
					}),
					{ status: 409, headers: { 'Content-Type': 'application/json' } }
				);
			}
		}

		let miles =
			typeof payload.miles === 'number'
				? payload.miles
				: Math.max(0, Number(payload.endOdometer) - Number(payload.startOdometer));
		miles = Number(miles.toFixed(2));

		let reimbursement = payload.reimbursement ?? undefined;
		if (typeof reimbursement === 'number') reimbursement = Number(reimbursement.toFixed(2));

		// If reimbursement not provided, compute using provided rate or user's default rate from settings
		if (typeof reimbursement !== 'number') {
			let rate: number | undefined =
				typeof payload.mileageRate === 'number' ? Number(payload.mileageRate) : undefined;
			if (rate == null) {
				try {
					const userSettingsKV = safeKV(env, 'BETA_USER_SETTINGS_KV');
					if (userSettingsKV) {
						const raw = await userSettingsKV.get(`settings:${userId}`);
						if (raw) {
							const parsed = JSON.parse(raw as string);
							rate = parsed?.mileageRate;
						}
					}
				} catch {
					/* ignore */
				}
			}
			if (typeof rate === 'number') reimbursement = Number((miles * rate).toFixed(2));
		}
		// Build authoritative mileage record (typed)
		const record: MileageRecord = {
			id,
			userId,
			tripId: payload.tripId || undefined,
			date: typeof payload.date === 'string' ? payload.date : new Date().toISOString(),
			startOdometer: typeof payload.startOdometer === 'number' ? payload.startOdometer : undefined,
			endOdometer: typeof payload.endOdometer === 'number' ? payload.endOdometer : undefined,
			miles: Number(miles),
			mileageRate:
				typeof payload.mileageRate === 'number' ? Number(payload.mileageRate) : undefined,
			vehicle:
				typeof payload.vehicle === 'string' && payload.vehicle !== '' ? payload.vehicle : undefined,
			reimbursement: typeof reimbursement === 'number' ? Number(reimbursement) : undefined,
			notes: (typeof payload.notes === 'string' ? payload.notes : '') || '',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};

		const svc = makeMileageService(safeKV(env, 'BETA_MILEAGE_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);
		const p = svc.put(record).catch((err) => log.warn('mileage.put failed', { err, id }));
		// Use waitUntil when possible to schedule the async persistence
		try {
			if (event.platform?.context?.waitUntil) event.platform.context.waitUntil(p);
		} catch {
			// fallback fire-and-forget
			void p;
		}

		return new Response(JSON.stringify(record), {
			headers: { 'Content-Type': 'application/json' },
			status: 201
		});
	} catch (err) {
		log.error('POST /api/mileage error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};
