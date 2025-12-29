import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';

export function getEnv(platform: unknown): Record<string, unknown> {
	// Return platform.env if present
	const p = platform as { env?: Record<string, unknown> } | undefined;
	return p?.env ?? {};
}

export function safeKV(
	env: Record<string, unknown> | undefined,
	name: string
): KVNamespace | undefined {
	if (!env) return undefined;
	const kv = (env as Record<string, unknown>)[name];
	return (kv as KVNamespace) ?? undefined;
}

export function safeDO(
	env: Record<string, unknown> | undefined,
	name: string
): DurableObjectNamespace | undefined {
	if (!env) return undefined;
	const v = (env as Record<string, unknown>)[name];
	return (v as DurableObjectNamespace) ?? undefined;
}

/**
 * Cast a potentially-unknown binding to a Cloudflare KVNamespace (conservative helper)
 */
export function asKV<T extends string = string>(value: unknown): KVNamespace<T> | undefined {
	return (value as KVNamespace<T>) ?? undefined;
}

/**
 * Cast a potentially-unknown binding to a Cloudflare DurableObjectNamespace
 */
export function asDO(value: unknown): DurableObjectNamespace | undefined {
	return (value as DurableObjectNamespace) ?? undefined;
}
