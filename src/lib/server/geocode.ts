import { log } from '$lib/server/log';

/**
 * Geocode using Google Geocoding API only. Photon/OpenStreetMap has been removed
 * in favor of a single provider (Google) with KV caching handled at the call-site.
 */
export async function geocode(
	address: string,
	apiKey?: string
): Promise<{ lat: number; lon: number; formattedAddress?: string } | null> {
	if (!apiKey) return null; // Google key required — Photon removed.

	try {
		const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
			address
		)}&key=${apiKey}`;
		const gRes = await fetch(gUrl);
		const gData = (await gRes.json()) as {
			status?: string;
			results?: Array<{
				geometry?: { location?: { lat?: number; lng?: number } };
				formatted_address?: string;
			}>;
		};
		if (gData.status === 'OK' && gData.results && gData.results.length > 0) {
			const first = gData.results[0];
			if (first && first.geometry && first.geometry.location) {
				const loc = first.geometry.location;
				return {
					lat: Number(loc.lat),
					lon: Number(loc.lng),
					formattedAddress: first.formatted_address ?? ''
				};
			}
		}
	} catch (e) {
		log.warn('Google geocode failed', { message: e instanceof Error ? e.message : String(e) });
	}

	return null;
}
