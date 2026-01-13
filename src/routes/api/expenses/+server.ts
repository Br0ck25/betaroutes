// src/routes/api/expenses/+server.ts
import type { RequestHandler } from './$types';
import { makeExpenseService, type ExpenseRecord } from '$lib/server/expenseService';
import { z } from 'zod';
import { getEnv, safeKV, safeDO } from '$lib/server/env';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import { PLAN_LIMITS } from '$lib/constants';

const expenseSchema = z.object({
	id: z.string().uuid().optional(),
	date: z.string(),
	category: z.string(),
	amount: z.number(),
	description: z.string().optional(),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
	store: z.string().optional()
});

// Use normalized environment accessor
// (getEnv returns a permissive 'any' and safeKV/safeDO return bindings safely)

type SessionUser = { id?: string; name?: string; token?: string; plan?: string };

export const GET: RequestHandler = async (event) => {
	try {
		const user = event.locals.user as SessionUser | undefined;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const env = getEnv(event.platform);
		const storageId = user.name || user.token || user.id || '';
		const since = event.url.searchParams.get('since') || undefined;

		log.info('Fetching expenses', { storageId, since: since || 'All Time' });

		// Inject DO Binding (use safe accessors)
		const svc = makeExpenseService(
			safeKV(env, 'BETA_EXPENSES_KV')!,
			safeDO(env, 'TRIP_INDEX_DO')!,
			safeKV(env, 'BETA_EXPENSES_TRASH_KV')
		);
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
		const storageId = user.name || user.token || user.id || '';
		const env = getEnv(event.platform);

		const body = (await event.request.json()) as unknown;

		const parseResult = expenseSchema.safeParse(body);

		if (!parseResult.success) {
			log.warn('Expense validation failed', { error: parseResult.error });
			return new Response(JSON.stringify({ error: 'Invalid Data' }), { status: 400 });
		}

		// Inject DO Binding
		const svc = makeExpenseService(
			safeKV(env, 'BETA_EXPENSES_KV')!,
			safeDO(env, 'TRIP_INDEX_DO')!,
			safeKV(env, 'BETA_EXPENSES_TRASH_KV')
		);

		const expense = {
			...parseResult.data,
			id: parseResult.data.id || crypto.randomUUID(),
			userId: storageId,
			createdAt: parseResult.data.createdAt || new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};

		// --- FREE TIER EXPENSE QUOTA (rolling window) ---
		let currentPlan: string = String(user.plan || '');
		try {
			// Attempt to fetch fresh user plan if available
			const { findUserById } = await import('$lib/server/userService');
			const usersKV = safeKV(env, 'BETA_USERS_KV');
			if (usersKV) {
				try {
					const fresh = await findUserById(usersKV, user.id || user.token || '');
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
			const windowDays = PLAN_LIMITS.FREE.WINDOW_DAYS || 30;
			const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
			const recentExpenses = await svc.list(storageId, since);
			const allowed =
				PLAN_LIMITS.FREE.MAX_EXPENSES_PER_MONTH || PLAN_LIMITS.FREE.MAX_EXPENSES_IN_WINDOW || 20;
			if (recentExpenses.length >= allowed) {
				return new Response(
					JSON.stringify({
						error: 'Limit Reached',
						message: `You have reached your free limit of ${allowed} expenses in the last ${windowDays} days (Used: ${recentExpenses.length}).`
					}),
					{ status: 403, headers: { 'Content-Type': 'application/json' } }
				);
			}
		}

		const savedExpense = { ...expense } as Record<string, unknown>;
		// Remove any UI-only fields (like `store`) before persisting
		delete (savedExpense as Record<string, unknown>)['store'];

		await svc.put(savedExpense as ExpenseRecord);
		log.info('Saved expense', { id: (savedExpense as ExpenseRecord).id });

		return new Response(JSON.stringify(savedExpense), { status: 201 });
	} catch (err: unknown) {
		log.error('POST Expense Error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
	}
};
