// src/routes/api/expenses/+server.ts
import type { RequestHandler } from './$types';
import { makeExpenseService } from '$lib/server/expenseService';
import { z } from 'zod';

const expenseSchema = z.object({
    id: z.string().uuid().optional(),
    date: z.string(),
    // [!code change] Changed to string to allow custom categories and prevent validation errors
    category: z.string(),
    amount: z.number(),
    description: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    // [!code ++] Allow 'store' property passed by SyncManager so validation doesn't fail
    store: z.string().optional()
});

function getKV(platform: any) {
    const kv = platform?.env?.BETA_LOGS_KV;
    if (!kv) throw new Error('KV binding missing');
    return kv;
}

export const GET: RequestHandler = async (event) => {
    try {
        const user = event.locals.user;
        if (!user) return new Response('Unauthorized', { status: 401 });

        const storageId = user.name || user.token;
        const since = event.url.searchParams.get('since') || undefined;
        
        console.log(`[API] Fetching expenses for ${storageId} (Since: ${since || 'All Time'})`);

        const svc = makeExpenseService(getKV(event.platform));
        const expenses = await svc.list(storageId, since);

        return new Response(JSON.stringify(expenses), {
            headers: {
                'Content-Type': 'application/json',
                // [!code ++] Critical: Prevent browser caching so other devices see updates immediately
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

        const body = await event.request.json();
        
        const parseResult = expenseSchema.safeParse(body);

        if (!parseResult.success) {
            console.error('[API] Expense validation failed:', parseResult.error);
            return new Response(JSON.stringify({ error: 'Invalid Data' }), { status: 400 });
        }

        const svc = makeExpenseService(getKV(event.platform));
        const expense = {
            ...parseResult.data,
            id: parseResult.data.id || crypto.randomUUID(),
            userId: storageId,
            createdAt: parseResult.data.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // [!code ++] Remove 'store' property before saving to DB
        const { store, ...savedExpense } = expense as any;

        await svc.put(savedExpense);
        console.log(`[API] Saved expense: ${savedExpense.id}`);

        return new Response(JSON.stringify(savedExpense), { status: 201 });
    } catch (err) {
        console.error('[API] POST Expense Error:', err);
        return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
    }
};