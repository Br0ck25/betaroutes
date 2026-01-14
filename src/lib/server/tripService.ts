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
};

export type Restorable = TripRecord & Record<string, unknown>;

function prefixForUser(userId: string) {
	return `trip:${userId}:`;
}

function trashPrefixForUser(userId: string) {
	return `trash:${userId}:`;
}

// [!code check] Ensure 'export' is here
export function makeTripService(
	kv: KVNamespace,
	trashKV: KVNamespace | undefined,
	placesKV: KVNamespace | undefined,
	tripIndexDO: DurableObjectNamespace,
	placesIndexDO: DurableObjectNamespace
) {
	// NOTE: Using KV-backed implementation to avoid Durable Object for trips/expenses
	return makeTripServiceKV(kv, trashKV, placesKV, placesIndexDO);

	const getIndexStub = (userId: string) => {
		const id = tripIndexDO.idFromName(userId);
		return tripIndexDO.get(id);
	};

	const toSummary = (trip: TripRecord) => ({
		id: trip.id,
		userId: trip.userId,
		date: trip.date,
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

			if (!res.ok) {
				log.error(`[TripService] DO Error: ${res.status}`);
				return [];
			}

			const data = (await res.json()) as
				| { trips: TripRecord[]; needsMigration?: boolean }
				| TripRecord[];

			let trips: TripRecord[] = [];
			let needsMigration = false;

			if (Array.isArray(data)) {
				trips = data;
			} else {
				trips = data.trips || [];
				needsMigration = !!data.needsMigration;
			}

			if (needsMigration) {
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
					const t = JSON.parse(raw);
					out.push(t);
				}

				const summaries = out.map(toSummary);

				await stub.fetch(`${DO_ORIGIN}/migrate`, {
					method: 'POST',
					body: JSON.stringify(summaries)
				});

				out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
				return out;
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

			// 1. Update the Summary Index
			await stub.fetch(`${DO_ORIGIN}/put`, {
				method: 'POST',
				body: JSON.stringify(toSummary(trip))
			});

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

			if (trashKV) {
				const metadata: TrashMetadata = {
					deletedAt: now.toISOString(),
					deletedBy: userId,
					originalKey: key,
					expiresAt: expiresAt.toISOString()
				};
				const trashKey = `trash:${userId}:${tripId}`;
				const trashPayload = { type: 'trip', data: trip, metadata };
				await trashKV.put(trashKey, JSON.stringify(trashPayload), {
					expirationTtl: RETENTION.THIRTY_DAYS
				});
			}

			const tombstone = {
				id: trip.id,
				userId: trip.userId,
				deleted: true,
				deletedAt: now.toISOString(),
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
			if (!trashKV) return [];
			const prefix = trashPrefixForUser(userId);
			const list = await trashKV.list({ prefix });
			const out: TrashItem[] = [];

			for (const k of list.keys) {
				const raw = await trashKV.get(k.name);
				if (!raw) continue;
				const parsed = JSON.parse(raw);
				let item: Restorable | Record<string, unknown>;
				let type: 'trip' | 'expense' = 'trip';

				if (parsed.trip) {
					item = parsed.trip;
					type = 'trip';
				} else if (parsed.type && parsed.data) {
					item = parsed.data;
					type = parsed.type;
				} else {
					item = parsed;
				}

				const itemRec = item as Record<string, unknown>;
				const id =
					typeof itemRec['id'] === 'string'
						? (itemRec['id'] as string)
						: (parsed.metadata?.originalKey || '').split(':').pop() || '';
				const uid =
					typeof itemRec['userId'] === 'string'
						? (itemRec['userId'] as string)
						: (parsed.metadata?.originalKey || '').split(':')[1] || '';
				out.push({
					id,
					userId: uid,
					metadata: parsed.metadata as TrashMetadata,
					recordType: type
				});
			}
			out.sort((a, b) => (b.metadata?.deletedAt || '').localeCompare(a.metadata?.deletedAt || ''));
			return out;
		},

		async emptyTrash(userId: string) {
			if (!trashKV) return 0;
			const prefix = trashPrefixForUser(userId);
			const list = await trashKV.list({ prefix });
			let count = 0;
			for (const k of list.keys) {
				await trashKV.delete(k.name);
				count++;
			}
			return count;
		},

		async restore(userId: string, itemId: string) {
			if (!trashKV) throw new Error('Trash KV not available');
			const trashKey = `trash:${userId}:${itemId}`;
			const raw = await trashKV.get(trashKey);
			if (!raw) throw new Error('Item not found in trash');
			const parsed = JSON.parse(raw);

			let item: Restorable | Record<string, unknown>;
			let type: 'trip' | 'expense' = 'trip';

			if (parsed.trip) {
				item = parsed.trip as Restorable;
				type = 'trip';
			} else if (parsed.type && parsed.data) {
				item = parsed.data as Record<string, unknown>;
				type = parsed.type;
			} else {
				item = parsed as Restorable;
			}

			if ('deletedAt' in item) delete (item as Record<string, unknown>)['deletedAt'];
			if ('deleted' in item) delete (item as Record<string, unknown>)['deleted'];
			(item as Record<string, unknown>)['updatedAt'] = new Date().toISOString();

			const restored = item as Restorable;

			if (type === 'trip') {
				const activeKey = `trip:${userId}:${restored.id}`;
				await kv.put(activeKey, JSON.stringify(restored));
				const stub = getIndexStub(userId);
				await stub.fetch(`${DO_ORIGIN}/put`, {
					method: 'POST',
					body: JSON.stringify(toSummary(restored))
				});
			} else if (type === 'expense') {
				const activeKey = `expense:${userId}:${restored.id}`;
				await kv.put(activeKey, JSON.stringify(restored));
			}

			await trashKV.delete(trashKey);
			return item;
		},

		async permanentDelete(userId: string, itemId: string) {
			if (!trashKV) throw new Error('Trash KV not available');
			const trashKey = `trash:${userId}:${itemId}`;
			await trashKV.delete(trashKey);
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

// New: KV-backed trip service (bypasses Durable Object index)
export function makeTripServiceKV(
	kv: KVNamespace,
	trashKV: KVNamespace | undefined,
	placesKV: KVNamespace | undefined,
	placesIndexDO?: DurableObjectNamespace
) {
	const prefixForUser = (userId: string) => `trip:${userId}:`;

	const toSummary = (trip: any) => ({
		id: trip.id,
		userId: trip.userId,
		date: trip.date,
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

	async function indexTripData(trip: any) {
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
				(trip.stops as any[]).forEach((s: any) => add(s.address, s.location));
			}
			if (Array.isArray(trip.destinations)) {
				(trip.destinations as any[]).forEach((d: any) => add(d.address, d.location));
			}

			const writePromises: Promise<unknown>[] = [];

			for (const [addrKey, data] of uniquePlaces.entries()) {
				if (data.lat !== undefined && data.lng !== undefined) {
					const safeKey = await (await import('$lib/utils/keys')).generatePlaceKey(addrKey);
					const payload = {
						lastSeen: new Date().toISOString(),
						formatted_address: addrKey,
						lat: data.lat,
						lng: data.lng
					};
					writePromises.push(placesKV!.put(safeKey, JSON.stringify(payload)));
				}

				const prefixKey = (await import('$lib/utils/keys')).generatePrefixKey(addrKey);
				if (placesIndexDO) {
					const stub = placesIndexDO.get(placesIndexDO.idFromName(prefixKey));
					writePromises.push(
						stub.fetch(`${DO_ORIGIN}/add?key=${encodeURIComponent(prefixKey)}`, {
							method: 'POST',
							body: JSON.stringify({ address: addrKey })
						})
					);
				}
			}

			const results = await Promise.allSettled(writePromises);
			const rejected = results.filter((r) => r.status === 'rejected');
			if (rejected.length > 0) {
				(log as any).error(
					`[TripServiceKV] Indexing had ${rejected.length} failures for trip ${trip.id}`
				);
			}
		} catch (err) {
			(log as any).error('[TripServiceKV] Critical error in indexTripData:', err);
		}
	}

	return {
		async checkMonthlyQuota(userId: string, limit: number) {
			const date = new Date();
			const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
			const key = `count:${monthKey}:${userId}`;
			const raw = await kv.get(key);
			const cur = raw ? parseInt(raw, 10) : 0;
			if (cur >= limit) return { allowed: false, count: cur };
			await kv.put(key, String(cur + 1));
			return { allowed: true, count: cur + 1 };
		},

		async list(userId: string, options: { since?: string; limit?: number; offset?: number } = {}) {
			const prefix = prefixForUser(userId);
			const out: any[] = [];
			let list = await kv.list({ prefix });
			let keys = list.keys;

			while (!list.list_complete && list.cursor) {
				list = await kv.list({ prefix, cursor: list.cursor });
				keys = keys.concat(list.keys);
			}

			for (const k of keys) {
				const raw = await kv.get(k.name);
				if (!raw) continue;
				out.push(JSON.parse(raw));
			}

			out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
			if (options.since) {
				const sinceDate = new Date(options.since);
				return out.filter((t) => new Date(t.updatedAt || t.createdAt) > sinceDate);
			}
			if (options.offset) out.splice(0, options.offset);
			if (options.limit) return out.slice(0, options.limit);
			return out.filter((t) => !t.deleted);
		},

		async get(userId: string, tripId: string) {
			const key = `trip:${userId}:${tripId}`;
			const raw = await kv.get(key);
			return raw ? (JSON.parse(raw) as any) : null;
		},

		async put(trip: any) {
			trip.updatedAt = new Date().toISOString();
			delete trip.deleted;
			delete trip.deletedAt;
			await kv.put(`trip:${trip.userId}:${trip.id}`, JSON.stringify(trip));

			// Index Places (best effort)
			try {
				await indexTripData(trip);
			} catch (e) {
				(log as any).error('[TripServiceKV] Failed to index trip data:', e);
			}
		},

		async delete(userId: string, tripId: string) {
			const key = `trip:${userId}:${tripId}`;
			const raw = await kv.get(key);
			if (!raw) return;
			const trip = JSON.parse(raw);
			const now = new Date();
			const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

			if (trashKV) {
				const metadata = {
					deletedAt: now.toISOString(),
					deletedBy: userId,
					originalKey: key,
					expiresAt: expiresAt.toISOString()
				};
				const trashKey = `trash:${userId}:${tripId}`;
				const trashPayload = { type: 'trip', data: trip, metadata };
				await trashKV.put(trashKey, JSON.stringify(trashPayload), {
					expirationTtl: 30 * 24 * 60 * 60
				});
			}

			const tombstone = {
				id: trip.id,
				userId: trip.userId,
				deleted: true,
				deletedAt: now.toISOString(),
				updatedAt: now.toISOString(),
				createdAt: trip.createdAt
			};

			await kv.put(key, JSON.stringify(tombstone), { expirationTtl: 30 * 24 * 60 * 60 });
		},

		async listTrash(userId: string) {
			if (!trashKV) return [];
			const prefix = `trash:${userId}:`;
			const list = await trashKV.list({ prefix });
			const out: any[] = [];
			for (const k of list.keys) {
				const raw = await trashKV.get(k.name);
				if (!raw) continue;
				const parsed = JSON.parse(raw);
				let item: any;
				let type: 'trip' | 'expense' = 'trip';

				if (parsed.trip) {
					item = parsed.trip;
					type = 'trip';
				} else if (parsed.type && parsed.data) {
					item = parsed.data;
					type = parsed.type;
				} else {
					item = parsed;
				}

				const itemRec = item as Record<string, unknown>;
				const id =
					typeof itemRec['id'] === 'string'
						? (itemRec['id'] as string)
						: (parsed.metadata?.originalKey || '').split(':').pop() || '';
				const uid =
					typeof itemRec['userId'] === 'string'
						? (itemRec['userId'] as string)
						: (parsed.metadata?.originalKey || '').split(':')[1] || '';
				out.push({ id, userId: uid, metadata: parsed.metadata, recordType: type });
			}
			out.sort((a, b) => (b.metadata?.deletedAt || '').localeCompare(a.metadata?.deletedAt || ''));
			return out;
		},

		async emptyTrash(userId: string) {
			if (!trashKV) return 0;
			const prefix = `trash:${userId}:`;
			const list = await trashKV.list({ prefix });
			let count = 0;
			for (const k of list.keys) {
				await trashKV.delete(k.name);
				count++;
			}
			return count;
		},

		async restore(userId: string, itemId: string) {
			if (!trashKV) throw new Error('Trash KV not available');
			const trashKey = `trash:${userId}:${itemId}`;
			const raw = await trashKV.get(trashKey);
			if (!raw) throw new Error('Item not found in trash');
			const parsed = JSON.parse(raw);
			let item: any;
			let type: 'trip' | 'expense' = 'trip';

			if (parsed.trip) {
				item = parsed.trip as any;
				type = 'trip';
			} else if (parsed.type && parsed.data) {
				item = parsed.data as any;
				type = parsed.type;
			} else {
				item = parsed as any;
			}

			if ('deletedAt' in item) delete (item as any)['deletedAt'];
			if ('deleted' in item) delete (item as any)['deleted'];
			(item as any)['updatedAt'] = new Date().toISOString();
			const restored = item as any;
			if (type === 'trip') {
				const activeKey = `trip:${userId}:${restored.id}`;
				await kv.put(activeKey, JSON.stringify(restored));
			} else if (type === 'expense') {
				const activeKey = `expense:${userId}:${restored.id}`;
				await kv.put(activeKey, JSON.stringify(restored));
			}
			await trashKV.delete(trashKey);
			return item;
		},

		async permanentDelete(userId: string, itemId: string) {
			if (!trashKV) throw new Error('Trash KV not available');
			const trashKey = `trash:${userId}:${itemId}`;
			await trashKV.delete(trashKey);
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
