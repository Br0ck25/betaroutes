// src/lib/server/hughesnet/router.ts
import type { KVNamespace } from '@cloudflare/workers-types';
import type { GeocodedPoint, RouteLeg } from './types';
import type { HughesNetFetcher } from './fetcher';
import { log } from '$lib/server/log';
import { geocode } from '$lib/server/geocode';

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

		// 2. Google geocoding (Photon removed). Use the shared geocode helper which returns a GeocodedPoint-like object.
		try {
			const pt = await geocode(rawAddress, this.googleApiKey);
			if (pt) {
				const point: GeocodedPoint = {
					lat: pt.lat,
					lon: pt.lon,
					formattedAddress: pt.formattedAddress
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
		} catch (e) {
			log.warn('Google geocoding failed:', e);
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

		// 2. OSRM removed: rely on Google Directions API + KV cache for routing calculations.
		// If startPt and endPt exist we will use Google as a single source of truth.

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
