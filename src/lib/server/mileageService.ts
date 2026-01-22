// src/lib/server/mileageService.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { DO_ORIGIN, RETENTION } from '$lib/constants';
import { log } from '$lib/server/log';
import { calculateFuelCost } from '$lib/utils/calculations';

export interface MileageRecord {
	id: string;
	userId: string;
	/** Optional link to parent trip */
	tripId?: string;
	date?: string;
	startOdometer?: number;
	endOdometer?: number;
	miles: number;
	reimbursement?: number;
	notes?: string;
	createdAt: string;
	updatedAt: string;
	deleted?: boolean;
	[key: string]: unknown;
}

export function makeMileageService(
	kv: KVNamespace,
	tripIndexDO: DurableObjectNamespace,
	tripKV?: KVNamespace
) {
	const getIndexStub = (userId: string) => {
		const id = tripIndexDO.idFromName(userId);
		return tripIndexDO.get(id);
	};

	// Helper to fetch all mileage from KV for a given prefix
	async function fetchFromKV(prefix: string): Promise<MileageRecord[]> {
		const all: MileageRecord[] = [];
		let list = await kv.list({ prefix });
		let keys = list.keys;

		while (!list.list_complete && list.cursor) {
			list = await kv.list({ prefix, cursor: list.cursor });
			keys = keys.concat(list.keys);
		}

		for (const key of keys) {
			const raw = await kv.get(key.name);
			if (!raw) continue;
			try {
				const parsed = JSON.parse(raw);
				if (parsed) all.push(parsed);
			} catch {
				// Skip corrupt entries
			}
		}
		return all;
	}

	return {
		/**
		 * List mileage records for a user.
		 * @param userId - Primary storage ID (UUID)
		 * @param since - Optional ISO date for delta sync
		 */
		async list(userId: string, since?: string): Promise<MileageRecord[]> {
			const stub = getIndexStub(userId);
			const prefix = `mileage:${userId}:`;

			// 1. Try to fetch from Durable Object index first
			let mileage: MileageRecord[] = [];
			try {
				const res = await stub.fetch(`${DO_ORIGIN}/mileage/list`);
				if (res.ok) {
					mileage = (await res.json()) as MileageRecord[];
				} else {
					log.error(`[MileageService] DO Error: ${res.status}`);
				}
			} catch (err) {
				log.warn('[MileageService] DO fetch failed, falling back to KV', err);
			}

			// SELF-HEALING: If Index is empty but KV has data, force sync/migrate
			if (mileage.length === 0) {
				const kvCheck = await kv.list({ prefix, limit: 1 });

				if (kvCheck.keys.length > 0) {
					log.info(
						`[MileageService] Detected desync for ${userId} (KV has data, Index empty). repairing...`
					);

					const all = await fetchFromKV(prefix);
					const migratedCount = all.length;

					// Force Push to DO
					if (all.length > 0) {
						await stub.fetch(`${DO_ORIGIN}/mileage/migrate`, {
							method: 'POST',
							body: JSON.stringify(all)
						});

						mileage = all;
						log.info(`[MileageService] Migrated ${migratedCount} items (0 tombstones included)`);
					}
				}
			}

			// Delta Sync: Return everything (including deletions)
			if (since) {
				const sinceDate = new Date(since);
				const filtered = mileage.filter((m) => new Date(m.updatedAt || m.createdAt) > sinceDate);
				log.info(
					`[MileageService] list() delta sync returning ${filtered.length} of ${mileage.length} items`
				);
				return filtered;
			}

			// [!code fix] Full List: Filter out deleted items (Tombstones)
			// This prevents deleted items from appearing on page load/refresh
			const deletedCount = mileage.filter((m) => m.deleted).length;
			const activeItems = mileage
				.filter((m) => !m.deleted)
				.sort((a, b) =>
					(b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
				);
			log.info(
				`[MileageService] list() returning ${activeItems.length} active items (${deletedCount} deleted filtered out)`
			);
			return activeItems;
		},

		async get(userId: string, id: string) {
			const all = await this.list(userId);
			return all.find((m) => m.id === id) || null;
		},

		async put(item: MileageRecord) {
			item.updatedAt = new Date().toISOString();
			delete item.deleted;

			// Write to KV
			await kv.put(`mileage:${item.userId}:${item.id}`, JSON.stringify(item));

			// Write to DO
			const stub = getIndexStub(item.userId);
			await stub.fetch(`${DO_ORIGIN}/mileage/put`, {
				method: 'POST',
				body: JSON.stringify(item)
			});
		},

		async delete(userId: string, id: string) {
			log.info(`[MileageService] delete() called`, { userId, id });
			const stub = getIndexStub(userId);

			// Try to find the item under the current userId key
			const key = `mileage:${userId}:${id}`;
			log.info(`[MileageService] Checking key: ${key}`);
			const raw = await kv.get(key);

			if (!raw) {
				log.warn(`[MileageService] delete() - Item not found in KV`, { key });
				return;
			}
			log.info(`[MileageService] Found item to delete, creating tombstone`);

			const item = JSON.parse(raw) as MileageRecord;
			const now = new Date();
			const expiresAt = new Date(now.getTime() + RETENTION.THIRTY_DAYS * 1000);

			const metadata = {
				deletedAt: now.toISOString(),
				deletedBy: userId,
				originalKey: key,
				expiresAt: expiresAt.toISOString()
			};

			const tombstone = {
				id: item.id,
				userId,
				deleted: true,
				deletedAt: now.toISOString(),
				metadata,
				backup: item,
				updatedAt: now.toISOString(),
				createdAt: item.createdAt
			};

			// 1. Write tombstone to KV
			await kv.put(key, JSON.stringify(tombstone), {
				expirationTtl: RETENTION.THIRTY_DAYS
			});
			log.info(`[MileageService] Wrote tombstone to: ${key}`);

			// 2. Update DO with tombstone (PUT)
			await stub.fetch(`${DO_ORIGIN}/mileage/put`, {
				method: 'POST',
				body: JSON.stringify(tombstone)
			});

			// If the deleted mileage was linked to a trip, set that trip's totalMiles and fuelCost to 0
			if (tripKV) {
				try {
					const tripIdToUpdate = typeof item.tripId === 'string' ? item.tripId : undefined;
					if (tripIdToUpdate) {
						const tripKey = `trip:${userId}:${tripIdToUpdate}`;
						const tripRaw = await tripKV.get(tripKey);
						if (tripRaw) {
							const trip = JSON.parse(tripRaw);
							if (!trip.deleted) {
								trip.totalMiles = 0;
								trip.fuelCost = 0;
								trip.updatedAt = now.toISOString();
								await tripKV.put(tripKey, JSON.stringify(trip));
								log.info(
									`[MileageService] Set trip ${tripIdToUpdate} totalMiles and fuelCost to 0 after mileage deletion`
								);
							}
						}
					}
				} catch (err) {
					log.warn(`[MileageService] Failed to zero trip totalMiles after mileage delete`, {
						id,
						error: err
					});
				}
			}
		},

		async listTrash(userId: string) {
			log.info(`[MileageService] listTrash() called`, { userId });
			const out: Record<string, unknown>[] = [];
			const prefix = `mileage:${userId}:`;

			log.info(`[MileageService] listTrash scanning prefix: ${prefix}`);
			let list = await kv.list({ prefix });
			let keys = list.keys;
			while (!list.list_complete && list.cursor) {
				list = await kv.list({ prefix, cursor: list.cursor });
				keys = keys.concat(list.keys);
			}
			log.info(`[MileageService] listTrash found ${keys.length} keys under ${prefix}`);

			let tombstoneCount = 0;
			for (const k of keys) {
				const raw = await kv.get(k.name);
				if (!raw) continue;
				const parsed = JSON.parse(raw) as Record<string, unknown> | undefined;
				if (!parsed || !(parsed['deleted'] as boolean)) continue;
				tombstoneCount++;

				const id = (parsed['id'] as string) || String(k.name.split(':').pop() || '');
				const uid = (parsed['userId'] as string) || String(k.name.split(':')[1] || '');
				const parsedMetadata = parsed['metadata'] as Record<string, unknown> | undefined;
				const metadata = parsedMetadata || {
					deletedAt: (parsed['deletedAt'] as string) || '',
					deletedBy: uid,
					originalKey: k.name,
					expiresAt: (parsedMetadata && (parsedMetadata['expiresAt'] as string)) || ''
				};

				const backup =
					(parsed['backup'] as Record<string, unknown> | undefined) ||
					(parsed['data'] as Record<string, unknown> | undefined) ||
					(parsed as Record<string, unknown>);

				out.push({
					id,
					userId: uid,
					metadata: metadata as Record<string, unknown>,
					recordType: 'mileage',
					miles:
						typeof (backup['miles'] as number) === 'number'
							? (backup['miles'] as number)
							: undefined,
					vehicle: backup['vehicle'],
					date: backup['date']
				});
			}
			log.info(`[MileageService] listTrash found ${tombstoneCount} tombstones under ${prefix}`);

			log.info(`[MileageService] listTrash returning ${out.length} tombstones`);
			out.sort((a, b) =>
				String((b['metadata'] as Record<string, unknown>)['deletedAt'] ?? '').localeCompare(
					String((a['metadata'] as Record<string, unknown>)['deletedAt'] ?? '')
				)
			);
			return out;
		},
		async permanentDelete(userId: string, itemId: string) {
			const key = `mileage:${userId}:${itemId}`;
			await kv.delete(key);

			const stub = getIndexStub(userId);
			await stub.fetch(`${DO_ORIGIN}/mileage/delete`, {
				method: 'POST',
				body: JSON.stringify({ id: itemId })
			});
		},

		async restore(userId: string, itemId: string) {
			const key = `mileage:${userId}:${itemId}`;
			const raw = await kv.get(key);
			if (!raw) throw new Error('Item not found');

			const tombstone = JSON.parse(raw) as Record<string, unknown>;
			if (!tombstone['deleted']) throw new Error('Item not deleted');

			// Validation: Only validate parent trip if the tombstone being restored has a linked tripId
			if (tripKV) {
				const backup =
					(tombstone['backup'] as Record<string, unknown> | undefined) ||
					(tombstone['data'] as Record<string, unknown> | undefined) ||
					tombstone;
				const linkedTripId =
					typeof backup['tripId'] === 'string' ? (backup['tripId'] as string) : undefined;
				if (linkedTripId) {
					const tripKey = `trip:${userId}:${linkedTripId}`;
					const tripRaw = await tripKV.get(tripKey);

					if (!tripRaw) {
						throw new Error('Parent trip not found. Cannot restore mileage log.');
					}

					const trip = JSON.parse(tripRaw);
					if (trip.deleted) {
						throw new Error(
							'Parent trip is deleted. Please restore the trip first before restoring the mileage log.'
						);
					}
				}
			}

			// FIX: Get the full backup data and preserve ALL fields
			const backup =
				(tombstone['backup'] as Record<string, unknown> | undefined) ||
				(tombstone['data'] as Record<string, unknown> | undefined) ||
				tombstone;

			// Create restored record with all original fields preserved
			const restored = {
				...backup,
				updatedAt: new Date().toISOString()
			} as MileageRecord & Record<string, unknown>;

			// Clean up unwanted fields
			delete restored['deleted'];
			delete restored['deletedAt'];
			delete restored['metadata'];
			delete restored['backup'];
			delete restored['data'];

			await this.put(restored);

			// Update the parent trip's totalMiles and fuelCost to reflect the restored mileage (only if linked to a tripId)
			const restoredTripId = typeof restored.tripId === 'string' ? restored.tripId : undefined;
			if (tripKV && restoredTripId && typeof restored.miles === 'number') {
				try {
					const tripKey = `trip:${userId}:${restoredTripId}`;
					const tripRaw = await tripKV.get(tripKey);
					if (tripRaw) {
						const trip = JSON.parse(tripRaw);
						if (!trip.deleted) {
							trip.totalMiles = restored.miles;
							// Recalculate fuel cost based on restored miles using shared utility
							const mpg = Number(trip.mpg) || 0;
							const gasPrice = Number(trip.gasPrice) || 0;
							trip.fuelCost = calculateFuelCost(restored.miles, mpg, gasPrice);
							trip.updatedAt = new Date().toISOString();
							await tripKV.put(tripKey, JSON.stringify(trip));
							log.info(
								`[MileageService] Updated trip ${restoredTripId} totalMiles to ${restored.miles} and fuelCost to ${trip.fuelCost} after mileage restore`
							);
						}
					}
				} catch (err) {
					log.warn(`[MileageService] Failed to update trip totalMiles after mileage restore`, {
						itemId,
						error: err
					});
				}
			}

			return restored;
		}
	};
}
