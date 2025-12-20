// src/lib/services/maps.ts
import type { Destination } from '$lib/types';

export interface RouteResult {
    totalMiles: number;
    totalMinutes: number;
    route: google.maps.DirectionsResult;
    optimizedOrder?: number[];
}

/**
 * Optimizes the route order using the Server API.
 * Strategies: KV Cache -> OSRM -> Google
 */
export async function optimizeRoute(
    startAddress: string,
    endAddress: string,
    destinations: Destination[]
) {
    const res = await fetch('/api/directions/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            startAddress,
            endAddress,
            stops: destinations
        })
    });

    const data = await res.json();

    // [!code highlight] Explicitly handle 403 Forbidden (Plan Limits)
    if (res.status === 403) {
        // Pass the server's specific message ("Route optimization is a Pro feature...")
        const error = new Error(data.message || data.error || 'Plan Limit Reached');
        (error as any).code = 'PLAN_LIMIT'; 
        throw error;
    }

    if (!res.ok) {
        throw new Error(data.error || 'Failed to optimize route');
    }

    return data;
}

/**
 * Calculates a route (Client-Side). 
 * Note: If your public API key does not allow Directions API, this will fail.
 * For the dashboard "New Trip" and "Edit Trip" pages, we use fetchRouteSegment (Server-Side) instead.
 */
export async function calculateRoute(
    startAddress: string,
    endAddress: string,
    destinations: Destination[],
    distanceUnit: 'mi' | 'km'
): Promise<RouteResult> {
    
    // 1. Validation
    if (!startAddress) {
        throw new Error("Please enter a start address.");
    }

    if (typeof google === 'undefined' || !google.maps || !google.maps.DirectionsService) {
        throw new Error("Google Maps API is not loaded yet. Please wait.");
    }

    const directionsService = new google.maps.DirectionsService();

    // 2. Prepare Waypoints
    const validDestinations = destinations.filter(d => d.address && d.address.trim() !== '');
    
    const waypoints = validDestinations.map(d => ({
        location: d.address,
        stopover: true
    }));

    // 3. Determine Origin/Dest
    let origin = startAddress;
    let destination = endAddress;

    // Logic: If no specific end address, the last stop IS the destination
    if (!destination && waypoints.length > 0) {
        destination = waypoints[waypoints.length - 1].location as string;
        waypoints.pop(); // Remove it from waypoints so it's not visited twice
    } else if (!destination && waypoints.length === 0) {
        throw new Error("Please add at least one destination or an end address.");
    }

    // 4. Request Route
    const request: google.maps.DirectionsRequest = {
        origin: origin,
        destination: destination,
        waypoints: waypoints,
        optimizeWaypoints: true, // This attempts client-side optimization
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: distanceUnit === 'km' ? google.maps.UnitSystem.METRIC : google.maps.UnitSystem.IMPERIAL
    };

    return new Promise((resolve, reject) => {
        directionsService.route(request, (result, status) => {
            if (status === google.maps.DirectionsStatus.OK && result) {
                const route = result.routes[0];
                let distanceMeters = 0;
                let durationSeconds = 0;

                route.legs.forEach(leg => {
                    if (leg.distance) distanceMeters += leg.distance.value;
                    if (leg.duration) durationSeconds += leg.duration.value;
                });

                // Conversions
                const totalMiles = distanceMeters * 0.000621371;
                const totalMinutes = durationSeconds / 60;

                resolve({
                    totalMiles: parseFloat(totalMiles.toFixed(1)),
                    totalMinutes: Math.round(totalMinutes),
                    route: result,
                    optimizedOrder: route.waypoint_order 
                });
            } else {
                reject(new Error(`Directions request failed: ${status}`));
            }
        });
    });
}