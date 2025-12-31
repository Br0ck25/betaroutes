// src/lib/server/TripIndexDO.ts
import type { DurableObjectState, KVNamespace } from '@cloudflare/workers-types';
import { log } from '$lib/server/log';

interface TripSummary {
	id: string;
	userId: string;
	date?: string;
	createdAt: string;
	updatedAt: string;
	[key: string]: unknown;
}

interface ExpenseRecord {
	id: string;
	userId: string;
	date: string;
	category: string;
	amount: number;
	description?: string;
	createdAt: string;
	updatedAt: string;
	[key: string]: unknown;
}

export class TripIndexDO {
	state: DurableObjectState;
	env: Record<string, unknown>;

	constructor(state: DurableObjectState, env: Record<string, unknown>) {
		this.state = state;
		this.env = env;

		// 1. Initialize SQLite Schema
		this.state.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS trips (
                id TEXT PRIMARY KEY,
                userId TEXT,
                date TEXT,
                createdAt TEXT,
                data TEXT
            );
            
            CREATE TABLE IF NOT EXISTS expenses (
                id TEXT PRIMARY KEY,
                userId TEXT,
                date TEXT,
                category TEXT,
                createdAt TEXT,
                data TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(userId);
            CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(userId);
        `);

		// 2. Migration Logic (Legacy KV -> SQLite)
		this.state.blockConcurrencyWhile(async () => {
			try {
				const legacyTrips = await this.state.storage.get<TripSummary[]>('trips');
				if (legacyTrips && Array.isArray(legacyTrips) && legacyTrips.length > 0) {
					const CHUNK_SIZE = 100;
					for (let i = 0; i < legacyTrips.length; i += CHUNK_SIZE) {
						const chunk = legacyTrips.slice(i, i + CHUNK_SIZE);
						this.state.storage.sql.exec('BEGIN TRANSACTION');
						try {
							for (const trip of chunk) {
								this.state.storage.sql.exec(
									'INSERT OR REPLACE INTO trips (id, userId, date, createdAt, data) VALUES (?, ?, ?, ?, ?)',
									trip.id,
									trip.userId || '',
									trip.date || '',
									trip.createdAt || '',
									JSON.stringify(trip)
								);
							}
							this.state.storage.sql.exec('COMMIT');
						} catch (err) {
							this.state.storage.sql.exec('ROLLBACK');
							throw err;
						}
					}
					await this.state.storage.delete('trips');
				}
			} catch (err) {
				log.error('[TripIndexDO] Startup Migration Failed:', err);
			}
		});
	}

	async fetch(request: Request) {
		const url = new URL(request.url);
		const path = url.pathname;

		try {
			const parseBody = async <T>() => {
				try {
					return (await request.json()) as T;
				} catch {
					throw new Error('INVALID_JSON');
				}
			};

			// --- ADMIN OPERATIONS ---
			if (path === '/admin/wipe-user') {
				if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
				this.state.storage.sql.exec('DELETE FROM trips');
				this.state.storage.sql.exec('DELETE FROM expenses');
				return new Response('Account Data Wiped');
			}

			// --- TRIP OPERATIONS ---
			if (path === '/list') {
				const limitParam = url.searchParams.get('limit');
				const offsetParam = url.searchParams.get('offset');
				let query = `SELECT data FROM trips ORDER BY date DESC, createdAt DESC`;
				const params: (string | number)[] = [];

				if (limitParam) {
					query += ` LIMIT ? OFFSET ?`;
					params.push(parseInt(limitParam) || 50, parseInt(offsetParam || '0') || 0);
				}

				const cursor = this.state.storage.sql.exec(query, ...params);
				const countRes = this.state.storage.sql.exec('SELECT COUNT(*) as total FROM trips');
				const total = (countRes.one() as { total: number }).total;

				const trips = [];
				for (const row of cursor) {
					trips.push(JSON.parse((row as Record<string, unknown>)['data'] as string));
				}
				return new Response(
					JSON.stringify({
						trips,
						pagination: {
							total,
							limit: limitParam ? parseInt(limitParam) : trips.length,
							offset: offsetParam ? parseInt(offsetParam) : 0
						}
					})
				);
			}

			if (path === '/migrate') {
				const trips = await parseBody<TripSummary[]>();
				this.state.storage.sql.exec('BEGIN TRANSACTION');
				try {
					for (const trip of trips) {
						this.state.storage.sql.exec(
							'INSERT OR REPLACE INTO trips (id, userId, date, createdAt, data) VALUES (?, ?, ?, ?, ?)',
							trip.id,
							trip.userId,
							trip.date || '',
							trip.createdAt || '',
							JSON.stringify(trip)
						);
					}
					this.state.storage.sql.exec('COMMIT');
				} catch (err) {
					this.state.storage.sql.exec('ROLLBACK');
					throw err;
				}
				return new Response('OK');
			}

			if (path === '/put') {
				const trip = await parseBody<TripSummary>();
				if (!trip || !trip.id || !trip.userId) return new Response('Invalid Data', { status: 400 });
				this.state.storage.sql.exec(
					`INSERT OR REPLACE INTO trips (id, userId, date, createdAt, data) VALUES (?, ?, ?, ?, ?)`,
					trip.id,
					trip.userId,
					trip.date || '',
					trip.createdAt || '',
					JSON.stringify(trip)
				);
				return new Response('OK');
			}

			// --- COMPUTE ROUTES (Aligns with HughesNet Router) ---
			if (path === '/compute-routes') {
				if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
				const body = await parseBody<{ id: string }>();
				const tripId = body?.id;
				if (!tripId) return new Response('Missing trip id', { status: 400 });

				try {
					const cursor = this.state.storage.sql.exec('SELECT data FROM trips WHERE id = ?', tripId);
					const row = cursor.one();
					if (!row) return new Response('Trip not found', { status: 404 });
					const trip = JSON.parse(
						(row as Record<string, unknown>)['data'] as string
					) as TripSummary;

					const points: string[] = [];
					if (trip['startAddress']) points.push(String(trip['startAddress']));
					if (Array.isArray(trip['stops'])) {
						for (const s of trip['stops'] as any[]) {
							if (s && s.address) points.push(String(s.address));
						}
					}
					if (trip['endAddress']) points.push(String(trip['endAddress']));

					const directionsKV = (this.env as any)['BETA_DIRECTIONS_KV'] as KVNamespace | undefined;
					const tripsKV = (this.env as any)['BETA_LOGS_KV'] as KVNamespace | undefined;
					const googleKey = String((this.env as any)['PRIVATE_GOOGLE_MAPS_API_KEY'] || '');

					let totalMeters = 0;
					let totalSeconds = 0;

					for (let i = 0; i < points.length - 1; i++) {
						const origin = points[i];
						const destination = points[i + 1];
						if (!origin || !destination || origin === destination) continue;

						// [!code changed] ALIGNMENT: Use HughesNet-style keys
						// This matches the regex logic in src/lib/server/hughesnet/router.ts
						let key = `dir:${origin.toLowerCase().trim()}_to_${destination.toLowerCase().trim()}`;
						key = key.replace(/[^a-z0-9_:-]/g, '');

						// Safety check for KV limit (512 bytes)
						if (key.length > 512) {
							// Fallback to substring if absurdly long, though this breaks sharing for edge cases
							key = key.substring(0, 512);
						}

						try {
							// 1) Check KV cache
							let cached: string | null = null;
							if (directionsKV) {
								cached = await directionsKV.get(key);
							}

							if (cached) {
								try {
									const parsed = JSON.parse(cached);
									if (parsed && parsed.distance != null && parsed.duration != null) {
										totalMeters += Number(parsed.distance);
										totalSeconds += Number(parsed.duration);
										// log.info(`[ComputeRoutes] Cache HIT ${key}`);
										continue;
									}
								} catch (e) {
									// ignore corrupt
								}
							}

							// 2) Google Fallback
							if (!googleKey) {
								log.warn('[ComputeRoutes] GOOGLE API KEY missing');
								continue;
							}
							const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(
								origin
							)}&destination=${encodeURIComponent(destination)}&key=${googleKey}`;
							const res = await fetch(url);
							const data: any = await res.json().catch(() => null);

							if (
								data &&
								data.status === 'OK' &&
								data.routes &&
								data.routes[0] &&
								data.routes[0].legs &&
								data.routes[0].legs[0]
							) {
								const leg = data.routes[0].legs[0];
								const distance = leg.distance?.value ?? null;
								const duration = leg.duration?.value ?? null;

								if (distance && isFinite(distance)) totalMeters += distance;
								if (duration && isFinite(duration)) totalSeconds += duration;

								// Save to KV (Readable Key)
								if (directionsKV && distance !== null && duration !== null) {
									await directionsKV.put(
										key,
										JSON.stringify({ distance, duration, source: 'google' })
									);
									log.info(`[ComputeRoutes] Cached: ${key}`);
								}
							}
						} catch (err) {
							log.warn(`[ComputeRoutes] Failed leg: ${err}`);
						}
					}

