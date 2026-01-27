import { geocode } from '$lib/server/geocode';
import { log } from '$lib/server/log';
import type { RequestHandler } from './$types';

type Point = { lat: number; lon: number; address?: string };

type TechInput = {
	name: string;
	start?: string;
	end?: string;
	startLoc?: Point;
	endLoc?: Point;
};

type StopInput = {
	address?: string;
	loc?: Point;
	rank?: number | null;
};

type OptimizePayload = {
	techs: TechInput[];
	stops: StopInput[];
};

type Env = {
	PRIVATE_GOOGLE_MAPS_API_KEY?: string;
	BETA_PLACES_KV?: KVNamespace;
};

const MAX_TECHS = 20;
const MAX_STOPS = 100;
const MAX_NAME_LEN = 80;
const MAX_ADDRESS_LEN = 240;

const ROAD_FACTOR = 1.25;
const EST_SPEED_MPH = 35;

const DM_CACHE_TTL_SEC = 60 * 60 * 24 * 30;
const ROUTE_CACHE_TTL_SEC = 60 * 60 * 24 * 30;

const RL_WINDOW_SEC = 60;
const RL_MAX_PER_WINDOW = 8;
const RL_KEY_PREFIX = 'rl:optimize:v1';

function haversineMiles(a: Point, b: Point) {
	const R = 3958.8;
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLon = toRad(b.lon - a.lon);
	const lat1 = toRad(a.lat);
	const lat2 = toRad(b.lat);
	const sinDLat = Math.sin(dLat / 2);
	const sinDLon = Math.sin(dLon / 2);
	const c =
		2 *
		Math.asin(Math.sqrt(sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon));
	return R * c;
}

function milesToMeters(miles: number) {
	return miles * 1609.344;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null;
}

function clampString(input: unknown, maxLen: number): string | null {
	if (typeof input !== 'string') return null;
	const s = input.trim();
	if (!s) return null;
	return s.length > maxLen ? s.slice(0, maxLen) : s;
}

// ✅ No regex => no-control-regex safe
function sanitizeForDisplay(input: string): string {
	let out = '';
	for (let i = 0; i < input.length; i++) {
		const c = input.charCodeAt(i);
		// strip ASCII control chars 0x00-0x1F and DEL 0x7F
		if (c < 0x20 || c === 0x7f) continue;
		out += input[i]!;
	}
	return out.trim();
}

function parsePoint(input: unknown): Point | null {
	if (!isRecord(input)) return null;

	const lat = input['lat'];
	const lon = input['lon'];

	if (typeof lat !== 'number' || typeof lon !== 'number') return null;
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

	const addressRaw = input['address'];
	const address =
		typeof addressRaw === 'string'
			? sanitizeForDisplay(addressRaw.slice(0, MAX_ADDRESS_LEN))
			: undefined;

	return { lat, lon, ...(typeof address === 'string' ? { address } : {}) };
}

function requireUserId(user: unknown): string {
	if (!isRecord(user)) throw new Error('User ID missing');
	const id = user['id'];
	if (typeof id !== 'string' || !id.trim()) throw new Error('User ID missing');
	return id.trim();
}

function enforceSameOriginCsrf(request: Request): boolean {
	const url = new URL(request.url);
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) return false;

	const sfs = request.headers.get('sec-fetch-site');
	if (sfs && sfs !== 'same-origin' && sfs !== 'same-site') return false;

	return true;
}

async function sha256Hex(input: string): Promise<string> {
	try {
		const data = new TextEncoder().encode(input);
		const digest = await crypto.subtle.digest('SHA-256', data);
		return Array.from(new Uint8Array(digest))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	} catch {
		let h = 2166136261;
		for (let i = 0; i < input.length; i++) {
			h ^= input.charCodeAt(i);
			h = Math.imul(h, 16777619);
		}
		return (h >>> 0).toString(16).padStart(8, '0');
	}
}

function round5(n: number): string {
	return Number(n).toFixed(5);
}

