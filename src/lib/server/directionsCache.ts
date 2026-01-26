import { log } from '$lib/server/log';
import { safeKV } from '$lib/server/env';

export async function computeAndCacheDirections(
	env: App.Env,
	trip: { startAddress?: string; stops?: Array<{ address?: string }>; endAddress?: string }
) {
	try {
		const directionsKV = safeKV(env, 'BETA_DIRECTIONS_KV') as KVNamespace | undefined;
		const googleKey = String(
			(env as unknown as Record<string, unknown>)['PRIVATE_GOOGLE_MAPS_API_KEY'] || ''
		);

		if (!directionsKV) {
			log.warn('computeAndCacheDirections: BETA_DIRECTIONS_KV binding missing');
			return;
		}

		if (!googleKey) {
			log.warn('computeAndCacheDirections: GOOGLE API KEY missing');
			return;
		}

		const points: string[] = [];
		if (trip['startAddress']) points.push(String(trip['startAddress']));
		if (Array.isArray(trip['stops'])) {
			const stops = trip['stops'] as Array<{ address?: string }>;
			for (const s of stops) {
				if (s && s.address) points.push(String(s.address));
			}
		}
		if (trip['endAddress']) points.push(String(trip['endAddress']));

		for (let i = 0; i < points.length - 1; i++) {
			const origin = points[i];
			const destination = points[i + 1];
			if (!origin || !destination || origin === destination) continue;

			let key = `dir:${origin.toLowerCase().trim()}_to_${destination.toLowerCase().trim()}`;
			key = key.replace(/[^a-z0-9_:-]/g, '');
			if (key.length > 512) key = key.substring(0, 512);

			try {
				const cached = await directionsKV.get(key);
				if (cached) {
					try {
						const parsed = JSON.parse(cached);
						if (parsed && parsed.distance != null && parsed.duration != null) {
							// already cached
							continue;
						}
					} catch {
						// ignore
					}
				}

				const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(
					origin
				)}&destination=${encodeURIComponent(destination)}&key=${googleKey}`;
				const res = await fetch(url);
				type DirectionsLeg = {
					distance?: { value?: number };
					duration?: { value?: number };
					start_location?: { lat?: number; lng?: number };
					end_location?: { lat?: number; lng?: number };
					start_address?: string;
					end_address?: string;
				};
				type DirectionsResponse = {
					status?: string;
					routes?: Array<{ legs?: DirectionsLeg[] }>;
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

					if (distance !== null && duration !== null) {
						await directionsKV.put(key, JSON.stringify({ distance, duration, source: 'google' }));
						log.info(`[DirectCompute] Cached: ${key}`);

						// write geocode entries if available
						try {
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
								const existing = await directionsKV.get(geoKey);
								if (!existing) {
									await directionsKV.put(
										geoKey,
										JSON.stringify({
											lat: Number(loc.lat),
											lon: Number(loc.lng),
											formattedAddress: formatted || addr,
											source: 'compute_routes'
										})
									);
									log.info(`[DirectCompute] Geocode cached (directions KV): ${geoKey}`);
								}
							};

							await writeIfMissing(leg.start_address, leg.start_location, leg.start_address);
							await writeIfMissing(leg.end_address, leg.end_location, leg.end_address);
						} catch (e) {
							log.warn('[DirectCompute] Auto geocode write failed', e);
						}
					}
				}
			} catch (err) {
				log.warn(`[DirectCompute] Failed leg: ${err}`);
			}
		}
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		log.error('[DirectCompute] computeAndCacheDirections failed', { message: msg });
	}
}
