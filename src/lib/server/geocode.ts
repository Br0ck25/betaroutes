import { log } from '$lib/server/log';

/**
 * Geocode using Photon (OpenStreetMap). Returns [lon, lat] or null.
 * Performs a Google fallback when `apiKey` is provided and Photon is weak.
 */
export async function geocodePhoton(
	address: string,
	apiKey?: string
): Promise<[number, number] | null> {
	try {
		const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=1`;
		const res = await fetch(url);
		const data = (await res.json()) as {
			features?: Array<{
				properties?: Record<string, unknown>;
				geometry?: { coordinates?: [number, number] };
			}>;
		};
		if (data.features && data.features.length > 0) {
			const f = data.features[0];
			if (!f) return null;
			const p = f && f.properties ? f.properties : ({} as Record<string, unknown>);

			// If input looks like a house-level address, require housenumber + street match
			const inputIsAddress = /^\d+\s+\w+/.test(address);
			if (inputIsAddress) {
				const hasHN = !!p['housenumber'];
				const hasStreet = !!(p['street'] || p['name']);
				const inputNumber = address.match(/^(\d+)/)?.[1] || null;
				const streetToken = address
					.match(/^\d+\s+(.+)$/)?.[1]
					?.split(/\s+/)[0]
					?.toLowerCase();
				const resultText = (
					String(p['name'] || '') +
					' ' +
					String(p['street'] || '')
				).toLowerCase();

				// Require both housenumber equality and street presence/match
				if (
					!hasHN ||
					String(p['housenumber']) !== String(inputNumber) ||
					!hasStreet ||
					(streetToken && streetToken.length > 3 && !resultText.includes(streetToken))
				) {
					// Attempt Google fallback if API key provided
					if (apiKey) {
						try {
							const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
							const gRes = await fetch(gUrl);
							const gData = (await gRes.json()) as {
								status?: string;
								results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
							};
							if (gData.status === 'OK' && gData.results && gData.results.length > 0) {
								const loc = gData.results?.[0]?.geometry?.location;
								if (loc && typeof loc.lng === 'number' && typeof loc.lat === 'number')
									return [loc.lng, loc.lat];
							}
						} catch (e) {
							log.warn('Google geocode failed (photon fallback)', {
								message: e instanceof Error ? e.message : String(e)
							});
						}
					}
					return null;
				}
			}

			return f.geometry && f.geometry.coordinates
				? (f.geometry.coordinates as [number, number])
				: null;
		}
	} catch (e) {
		log.warn('Photon geocode failed', { message: e instanceof Error ? e.message : String(e) });
	}

	// Final attempt: try Google if key available
	if (apiKey) {
		try {
			const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
			const gRes = await fetch(gUrl);
			const gData = (await gRes.json()) as {
				status?: string;
				results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
			};
			const loc = gData.results?.[0]?.geometry?.location;
			if (loc && typeof loc.lng === 'number' && typeof loc.lat === 'number')
				return [loc.lng, loc.lat];
		} catch (e) {
			log.warn('Google geocode failed (final fallback)', {
				message: e instanceof Error ? e.message : String(e)
			});
		}
	}

	return null;
}
