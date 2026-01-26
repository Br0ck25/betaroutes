// src/routes/api/expenses/+server.ts
import type { RequestHandler } from './$types';
import { makeExpenseService, type ExpenseRecord } from '$lib/server/expenseService';
import { z } from 'zod';
import { getEnv, safeKV, safeDO } from '$lib/server/env';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import { PLAN_LIMITS } from '$lib/constants';
import { getStorageId } from '$lib/server/user';
import { checkRateLimitEnhanced } from '$lib/server/rateLimit';

const expenseSchema = z.object({
	id: z.string().uuid().optional(),
	date: z.string(),
	category: z.string(),
	amount: z.number(),
	description: z.string().optional(),
	taxDeductible: z.boolean().optional(),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
	store: z.string().optional()
});

// Use normalized environment accessor
// (getEnv returns a permissive 'any' and safeKV/safeDO return bindings safely)

type SessionUser = { id?: string; plan?: string };

export const GET: RequestHandler = async (event) => {
	try {
		const user = event.locals.user as SessionUser | undefined;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const env = getEnv(event.platform);
		const storageId = getStorageId(user);
		if (!storageId) return new Response('Unauthorized', { status: 401 });
		let since = event.url.searchParams.get('since') || undefined;

		// Add buffer and clamp future times (5 minutes) to compensate for client clock skew
		if (since) {
			try {
				const bufMs = 5 * 60 * 1000;
				const s = new Date(since);
				s.setTime(s.getTime() - bufMs);
				const now = Date.now();
				if (s.getTime() > now) {
					log.info('[GET /api/expenses] since param in future; clamping to now - buffer', {
						storageId,
						original: since,
						clamped: new Date(now - bufMs).toISOString()
					});
					s.setTime(now - bufMs);
				}
				since = s.toISOString();
			} catch {
				// leave since as-is on parse error
			}
		}

		log.info('Fetching expenses', { storageId, since: since || 'All Time' });

		// Inject DO Binding (use safe accessors)
		const svc = makeExpenseService(safeKV(env, 'BETA_EXPENSES_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);
		const expenses = await svc.list(storageId, since);

		return new Response(JSON.stringify(expenses), {
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
				Pragma: 'no-cache',
				Expires: '0'
			}
		});
	} catch (err: unknown) {
		log.error('Error fetching expenses', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		const user = event.locals.user as SessionUser | undefined;
		if (!user) return new Response('Unauthorized', { status: 401 });
		const storageId = getStorageId(user);
		if (!storageId) return new Response('Unauthorized', { status: 401 });
		const env = getEnv(event.platform);

		// [!code fix] SECURITY (Issue #8): Rate limiting for expense creation
		const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');
		if (sessionsKV) {
			const rateLimitResult = await checkRateLimitEnhanced(
				sessionsKV,
				storageId,
				'expense_create',
				100,
				60
			);
			if (!rateLimitResult.allowed) {
				log.warn('Expense rate limit exceeded', { storageId });
				return new Response(
					JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
					{ status: 429 }
				);
			}
		}

		const body = (await event.request.json()) as unknown;

		const parseResult = expenseSchema.safeParse(body);

		if (!parseResult.success) {
			log.warn('Expense validation failed', { error: parseResult.error });
			return new Response(JSON.stringify({ error: 'Invalid Data' }), { status: 400 });
		}

		// Inject DO Binding
		const svc = makeExpenseService(safeKV(env, 'BETA_EXPENSES_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);

		// Build explicit expense object (NO mass-assignment)
		const data = parseResult.data;
		const expense: ExpenseRecord & Record<string, unknown> = {
			id: data.id || crypto.randomUUID(),
			userId: storageId,
			date: data.date,
			category: data.category,
			amount: Number(data.amount),
			description: typeof data.description === 'string' ? data.description : undefined,
			createdAt: data.createdAt || new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};

		// Optional: include taxDeductible if provided (allowed field)
		if (typeof data.taxDeductible === 'boolean')
			(expense as Record<string, unknown>)['taxDeductible'] = data.taxDeductible;

		// --- FREE TIER EXPENSE QUOTA (atomic via Durable Object to prevent race conditions) ---
		let currentPlan: string = String(user.plan || '');
		try {
			// Attempt to fetch fresh user plan if available
			const { findUserById } = await import('$lib/server/userService');
			const usersKV = safeKV(env, 'BETA_USERS_KV');
			if (usersKV) {
				try {
					const fresh = await findUserById(usersKV, user.id || '');
					if (fresh && fresh.plan) currentPlan = fresh.plan;
				} catch (err: unknown) {
					log.warn('Failed to fetch fresh user plan', { message: createSafeErrorMessage(err) });
				}
			}
		} catch (err: unknown) {
			// If import fails or other unexpected issues occur, continue with session plan
			log.warn('Plan check failed', { message: createSafeErrorMessage(err) });
		}

		if (currentPlan === 'free') {
			const allowed =
				PLAN_LIMITS.FREE.MAX_EXPENSES_PER_MONTH || PLAN_LIMITS.FREE.MAX_EXPENSES_IN_WINDOW || 20;

			// Use atomic check-and-increment in Durable Object to prevent race conditions
			const quotaResult = await svc.checkMonthlyQuota(storageId, allowed);

			if (!quotaResult.allowed) {
				return new Response(
					JSON.stringify({
						error: 'Limit Reached',
						message: `You have reached your free limit of ${allowed} expenses this month (Used: ${quotaResult.count}).`
					}),
					{ status: 403, headers: { 'Content-Type': 'application/json' } }
				);
			}
			// Note: Counter was already incremented atomically by checkMonthlyQuota
		}

		// Persist the canonical expense record (explicit fields only)
		await svc.put(expense as ExpenseRecord);
		log.info('Saved expense', { id: expense.id });

		return new Response(JSON.stringify(expense), {
			headers: { 'Content-Type': 'application/json' },
			status: 201
		});
	} catch (err: unknown) {
		log.error('POST Expense Error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
	}
};
