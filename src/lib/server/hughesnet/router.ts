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
        // Use consistent key format
        const kvKey = `geo:${cleanAddr.replace(/[^a-z0-9]/g, '_')}`;

        // 1. Check KV Cache
        if (this.kv) {
            try {
                const cached = await this.kv.get(kvKey);
                if (cached) return JSON.parse(cached);
            } catch (e) {
                console.warn('Failed to get cached geocode:', e);
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
                const data = await res.json();
                if (data.features && data.features.length > 0) {
                    const f = data.features[0];
                    // Construct a formatted address from properties
                    const props = f.properties;
                    const addressParts = [
                        props.name, 
                        props.street, 
                        props.city, 
                        props.state, 
                        props.postcode, 
                        props.country
                    ].filter(Boolean);
                    
                    // Photon returns [lon, lat]
                    const point: GeocodedPoint = { 
                        lat: parseFloat(f.geometry.coordinates[1]), 
                        lon: parseFloat(f.geometry.coordinates[0]),
                        formattedAddress: addressParts.join(', ')
                    };

                    // Save to KV (Permanent Cache)
                    if (this.kv) {
                        try {
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
                console.warn('Photon geocoding timeout');
            } else {
                console.warn('Photon geocoding failed:', e);
            }
        }

        // 3. Try Google Fallback
        if (this.googleApiKey) {
            try {
                const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(rawAddress)}&key=${this.googleApiKey}`;
                const res = await fetch(googleUrl, {
                    signal: this.createTimeoutSignal(EXTERNAL_API_TIMEOUT_MS)
                });
                const data = await res.json();
                
                if (data.results?.[0]?.geometry?.location) {
                    const loc = data.results[0].geometry.location;
                    const point: GeocodedPoint = { 
                        lat: loc.lat, 
                        lon: loc.lng, 
                        formattedAddress: data.results[0].formatted_address 
                    };

                    // Save to KV (Permanent Cache)
                    if (this.kv) {
                        try {
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

        // 1. Check KV Cache
        if (this.kv) {
            try {
                const cached = await this.kv.get(key);
                if (cached) return JSON.parse(cached);
            } catch (e) {
                console.warn('Failed to get cached route:', e);
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
                    const data = await res.json();
                    if (data.routes?.[0]) {
                        const result = {
                            distance: data.routes[0].distance, // meters
                            duration: data.routes[0].duration  // seconds
                        };
                        
                        // Save to KV (Permanent Cache)
                        if (this.kv) {
                            try {
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

        // 3. Try Google Fallback
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
                    
                    // Save to KV (Permanent Cache)
                    if (this.kv) {
                        try {
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