async function dmKey(userId: string, o: Point, d: Point): Promise<string> {
	const raw = `${round5(o.lat)},${round5(o.lon)}:${round5(d.lat)},${round5(d.lon)}`;
	const h = await sha256Hex(raw);
	return `dm:${userId}:${h}`;
}

async function routeKey(userId: string, points: Point[]): Promise<string> {
	const raw = points.map((p) => `${round5(p.lat)},${round5(p.lon)}`).join(':');
	const h = await sha256Hex(raw);
	return `route:${userId}:${h}`;
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: ctrl.signal });
		if (!res.ok) return null;
		return (await res.json()) as unknown;
	} catch {
		return null;
	} finally {
		clearTimeout(t);
	}
}

async function enforceRateLimit(kv: KVNamespace, userId: string): Promise<boolean> {
	const now = Date.now();
	const windowId = Math.floor(now / (RL_WINDOW_SEC * 1000));
	const key = `${RL_KEY_PREFIX}:${userId}:${windowId}`;

	let count = 0;

	try {
		const raw = await kv.get(key);
		if (raw) {
			const parsed = JSON.parse(raw) as unknown;
			if (isRecord(parsed)) {
				const c = parsed['count'];
				if (typeof c === 'number' && Number.isFinite(c)) count = c;
			}
		}
	} catch (e) {
		log.warn('[RL] read failed', { err: (e as Error).message });
		return false; // fail secure (your mandate)
	}

	count += 1;

	try {
		await kv.put(key, JSON.stringify({ count }), { expirationTtl: RL_WINDOW_SEC * 2 });
	} catch (e) {
		log.warn('[RL] write failed', { err: (e as Error).message });
		return false;
	}

	return count <= RL_MAX_PER_WINDOW;
}

async function getDistanceMatrix(
	userId: string,
	origins: Point[],
	destinations: Point[],
	apiKey: string | undefined,
	kv: KVNamespace | undefined
): Promise<{ distances: number[][]; durations: number[][] }> {
	const distances: number[][] = Array.from({ length: origins.length }, () =>
		Array(destinations.length).fill(NaN)
	);
	const durations: number[][] = Array.from({ length: origins.length }, () =>
		Array(destinations.length).fill(NaN)
	);

	const totalPairs = origins.length * destinations.length;
	const allowPairCaching = Boolean(kv) && totalPairs <= 400;

	if (allowPairCaching && kv) {
		for (let i = 0; i < origins.length; i++) {
			for (let j = 0; j < destinations.length; j++) {
				try {
					const key = await dmKey(userId, origins[i]!, destinations[j]!);
					const raw = await kv.get(key);
					if (!raw) continue;

					const parsed = JSON.parse(raw) as unknown;
					if (!isRecord(parsed)) continue;

					const dm = parsed['distanceMeters'];
					const du = parsed['durationSeconds'];

					distances[i]![j] = typeof dm === 'number' && Number.isFinite(dm) ? dm : NaN;
					durations[i]![j] = typeof du === 'number' && Number.isFinite(du) ? du : NaN;
				} catch (e) {
					log.warn('[DM CACHE] read failed', { err: (e as Error).message });
				}
			}
		}
	}

	if (!apiKey) return { distances, durations };

	const MAX_DESTS_PER_REQ = 25;

	for (let offset = 0; offset < destinations.length; offset += MAX_DESTS_PER_REQ) {
		const chunk = destinations.slice(offset, offset + MAX_DESTS_PER_REQ);
		const originsStr = origins.map((o) => `${o.lat},${o.lon}`).join('|');
		const destinationsStr = chunk.map((d) => `${d.lat},${d.lon}`).join('|');

		const url =
			`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(originsStr)}` +
			`&destinations=${encodeURIComponent(destinationsStr)}` +
			`&key=${apiKey}&mode=driving&units=metric`;

		const data = await fetchJsonWithTimeout(url, 10_000);

		if (!isRecord(data)) continue;
		if (data['status'] !== 'OK') continue;

		const rows = data['rows'];
		if (!Array.isArray(rows)) continue;

		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			if (!isRecord(row)) continue;
			const elements = row['elements'];
			if (!Array.isArray(elements)) continue;

			for (let j = 0; j < elements.length; j++) {
				const elem = elements[j];
				if (!isRecord(elem)) continue;
				if (elem['status'] !== 'OK') continue;

				const distObj = elem['distance'];
				const durObj = elem['duration'];

				const distanceMeters =
					isRecord(distObj) && typeof distObj['value'] === 'number'
						? (distObj['value'] as number)
						: NaN;
				const durationSeconds =
					isRecord(durObj) && typeof durObj['value'] === 'number'
						? (durObj['value'] as number)
						: NaN;

				const globalJ = offset + j;
				if (globalJ >= destinations.length) continue;

				distances[i]![globalJ] = Number.isFinite(distanceMeters) ? distanceMeters : NaN;
				durations[i]![globalJ] = Number.isFinite(durationSeconds) ? durationSeconds : NaN;

				if (
					allowPairCaching &&
					kv &&
					Number.isFinite(distanceMeters) &&
					Number.isFinite(durationSeconds)
				) {
					try {
						const key = await dmKey(userId, origins[i]!, destinations[globalJ]!);
						await kv.put(
							key,
							JSON.stringify({
								distanceMeters,
								durationSeconds,
								cachedAt: new Date().toISOString()
							}),
							{ expirationTtl: DM_CACHE_TTL_SEC }
						);
					} catch (e) {
						log.warn('[DM CACHE] write failed', { err: (e as Error).message });
					}
				}
			}
		}
	}

	return { distances, durations };
}

