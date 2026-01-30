// src/routes/api/expenses/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeExpenseService, type ExpenseRecord } from '$lib/server/expenseService';
import { getEnv, safeKV, safeDO } from '$lib/server/env';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import { log } from '$lib/server/log';

export const DELETE: RequestHandler = async (event) => {
  try {
    const user = event.locals.user as { id?: string } | undefined;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const env = getEnv(event.platform);

    // [!code fix] Strictly use ID. Prevents username spoofing.
    const storageId = user.id || '';

    const expenseId = event.params.id;

    // Use the expenses KV so tombstones are written to the expenses namespace
    const svc = makeExpenseService(safeKV(env, 'BETA_EXPENSES_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);

    // SECURITY: Verify the expense exists and belongs to this user (IDOR prevention)
    const existing = await svc.get(storageId, expenseId);
    if (!existing) {
      return new Response(JSON.stringify({ error: 'Expense not found' }), { status: 404 });
    }

    await svc.delete(storageId, expenseId);

    return new Response(JSON.stringify({ success: true }));
  } catch (err: unknown) {
    log.error('DELETE Expense Error', { message: createSafeErrorMessage(err) });
    return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
  }
};

export const PUT: RequestHandler = async (event) => {
  try {
    const user = event.locals.user as { id?: string } | undefined;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const env = getEnv(event.platform);

    // [!code fix] Strictly use ID. Prevents username spoofing.
    const storageId = user.id || '';

    const expenseId = event.params.id;

    const svc = makeExpenseService(safeKV(env, 'BETA_EXPENSES_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);

    // SECURITY: Verify the expense exists and belongs to this user (IDOR prevention)
    const existing = await svc.get(storageId, expenseId);
    if (!existing) {
      return new Response(JSON.stringify({ error: 'Expense not found' }), { status: 404 });
    }

    const rawBody = (await event.request.json()) as unknown;
    const body =
      typeof rawBody === 'object' && rawBody !== null ? (rawBody as Record<string, unknown>) : {};

    // Merge updates explicitly (prevent mass-assignment)
    const expense: ExpenseRecord = {
      id: expenseId,
      userId: storageId,
      date: existing.date,
      category: existing.category,
      amount: existing.amount,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      // optional fields accessed via index signature
      ...(existing['taxDeductible'] !== undefined
        ? { taxDeductible: existing['taxDeductible'] as boolean }
        : {}),
      ...(existing['store'] !== undefined ? { store: existing['store'] as string } : {})
    };

    if (typeof existing['description'] === 'string')
      (expense as Record<string, unknown>)['description'] = existing['description'] as string;

    if (typeof body['date'] === 'string') expense.date = body['date'] as string;
    if (typeof body['category'] === 'string') expense.category = body['category'] as string;
    if (body['amount'] !== undefined) {
      const num = Number(body['amount']);
      if (!Number.isNaN(num)) expense.amount = num;
    }
    if (typeof body['description'] === 'string')
      expense.description = body['description'] as string;
    if (typeof body['taxDeductible'] === 'boolean')
      (expense as Record<string, unknown>)['taxDeductible'] = body['taxDeductible'] as boolean;
    if (typeof body['store'] === 'string')
      (expense as Record<string, unknown>)['store'] = body['store'] as string;

    await svc.put(expense);

    return new Response(JSON.stringify(expense));
  } catch (err: unknown) {
    log.error('PUT Expense Error', { message: createSafeErrorMessage(err) });
    return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
  }
};
