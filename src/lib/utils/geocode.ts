export function isAcceptableGeocode(result: any, input: string): boolean {
	if (!result) return false;

	// Always trust Google results
	if (result.source === 'google' || result.source === 'google_proxy' || result.source === 'google') return true;

	// Reject numeric-only labels ("407")
	if (result.name && String(result.name).trim().match(/^\d+$/)) return false;

	// Reject broad OSM types
	const broadTypes = ['city', 'state', 'country', 'county', 'state_district', 'place', 'administrative'];
	if ((result.osm_value && broadTypes.includes(String(result.osm_value))) || (result.osm_key && broadTypes.includes(String(result.osm_key)))) {
		return false;
	}

	// Normalize address access from different providers
	const addr = result.address || {};
	const hn = result.house_number || (result.properties && result.properties.housenumber) || addr.house_number || null;
	const road = result.street || (result.properties && result.properties.street) || addr.road || addr.road || null;
	const text = ((result.name || '') + ' ' + (result.formatted_address || '') + ' ' + (road || '')).toLowerCase();

	// If input looks like a house-level address, require house number and road and token match
	const inputIsAddress = /^\d+\s+\w+/i.test(input);
	if (inputIsAddress) {
		// Must have housenumber and road
		if (!hn || !road) return false;

		// Ensure the street token from input appears in the result text
		const streetMatch = input.match(/^\d+\s+([A-Za-z0-9-]+)/);
		// @ts-ignore - we've guarded streetMatch above
		const streetToken = streetMatch && streetMatch[1] ? String(streetMatch[1]).split(/\s+/)[0].toLowerCase() : '';
		if (streetToken.length > 3 && !text.includes(streetToken)) return false;

		// Ensure house number appears in result as well
		if (!String(hn).includes(input.match(/^\d+/)?.[0] || '')) return false;

		return true;
	}

	// For non-address inputs, prefer to accept if it has a name and geometry
	if (result.geometry && result.geometry.location && (result.name || result.formatted_address)) return true;

	return false;
}
