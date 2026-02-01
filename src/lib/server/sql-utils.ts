// src/lib/server/sql-utils.ts

// Small helpers to safely extract data from Durable Object SQL exec results
// and to iterate cursor-like objects returned by `state.storage.sql.exec()`.

export function extractCount(res: unknown): number {
  if (!res || typeof res !== 'object') return 0;
  const maybe = res as { one?: () => Record<string, unknown> | undefined };
  if (typeof maybe.one !== 'function') return 0;
  const row = maybe.one();
  if (!row) return 0;

  // Common names: total, c, COUNT(*), etc. Fall back to first value.
  const firstVal = (row['total'] ?? row['c'] ?? Object.values(row)[0]) as unknown;
  const n = Number(firstVal as unknown);
  return Number.isFinite(n) ? n : 0;
}

export function cursorToArray(cursor: unknown): Record<string, unknown>[] {
  const arr: Record<string, unknown>[] = [];
  if (!cursor) return arr;
  // Cursor returned by Cloudflare SQL exec is iterable
  const it = cursor as Iterable<Record<string, unknown>>;
  try {
    for (const row of it) {
      arr.push(row);
    }
  } catch {
    // Non-iterable or unexpected shape - return empty
  }
  return arr;
}
