// src/routes/api/expenses/+server.ts
import type { RequestHandler } from './$types';
import { makeExpenseService } from '$lib/server/expenseService';
import { z } from 'zod';
import { getEnv, safeKV, safeDO } from '$lib/server/env';
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


export const GET: RequestHandler = async (event) => {
    try {
        const user = event.locals.user;
        if (!user) return new Response('Unauthorized', { status: 401 });

        const env = getEnv(event.platform);
        const storageId = (user as any).name || (user as any).token;
        const since = event.url.searchParams.get('since') || undefined;
        
        console.log(`[API] Fetching expenses for ${storageId} (Since: ${since || 'All Time'})`);

        // Inject DO Binding (use safe accessors)
        const svc = makeExpenseService(safeKV(env, 'BETA_LOGS_KV')!, safeDO(env, 'TRIP_INDEX_DO')!, safeKV(env, 'BETA_LOGS_TRASH_KV'));
        const expenses = await svc.list(storageId, since);

        return new Response(JSON.stringify(expenses), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            }
        });
    } catch (err) {
        console.error('[API] Error fetching expenses:', err);
        return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
    }
};

export const POST: RequestHandler = async (event) => {
    try {
        const user = event.locals.user;
        if (!user) return new Response('Unauthorized', { status: 401 });
        const storageId = (user as any).name || (user as any).token;
        const env = getEnv(event.platform);

        const body: any = await event.request.json();
        
        const parseResult = expenseSchema.safeParse(body);

        if (!parseResult.success) {
            console.error('[API] Expense validation failed:', parseResult.error);
            return new Response(JSON.stringify({ error: 'Invalid Data' }), { status: 400 });
        }

        // Inject DO Binding
        const svc = makeExpenseService(safeKV(env, 'BETA_LOGS_KV')!, safeDO(env, 'TRIP_INDEX_DO')!, safeKV(env, 'BETA_LOGS_TRASH_KV'));
        
        const expense = {
            ...parseResult.data,
            id: parseResult.data.id || crypto.randomUUID(),
            userId: storageId,
            createdAt: parseResult.data.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // --- FREE TIER EXPENSE QUOTA (rolling window) ---
        let currentPlan: any = user.plan;
        try {
            // Attempt to fetch fresh user plan if available
            const { findUserById } = await import('$lib/server/userService');
            const usersKV = safeKV(env, 'BETA_USERS_KV');
            if (usersKV) {
                const fresh = await findUserById(usersKV, (user as any).id || (user as any).token);
                if (fresh && fresh.plan) currentPlan = fresh.plan;
            }
        } catch (e) {
            // ignore and proceed with session plan
        }

        if (currentPlan === 'free') {
            const windowDays = PLAN_LIMITS.FREE.WINDOW_DAYS || 30;
            const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
            const recentExpenses = await svc.list(storageId, since);
            const allowed = PLAN_LIMITS.FREE.MAX_EXPENSES_PER_MONTH || PLAN_LIMITS.FREE.MAX_EXPENSES_IN_WINDOW || 20;
            if (recentExpenses.length >= allowed) {
                return new Response(JSON.stringify({ error: 'Limit Reached', message: `You have reached your free limit of ${allowed} expenses in the last ${windowDays} days (Used: ${recentExpenses.length}).` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
        }

        const { store, ...savedExpense } = expense as any;

        await svc.put(savedExpense);
        console.log(`[API] Saved expense: ${savedExpense.id}`);

        return new Response(JSON.stringify(savedExpense), { status: 201 });
    } catch (err) {
        console.error('[API] POST Expense Error:', err);
        return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
    }
};