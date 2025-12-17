// src/lib/server/hughesnet/router.ts
import type { KVNamespace } from '@cloudflare/workers-types';
import type { GeocodedPoint, RouteLeg } from './types';
import type { HughesNetFetcher } from './fetcher';

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
        const kvKey = `geo:${cleanAddr.replace(/[^a-z0-9]/g, '_')}`;

        if (this.kv) {
            try {
                const cached = await this.kv.get(kvKey);
                if (cached) return JSON.parse(cached);
            } catch (e) {
                console.warn('Failed to get cached geocode:', e);
            }
        }

        // Try Nominatim with timeout
        try {
            const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(rawAddress)}&format=json&limit=1`;
            const res = await fetch(nomUrl, { 
                headers: { 'User-Agent': 'BetaRoutes/1.0' },
                signal: this.createTimeoutSignal(EXTERNAL_API_TIMEOUT_MS)
            });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    const point = { 
                        lat: parseFloat(data[0].lat), 
                        lon: parseFloat(data[0].lon),
                        formattedAddress: data[0].display_name
                    };
                    if (this.kv) {
                        try {
                            // PERMANENT CACHE - NO EXPIRATION
                            await this.kv.put(kvKey, JSON.stringify(point));
                        } catch (e) {
                            console.warn('Failed to cache geocode:', e);
                        }
                    }
                    return point;
                }
            }
        } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') {
                console.warn('Nominatim geocoding timeout');
            } else {
                console.warn('Nominatim geocoding failed:', e);
            }
        }

        // Try Google with timeout
        if (this.googleApiKey) {
            try {
                const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(rawAddress)}&key=${this.googleApiKey}`;
                const res = await fetch(googleUrl, {
                    signal: this.createTimeoutSignal(EXTERNAL_API_TIMEOUT_MS)
                });
                const data = await res.json();
                if (data.results?.[0]?.geometry?.location) {
                    const loc = data.results[0].geometry.location;
                    const point = { 
                        lat: loc.lat, 
                        lon: loc.lng, 
                        formattedAddress: data.results[0].formatted_address 
                    };
                    if (this.kv) {
                        try {
                            // PERMANENT CACHE - NO EXPIRATION
                            await this.kv.put(kvKey, JSON.stringify(point));
                        } catch (e) {
                            console.warn('Failed to cache geocode:', e);
                        }
                    }
                    return point;
                }
            } catch (e) {
                if (e instanceof Error && e.name === 'AbortError') {
                    console.warn('Google geocoding timeout');
                } else {
                    console.warn('Google geocoding failed:', e);
                }
            }
        }
        return null;
    }

    async getRouteInfo(origin: string, destination: string): Promise<RouteLeg | null> {
        const key = `dir:${origin.toLowerCase().trim()}_to_${destination.toLowerCase().trim()}`.replace(/[^a-z0-9_:-]/g, '');

        if (this.kv) {
            try {
                const cached = await this.kv.get(key);
                if (cached) return JSON.parse(cached);
            } catch (e) {
                console.warn('Failed to get cached route:', e);
            }
        }

        const startPt = await this.resolveAddress(origin);
        const endPt = await this.resolveAddress(destination);

        // Try OSRM with timeout
        if (startPt && endPt) {
            try {
                const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${startPt.lon},${startPt.lat};${endPt.lon},${endPt.lat}?overview=false`;
                const res = await fetch(osrmUrl, {
                    signal: this.createTimeoutSignal(EXTERNAL_API_TIMEOUT_MS)
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.routes?.[0]) {
                        const result = {
                            distance: data.routes[0].distance,
                            duration: data.routes[0].duration
                        };
                        if (this.kv) {
                            try {
                                // PERMANENT CACHE - NO EXPIRATION
                                await this.kv.put(key, JSON.stringify(result));
                            } catch (e) {
                                console.warn('Failed to cache route:', e);
                            }
                        }
                        return result;
                    }
                }
            } catch (e) {
                if (e instanceof Error && e.name === 'AbortError') {
                    console.warn('OSRM routing timeout');
                } else {
                    console.warn('OSRM routing failed:', e);
                }
            }
        }

        // Try Google with timeout
        if (this.googleApiKey) {
            try {
                const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${this.googleApiKey}`;
                const res = await this.fetcher.safeFetch(url, { 
                    headers: { 'Referer': 'https://gorouteyourself.com/' }
                });
                const data = await res.json();
                if (data.routes?.[0]?.legs?.[0]) {
                    const result = { 
                        distance: data.routes[0].legs[0].distance.value, 
                        duration: data.routes[0].legs[0].duration.value 
                    };
                    if (this.kv) {
                        try {
                            // PERMANENT CACHE - NO EXPIRATION
                            await this.kv.put(key, JSON.stringify(result));
                        } catch (e) {
                            console.warn('Failed to cache route:', e);
                        }
                    }
                    return result;
                }
            } catch (e: any) {
                if (e.message === 'REQ_LIMIT') throw e;
                console.error('[Maps] Google API Error', e);
            }
        }
        return null;
    }
}
