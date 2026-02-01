export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e ?? 'Unknown error');
  } catch {
    return 'Unknown error';
  }
}

export function asRecord(e: unknown): Record<string, unknown> {
  return e && typeof e === 'object' ? (e as Record<string, unknown>) : {};
}
