// src/lib/server/hughesnet/router.ts
import type { KVNamespace } from '@cloudflare/workers-types';
import type { GeocodedPoint, RouteLeg } from './types';
import type { HughesNetFetcher } from './fetcher';
import { log } from '$lib/server/log';

// Issue #9: Timeout constant for external API calls
const EXTERNAL_API_TIMEOUT_MS = 10000; // 10 seconds

export class HughesNetRouter {
	constructor(
		private kv: KVNamespace | undefined,
		private googleApiKey: string | undefined,
		private fetcher: HughesNetFetcher
	) {}

	// Issue #9: Helper to create timeout signal
	private createTimeoutSignal(timeoutMs: number): AbortSignal {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), timeoutMs);
		return controller.signal;
	}

	async resolveAddress(rawAddress: string): Promise<GeocodedPoint | null> {
		const cleanAddr = rawAddress.trim().toLowerCase();
		// Use consistent key format
		const kvKey = `geo:${cleanAddr.replace(/[^a-z0-9]/g, '_')}`;

		// 1. Check KV Cache
		if (this.kv) {
			try {
				const cached = await this.kv.get(kvKey);
				if (cached) return JSON.parse(cached);
			} catch (e) {
				log.warn('Failed to get cached geocode:', e);
			}
		}

		// 2. Try Photon (OpenStreetMap) - Replaces Nominatim
		try {
			const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(rawAddress)}&limit=1`;
			const res = await fetch(photonUrl, {
				headers: { 'User-Agent': 'BetaRoutes/1.0' },
				signal: this.createTimeoutSignal(EXTERNAL_API_TIMEOUT_MS)
			});

			if (res.ok) {
				const data = (await res.json()) as { features?: unknown };
				if (Array.isArray(data.features) && data.features.length > 0) {
					const f = data.features[0] as Record<string, unknown>;
					// Construct a formatted address from properties

					const props = ((f as any)['properties'] ?? {}) as Record<string, unknown>;
					const addressParts: string[] = [];
					['name', 'street', 'city', 'state', 'postcode', 'country'].forEach((k) => {
						const v = props[k];
						if (v && typeof v === 'string') addressParts.push(v);
					});

					// Photon returns [lon, lat]
					const geom = (f as Record<string, unknown>)['geometry'] as
						| Record<string, unknown>
						| undefined;
					const coords =
						geom && 'coordinates' in geom ? (geom['coordinates'] as unknown[]) : undefined;
					if (Array.isArray(coords) && coords.length >= 2) {
						const lat = Number(coords[1]);
						const lon = Number(coords[0]);
						const point: GeocodedPoint = {
							lat,
							lon,
							formattedAddress: addressParts.join(', ')
						};

						// Save to KV (Permanent Cache)
						if (this.kv) {
							try {
								await this.kv.put(kvKey, JSON.stringify(point));
							} catch (err) {
								log.warn('Failed to cache geocode:', err);
							}
						}
						return point;
					}
				}
			}
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') {
				log.warn('Photon geocoding timeout');
			} else {
				log.warn('Photon geocoding failed:', e);
			}
		}

		// 3. Try Google Fallback
		if (this.googleApiKey) {
			try {
				const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(rawAddress)}&key=${this.googleApiKey}`;
				const res = await fetch(googleUrl, {
					signal: this.createTimeoutSignal(EXTERNAL_API_TIMEOUT_MS)
				});
				const data = (await res.json()) as { results?: unknown[] };

				const first = data.results?.[0] as any;
				if (first && first.geometry && first.geometry.location) {
					const loc = first.geometry.location;
					const point: GeocodedPoint = {
						lat: Number(loc.lat),
						lon: Number(loc.lng),
						formattedAddress: first['formatted_address']
					};

					// Save to KV (Permanent Cache)
					if (this.kv) {
						try {
							await this.kv.put(kvKey, JSON.stringify(point));
						} catch (e) {
							log.warn('Failed to cache geocode:', e);
						}
					}
					return point;
				}
			} catch (e) {
				if (e instanceof Error && e.name === 'AbortError') {
					log.warn('Google geocoding timeout');
				} else {
					log.warn('Google geocoding failed:', e);
				}
			}
		}
		return null;
	}

	async getRouteInfo(origin: string, destination: string): Promise<RouteLeg | null> {
		const key = `dir:${origin.toLowerCase().trim()}_to_${destination.toLowerCase().trim()}`.replace(
			/[^a-z0-9_:-]/g,
			''
		);

		// 1. Check KV Cache
		if (this.kv) {
			try {
				const cached = await this.kv.get(key);
				if (cached) return JSON.parse(cached);
			} catch (e) {
				log.warn('Failed to get cached route:', e);
			}
		}

		// Resolve coordinates (checks KV -> Photon -> Google)
		const startPt = await this.resolveAddress(origin);
		const endPt = await this.resolveAddress(destination);

		// 2. Try OSRM
		if (startPt && endPt) {
			try {
				// OSRM expects: lon,lat;lon,lat
				const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${startPt.lon},${startPt.lat};${endPt.lon},${endPt.lat}?overview=false`;
				const res = await fetch(osrmUrl, {
					signal: this.createTimeoutSignal(EXTERNAL_API_TIMEOUT_MS)
				});

				if (res.ok) {
					const data: any = await res.json();
					if (data.routes?.[0]) {
						const result = {
							distance: data.routes[0].distance, // meters
							duration: data.routes[0].duration // seconds
						};

						// Save to KV (Permanent Cache)
						if (this.kv) {
							try {
								await this.kv.put(key, JSON.stringify(result));
							} catch (e) {
								log.warn('Failed to cache route:', e);
							}
						}
						return result;
					}
				}
			} catch (e) {
				if (e instanceof Error && e.name === 'AbortError') {
					log.warn('OSRM routing timeout');
				} else {
					log.warn('OSRM routing failed:', e);
				}
			}
		}

		// 3. Try Google Fallback
		if (this.googleApiKey) {
			try {
				const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${this.googleApiKey}`;
				const res = await this.fetcher.safeFetch(url, {
					headers: { Referer: 'https://gorouteyourself.com/' }
				});

				const data: any = await res.json();

				if (data.routes?.[0]?.legs?.[0]) {
					const result = {
						distance: data.routes[0].legs[0].distance.value,
						duration: data.routes[0].legs[0].duration.value
					};

					// Save to KV (Permanent Cache)
					if (this.kv) {
						try {
							await this.kv.put(key, JSON.stringify(result));
						} catch (e) {
							log.warn('Failed to cache route:', e);
						}
					}
					return result;
				}
			} catch (e: unknown) {
				const emsg =
					typeof e === 'object' && e !== null && 'message' in e
						? String((e as { message: unknown }).message)
						: String(e);
				if (emsg === 'REQ_LIMIT') throw e as Error;
				log.error('[Maps] Google API Error', e);
			}
		}
		return null;
	}
}
