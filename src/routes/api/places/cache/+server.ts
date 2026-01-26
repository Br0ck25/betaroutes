import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { generatePlaceKey } from '$lib/utils/keys';
import { sanitizeString } from '$lib/server/sanitize';
import { log } from '$lib/server/log';
import { safeKV } from '$lib/server/env';

export interface CachedPlace {
	formatted_address: string;
	name?: string;
	secondary_text?: string;
	place_id?: string;
	geometry?: unknown;
	source: string;
	cachedAt: string;
	contributedBy: string;
}

export function parseCachedPlaceArray(raw: string | null): CachedPlace[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((p) => p && typeof p === 'object' && !Array.isArray(p))
			.map((p) => {
				const obj = p as Record<string, unknown>;
				return {
					formatted_address: String(obj['formatted_address'] ?? ''),
					name: typeof obj['name'] === 'string' ? (obj['name'] as string) : undefined,
					secondary_text:
						typeof obj['secondary_text'] === 'string'
							? (obj['secondary_text'] as string)
							: undefined,
					place_id: typeof obj['place_id'] === 'string' ? (obj['place_id'] as string) : undefined,
					geometry: obj['geometry'],
					source: typeof obj['source'] === 'string' ? (obj['source'] as string) : 'unknown',
					cachedAt:
						typeof obj['cachedAt'] === 'string'
							? (obj['cachedAt'] as string)
							: new Date().toISOString(),
					contributedBy:
						typeof obj['contributedBy'] === 'string' ? (obj['contributedBy'] as string) : ''
				} as CachedPlace;
			});
	} catch {
		return [];
	}
}

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	// 1. Security: Block unauthenticated writes
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// SECURITY (Issue #8): Get user ID for per-user cache isolation

	const user = locals.user as unknown;
	if (!user || typeof (user as { id?: unknown }).id !== 'string') {
		return json({ error: 'Invalid session' }, { status: 401 });
	}
	const userId = (user as { id: string }).id;

	try {
		const rawPlace: unknown = await request.json().catch(() => null);
		if (!rawPlace || typeof rawPlace !== 'object') {
			return json({ success: false, error: 'Invalid data' });
		}
		const rp = rawPlace as Record<string, unknown>;
		const placesKV = safeKV(platform?.env, 'BETA_PLACES_KV');

		if (!placesKV) {
			log.warn('BETA_PLACES_KV not found for caching');
			return json({ success: false });
		}

		const hasFormatted =
			typeof rp['formatted_address'] === 'string' &&
			(rp['formatted_address'] as string).trim() !== '';
		const hasName = typeof rp['name'] === 'string' && (rp['name'] as string).trim() !== '';
		if (!hasFormatted && !hasName) {
			return json({ success: false, error: 'Invalid data' });
		}

		// Sanitize data
		const formatted_address = hasFormatted
			? sanitizeString(rp['formatted_address'] as string, 500)
			: '';
		const name = hasName ? sanitizeString(rp['name'] as string, 200) : '';
		const place: CachedPlace = {
			formatted_address,
			name,
			secondary_text:
				typeof rp['secondary_text'] === 'string'
					? sanitizeString(rp['secondary_text'] as string, 300)
					: '',
			place_id:
				typeof rp['place_id'] === 'string' ? sanitizeString(rp['place_id'] as string, 200) : '',
			geometry: rp['geometry'],
			source: 'autocomplete_selection', // Force source to ensure it looks 'local'
			cachedAt: new Date().toISOString(),
			contributedBy: userId
		};

		const keyText = place.formatted_address || place.name || '';

		// 1. Save "Detail" Record (place:<userId>:<hash>)
		// SECURITY: Scope to user to prevent cache poisoning
		const key = await generatePlaceKey(keyText);
		const userScopedKey = `place:${userId}:${key.replace('place:', '')}`;
		await placesKV.put(userScopedKey, JSON.stringify(place));

		// 2. Update per-user Search Index Buckets (user:<userId>:prefix:...)
		// SECURITY (Issue #8): Scope buckets to user to prevent global cache poisoning
		const normalized = keyText.toLowerCase().replace(/\s+/g, '');

		// We update specific prefixes to ensure it appears as the user types
		// Limiting concurrency to avoid overwhelming the worker
		const prefixesToUpdate: string[] = [];
		for (let len = 2; len <= Math.min(10, normalized.length); len++) {
			prefixesToUpdate.push(normalized.substring(0, len));
		}

		// Process bucket updates in parallel (user-scoped)
		await Promise.all(
			prefixesToUpdate.map(async (prefix) => {
				// SECURITY: Prefix with userId to isolate user's autocomplete data
				const bucketKey = `user:${userId}:prefix:${prefix}`;
				const existingRaw = await placesKV.get(bucketKey);
				const bucket = existingRaw ? parseCachedPlaceArray(existingRaw) : [];

				// Remove if exists (to update it), then add to top
				const filtered = bucket.filter(
					(b) => b.formatted_address !== place.formatted_address && b.place_id !== place.place_id
				);

				const newBucket = [place, ...filtered].slice(0, 20);

				// Save prefix bucket (user-scoped)
				await placesKV.put(bucketKey, JSON.stringify(newBucket));
			})
		);

		return json({ success: true });
	} catch (e) {
		log.error('Cache Error', { message: (e as Error)?.message });
		return json({ success: false, error: String(e) }, { status: 500 });
	}
};
