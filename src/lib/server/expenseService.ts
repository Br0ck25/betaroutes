// src/lib/server/expenseService.ts
import type { KVNamespace } from '@cloudflare/workers-types';

export interface ExpenseRecord {
  id: string;
  userId: string;
  date: string;
  category: string;
  amount: number;
  description?: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
  [key: string]: any;
}

// Update factory to accept the Trash KV
export function makeExpenseService(kv: KVNamespace, trashKV?: KVNamespace) {
  
  function getKey(userId: string, id: string) {
    return `expense:${userId}:${id}`;
  }

  return {
    async list(userId: string, since?: string): Promise<ExpenseRecord[]> {
      const prefix = `expense:${userId}:`;
      const list = await kv.list({ prefix });
      const expenses: ExpenseRecord[] = [];

      for (const key of list.keys) {
        const raw = await kv.get(key.name);
        if (raw) {
          const item = JSON.parse(raw);
          // Filter out soft-deleted items unless syncing
          if (!item.deleted || since) {
            expenses.push(item);
          }
        }
      }

      // Delta Sync Logic
      if (since) {
        const sinceDate = new Date(since);
        return expenses.filter(e => new Date(e.updatedAt || e.createdAt) > sinceDate);
      }

      return expenses;
    },

    async get(userId: string, id: string) {
      const raw = await kv.get(getKey(userId, id));
      return raw ? JSON.parse(raw) as ExpenseRecord : null;
    },

    async put(expense: ExpenseRecord) {
      expense.updatedAt = new Date().toISOString();
      delete expense.deleted; // Ensure it's active
      delete expense.deletedAt;
      await kv.put(getKey(expense.userId, expense.id), JSON.stringify(expense));
    },

    async delete(userId: string, id: string) {
      const key = getKey(userId, id);
      const raw = await kv.get(key);
      
      if (raw) {
        const expense = JSON.parse(raw);
        const now = new Date();

        // 1. Move to Trash KV if available
        if (trashKV) {
             const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days expiry
             const metadata = {
                deletedAt: now.toISOString(),
                deletedBy: userId,
                originalKey: key,
                expiresAt: expiresAt.toISOString()
             };
             
             // Wrap in standard trash structure
             const trashItem = {
                type: 'expense',
                data: expense,
                metadata
             };
             
             const trashKey = `trash:${userId}:${id}`;
             await trashKV.put(
                trashKey, 
                JSON.stringify(trashItem),
                { expirationTtl: 30 * 24 * 60 * 60 }
             );
        }

        // 2. Soft delete tombstone in Main KV
        const tombstone = {
          ...expense,
          deleted: true,
          deletedAt: now.toISOString(),
          updatedAt: now.toISOString()
        };
        await kv.put(key, JSON.stringify(tombstone));
      }
    }
  };
}