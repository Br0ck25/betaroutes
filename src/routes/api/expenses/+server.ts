// src/routes/api/expenses/+server.ts
import type { RequestHandler } from './$types';
import { makeExpenseService } from '$lib/server/expenseService';
import { z } from 'zod';

const expenseSchema = z.object({
    id: z.string().uuid().optional(),
    date: z.string(),
    category: z.enum(['maintenance', 'insurance', 'supplies', 'other']),
    amount: z.number(),
    description: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional()
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
        
        const svc = makeExpenseService(getKV(event.platform));
        const expenses = await svc.list(storageId, since);

        return new Response(JSON.stringify(expenses));
    } catch (err) {
        return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
    }
};

export const POST: RequestHandler = async (event) => {
    try {
        const user = event.locals.user;
        if (!user) return new Response('Unauthorized', { status: 401 });
        const storageId = user.name || user.token;

        const body = await event.request.json();
        const result = expenseSchema.safeParse(body);

        if (!result.success) {
            return new Response(JSON.stringify({ error: 'Invalid Data' }), { status: 400 });
        }

        const svc = makeExpenseService(getKV(event.platform));
        const expense = {
            ...result.data,
            id: result.data.id || crypto.randomUUID(),
            userId: storageId,
            createdAt: result.data.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        await svc.put(expense as any);

        return new Response(JSON.stringify(expense), { status: 201 });
    } catch (err) {
        console.error(err);
        return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
    }
};