// Top-level helper: geocodeAddress
// Validates an input string or Point and returns a normalized Point or null
async function geocodeAddress(
	input: string | Point | undefined,
	apiKey?: string
): Promise<Point | null> {
	if (!input) return null;

	if (typeof input === 'object') {
		const p = parsePoint(input);
		return p ? p : null;
	}

	const addr = clampString(input, MAX_ADDRESS_LEN);
	if (!addr) return null;

	const g = await geocode(addr, apiKey);
	if (!g) return null;

	return {
		lat: Number(g.lat),
		lon: Number(g.lon),
		address: sanitizeForDisplay((g.formattedAddress || addr).slice(0, MAX_ADDRESS_LEN))
	};
}

function distanceMetersFor(
	dmDistances: number[][],
	techs: Array<{ name: string; startLoc: Point; endLoc: Point }>,
	stops: Array<{ address?: string; rank: number | null; loc: Point }>,
	techIdx: number,
	stopIdx: number
): number {
	const dm = dmDistances?.[techIdx]?.[stopIdx];
	if (typeof dm === 'number' && Number.isFinite(dm)) return dm;
	return milesToMeters(haversineMiles(techs[techIdx]!.startLoc, stops[stopIdx]!.loc));
}

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	try {
		if (!locals.user) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
		}
		const userId = requireUserId(locals.user);

		if (!enforceSameOriginCsrf(request)) {
			return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
		}

		const env = (platform?.env ?? {}) as Env;
		const placesKV = env.BETA_PLACES_KV;

		if (!placesKV) {
			log.error('[OPTIMIZE] missing BETA_PLACES_KV');
			return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500 });
		}

		const allowed = await enforceRateLimit(placesKV, userId);
		if (!allowed)
			return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 });

		const bodyRaw = (await request.json().catch(() => null)) as unknown;
		if (!isRecord(bodyRaw))
			return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 });

		const techsRaw = bodyRaw['techs'];
		const stopsRaw = bodyRaw['stops'];
		if (!Array.isArray(techsRaw) || !Array.isArray(stopsRaw)) {
			return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 });
		}

		if (techsRaw.length > MAX_TECHS) {
			return new Response(JSON.stringify({ error: `Maximum ${MAX_TECHS} technicians allowed` }), {
				status: 400
			});
		}
		if (stopsRaw.length > MAX_STOPS) {
			return new Response(JSON.stringify({ error: `Maximum ${MAX_STOPS} stops allowed` }), {
				status: 400
			});
		}

		const payload: OptimizePayload = {
			techs: techsRaw.map((t): TechInput => {
				if (!isRecord(t)) return { name: '' };

				const name = clampString(t['name'], MAX_NAME_LEN) ?? '';
				const start = clampString(t['start'], MAX_ADDRESS_LEN) ?? undefined;
				const end = clampString(t['end'], MAX_ADDRESS_LEN) ?? undefined;
				const startLoc = parsePoint(t['startLoc']);
				const endLoc = parsePoint(t['endLoc']);

				return {
					name,
					...(typeof start === 'string' ? { start } : {}),
					...(typeof end === 'string' ? { end } : {}),
					...(startLoc ? { startLoc } : {}),
					...(endLoc ? { endLoc } : {})
				};
			}),
			stops: stopsRaw.map((s): StopInput => {
				if (!isRecord(s)) return {};

				const address = clampString(s['address'], MAX_ADDRESS_LEN) ?? undefined;
				const loc = parsePoint(s['loc']);
				const rankRaw = s['rank'];

				const rank =
					rankRaw == null
						? null
						: typeof rankRaw === 'number' && Number.isFinite(rankRaw)
							? Math.trunc(rankRaw)
							: null;

				const sObj: { rank: number | null; loc: Point; address?: string } = {
					loc: loc as Point,
					rank
				};
				if (typeof address === 'string')
					sObj.address = sanitizeForDisplay(address.slice(0, MAX_ADDRESS_LEN));
				return sObj;
			})
		};

		if (payload.techs.length === 0) {
			return new Response(JSON.stringify({ error: 'At least one tech required' }), { status: 400 });
		}

		const apiKey = env.PRIVATE_GOOGLE_MAPS_API_KEY; // API key for server-side geocoding

		const techs: Array<{ name: string; startLoc: Point; endLoc: Point }> = [];
		for (let idx = 0; idx < payload.techs.length; idx++) {
			const t = payload.techs[idx]!;
			if (!t.name)
				return new Response(JSON.stringify({ error: 'Techs must have name and start' }), {
					status: 400
				});

			const startLoc = await geocodeAddress(t.startLoc ?? t.start);
			if (!startLoc) {
				log.warn('[GEOCODE] tech start failed', { idx });
				return new Response(JSON.stringify({ error: 'Cannot geocode technician start' }), {
					status: 400
				});
			}

			const endLoc = await geocodeAddress(t.endLoc ?? t.end ?? t.startLoc ?? t.start);
			if (!endLoc) {
				log.warn('[GEOCODE] tech end failed', { idx });
				return new Response(JSON.stringify({ error: 'Cannot geocode technician end' }), {
					status: 400
				});
			}

			techs.push({ name: t.name, startLoc, endLoc });
		}

		const stops: Array<{ address?: string; rank: number | null; loc: Point }> = [];
		for (let idx = 0; idx < payload.stops.length; idx++) {
			const s = payload.stops[idx]!;
			const loc = await geocodeAddress(s.loc ?? s.address);
			if (!loc) {
				log.warn('[GEOCODE] stop failed', { idx });
				return new Response(JSON.stringify({ error: 'Cannot geocode stop' }), { status: 400 });
			}

			const rank = s.rank == null ? null : Math.trunc(s.rank);
			const pushObj: { loc: Point; rank: number | null; address?: string } = {
				loc,
				rank: rank != null && Number.isFinite(rank) ? rank : null
			};
			if (typeof s.address === 'string')
				pushObj.address = sanitizeForDisplay(s.address.slice(0, MAX_ADDRESS_LEN));
			stops.push(pushObj);
		}

		const T = techs.length;

		const rankMap = new Map<number, number[]>();
		for (let i = 0; i < stops.length; i++) {
			const r = stops[i]!.rank;
			if (r == null) continue;
			if (!rankMap.has(r)) rankMap.set(r, []);
			rankMap.get(r)!.push(i);
		}

		for (const [r, idxs] of rankMap.entries()) {
			if (idxs.length > T) {
				return new Response(
					JSON.stringify({
						error: `Too many stops marked rank ${r} (${idxs.length}) for ${T} tech(s)`
					}),
					{ status: 400 }
				);
			}
		}

		const techOrigins: Point[] = techs.map((t) => ({ lat: t.startLoc.lat, lon: t.startLoc.lon }));
		const stopDests: Point[] = stops.map((s) => ({ lat: s.loc.lat, lon: s.loc.lon }));

		const dmRes = await getDistanceMatrix(userId, techOrigins, stopDests, apiKey, placesKV);
		const dmDistances = dmRes.distances;

		// Use top-level distanceMetersFor(dmDistances, techs, stops, techIdx, stopIdx)

		const assignments: Array<{
			tech: { name: string; startLoc: Point; endLoc: Point };
			stops: number[];
		}> = techs.map((t) => ({
			tech: { name: t.name, startLoc: t.startLoc, endLoc: t.endLoc },
			stops: []
		}));

		for (const [, idxs] of rankMap.entries()) {
			const available = new Set<number>(techs.map((_, i) => i));
			const sortedStopIdxs = idxs.slice().sort((aIdx, bIdx) => {
				const aMin = Math.min(
					...techs.map((_, ti) => distanceMetersFor(dmDistances, techs, stops, ti, aIdx))
				);
				const bMin = Math.min(
					...techs.map((_, ti) => distanceMetersFor(dmDistances, techs, stops, ti, bIdx))
				);
				return aMin - bMin;
			});

			for (const sIdx of sortedStopIdxs) {
				let bestIdx = -1;
				let bestDist = Infinity;

				for (const ti of available) {
					const d = distanceMetersFor(dmDistances, techs, stops, ti, sIdx);
					if (d < bestDist) {
						bestDist = d;
						bestIdx = ti;
					}
				}

				if (bestIdx === -1) {
					return new Response(
						JSON.stringify({ error: 'Assignment failed due to rank constraints' }),
						{ status: 400 }
					);
				}

				assignments[bestIdx]!.stops.push(sIdx);
				available.delete(bestIdx);
			}
		}

		const rankedStopSet = new Set<number>();
		for (const idxs of rankMap.values()) for (const i of idxs) rankedStopSet.add(i);
		const unassignedIdxs = stops.map((_, i) => i).filter((i) => !rankedStopSet.has(i));

		const totalStops = stops.length;
		const base = Math.floor(totalStops / T);
		const extra = totalStops % T;

		const target = assignments.map((a, idx) => {
			const wanted = base + (idx < extra ? 1 : 0);
			return Math.max(0, wanted - a.stops.length);
		});

		for (const stopIdx of unassignedIdxs) {
			let bestTech = -1;
			let bestCost = Infinity;

			for (let ti = 0; ti < techs.length; ti++) {
				if (target[ti]! <= 0) continue;
				const d = distanceMetersFor(dmDistances, techs, stops, ti, stopIdx);
				if (d < bestCost) {
					bestCost = d;
					bestTech = ti;
				}
			}

			if (bestTech === -1) {
				bestTech = 0;
				bestCost = distanceMetersFor(dmDistances, techs, stops, 0, stopIdx);
				for (let ti = 1; ti < techs.length; ti++) {
					const d = distanceMetersFor(dmDistances, techs, stops, ti, stopIdx);
					if (d < bestCost) {
						bestCost = d;
						bestTech = ti;
					}
				}
			} else {
				target[bestTech] = Math.max(0, target[bestTech]! - 1);
			}

			assignments[bestTech]!.stops.push(stopIdx);
		}

		const totals = { miles: 0, minutes: 0 };

		const withEstimates = await Promise.all(
			assignments.map(async (a) => {
				const remaining = a.stops.slice();
				const seqIdxs: number[] = [];

				let cursor: Point = a.tech.startLoc;

				while (remaining.length > 0) {
					let bestI = 0;
					let bestD = Infinity;

					for (let i = 0; i < remaining.length; i++) {
						const sIdx = remaining[i]!;
						const d = haversineMiles(cursor, stops[sIdx]!.loc);
						if (d < bestD) {
							bestD = d;
							bestI = i;
						}
					}

					const picked = remaining.splice(bestI, 1)[0]!;
					seqIdxs.push(picked);
					cursor = stops[picked]!.loc;
				}

				let miles = 0;
				let minutes = 0;

				const routePoints: Point[] = [
					a.tech.startLoc,
					...seqIdxs.map((i) => stops[i]!.loc),
					a.tech.endLoc
				];
				const rk = await routeKey(userId, routePoints);

				try {
					const cachedRaw = await placesKV.get(rk);
					if (cachedRaw) {
						const parsed = JSON.parse(cachedRaw) as unknown;
						if (isRecord(parsed)) {
							const cm = parsed['miles'];
							const cmin = parsed['minutes'];
							if (
								typeof cm === 'number' &&
								typeof cmin === 'number' &&
								Number.isFinite(cm) &&
								Number.isFinite(cmin)
							) {
								miles = cm;
								minutes = cmin;
							}
						}
					}
				} catch (e) {
					log.warn('[ROUTE CACHE] read failed', { err: (e as Error).message });
				}

				if ((!miles || !minutes) && apiKey) {
					const origin = `${routePoints[0]!.lat},${routePoints[0]!.lon}`;
					const destination = `${routePoints[routePoints.length - 1]!.lat},${routePoints[routePoints.length - 1]!.lon}`;

					const waypointPoints = routePoints.slice(1, -1);
					const MAX_WAYPOINTS = 20;

					if (waypointPoints.length <= MAX_WAYPOINTS) {
						const waypoints = waypointPoints.map((p) => `${p.lat},${p.lon}`).join('|');
						const wayParam = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : '';

						const url =
							`https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}` +
							`&destination=${encodeURIComponent(destination)}${wayParam}` +
							`&key=${apiKey}&mode=driving&units=imperial`;

						const ddata = await fetchJsonWithTimeout(url, 12_000);

						if (isRecord(ddata) && ddata['status'] === 'OK') {
							const routes = ddata['routes'];
							if (Array.isArray(routes) && routes[0] && isRecord(routes[0])) {
								const legs = routes[0]['legs'];
								if (Array.isArray(legs)) {
									let totalMeters = 0;
									let totalSeconds = 0;

									for (const leg of legs) {
										if (!isRecord(leg)) continue;
										const dist = leg['distance'];
										const dur = leg['duration'];

										if (isRecord(dist) && typeof dist['value'] === 'number')
											totalMeters += dist['value'] as number;
										if (isRecord(dur) && typeof dur['value'] === 'number')
											totalSeconds += dur['value'] as number;
									}

									miles = totalMeters / 1609.344;
									minutes = totalSeconds / 60;

									try {
										await placesKV.put(
											rk,
											JSON.stringify({
												miles,
												minutes,
												cachedAt: new Date().toISOString(),
												source: 'directions'
											}),
											{ expirationTtl: ROUTE_CACHE_TTL_SEC }
										);
									} catch (e) {
										log.warn('[ROUTE CACHE] write failed', { err: (e as Error).message });
									}
								}
							}
						}
					}
				}

				if (!miles || !minutes) {
					let prev = a.tech.startLoc;

					for (const sIdx of seqIdxs) {
						const leg = haversineMiles(prev, stops[sIdx]!.loc) * ROAD_FACTOR;
						miles += leg;
						minutes += (leg / EST_SPEED_MPH) * 60;
						prev = stops[sIdx]!.loc;
					}

					const lastLeg = haversineMiles(prev, a.tech.endLoc) * ROAD_FACTOR;
					miles += lastLeg;
					minutes += (lastLeg / EST_SPEED_MPH) * 60;
				}

				totals.miles += miles;
				totals.minutes += minutes;

				return {
					tech: a.tech,
					stops: seqIdxs.map((i) => ({
						address: stops[i]!.address ? sanitizeForDisplay(stops[i]!.address!) : undefined,
						rank: stops[i]!.rank,
						loc: stops[i]!.loc
					})),
					miles,
					minutes
				};
			})
		);

		return new Response(JSON.stringify({ assignments: withEstimates, totals }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	} catch (e) {
		log.error('[OPTIMIZE] failed', { err: (e as Error).message });
		return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
	}
};
