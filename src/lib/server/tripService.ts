// src/lib/server/tripService.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { generatePrefixKey, generatePlaceKey } from '$lib/utils/keys';
import { DO_ORIGIN, RETENTION } from '$lib/constants';
import { log } from '$lib/server/log';

export type Stop = {
	id: string;
	address: string;
	notes?: string;
	earnings?: number;
	order: number;
	location?: { lat: number; lng: number };
};

export type TripRecord = {
	id: string;
	userId: string;
	title?: string;
	stops?: Stop[];
	date?: string;
	/** Optional pay date for tax purposes */
	payDate?: string;
	startAddress?: string;
	endAddress?: string;
	startLocation?: { lat: number; lng: number };
	endLocation?: { lat: number; lng: number };
	destinations?: { address: string; location?: { lat: number; lng: number } }[];
	startTime?: string;
	endTime?: string;
	netProfit?: number;
	totalEarnings?: number;
	fuelCost?: number;
	maintenanceCost?: number;
	suppliesCost?: number;
	maintenanceItems?: unknown[];
	supplyItems?: unknown[];
	suppliesItems?: unknown[];
	totalMiles?: number;
	hoursWorked?: number;
	estimatedTime?: number;
	totalTime?: string;
	createdAt: string;
	updatedAt?: string;
	deletedAt?: string;
	deleted?: boolean;
	lastModified?: string;
};

export type TrashMetadata = {
	deletedAt: string;
	deletedBy: string;
	originalKey: string;
	expiresAt: string;
};

export type TrashItem = {
	id: string;
	userId: string;
	recordType: 'trip' | 'expense';
	metadata: TrashMetadata;
	// Optional summary fields for UI
	title?: string;
	date?: string;
	createdAt?: string;
	stops?: unknown[];
	totalMiles?: number;
	startAddress?: string;
	category?: string;
	amount?: number;
	description?: string;
};

export type Restorable = TripRecord & Record<string, unknown>;

function prefixForUser(userId: string) {
	return `trip:${userId}:`;
}

