// src/lib/server/hughesnet/router.ts
import type { GeocodedPoint, RouteLeg } from './types';
import type { HughesNetFetcher } from './fetcher';
import { log } from '$lib/server/log';
import { geocode } from '$lib/server/geocode';

function isRecord(obj: unknown): obj is Record<string, unknown> {
	return typeof obj === 'object' && obj !== null;
}

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

	/**
	 * Normalize address to handle common variations for cache lookups.
	 * Examples: "6131 highway 541" -> "6131 ky-541", "hwy 541" -> "ky-541"
	 */
	private normalizeAddressForCache(address: string): string {
		let normalized = address.trim().toLowerCase();

		// Handle highway variations - convert "highway 123" to "ky-123" format
		// Match: highway 541, hwy 541, us 60, route 80, etc.
		normalized = normalized
			.replace(/\bhighway\s+(\d+)/gi, 'ky-$1')
			.replace(/\bhwy\.?\s+(\d+)/gi, 'ky-$1')
			.replace(/\bus\s+(\d+)/gi, 'us-$1')
			.replace(/\broute\s+(\d+)/gi, 'ky-$1')
			.replace(/\brt\.?\s+(\d+)/gi, 'ky-$1');

		return normalized;
	}

	/**
	 * Generate multiple cache key variations for an address to check.
	 * This helps find cached results even when address format varies.
	 */
	private getCacheKeyVariations(rawAddress: string): string[] {
		const normalized = this.normalizeAddressForCache(rawAddress);
		const cleanKey = normalized.replace(/[^a-z0-9]/g, '_');

		// Also try the original format in case it was already cached
		const originalKey = rawAddress
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '_');

		const keys = [`geo:${cleanKey}`];
		if (originalKey !== cleanKey) {
			keys.push(`geo:${originalKey}`);
		}
		return keys;
	}

	async resolveAddress(rawAddress: string): Promise<GeocodedPoint | null> {
		const cacheKeys = this.getCacheKeyVariations(rawAddress);
		const primaryKey = cacheKeys[0]!; // Always defined - array has at least one element

		// 1. Check KV Cache with all key variations
		if (this.kv) {
			try {
				for (const kvKey of cacheKeys) {
					const cached = await this.kv.get(kvKey);
					if (cached) {
						let parsed: unknown;
						try {
							parsed = JSON.parse(cached);
						} catch {
							parsed = undefined;
						}

						if (
							isRecord(parsed) &&
							typeof parsed['lat'] === 'number' &&
							typeof parsed['lon'] === 'number'
						) {
							const point: GeocodedPoint = {
								lat: Number(parsed['lat']),
								lon: Number(parsed['lon']),
								formattedAddress:
									typeof parsed['formattedAddress'] === 'string'
										? (parsed['formattedAddress'] as string)
										: ''
							};

							// Cache hit - also store under primary key for future lookups
							if (kvKey !== primaryKey) {
								try {
									await this.kv.put(primaryKey, cached);
								} catch {
									// Ignore cache update errors
								}
							}
							return point;
						}
					}
				}
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
						// Store under primary normalized key
						await this.kv.put(primaryKey, JSON.stringify(point));
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

				const first = data.results?.[0];
				if (
					isRecord(first) &&
					isRecord((first as Record<string, unknown>)['geometry']) &&
					isRecord(
						((first as Record<string, unknown>)['geometry'] as Record<string, unknown>)['location']
					)
				) {
					const loc = ((first as Record<string, unknown>)['geometry'] as Record<string, unknown>)[
						'location'
					] as Record<string, unknown>;
					const lat = Number(loc['lat']);
					const lng = Number(loc['lng']);
					const formatted =
						typeof (first as Record<string, unknown>)['formatted_address'] === 'string'
							? String((first as Record<string, unknown>)['formatted_address'])
							: '';

					const point: GeocodedPoint = { lat, lon: lng, formattedAddress: formatted };

					// Save to KV (Permanent Cache)
					if (this.kv) {
						try {
							await this.kv.put(primaryKey, JSON.stringify(point));
						} catch (err) {
							log.warn('Failed to cache geocode:', err);
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
				if (cached) {
					let parsed: unknown;
					try {
						parsed = JSON.parse(cached);
					} catch {
						parsed = undefined;
					}
					if (
						isRecord(parsed) &&
						typeof parsed['distance'] === 'number' &&
						typeof parsed['duration'] === 'number'
					) {
						return { distance: Number(parsed['distance']), duration: Number(parsed['duration']) };
					}
				}
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

				const data: unknown = await res.json();

				if (isRecord(data) && Array.isArray((data as Record<string, unknown>)['routes'])) {
					const routes = (data as Record<string, unknown>)['routes'] as unknown[];
					const firstRoute = routes?.[0];
					if (
						isRecord(firstRoute) &&
						Array.isArray((firstRoute as Record<string, unknown>)['legs'])
					) {
						const firstLeg = ((firstRoute as Record<string, unknown>)['legs'] as unknown[])[0];
						if (
							isRecord(firstLeg) &&
							isRecord((firstLeg as Record<string, unknown>)['distance']) &&
							isRecord((firstLeg as Record<string, unknown>)['duration'])
						) {
							const distance = Number(
								((firstLeg as Record<string, unknown>)['distance'] as Record<string, unknown>)[
									'value'
								]
							);
							const duration = Number(
								((firstLeg as Record<string, unknown>)['duration'] as Record<string, unknown>)[
									'value'
								]
							);
							if (Number.isFinite(distance) && Number.isFinite(duration)) {
								const result: RouteLeg = { distance, duration };
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
					}
				}
			} catch (e) {
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
