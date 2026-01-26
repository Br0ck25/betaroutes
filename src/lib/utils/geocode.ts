export function isAcceptableGeocode(result: unknown, input: string): boolean {
	if (!result || typeof result !== 'object') return false;
	const r = result as Record<string, unknown>;

	// Always trust Google results
	if (
		typeof r['source'] === 'string' &&
		(r['source'] === 'google' || r['source'] === 'google_proxy' || r['source'] === 'google')
	) {
		return true;
	}

	// Reject numeric-only labels ("407")
	if (r['name'] && String(r['name']).trim().match(/^\d+$/)) return false;

	// Reject broad OSM types
	const broadTypes = [
		'city',
		'state',
		'country',
		'county',
		'state_district',
		'place',
		'administrative'
	];
	if (
		(typeof r['osm_value'] === 'string' && broadTypes.includes(String(r['osm_value']))) ||
		(typeof r['osm_key'] === 'string' && broadTypes.includes(String(r['osm_key'])))
	) {
		return false;
	}

	// Normalize address access from different providers
	const addr = (r['address'] as Record<string, unknown> | undefined) ?? {};
	const properties = (r['properties'] as Record<string, unknown> | undefined) ?? {};
	const hn =
		typeof r['house_number'] === 'string'
			? r['house_number']
			: typeof properties['housenumber'] === 'string'
				? properties['housenumber']
				: typeof addr['house_number'] === 'string'
					? addr['house_number']
					: null;
	const road =
		typeof r['street'] === 'string'
			? r['street']
			: typeof properties['street'] === 'string'
				? properties['street']
				: typeof addr['road'] === 'string'
					? addr['road']
					: null;
	const text = (
		(String(r['name'] ?? '') || '') +
		' ' +
		(String(r['formatted_address'] ?? '') || '') +
		' ' +
		(String(road ?? '') || '')
	).toLowerCase();

	// If input looks like a house-level address, require house number and road and token match
	const inputIsAddress = /^\d+\s+\w+/i.test(input);
	if (inputIsAddress) {
		// Must have housenumber and road
		if (!hn || !road) return false;

		// Ensure the street token from input appears in the result text
		const streetMatch = input.match(/^\d+\s+([A-Za-z0-9-]+)/);
		let streetToken = '';
		const rawToken = streetMatch?.[1] ?? '';
		if (rawToken) {
			const parts = String(rawToken).split(/\s+/);
			const first = parts[0] ?? '';
			streetToken = first.toLowerCase();
		}
		if (streetToken.length > 3 && !text.includes(streetToken)) return false;

		// Ensure house number appears in result as well
		const inputHouseNumber = input.match(/^\d+/)?.[0] ?? '';
		if (!String(hn).includes(inputHouseNumber)) return false;

		return true;
	}

	// For non-address inputs, prefer to accept if it has a name and geometry
	if (
		r['geometry'] &&
		(r['geometry'] as Record<string, unknown>)['location'] &&
		(r['name'] || r['formatted_address'])
	)
		return true;

	return false;
}
