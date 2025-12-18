// src/routes/api/expenses/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeExpenseService } from '$lib/server/expenseService';

function getKV(platform: any) {
    return platform?.env?.BETA_LOGS_KV;
}

export const DELETE: RequestHandler = async (event) => {
    const user = event.locals.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const svc = makeExpenseService(getKV(event.platform));
    await svc.delete(user.name || user.token, event.params.id);

    return new Response(JSON.stringify({ success: true }));
};

export const PUT: RequestHandler = async (event) => {
     const user = event.locals.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const body = await event.request.json();
    const svc = makeExpenseService(getKV(event.platform));
    
    // Ensure ID matches URL
    const expense = { ...body, id: event.params.id, userId: user.name || user.token };
    await svc.put(expense);

    return new Response(JSON.stringify(expense));
};