// [!code check] Ensure 'export' is here
export function makeTripService(
	kv: KVNamespace,
	_trashKV: KVNamespace | undefined,
	placesKV: KVNamespace | undefined,
	tripIndexDO: DurableObjectNamespace,
	placesIndexDO: DurableObjectNamespace
) {
	const getIndexStub = (userId: string) => {
		const id = tripIndexDO.idFromName(userId);
		return tripIndexDO.get(id);
	};

	const toSummary = (trip: TripRecord) => ({
		id: trip.id,
		userId: trip.userId,
		date: trip.date,
		// Optional pay date (tax purposes)
		payDate: trip.payDate,
		title: trip.title,
		startAddress: trip.startAddress,
		endAddress: trip.endAddress,
		startTime: trip.startTime,
		endTime: trip.endTime,
		netProfit: trip.netProfit,
		totalEarnings: trip.totalEarnings,
		fuelCost: trip.fuelCost,
		maintenanceCost: trip.maintenanceCost,
		suppliesCost: trip.suppliesCost,
		maintenanceItems: trip.maintenanceItems,
		supplyItems: trip.supplyItems,
		suppliesItems: trip.suppliesItems,
		totalMiles: trip.totalMiles,
		hoursWorked: trip.hoursWorked,
		estimatedTime: trip.estimatedTime,
		totalTime: trip.totalTime,
		stopsCount: trip.stops?.length || 0,
		stops: trip.stops,
		createdAt: trip.createdAt,
		updatedAt: trip.updatedAt,
		deleted: trip.deleted
	});

	async function indexTripData(trip: TripRecord) {
		if (!placesKV || trip.deleted) return;

		try {
			const uniquePlaces = new Map<string, { lat?: number; lng?: number }>();
			const add = (addr?: string, loc?: { lat: number; lng: number }) => {
				if (!addr || addr.length < 3) return;
				const normalized = addr.toLowerCase().trim();
				if (!uniquePlaces.has(normalized) || loc) {
					uniquePlaces.set(normalized, loc || {});
				}
			};

			add(trip.startAddress, trip.startLocation);
			add(trip.endAddress, trip.endLocation);
			if (Array.isArray(trip.stops)) {
				(trip.stops as Stop[]).forEach((s: Stop) => add(s.address, s.location));
			}
			if (Array.isArray(trip.destinations)) {
				(
					trip.destinations as { address: string; location?: { lat: number; lng: number } }[]
				).forEach((d) => add(d.address, d.location));
			}

			const writePromises: Promise<unknown>[] = [];

			for (const [addrKey, data] of uniquePlaces.entries()) {
				if (data.lat !== undefined && data.lng !== undefined) {
					const safeKey = await generatePlaceKey(addrKey);
					const payload = {
						lastSeen: new Date().toISOString(),
						formatted_address: addrKey,
						lat: data.lat,
						lng: data.lng
					};
					writePromises.push(placesKV.put(safeKey, JSON.stringify(payload)));
				}

				const prefixKey = generatePrefixKey(addrKey);
				const stub = placesIndexDO.get(placesIndexDO.idFromName(prefixKey));

				writePromises.push(
					stub.fetch(`${DO_ORIGIN}/add?key=${encodeURIComponent(prefixKey)}`, {
						method: 'POST',
						body: JSON.stringify({ address: addrKey })
					})
				);
			}

			const results = await Promise.allSettled(writePromises);
			const rejected = results.filter((r) => r.status === 'rejected');
			if (rejected.length > 0) {
				log.error(`[TripService] Indexing had ${rejected.length} failures for trip ${trip.id}`);
			}
		} catch (err) {
			log.error('[TripService] Critical error in indexTripData:', err);
		}
	}

	// Helper to fetch directly from KV (Source of Truth)
	async function listFromKV(userId: string): Promise<TripRecord[]> {
		const prefix = prefixForUser(userId);
		const out: TripRecord[] = [];
		let list = await kv.list({ prefix });
		let keys = list.keys;

		while (!list.list_complete && list.cursor) {
			list = await kv.list({ prefix, cursor: list.cursor });
			keys = keys.concat(list.keys);
		}

		for (const k of keys) {
			const raw = await kv.get(k.name);
			if (!raw) continue;
			try {
				const t = JSON.parse(raw);
				// Filter out deleted items here, similar to the DO
				if (!t.deleted) out.push(t);
			} catch (e) {
				// ignore corrupt JSON in KV
			}
		}

		out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		return out;
	}

	return {
		async checkMonthlyQuota(
			userId: string,
			limit: number
		): Promise<{ allowed: boolean; count: number }> {
			const date = new Date();
			const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
			const stub = getIndexStub(userId);

			const res = await stub.fetch(`${DO_ORIGIN}/billing/check-increment`, {
				method: 'POST',
				body: JSON.stringify({ monthKey, limit })
			});
			if (!res.ok) return { allowed: false, count: limit };
			return (await res.json()) as { allowed: boolean; count: number };
		},

		async list(
			userId: string,
			options: { since?: string; limit?: number; offset?: number } = {}
		): Promise<TripRecord[]> {
			const stub = getIndexStub(userId);

			let url = `${DO_ORIGIN}/list`;
			const params = new URLSearchParams();
			if (options.limit) params.set('limit', String(options.limit));
			if (options.offset) params.set('offset', String(options.offset));
			if (params.size > 0) url += `?${params.toString()}`;

			const res = await stub.fetch(url);

			// --- FAILSAFE 1: If DO is completely down (e.g. 500), fallback to KV immediately ---
			if (!res.ok) {
				log.error(`[TripService] DO Error: ${res.status} - Falling back to KV`);
				const kvTrips = await listFromKV(userId);
				if (options.since) {
					const sinceDate = new Date(options.since);
					return kvTrips.filter((t) => new Date(t.updatedAt || t.createdAt) > sinceDate);
				}
				return kvTrips;
			}

			const data = (await res.json()) as
				| { trips: TripRecord[]; needsMigration?: boolean; pagination?: { total: number } }
				| TripRecord[];

			let trips: TripRecord[] = [];
			let needsMigration = false;
			let doCount = 0;

			if (Array.isArray(data)) {
				trips = data;
				doCount = trips.length;
			} else {
				trips = data.trips || [];
				needsMigration = !!data.needsMigration;
				// Use the total from pagination if available, otherwise array length
				doCount = data.pagination?.total ?? trips.length;
			}

			// --- FAILSAFE 2: Count-Based Consistency Check ---
			// Retrieve the expected count of active trips from KV metadata
			const expectedCountStr = await kv.get(`meta:user:${userId}:trip_count`);
			const expectedCount = expectedCountStr ? parseInt(expectedCountStr, 10) : 0;

			// If the DO index has fewer items than KV expects, or explicitly requests migration,
			// or returns 0 items when we know some should exist, trigger a full repair.
			if (needsMigration || doCount < expectedCount || (trips.length === 0 && expectedCount > 0)) {
				log.info(
					`[TripService] Sync mismatch detected (DO: ${doCount}, KV: ${expectedCount}). Triggering repair.`
				);

				// 1. Fetch full list from KV (Source of Truth)
				const repairedTrips = await listFromKV(userId);

				// 2. Asynchronously repair the DO index
				if (repairedTrips.length > 0) {
					const summaries = repairedTrips.map(toSummary);
					stub
						.fetch(`${DO_ORIGIN}/migrate`, {
							method: 'POST',
							body: JSON.stringify(summaries)
						})
						.catch((e) => log.warn('[TripService] Background repair failed', e));
				}

				// 3. Return the fresh data from KV immediately to the user
				if (options.since) {
					const sinceDate = new Date(options.since);
					return repairedTrips.filter((t) => new Date(t.updatedAt || t.createdAt) > sinceDate);
				}
				return repairedTrips;
			}

			if (options.since) {
				const sinceDate = new Date(options.since);
				return trips.filter((t) => new Date(t.updatedAt || t.createdAt) > sinceDate);
			} else {
				return trips.filter((t) => !t.deleted);
			}
		},

		async get(userId: string, tripId: string) {
			const key = `trip:${userId}:${tripId}`;
			const raw = await kv.get(key);
			return raw ? (JSON.parse(raw) as TripRecord) : null;
		},

		async put(trip: TripRecord) {
			trip.updatedAt = new Date().toISOString();
			delete trip.deleted;
			delete trip.deletedAt;
			await kv.put(`trip:${trip.userId}:${trip.id}`, JSON.stringify(trip));
			const stub = getIndexStub(trip.userId);

			// 1. Update the Summary Index (log failures)
			try {
				const r = await stub.fetch(`${DO_ORIGIN}/put`, {
					method: 'POST',
					body: JSON.stringify(toSummary(trip))
				});
				if (!r.ok) {
					log.warn('[TripService] DO put returned non-ok status', { status: r.status });
				}
			} catch (e) {
				log.error('[TripService] DO put failed', { message: (e as Error).message });
			}

			// 2. Trigger Route Calculation & Caching (Background)
			stub
				.fetch(`${DO_ORIGIN}/compute-routes`, {
					method: 'POST',
					body: JSON.stringify({ id: trip.id })
				})
				.catch((err) => {
					log.error('[TripService] Background route computation failed trigger:', err);
				});

			// 3. Index Places
			try {
				await indexTripData(trip);
			} catch (e) {
				log.error('[TripService] Failed to index trip data:', e);
			}
		},

		async delete(userId: string, tripId: string) {
			const key = `trip:${userId}:${tripId}`;
			const raw = await kv.get(key);
			if (!raw) return;

			const trip = JSON.parse(raw);
			const now = new Date();
			const expiresAt = new Date(now.getTime() + RETENTION.THIRTY_DAYS * 1000);

			// Persist a tombstone in the main logs KV that includes metadata and a backup of the original
			const metadata: TrashMetadata = {
				deletedAt: now.toISOString(),
				deletedBy: userId,
				originalKey: key,
				expiresAt: expiresAt.toISOString()
			};

			const tombstone = {
				id: trip.id,
				userId: trip.userId,
				deleted: true,
				deletedAt: now.toISOString(),
				deletedBy: userId,
				metadata,
				backup: trip,
				updatedAt: now.toISOString(),
				createdAt: trip.createdAt
			};

			await kv.put(key, JSON.stringify(tombstone), { expirationTtl: RETENTION.THIRTY_DAYS });

			const stub = getIndexStub(userId);
			await stub.fetch(`${DO_ORIGIN}/delete`, {
				method: 'POST',
				body: JSON.stringify({ id: trip.id })
			});

			const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
			await stub.fetch(`${DO_ORIGIN}/billing/decrement`, {
				method: 'POST',
				body: JSON.stringify({ monthKey })
			});
		},

		async listTrash(userId: string): Promise<TrashItem[]> {
			const prefix = prefixForUser(userId);
			let list = await kv.list({ prefix });
			let keys = list.keys;
			while (!list.list_complete && list.cursor) {
				list = await kv.list({ prefix, cursor: list.cursor });
				keys = keys.concat(list.keys);
			}

			const out: TrashItem[] = [];
			for (const k of keys) {
				const raw = await kv.get(k.name);
				if (!raw) continue;
				const parsed = JSON.parse(raw);
				if (!parsed || !parsed.deleted) continue;

				const id = parsed.id || String(k.name.split(':').pop() || '');
				const uid = parsed.userId || String(k.name.split(':')[1] || '');
				const metadata: TrashMetadata = parsed.metadata || {
					deletedAt: parsed.deletedAt || '',
					deletedBy: parsed.deletedBy || uid,
					originalKey: k.name,
					expiresAt: parsed.metadata?.expiresAt || ''
				};

				// Build a lightweight summary for UI display (merge backup fields if present)
				const backup = parsed.backup || parsed.data || parsed.trip || parsed || {};
				let type: 'trip' | 'expense' = 'trip';
				if (parsed.type === 'expense' || (backup && (backup.category || backup.amount))) {
					type = 'expense';
				}

				if (type === 'trip') {
					out.push({
						id,
						userId: uid,
						metadata,
						recordType: 'trip',
						title: (backup.title as string) || (backup.startAddress as string) || undefined,
						date: (backup.date as string) || undefined,
						createdAt: (backup.createdAt as string) || undefined,
						stops: (backup.stops as unknown[]) || undefined,
						totalMiles: typeof backup.totalMiles === 'number' ? backup.totalMiles : undefined,
						startAddress: (backup.startAddress as string) || undefined
					});
				}
			}

			out.sort((a, b) => (b.metadata?.deletedAt || '').localeCompare(a.metadata?.deletedAt || ''));
			return out;
		},

		async restore(userId: string, itemId: string) {
			const key = `trip:${userId}:${itemId}`;
			const raw = await kv.get(key);
			if (!raw) throw new Error('Item not found in trash');
			const parsed = JSON.parse(raw);
			if (!parsed || !parsed.deleted) throw new Error('Item is not deleted');
			const backup = parsed.backup || parsed.data || parsed.trip;
			if (!backup) throw new Error('Backup data not found in item');

			// Clean tombstone fields and set updatedAt
			if ('deletedAt' in backup) delete (backup as Record<string, unknown>)['deletedAt'];
			if ('deleted' in backup) delete (backup as Record<string, unknown>)['deleted'];
			(backup as Record<string, unknown>)['updatedAt'] = new Date().toISOString();

			const restored = backup as Restorable;

			if (restored) {
				if (restored && restored.userId) {
					await kv.put(key, JSON.stringify(restored));
					const stub = getIndexStub(userId);
					await stub.fetch(`${DO_ORIGIN}/put`, {
						method: 'POST',
						body: JSON.stringify(toSummary(restored))
					});
					return restored;
				}
			}
			throw new Error('Restore failed');
		},

		async permanentDelete(userId: string, itemId: string) {
			const key = `trip:${userId}:${itemId}`;
			await kv.delete(key);
		},

		async incrementUserCounter(userId: string, amt = 1) {
			const key = `meta:user:${userId}:trip_count`;
			const raw = await kv.get(key);
			const cur = raw ? parseInt(raw, 10) : 0;
			const next = Math.max(0, cur + amt);
			await kv.put(key, String(next));
			return next;
		}
	};
}