					// Update Trip in SQLite & KV
					try {
						const miles = Number((totalMeters * 0.000621371).toFixed(1));
						const minutes = Math.round(totalSeconds / 60);
						const updated = {
							...trip,
							totalMiles: miles,
							estimatedTime: minutes,
							updatedAt: new Date().toISOString()
						};

						this.state.storage.sql.exec(
							'UPDATE trips SET data = ? WHERE id = ?',
							JSON.stringify(updated),
							tripId
						);

						if (tripsKV) {
							const tripKey = `trip:${trip.userId}:${trip.id}`;
							await tripsKV.put(tripKey, JSON.stringify({ ...updated }));
						}
					} catch (e) {
						log.warn(`[ComputeRoutes] Save failed: ${e}`);
					}

					return new Response('OK');
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : String(e);
					log.error('[TripIndexDO] compute-routes failed', { message: msg });
					return new Response(JSON.stringify({ error: msg }), { status: 500 });
				}
			}

			if (path === '/delete') {
				const { id } = await parseBody<{ id: string }>();
				this.state.storage.sql.exec('DELETE FROM trips WHERE id = ?', id);
				return new Response('OK');
			}

			// --- EXPENSE OPERATIONS (Omitted for brevity, logic remains identical) ---
			if (path === '/expenses/list') {
				const cursor = this.state.storage.sql.exec(
					`SELECT data FROM expenses ORDER BY date DESC, createdAt DESC`
				);
				const expenses = [];
				for (const row of cursor) {
					expenses.push(JSON.parse((row as Record<string, unknown>)['data'] as string));
				}
				return new Response(JSON.stringify(expenses));
			}

			if (path === '/expenses/put') {
				const item = await parseBody<ExpenseRecord>();
				this.state.storage.sql.exec(
					`INSERT OR REPLACE INTO expenses (id, userId, date, category, createdAt, data) VALUES (?, ?, ?, ?, ?, ?)`,
					item.id,
					item.userId,
					item.date,
					item.category,
					item.createdAt,
					JSON.stringify(item)
				);
				return new Response('OK');
			}

			if (path === '/expenses/delete') {
				const { id } = await parseBody<{ id: string }>();
				this.state.storage.sql.exec('DELETE FROM expenses WHERE id = ?', id);
				return new Response('OK');
			}

			if (path === '/expenses/migrate') {
				const items = await parseBody<ExpenseRecord[]>();
				this.state.storage.sql.exec('BEGIN TRANSACTION');
				try {
					for (const item of items) {
						this.state.storage.sql.exec(
							'INSERT OR REPLACE INTO expenses (id, userId, date, category, createdAt, data) VALUES (?, ?, ?, ?, ?, ?)',
							item.id,
							item.userId,
							item.date,
							item.category,
							item.createdAt,
							JSON.stringify(item)
						);
					}
					this.state.storage.sql.exec('COMMIT');
				} catch (err) {
					this.state.storage.sql.exec('ROLLBACK');
					throw err;
				}
				await this.state.storage.put('expenses_migrated', true);
				return new Response('OK');
			}

			if (path === '/expenses/status') {
				const countRes = this.state.storage.sql.exec('SELECT COUNT(*) as c FROM expenses');
				const count = (countRes.one() as { c: number }).c;
				const migrated = await this.state.storage.get('expenses_migrated');
				return new Response(JSON.stringify({ needsMigration: !migrated && count === 0 }));
			}

			// --- BILLING ---
			if (path === '/billing/check-increment') {
				const { monthKey, limit } = await parseBody<{ monthKey: string; limit: number }>();
				const key = `count:${monthKey}`;
				const current = (await this.state.storage.get<number>(key)) || 0;
				if (current >= limit)
					return new Response(JSON.stringify({ allowed: false, count: current }));
				await this.state.storage.put(key, current + 1);
				return new Response(JSON.stringify({ allowed: true, count: current + 1 }));
			}

			if (path === '/billing/decrement') {
				const { monthKey } = await parseBody<{ monthKey: string }>();
				const key = `count:${monthKey}`;
				const current = (await this.state.storage.get<number>(key)) || 0;
				await this.state.storage.put(key, Math.max(0, current - 1));
				return new Response(JSON.stringify({ count: Math.max(0, current - 1) }));
			}

			return new Response('Not Found', { status: 404 });
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error('[TripIndexDO] Error:', { message: msg });
			if (msg === 'INVALID_JSON') return new Response('Invalid JSON', { status: 400 });
			return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
		}
	}
}
