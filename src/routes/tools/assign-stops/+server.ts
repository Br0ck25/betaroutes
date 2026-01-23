import type { RequestHandler } from './$types';
import { geocode } from '$lib/server/geocode';
import { log } from '$lib/server/log';

function haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
	const R = 3958.8; // miles
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

// Estimate road miles by adding a small multiplier to haversine distance
const ROAD_FACTOR = 1.25; // conservative multiplier
const EST_SPEED_MPH = 35; // for drive time estimate

// Helper: Distance Matrix caching keys (per origin/destination pair)
function dmKey(o: { lat: number; lon: number }, d: { lat: number; lon: number }) {
	return `dm:${Number(o.lat).toFixed(5)},${Number(o.lon).toFixed(5)}:${Number(d.lat).toFixed(5)},${Number(d.lon).toFixed(5)}`;
}

// Get pairwise distances (meters) and durations (seconds) between an array of origins and destinations
// Uses KV cache (BETA_PLACES_KV) -> Google Distance Matrix -> caches individual pair results
async function getDistanceMatrix(
	origins: Array<{ lat: number; lon: number }>,
	destinations: Array<{ lat: number; lon: number }>,
	apiKey?: string,
	kv?: any
): Promise<number[][]> {
	// Build cache lookups
	const out: number[][] = Array.from({ length: origins.length }, () =>
		Array(destinations.length).fill(NaN)
	);
	const missingPairs: { oIdx: number; dIdx: number }[] = [];

	for (let i = 0; i < origins.length; i++) {
		for (let j = 0; j < destinations.length; j++) {
			const dest = destinations[j]!;
			const key = dmKey(origins[i]!, dest);
			try {
				if (kv) {
					const raw = await kv.get(key);
					if (raw) {
						let cached: any = null;
						try {
							cached = JSON.parse(String(raw));
						} catch (e) {
							log.warn('[DM CACHE] Invalid JSON in cache', { key, err: (e as Error).message });
							cached = null;
						}
						if (cached) {
							const row = out[i]!;
							row[j] = Number(cached.distanceMeters ?? NaN) || NaN;
							continue;
						}
					}
				}
			} catch (e) {
				log.warn('[DM CACHE] KV read failed for pair', {
					origin: `${origins[i]!.lat},${origins[i]!.lon}`,
					dest: `${destinations[j]!.lat},${destinations[j]!.lon}`,
					err: (e as Error).message
				});
			}
			missingPairs.push({ oIdx: i, dIdx: j });
		}
	}

	if (missingPairs.length === 0) return out; // all cached

	// If no API key, return what's available (may contain NaN)
	if (!apiKey) return out;

	// Prepare origin/destination strings for Distance Matrix request
	const originsStr = origins.map((o) => `${o.lat},${o.lon}`).join('|');
	const destinationsStr = destinations.map((d) => `${d.lat},${d.lon}`).join('|');

	try {
		const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(originsStr)}&destinations=${encodeURIComponent(destinationsStr)}&key=${apiKey}&mode=driving&units=metric`;
		const res = await fetch(url);
		const data: any = await res.json();
		if (data && data.status === 'OK' && Array.isArray(data.rows)) {
			for (let i = 0; i < data.rows.length; i++) {
				const elements = (data.rows[i] && data.rows[i].elements) || [];
				for (let j = 0; j < elements.length; j++) {
					const elem = elements[j];
					if (elem && elem.status === 'OK') {
						const distanceMeters = Number((elem.distance && elem.distance.value) ?? 0);
						const durationSeconds = Number((elem.duration && elem.duration.value) ?? 0);
						const row = out[i]!;
						row[j] = distanceMeters;

						// Cache individual pair
						try {
							if (kv) {
								const key = dmKey(origins[i]!, destinations[j]!);
								await kv.put(
									key,
									JSON.stringify({
										distanceMeters,
										durationSeconds,
										cachedAt: new Date().toISOString()
									})
								);
							}
						} catch (e) {
							log.warn('[DM CACHE] write failed', { err: (e as Error).message });
						}
					}
				}
			}
		}
	} catch (e) {
		log.warn('[DM] request failed', { err: (e as Error).message });
	}

	return out;
}

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	// Enforce authentication
	if (!locals.user) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
	}

	const body = (await request.json().catch(() => null)) as { techs?: any[]; stops?: any[] } | null;
	if (!body || !Array.isArray(body.techs) || !Array.isArray(body.stops)) {
		return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 });
	}

	// SECURITY: Limit array sizes to prevent DoS/complexity attacks
	const MAX_TECHS = 20;
	const MAX_STOPS = 100;

	if (body.techs.length > MAX_TECHS) {
		return new Response(JSON.stringify({ error: `Maximum ${MAX_TECHS} technicians allowed` }), {
			status: 400
		});
	}
	if (body.stops.length > MAX_STOPS) {
		return new Response(JSON.stringify({ error: `Maximum ${MAX_STOPS} stops allowed` }), {
			status: 400
		});
	}

	const rawTechs = body.techs || [];
	const rawStops = body.stops || [];

	// Geocode all addresses server-side (use PRIVATE_GOOGLE_MAPS_API_KEY if present)
	const apiKey = (platform?.env as any)?.PRIVATE_GOOGLE_MAPS_API_KEY || undefined;

	// Helper to geocode and return point. Accepts either a string address or a pre-resolved loc object
	async function geocodeAddress(
		input: string | { lat: number; lon: number; address?: string } | undefined
	) {
		if (!input) return null;
		// If client provided geometry, trust it (do not persist from here — client selections are cached by /api/autocomplete)
		if (
			typeof input === 'object' &&
			typeof input.lat === 'number' &&
			typeof input.lon === 'number'
		) {
			return { lat: Number(input.lat), lon: Number(input.lon), address: input.address };
		}

		// otherwise, resolve via server-side geocode
		const g = await geocode(String(input), apiKey);
		if (!g) return null;
		return { lat: g.lat, lon: g.lon, address: g.formattedAddress || String(input) };
	}

	// Geocode tech starts/ends and stops
	const techs = [] as any[];
	for (const t of rawTechs) {
		if (!t.name || !(t.start || t.startLoc))
			return new Response(JSON.stringify({ error: 'Techs must have name and start' }), {
				status: 400
			});

		const startLoc = await geocodeAddress(t.startLoc ?? t.start);
		if (!startLoc)
			return new Response(
				JSON.stringify({
					error: `Cannot geocode tech start: ${t.start || JSON.stringify(t.startLoc)}`
				}),
				{
					status: 400
				}
			);

		const endInput = t.endLoc ?? t.end ?? t.start;
		const endLoc = await geocodeAddress(endInput);
		if (!endLoc)
			return new Response(
				JSON.stringify({ error: `Cannot geocode tech end: ${t.end || JSON.stringify(t.endLoc)}` }),
				{
					status: 400
				}
			);

		techs.push({ ...t, startLoc, endLoc });
	}

	const stops = [] as any[];
	for (const s of rawStops) {
		if (!(s.address || s.loc))
			return new Response(JSON.stringify({ error: 'Stops must have address or loc' }), {
				status: 400
			});
		const loc = await geocodeAddress(s.loc ?? s.address);
		if (!loc)
			return new Response(
				JSON.stringify({ error: `Cannot geocode stop: ${s.address || JSON.stringify(s.loc)}` }),
				{
					status: 400
				}
			);
		stops.push({ ...s, loc });
	}

	const T = techs.length;
	if (T === 0)
		return new Response(JSON.stringify({ error: 'At least one tech required' }), { status: 400 });

	// Validate rank constraints: for each rank, count stops
	const rankMap = new Map<number, any[]>();
	for (const s of stops) {
		if (s.rank != null) {
			const r = Number(s.rank);
			if (!rankMap.has(r)) rankMap.set(r, []);
			rankMap.get(r)!.push(s);
		}
	}

	for (const r of Array.from(rankMap.keys())) {
		const arr = rankMap.get(r)!;
		if (arr.length > T) {
			return new Response(
				JSON.stringify({
					error: `Too many stops marked rank ${r} (${arr.length}) for ${T} tech(s)`
				}),
				{ status: 400 }
			);
		}
	}

	// Preassign rank-marked stops: ensure each equally maps to distinct techs per rank
	// For each rank, assign each stop to the nearest available tech (based on Distance Matrix or haversine) and mark them taken for that rank
	const assignments = techs.map((t) => ({ tech: t, stops: [] as any[] }));

	// Use Distance Matrix to decide nearest techs where possible
	const placesKV = (platform?.env as any)?.BETA_PLACES_KV as any | undefined;
	const dmApiKey = (platform?.env as any)?.PRIVATE_GOOGLE_MAPS_API_KEY || undefined;

	const techOrigins = techs.map((t) => ({ lat: t.startLoc!.lat, lon: t.startLoc!.lon }));
	const stopDests = stops.map((s) => ({ lat: s.loc!.lat, lon: s.loc!.lon }));
	const dm = await getDistanceMatrix(techOrigins, stopDests, dmApiKey, placesKV);

	for (const pair of rankMap.entries()) {
		const arr = pair[1] as any[];
		// copy of tech indices that can accept this rank
		const available = new Set(techs.map((_, i) => i));
		// sort stops by nearest tech distance to make greedy assignment deterministic
		arr.sort((a: any, b: any) => {
			const aIdx = stops.indexOf(a);
			const bIdx = stops.indexOf(b);
			const aMin = Math.min(
				...techs.map(
					(_, ti) => Number(dm?.[ti]?.[aIdx] ?? NaN) || haversineMiles(techs[ti].startLoc, a.loc)
				)
			);
			const bMin = Math.min(
				...techs.map(
					(_, ti) => Number(dm?.[ti]?.[bIdx] ?? NaN) || haversineMiles(techs[ti].startLoc, b.loc)
				)
			);
			return aMin - bMin;
		});

		for (const s of arr) {
			// find nearest available tech
			let bestIdx = -1;
			let bestDist = Infinity;
			const sIdx = stops.indexOf(s);
			for (const i of available) {
				const d = Number(dm?.[i]?.[sIdx] ?? NaN) || haversineMiles(techs[i].startLoc, s.loc);
				if (d < bestDist) {
					bestDist = d;
					bestIdx = i;
				}
			}
			if (bestIdx === -1) {
				// should not happen due to earlier check
				return new Response(
					JSON.stringify({ error: 'Assignment failed due to rank constraints' }),
					{ status: 400 }
				);
			}
			assignments[bestIdx]!.stops.push(s);
			available.delete(bestIdx);
		}
	}

	// Remaining stops (unranked) - assign to balance counts and minimize distance
	const unassigned = stops.filter((s) => s.rank == null);

	// target sizes: distribute total stops evenly across techs
	const totalStops = stops.length;
	const base = Math.floor(totalStops / T);
	const extra = totalStops % T; // first `extra` techs get +1
	const target = assignments.map((_, idx) => base + (idx < extra ? 1 : 0));

	// Reduce target by already preassigned counts
	for (let i = 0; i < assignments.length; i++) {
		const pre = assignments[i]!.stops.length;
		target[i] = Math.max(0, (target[i] ?? 0) - pre);
	}

	// Prepare DM rows for tech starts -> unassigned stops
	const unassignedIdxs = unassigned.map((s) => stops.indexOf(s)).filter((i) => i >= 0);
	const unassignedDests = unassignedIdxs
		.map((i) => stopDests[i])
		.filter((p): p is { lat: number; lon: number } => !!p);
	const dmForUnassigned =
		unassignedDests.length > 0
			? await getDistanceMatrix(techOrigins, unassignedDests, dmApiKey, placesKV)
			: Array.from({ length: techOrigins.length }, () => []);

	// For each unassigned stop, assign to nearest tech with remaining capacity using DM when available
	for (let u = 0; u < unassigned.length; u++) {
		const s = unassigned[u];
		let bestIdx = -1;
		let bestCost = Infinity;
		for (let i = 0; i < techs.length; i++) {
			if ((target[i] ?? 0) <= 0) continue;
			const d =
				Number(dmForUnassigned?.[i]?.[u] ?? NaN) || haversineMiles(techs[i].startLoc, s.loc);
			if (d < bestCost) {
				bestCost = d;
				bestIdx = i;
			}
		}
		// If no one left with capacity, assign to the tech with minimal distance irrespective of capacity
		if (bestIdx === -1) {
			let bestIdx2 = 0;
			let bestInc = Infinity;
			for (let i = 0; i < techs.length; i++) {
				const d =
					Number(dmForUnassigned?.[i]?.[u] ?? NaN) || haversineMiles(techs[i].startLoc, s.loc);
				if (d < bestInc) {
					bestInc = d;
					bestIdx2 = i;
				}
			}
			bestIdx = bestIdx2;
		} else {
			if (typeof target[bestIdx] === 'number') target[bestIdx]!--;
		}
		assignments[bestIdx]!.stops.push(s);
	}

	// For each tech, order stops with nearest-neighbor heuristic starting from tech.startLoc and ending at tech.endLoc
	const totals = { miles: 0, minutes: 0 };
	const withEstimates = await Promise.all(
		assignments.map(async (a) => {
			const seq = [] as any[];
			const remaining = a.stops.slice();
			let cursor = a.tech.startLoc;
			while (remaining.length > 0) {
				let bestI = 0;
				let bestD = Infinity;
				for (let i = 0; i < remaining.length; i++) {
					const d = haversineMiles(cursor, remaining[i].loc);
					if (d < bestD) {
						bestD = d;
						bestI = i;
					}
				}
				const picked = remaining.splice(bestI, 1)[0];
				seq.push(picked);
				cursor = picked.loc;
			}

			// compute miles and time for route: start -> each stop -> end
			let m = 0;
			let minutes = 0;

			// Build canonical route signature for caching
			const routePoints = [a.tech.startLoc, ...seq.map((s) => s.loc), a.tech.endLoc];
			const canonical = routePoints
				.map((p) => `${Number(p.lat).toFixed(5)},${Number(p.lon).toFixed(5)}`)
				.join(':');
			const cacheKey = `route:${canonical}`;
			const kv = (platform?.env as any)?.BETA_PLACES_KV as any | undefined;

			// Try KV cache first
			try {
				if (kv) {
					const cachedRaw = await kv.get(cacheKey);
					if (cachedRaw) {
						const cached = JSON.parse(cachedRaw);
						m = Number(cached.miles) || 0;
						minutes = Number(cached.minutes) || 0;
					}
				}
			} catch (e) {
				log.warn('[ROUTE CACHE] read failed', { key: cacheKey, err: (e as Error).message });
			}

			// If not cached, try Google Directions (server-side) and cache result
			if ((!m || !minutes) && apiKey) {
				try {
					const origin = `${routePoints[0].lat},${routePoints[0].lon}`;
					const destination = `${routePoints[routePoints.length - 1].lat},${routePoints[routePoints.length - 1].lon}`;
					const waypoints = routePoints
						.slice(1, -1)
						.map((p) => `${p.lat},${p.lon}`)
						.join('|');
					const wayParam = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : '';
					const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}${wayParam}&key=${apiKey}&mode=driving&units=imperial`;
					const dres = await fetch(url);
					const ddata: any = await dres.json();
					if (ddata && ddata.status === 'OK' && ddata.routes && ddata.routes[0]) {
						const legs = ddata.routes[0].legs || [];
						let totalMeters = 0;
						let totalSeconds = 0;
						for (const leg of legs) {
							totalMeters += (leg.distance && leg.distance.value) || 0;
							totalSeconds += (leg.duration && leg.duration.value) || 0;
						}
						m = totalMeters / 1609.344; // meters -> miles
						minutes = totalSeconds / 60;

						// Cache result for future
						try {
							if (kv) {
								await kv.put(
									cacheKey,
									JSON.stringify({
										miles: m,
										minutes,
										cachedAt: new Date().toISOString(),
										source: 'directions'
									})
								);
							}
						} catch (e) {
							log.warn('[ROUTE CACHE] write failed', { key: cacheKey, err: (e as Error).message });
						}
					}
				} catch (e) {
					log.warn('[DIRECTIONS] failed', { err: (e as Error).message });
				}
			}

			// Fallback to haversine estimate if Google not available or failed
			if (!m || !minutes) {
				let prev = a.tech.startLoc;
				for (const s of seq) {
					const leg = haversineMiles(prev, s.loc) * ROAD_FACTOR;
					m += leg;
					minutes += (leg / EST_SPEED_MPH) * 60;
					prev = s.loc;
				}
				m += haversineMiles(prev, a.tech.endLoc) * ROAD_FACTOR;
				minutes += ((haversineMiles(prev, a.tech.endLoc) * ROAD_FACTOR) / EST_SPEED_MPH) * 60;
			}

			totals.miles += m;
			totals.minutes += minutes;

			return {
				tech: { name: a.tech.name, startLoc: a.tech.startLoc, endLoc: a.tech.endLoc },
				stops: seq.map((s) => ({ address: s.address, rank: s.rank, loc: s.loc })),
				miles: m,
				minutes: minutes
			};
		})
	);

	return new Response(JSON.stringify({ assignments: withEstimates, totals }), { status: 200 });
};
