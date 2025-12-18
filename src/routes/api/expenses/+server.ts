// src/routes/api/expenses/+server.ts
import type { RequestHandler } from './$types';
import { makeExpenseService } from '$lib/server/expenseService';
import { z } from 'zod';

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

// Helper for Strict Environment
function getEnv(platform: App.Platform | undefined): App.Env {
    const env = platform?.env;
    if (!env || !env.BETA_LOGS_KV || !env.TRIP_INDEX_DO) {
        console.error("CRITICAL: Missing BETA_LOGS_KV or TRIP_INDEX_DO bindings");
        throw new Error('Database bindings missing');
    }
    return env;
}

export const GET: RequestHandler = async (event) => {
    try {
        const user = event.locals.user;
        if (!user) return new Response('Unauthorized', { status: 401 });

        const env = getEnv(event.platform);
        const storageId = user.name || user.token;
        const since = event.url.searchParams.get('since') || undefined;
        
        console.log(`[API] Fetching expenses for ${storageId} (Since: ${since || 'All Time'})`);

        // Inject DO Binding
        const svc = makeExpenseService(env.BETA_LOGS_KV, env.TRIP_INDEX_DO, env.BETA_LOGS_TRASH_KV);
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
        const storageId = user.name || user.token;
        const env = getEnv(event.platform);

        const body = await event.request.json();
        
        const parseResult = expenseSchema.safeParse(body);

        if (!parseResult.success) {
            console.error('[API] Expense validation failed:', parseResult.error);
            return new Response(JSON.stringify({ error: 'Invalid Data' }), { status: 400 });
        }

        // Inject DO Binding
        const svc = makeExpenseService(env.BETA_LOGS_KV, env.TRIP_INDEX_DO, env.BETA_LOGS_TRASH_KV);
        
        const expense = {
            ...parseResult.data,
            id: parseResult.data.id || crypto.randomUUID(),
            userId: storageId,
            createdAt: parseResult.data.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const { store, ...savedExpense } = expense as any;

        await svc.put(savedExpense);
        console.log(`[API] Saved expense: ${savedExpense.id}`);

        return new Response(JSON.stringify(savedExpense), { status: 201 });
    } catch (err) {
        console.error('[API] POST Expense Error:', err);
        return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
    }
};