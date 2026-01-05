// src/lib/server/sanitize.ts

import type {
	Location,
	Stop,
	Destination,
	CostItem,
	Trip,
	UnsanitizedLocation,
	UnsanitizedStop,
	UnsanitizedDestination,
	UnsanitizedCostItem,
	UnsanitizedTrip
} from '$lib/types';

import { log } from '$lib/server/log';

/**
 * Input Sanitization Utility
 * Focused on Data Integrity and Type Safety.
 * XSS prevention is handled automatically by Svelte's default escaping.
 */

/**
 * Sanitize a string by trimming and enforcing length.
 * We do NOT strip tags here because Svelte handles display safety.
 * This preserves data fidelity (what the user types is what they get back).
 */
export function sanitizeString(
	input: string | null | undefined | unknown,
	maxLength: number = 1000
): string {
	if (!input) return '';

	// Convert to string and trim whitespace
	let str = String(input).trim();

	// Enforce length limit to prevent database bloat
	if (str.length > maxLength) {
		str = str.substring(0, maxLength);
	}

	// Remove null bytes (a common low-level attack vector)
	return str.replace(/\0/g, '');
}

/**
 * Sanitize a number, ensuring it's a valid finite number
 */
export function sanitizeNumber(input: unknown, defaultValue: number = 0): number {
	const num = Number(input);
	// Check if valid number
	if (isNaN(num) || !isFinite(num)) {
		return defaultValue;
	}
	return num;
}

/**
 * Sanitize a location object with lat/lng
 */
export function sanitizeLocation(location: unknown): Location | undefined {
	if (!location || typeof location !== 'object') return undefined;

	const loc = location as UnsanitizedLocation;
	const lat = sanitizeNumber(loc.lat, NaN);
	const lng = sanitizeNumber(loc.lng, NaN);

	// Validate lat/lng ranges
	if (isNaN(lat) || isNaN(lng)) return undefined;
	if (lat < -90 || lat > 90) return undefined;
	if (lng < -180 || lng > 180) return undefined;

	return { lat, lng };
}

/**
 * Sanitize a date/time string
 */
export function sanitizeDateTime(input: unknown): string {
	if (!input) return '';
	const str = String(input).trim();

	// Simple check: can Date parse it?
	const date = new Date(str);
	if (!isNaN(date.getTime())) {
		return date.toISOString();
	}
	return '';
}

/**
 * Sanitize UUID
 */
export function sanitizeUUID(input: unknown): string | undefined {
	if (!input) return undefined;
	const str = String(input).trim().toLowerCase();
	// UUID v4 format regex
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	return uuidRegex.test(str) ? str : undefined;
}

/**
 * Sanitize an array of items using a sanitizer function
 */
export function sanitizeArray<T>(
	input: unknown,
	itemSanitizer: (item: unknown) => T | null,
	maxItems: number = 100
): T[] {
	if (!Array.isArray(input)) return [];
	return input
		.slice(0, maxItems)
		.map(itemSanitizer)
		.filter((item): item is T => item !== null);
}

// --- Object Sanitizers ---

export function sanitizeStop(stop: unknown): Stop | null {
	if (!stop || typeof stop !== 'object') return null;
	const s = stop as UnsanitizedStop;

	// Accept common address fields to be resilient to differing payload shapes
	const sRecord = s as Record<string, unknown>;
	const rawAddress =
		typeof sRecord['address'] === 'string'
			? (sRecord['address'] as string)
			: typeof sRecord['formatted_address'] === 'string'
				? (sRecord['formatted_address'] as string)
				: typeof sRecord['name'] === 'string'
					? (sRecord['name'] as string)
					: '';

	return {
		id: s.id ? sanitizeUUID(s.id) : undefined,
		address: sanitizeString(rawAddress, 500),
		earnings: sanitizeNumber(s.earnings, 0),
		notes: sanitizeString(s.notes, 1000),
		order: sanitizeNumber(s.order, 0),
		location: sanitizeLocation(s.location)
	};
}

export function sanitizeDestination(destination: unknown): Destination | null {
	if (!destination || typeof destination !== 'object') return null;
	const d = destination as UnsanitizedDestination;

	const address = sanitizeString(d.address, 500);
	if (!address) return null;

	return {
		address,
		earnings: sanitizeNumber(d.earnings, 0),
		location: sanitizeLocation(d.location)
	};
}

export function sanitizeCostItem(item: unknown): CostItem | null {
	if (!item || typeof item !== 'object') return null;
	const c = item as UnsanitizedCostItem;

	const type = sanitizeString(c.type, 100);
	if (!type) return null;

	return {
		type,
		cost: sanitizeNumber(c.cost, 0)
	};
}

/**
 * Sanitize a complete trip object
 */
export function sanitizeTrip(trip: unknown): Partial<Trip> {
	if (!trip || typeof trip !== 'object') {
		throw new Error('Invalid trip data');
	}

	const t = trip as UnsanitizedTrip;

	return {
		id: t.id ? sanitizeUUID(t.id) : undefined,
		date: sanitizeString(t.date, 50),
		startTime: sanitizeString(t.startTime, 50),
		endTime: sanitizeString(t.endTime, 50),
		hoursWorked: sanitizeNumber(t.hoursWorked),
		startAddress: sanitizeString(t.startAddress, 500),
		startLocation: sanitizeLocation(t.startLocation),
		endAddress: sanitizeString(t.endAddress, 500),
		endLocation: sanitizeLocation(t.endLocation),
		totalMiles: sanitizeNumber(t.totalMiles),
		estimatedTime: sanitizeNumber(t.estimatedTime),
		totalTime: sanitizeString(t.totalTime, 50),
		mpg: sanitizeNumber(t.mpg),
		gasPrice: sanitizeNumber(t.gasPrice),
		fuelCost: sanitizeNumber(t.fuelCost),
		maintenanceCost: sanitizeNumber(t.maintenanceCost),
		suppliesCost: sanitizeNumber(t.suppliesCost),
		totalEarnings: sanitizeNumber(t.totalEarnings),
		netProfit: sanitizeNumber(t.netProfit),
		notes: sanitizeString(t.notes, 1000),
		stops: sanitizeArray(t.stops, sanitizeStop, 50),
		destinations: sanitizeArray(t.destinations, sanitizeDestination, 50),
		maintenanceItems: sanitizeArray(t.maintenanceItems, sanitizeCostItem, 20),
		suppliesItems: sanitizeArray(t.suppliesItems, sanitizeCostItem, 20),
		lastModified: t.lastModified ? sanitizeDateTime(t.lastModified) : undefined
	};
}

/**
 * Validate and sanitize entire request body
 */
export function validateAndSanitizeRequest(
	body: unknown,
	_logSuspicious: boolean = true
): Partial<Trip> {
	// Keep `_logSuspicious` referenced so lint doesn't flag it as unused (reserved for future use)
	void _logSuspicious;

	// We no longer scan for regex patterns because Svelte renders all input as text.
	// If a user saves "<script>", it is stored as "<script>" and displayed as "<script>".
	// It never executes.
	return sanitizeTrip(body);
}

export function sanitizeQueryParam(param: string | null, maxLength: number = 200): string {
	return sanitizeString(param, maxLength);
}

export function createSafeErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		log.error('Error details', { message: error.message, stack: error.stack });
		return 'An error occurred while processing your request';
	}
	return 'An unexpected error occurred';
}
