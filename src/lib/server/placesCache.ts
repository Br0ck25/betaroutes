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
