// src/routes/api/directions/optimize/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';

/**
 * Helper: Geocode using Photon (OpenStreetMap)
 * Returns [lon, lat]
 */
async function geocodePhoton(address: string): Promise<[number, number] | null> {
    try {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=1`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            return data.features[0].geometry.coordinates as [number, number];
        }
    } catch (e) {
        console.warn('Photon geocode failed', e);
    }
    return null;
}

/**
 * Helper: Generate a unique key for the set of stops to cache the optimization result
 */
function generateOptimizationKey(start: string, end: string, stops: string[]): string {
    // Sort stops to ensure A,B,C generates same key as C,B,A if the set is the same
    // (Though technically order matters for the INPUT, usually we want to cache the RESULT for this specific request)
    // Actually, for optimization, the input order matters less than the SET of addresses.
    // However, to be safe, let's hash the specific input request.
    const combined = [start, end, ...stops].filter(Boolean).join('|').toLowerCase().replace(/[^a-z0-9|]/g, '');
    // Simple hash to keep key short
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return `opt:${hash}`;
}

export const POST: RequestHandler = async ({ request, platform, locals }) => {
    // 1. Security Check
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Check Plan - Disable Optimization for Free Tier
    if (locals.user.plan === 'free') {
        return json({ 
            error: 'Plan Limit', 
            message: 'Route optimization is a Pro feature. You can manually reorder stops by dragging them.' 
        }, { status: 403 });
    }

    const { startAddress, endAddress, stops } = await request.json();
    
    if (!startAddress || !stops || stops.length < 2) {
        return json({ error: 'Not enough data to optimize' }, { status: 400 });
    }

    const kv = platform?.env?.BETA_DIRECTIONS_KV as KVNamespace;
    const apiKey = platform?.env?.PRIVATE_GOOGLE_MAPS_API_KEY;
    const cacheKey = generateOptimizationKey(startAddress, endAddress || '', stops.map((s: any) => s.address));

    // 3. Check KV Cache
    if (kv) {
        const cached = await kv.get(cacheKey);
        if (cached) {
            return json(JSON.parse(cached));
        }
    }

    // Prepare Addresses
    const stopAddresses = stops.map((s: any) => s.address);
    const allAddresses = [startAddress, ...stopAddresses];
    if (endAddress) allAddresses.push(endAddress);

    // 4. Try OSRM (Free)
    try {
        // Geocode all points first
        const coords = await Promise.all(allAddresses.map(addr => geocodePhoton(addr)));
        const hasAllCoords = coords.every(c => c !== null);

        if (hasAllCoords) {
            // OSRM Trip API: http://project-osrm.org/docs/v5.5.1/api/#trip-service
            const coordsString = coords.map(c => c!.join(',')).join(';');
            let osrmUrl = `http://router.project-osrm.org/trip/v1/driving/${coordsString}?source=first`;
            
            if (endAddress) {
                osrmUrl += `&destination=last&roundtrip=false`;
            } else {
                // If no end address, we don't force roundtrip, allowing it to end at the best location?
                // Or we treat it as a roundtrip to start? 
                // Google "optimizeWaypoints" usually keeps start/end fixed. 
                // If no end provided, usually implies roundtrip or just visit all.
                // Let's assume roundtrip=false to be safe for a delivery route list.
                osrmUrl += `&roundtrip=false`; 
            }

            const res = await fetch(osrmUrl);
            const data = await res.json();

            if (data.code === 'Ok' && data.waypoints) {
                // OSRM returns 'waypoints' sorted by their order in the Optimized Trip.
                // Each waypoint object has a 'waypoint_index' property corresponding to the Input Index.
                // Input Index 0 is Start.
                
                // We need to extract the indices of the "Stops" (which were input indices 1 to N).
                const waypointIndices = data.waypoints
                    .map((wp: any) => wp.waypoint_index)
                    .filter((idx: number) => {
                        // Exclude Start (0)
                        if (idx === 0) return false;
                        // Exclude End (last index) if endAddress existed
                        if (endAddress && idx === allAddresses.length - 1) return false;
                        return true;
                    });

                // Convert back to 0-based indices relative to the 'stops' array
                // The input index 1 corresponds to stops[0].
                const optimizedOrder = waypointIndices.map((idx: number) => idx - 1);

                const result = { source: 'osrm', optimizedOrder };
                
                if (kv) await kv.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 }); // 24h cache
                return json(result);
            }
        }
    } catch (e) {
        console.warn('OSRM Optimization failed, falling back to Google', e);
    }

    // 5. Google Fallback (Server-Side)
    if (!apiKey) {
        return json({ error: 'Optimization service unavailable' }, { status: 500 });
    }

    try {
        const origin = startAddress;
        let destination = endAddress;
        // Make a copy of stops to modify if needed
        const waypointsList = [...stopAddresses];

        // Google requires a destination. If none provided, the last stop becomes the destination.
        // We replicate the logic used in the client: pop the last stop.
        if (!destination && waypointsList.length > 0) {
            destination = waypointsList.pop();
        }

        const waypointsStr = waypointsList.map((w: string) => encodeURIComponent(w)).join('|');
        const gUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&waypoints=optimize:true|${waypointsStr}&key=${apiKey}`;
        
        const gRes = await fetch(gUrl);
        const gData = await gRes.json();

        if (gData.status === 'OK' && gData.routes.length > 0) {
            const route = gData.routes[0];
            const result = {
                source: 'google',
                optimizedOrder: route.waypoint_order,
                legs: route.legs // Include legs for distance calculations
            };

            if (kv) await kv.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 });
            return json(result);
        }
        
        return json({ error: gData.status }, { status: 400 });

    } catch (e) {
        console.error('Google Optimization Error', e);
        return json({ error: 'Optimization failed' }, { status: 500 });
    }
};