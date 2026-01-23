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

interface MileageRecord {
	id: string;
	userId: string;
	date: string;
	miles: number;
	vehicle?: string;
	createdAt: string;
	updatedAt: string;
	[key: string]: unknown;
}

export class TripIndexDO {
	state: DurableObjectState;
	env: Record<string, unknown>;
	private schemaEnsured = false;

	constructor(state: DurableObjectState, env: Record<string, unknown>) {
		this.state = state;
		this.env = env;
		// Run on cold start, but also lazily on fetch
		this.ensureSchema();
	}

	// Create tables if they don't exist (Critical for existing users)
	private ensureSchema() {
		// --- SELF-HEAL: Check for Schema Mismatch ---
		// If the existing table doesn't have the columns we expect, the INSERT will fail later.
		// We test this by trying to SELECT the specific columns we use.
		try {
			this.state.storage.sql.exec('SELECT id, userId, date, createdAt, data FROM trips LIMIT 1');
			this.state.storage.sql.exec(
				'SELECT id, userId, date, category, createdAt, data FROM expenses LIMIT 1'
			);
			this.state.storage.sql.exec('SELECT id, userId, date, createdAt, data FROM mileage LIMIT 1');
		} catch (e) {
			log.warn('[TripIndexDO] Schema mismatch or corruption detected. Rebuilding tables...', e);
			try {
				this.state.storage.sql.exec('DROP TABLE IF EXISTS trips');
				this.state.storage.sql.exec('DROP TABLE IF EXISTS expenses');
				this.state.storage.sql.exec('DROP TABLE IF EXISTS mileage');
			} catch (dropErr) {
				log.error('[TripIndexDO] Failed to drop tables during rebuild', dropErr);
			}
		}

		try {
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

				CREATE TABLE IF NOT EXISTS mileage (
					id TEXT PRIMARY KEY,
					userId TEXT,
					date TEXT,
					createdAt TEXT,
					data TEXT
				);

				CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(userId);
				CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(userId);
				CREATE INDEX IF NOT EXISTS idx_mileage_user ON mileage(userId);
			`);
			this.schemaEnsured = true;
		} catch (err) {
			log.error('[TripIndexDO] Schema Init Failed:', err);
		}

		// Legacy Migration Logic (KV -> SQLite for Trips)
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
		// Ensure schema exists before processing any request
		if (!this.schemaEnsured) {
			this.ensureSchema();
		}

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

			// SECURITY: Verify internal caller for admin operations
			const verifyInternalCaller = () => {
				// DOs can only be called from workers in the same account,
				// but we add an extra layer for admin operations
				const internalSecret = this.env['DO_INTERNAL_SECRET'] as string | undefined;
				const providedSecret = request.headers.get('x-do-internal-secret');

				// If secret is configured, require it for admin ops
				if (internalSecret && internalSecret !== providedSecret) {
					return false;
				}
				return true;
			};

			// --- ADMIN OPERATIONS ---
			if (path === '/admin/wipe-user') {
				if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

				// SECURITY: Verify internal caller for destructive operations
				if (!verifyInternalCaller()) {
					return new Response('Forbidden', { status: 403 });
				}

				this.state.storage.sql.exec('DELETE FROM trips');
				this.state.storage.sql.exec('DELETE FROM expenses');
				this.state.storage.sql.exec('DELETE FROM mileage');
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

				// Added specific try/catch for the INSERT to log schema errors clearly
				try {
					this.state.storage.sql.exec(
						`INSERT OR REPLACE INTO trips (id, userId, date, createdAt, data) VALUES (?, ?, ?, ?, ?)`,
						trip.id,
						trip.userId,
						trip.date || '',
						trip.createdAt || '',
						JSON.stringify(trip)
					);
				} catch (e) {
					log.error('[TripIndexDO] INSERT failed - likely schema mismatch', e);
					throw e; // Re-throw so the 500 triggers the Dirty Index repair in tripService
				}
				return new Response('OK');
			}

			// --- COMPUTE ROUTES ---
			if (path === '/compute-routes') {
				if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
				const body = await parseBody<{ id: string }>();
				const tripId = body?.id;
				if (!tripId) return new Response('Missing trip id', { status: 400 });

				log.info(`[ComputeRoutes] START ${tripId}`);

				try {
					const cursor = this.state.storage.sql.exec('SELECT data FROM trips WHERE id = ?', tripId);
					const row = cursor.one();
					if (!row) {
						log.warn(`[ComputeRoutes] Trip not found: ${tripId}`);
						return new Response('Trip not found', { status: 404 });
					}
					const trip = JSON.parse(
						(row as Record<string, unknown>)['data'] as string
					) as TripSummary;

					const points: string[] = [];
					if (trip['startAddress']) points.push(String(trip['startAddress']));
					if (Array.isArray(trip['stops'])) {
						const stops = (trip['stops'] as unknown as Array<{ address?: string }>) || [];
						for (const s of stops) {
							if (s && s.address) points.push(String(s.address));
						}
					}
					if (trip['endAddress']) points.push(String(trip['endAddress']));

					const directionsKV = (this.env as unknown as Record<string, unknown>)[
						'BETA_DIRECTIONS_KV'
					] as KVNamespace | undefined;
					const tripsKV = (this.env as unknown as Record<string, unknown>)['BETA_LOGS_KV'] as
						| KVNamespace
						| undefined;
					const googleKey = String(
						(this.env as unknown as Record<string, unknown>)['PRIVATE_GOOGLE_MAPS_API_KEY'] || ''
					);

					let totalMeters = 0;
					let totalSeconds = 0;

					for (let i = 0; i < points.length - 1; i++) {
						const origin = points[i];
						const destination = points[i + 1];
						if (!origin || !destination || origin === destination) continue;

						let key = `dir:${origin.toLowerCase().trim()}_to_${destination.toLowerCase().trim()}`;
						key = key.replace(/[^a-z0-9_:-]/g, '');

						if (key.length > 512) {
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
										continue;
									}
								} catch {
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
							type DirectionsResponse = {
								status?: string;
								routes?: Array<{
									legs?: Array<{
										distance?: { value?: number };
										duration?: { value?: number };
										start_location?: { lat?: number; lng?: number };
										end_location?: { lat?: number; lng?: number };
										start_address?: string;
										end_address?: string;
									}>;
								}>;
							} | null;
							const data = (await res.json().catch(() => null)) as DirectionsResponse;
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

								// Save to KV
								if (directionsKV && distance !== null && duration !== null) {
									await directionsKV.put(
										key,
										JSON.stringify({ distance, duration, source: 'google' })
									);
									try {
										const directionsKVLocal = (this.env as unknown as Record<string, unknown>)[
											'BETA_DIRECTIONS_KV'
										] as KVNamespace | undefined;
										if (directionsKVLocal) {
											const writeIfMissing = async (
												addr: string | undefined,
												loc: { lat?: number; lng?: number } | undefined,
												formatted?: string
											) => {
												if (!addr || !loc || loc.lat == null || loc.lng == null) return;
												const geoKey = `geo:${addr
													.toLowerCase()
													.trim()
													.replace(/[^a-z0-9]/g, '_')}`;
												const existing = await directionsKVLocal.get(geoKey);
												if (!existing) {
													await directionsKVLocal.put(
														geoKey,
														JSON.stringify({
															lat: Number(loc.lat),
															lon: Number(loc.lng),
															formattedAddress: formatted || addr,
															source: 'compute_routes'
														})
													);
												}
											};
											await writeIfMissing(
												leg.start_address,
												leg.start_location,
												leg.start_address
											);
											await writeIfMissing(leg.end_address, leg.end_location, leg.end_address);
										}
									} catch (e) {
										log.warn('[ComputeRoutes] Auto geocode write failed', e);
									}
								}
							}
						} catch (err) {
							log.warn(`[ComputeRoutes] Failed leg: ${err}`);
						}
					}

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

			// --- EXPENSE OPERATIONS ---
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

			// --- EXPENSE BILLING/QUOTA (atomic to prevent race conditions) ---
			if (path === '/expenses/check-increment') {
				const { monthKey, limit } = await parseBody<{ monthKey: string; limit: number }>();
				const key = `expense_count:${monthKey}`;
				const current = (await this.state.storage.get<number>(key)) || 0;
				if (current >= limit)
					return new Response(JSON.stringify({ allowed: false, count: current }));
				await this.state.storage.put(key, current + 1);
				return new Response(JSON.stringify({ allowed: true, count: current + 1 }));
			}

			if (path === '/expenses/decrement') {
				const { monthKey } = await parseBody<{ monthKey: string }>();
				const key = `expense_count:${monthKey}`;
				const current = (await this.state.storage.get<number>(key)) || 0;
				await this.state.storage.put(key, Math.max(0, current - 1));
				return new Response(JSON.stringify({ count: Math.max(0, current - 1) }));
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
				try {
					const countRes = this.state.storage.sql.exec('SELECT COUNT(*) as c FROM expenses');
					const count = (countRes.one() as { c: number }).c;
					const migrated = await this.state.storage.get('expenses_migrated');
					return new Response(JSON.stringify({ needsMigration: !migrated && count === 0 }));
				} catch {
					return new Response(JSON.stringify({ needsMigration: true }));
				}
			}

			// --- MILEAGE OPERATIONS ---
			if (path === '/mileage/list') {
				const cursor = this.state.storage.sql.exec(
					`SELECT data FROM mileage ORDER BY date DESC, createdAt DESC`
				);
				const records = [];
				for (const row of cursor) {
					records.push(JSON.parse((row as Record<string, unknown>)['data'] as string));
				}
				return new Response(JSON.stringify(records));
			}

			if (path === '/mileage/put') {
				const item = await parseBody<MileageRecord>();
				// Basic validation
				if (!item || !item.id || !item.userId) return new Response('Invalid Data', { status: 400 });

				this.state.storage.sql.exec(
					`INSERT OR REPLACE INTO mileage (id, userId, date, createdAt, data) VALUES (?, ?, ?, ?, ?)`,
					item.id,
					item.userId,
					item.date || '',
					item.createdAt || '',
					JSON.stringify(item)
				);
				return new Response('OK');
			}

			if (path === '/mileage/delete') {
				const { id } = await parseBody<{ id: string }>();
				this.state.storage.sql.exec('DELETE FROM mileage WHERE id = ?', id);
				return new Response('OK');
			}

			if (path === '/mileage/migrate') {
				const items = await parseBody<MileageRecord[]>();
				this.state.storage.sql.exec('BEGIN TRANSACTION');
				try {
					for (const item of items) {
						this.state.storage.sql.exec(
							'INSERT OR REPLACE INTO mileage (id, userId, date, createdAt, data) VALUES (?, ?, ?, ?, ?)',
							item.id,
							item.userId,
							item.date || '',
							item.createdAt || '',
							JSON.stringify(item)
						);
					}
					this.state.storage.sql.exec('COMMIT');
				} catch (err) {
					this.state.storage.sql.exec('ROLLBACK');
					throw err;
				}
				return new Response('OK');
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
