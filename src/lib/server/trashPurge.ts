import { safeKV, safeDO } from '$lib/server/env';
import { log } from '$lib/server/log';
import { makeTripService } from './tripService';
import { makeExpenseService } from './expenseService';
import { makeMileageService } from './mileageService';

export interface PurgeOptions {
	batchSize?: number; // keys fetched per kv.list batch
	maxDeletes?: number; // maximum deletes to perform in a single run
	// Allow injecting services for easier testing
	services?: {
		tripSvc?: { permanentDelete: (userId: string, id: string) => Promise<void> };
		expenseSvc?: { permanentDelete: (userId: string, id: string) => Promise<void> };
		mileageSvc?: { permanentDelete: (userId: string, id: string) => Promise<void> };
	};
}

export type PurgeSummary = {
	checked: number;
	deleted: number;
	errors: number;
};

const DEFAULT_BATCH = 50;
const DEFAULT_MAX_DELETES = 500;

function parseKeyName(name: string): { userId: string; id: string } | null {
	// Expecting keys like 'trip:{userId}:{id}' or 'mileage:{userId}:{id}' or 'expense:{userId}:{id}'
	const parts = name.split(':');
	if (parts.length < 3) return null;
	const userId = String(parts[1] ?? '');
	const id = parts.slice(2).join(':') || '';
	if (!userId || !id) return null;
	return { userId, id };
}

export async function purgeExpiredTrash(
	platformEnv: Record<string, unknown> | undefined,
	opts?: PurgeOptions
): Promise<PurgeSummary> {
	const batchSize = opts?.batchSize ?? DEFAULT_BATCH;
	const maxDeletes = opts?.maxDeletes ?? DEFAULT_MAX_DELETES;
	let checked = 0;
	let deleted = 0;
	let errors = 0;

	try {
		// Resolve KVs and DOs safely
		const tripKV = safeKV(platformEnv, 'BETA_LOGS_KV');
		const mileageKV = safeKV(platformEnv, 'BETA_MILEAGE_KV');
		const expenseKV = safeKV(platformEnv, 'BETA_EXPENSES_KV');

		const tripIndexDO = safeDO(platformEnv, 'TRIP_INDEX_DO');
		const placesIndexDO = safeDO(platformEnv, 'PLACES_INDEX_DO');

		// Create services if not injected
		const tripSvc =
			opts?.services?.tripSvc ??
			(tripKV
				? makeTripService(
						tripKV,
						undefined,
						safeKV(platformEnv, 'BETA_PLACES_KV') as KVNamespace | undefined,
						tripIndexDO as DurableObjectNamespace,
						placesIndexDO as DurableObjectNamespace
					)
				: undefined);
		const mileageSvc =
			opts?.services?.mileageSvc ??
			(mileageKV
				? makeMileageService(
						mileageKV,
						tripIndexDO as DurableObjectNamespace,
						safeKV(platformEnv, 'BETA_LOGS_KV') as KVNamespace | undefined
					)
				: undefined);
		const expenseSvc =
			opts?.services?.expenseSvc ??
			(expenseKV
				? makeExpenseService(expenseKV, tripIndexDO as DurableObjectNamespace)
				: undefined);

		// Helper to process a KV namespace
		async function processKV(
			kv: KVNamespace | undefined,
			recordType: 'trip' | 'mileage' | 'expense'
		) {
			if (!kv) return;

			let list = await kv.list({ prefix: `${recordType}:` });
			let keys: Array<{ name: string }> = (list.keys ?? []) as Array<{ name: string }>;
			// Iterate through pages
			while (keys.length > 0) {
				for (let i = 0; i < keys.length; i += batchSize) {
					const batch: Array<{ name: string }> = keys.slice(i, i + batchSize) as Array<{
						name: string;
					}>;
					const raws = await Promise.all(batch.map((k) => kv.get(k.name)));
					for (let j = 0; j < batch.length; j++) {
						if (deleted >= maxDeletes) break;
						const b = batch[j]!; // non-null by loop guard
						const key = b.name;
						checked++;
						const raw = raws[j] as string | null;
						if (!raw) continue;
						let parsed: unknown = null;
						try {
							parsed = JSON.parse(raw);
						} catch {
							continue;
						}
						if (!parsed || typeof parsed !== 'object') continue;
						const asObj = parsed as Record<string, unknown>;
						if (!asObj['deleted']) continue;
						// Prefer metadata.expiresAt then expiresAt then deletedAt + retention fallback
						const expiresAt =
							(asObj['metadata'] && (asObj['metadata'] as Record<string, unknown>)['expiresAt']) ||
							asObj['expiresAt'] ||
							asObj['deletedAt'];
						if (!expiresAt) {
							// If no explicit expiresAt, skip (service should set TTL on put)
							continue;
						}
						const expires = new Date(String(expiresAt));
						if (isNaN(expires.getTime())) continue;
						if (expires.getTime() > Date.now()) continue; // not expired yet

						// parse userId and id from key
						const parsedKey = parseKeyName(key);
						if (!parsedKey) continue;
						const { userId, id } = parsedKey;
						try {
							if (recordType === 'trip' && tripSvc) {
								await tripSvc.permanentDelete(userId, id);
								deleted++;
							} else if (recordType === 'mileage' && mileageSvc) {
								await mileageSvc.permanentDelete(userId, id);
								deleted++;
							} else if (recordType === 'expense' && expenseSvc) {
								await expenseSvc.permanentDelete(userId, id);
								deleted++;
							}
						} catch (e: unknown) {
							errors++;
							log.warn('Failed to permanently delete expired trash item', {
								recordType,
								userId,
								id,
								message: String(e)
							});
						}
					}
				}

				if (!list.list_complete && list.cursor) {
					list = await kv.list({ prefix: `${recordType}:`, cursor: list.cursor });
					keys = list.keys as Array<{ name: string }>;
				} else {
					keys = [];
				}
			}
		}

		// Process each KV namespace in sequence
		await processKV(tripKV, 'trip');
		if (deleted < maxDeletes) await processKV(mileageKV, 'mileage');
		if (deleted < maxDeletes) await processKV(expenseKV, 'expense');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('purgeExpiredTrash failed', { message });
		errors++;
	}

	return { checked, deleted, errors };
}
