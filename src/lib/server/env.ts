import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';

export function getEnv(platform: any): any {
	// Return platform.env if present (keep as any to avoid leaking types here)
	if (!platform || !platform.env) return {};
	return platform.env as any;
}

export function safeKV(env: any, name: string): KVNamespace | undefined {
	if (!env) return undefined;
	const kv = (env as any)[name];
	return kv ? (kv as KVNamespace) : undefined;
}

export function safeDO(env: any, name: string): DurableObjectNamespace | undefined {
	if (!env) return undefined;
	const v = (env as any)[name];
	return v ? (v as DurableObjectNamespace) : undefined;
}

/**
 * Cast a potentially-unknown binding to a Cloudflare KVNamespace (conservative helper)
 */
export function asKV<T extends string = string>(value: unknown): KVNamespace<T> | undefined {
	return (value as any) as KVNamespace<T> | undefined;
}

/**
 * Cast a potentially-unknown binding to a Cloudflare DurableObjectNamespace
 */
export function asDO(value: unknown): DurableObjectNamespace | undefined {
	return (value as any) as DurableObjectNamespace | undefined;
}
