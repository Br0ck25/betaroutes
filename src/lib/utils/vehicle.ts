// src/lib/utils/vehicle.ts
/**
 * Helpers for rendering vehicle fields which may be stored as either
 * a vehicle `id` (UUID) or a plain `name` string. The UI should
 * prefer the human-readable `name` when available in user settings.
 */
export function getVehicleDisplayName(
	raw: string | undefined | null,
	vehicles?: Array<{ id?: string; name?: string }>
): string {
	if (!raw) return '-';
	const val = String(raw);
	// Prefer exact match by id/name from provided vehicles
	if (Array.isArray(vehicles)) {
		const byId = vehicles.find((v) => v.id && v.id === val);
		if (byId && byId.name) return byId.name;
		const byName = vehicles.find((v) => v.name && v.name === val);
		if (byName) return byName.name;
	}
	// If the value looks like a UUID but we couldn't resolve it, avoid showing raw ID
	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val)) {
		return 'Unknown vehicle';
	}
	// Otherwise assume it's already a friendly name
	return val || '-';
}
