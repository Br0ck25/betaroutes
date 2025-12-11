// src/routes/api/debug/migrate-places/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';
import type { TripRecord, TrashItem } from '$lib/server/tripService';

export const POST: RequestHandler = async ({ platform }) => {
    const logsKV = platform?.env?.BETA_LOGS_KV as KVNamespace;
    const trashKV = platform?.env?.BETA_LOGS_TRASH_KV as KVNamespace;
    const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace;

    if (!logsKV || !placesKV) {
        return json({ error: 'KV Bindings missing' }, { status: 500 });
    }

    let savedCount = 0;
    const errors: string[] = [];
    const processedAddresses = new Set<string>();

    // Helper to save address
    async function saveAddress(address: string) {
        if (!address || address.length < 5) return;
        
        // Normalize
        const key = address.toLowerCase().trim();
        
        if (processedAddresses.has(key)) return;
        processedAddresses.add(key);

        // Check if exists (optional, put overwrites anyway which is fine)
        const placeData = {
            formatted_address: address,
            source: 'migration',
            updatedAt: new Date().toISOString()
        };

        await placesKV.put(key, JSON.stringify(placeData));
        savedCount++;
    }

    // Helper to extract addresses from a trip object
    async function processTrip(trip: TripRecord) {
        if (trip.startAddress) await saveAddress(trip.startAddress);
        if (trip.endAddress) await saveAddress(trip.endAddress);
        
        if (trip.stops && Array.isArray(trip.stops)) {
            for (const stop of trip.stops) {
                if (stop.address) await saveAddress(stop.address);
            }
        }

        // Handle the 'destinations' array if it exists (based on your JSON snippet)
        if (trip.destinations && Array.isArray(trip.destinations)) {
            for (const dest of trip.destinations) {
                if (dest.address) await saveAddress(dest.address);
            }
        }
    }

    try {
        // 1. Process Active Logs
        const logsList = await logsKV.list();
        for (const key of logsList.keys) {
            const raw = await logsKV.get(key.name);
            if (raw) {
                try {
                    const trip = JSON.parse(raw);
                    await processTrip(trip);
                } catch (e) {
                    errors.push(`Failed to parse log ${key.name}`);
                }
            }
        }

        // 2. Process Trash Logs (Optional, but good for completeness)
        if (trashKV) {
            const trashList = await trashKV.list();
            for (const key of trashList.keys) {
                const raw = await trashKV.get(key.name);
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw) as TrashItem;
                        // Trash items are wrapped in { trip: ..., metadata: ... }
                        if (parsed.trip) {
                            await processTrip(parsed.trip);
                        }
                    } catch (e) {
                        errors.push(`Failed to parse trash ${key.name}`);
                    }
                }
            }
        }

        return json({ 
            success: true, 
            unique_addresses_saved: savedCount,
            errors 
        });

    } catch (e) {
        return json({ error: String(e) }, { status: 500 });
    }
};