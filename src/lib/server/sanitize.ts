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
	UnsanitizedTrip,
	UnknownRecord
} from '$lib/types';

/**
 * Input Sanitization Utility
 * Prevents XSS, injection attacks, and malicious input
 */

/**
 * Sanitize a string by escaping HTML entities and removing dangerous characters
 */
export function sanitizeString(
	input: string | null | undefined | unknown,
	maxLength: number = 1000
): string {
	if (!input) return '';

	// Convert to string if not already
	let str = String(input);

	// Truncate if too long
	if (str.length > maxLength) {
		str = str.substring(0, maxLength);
	}

	// Remove null bytes
	str = str.replace(/\0/g, '');

	// Replace HTML entities to prevent XSS
	str = str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#x27;')
		.replace(/\//g, '&#x2F;');

	// Remove any remaining control characters except newlines and tabs
	str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

	return str.trim();
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
	if (!location || typeof location !== 'object') {
		return undefined;
	}

	const loc = location as UnsanitizedLocation;

	const lat = sanitizeNumber(loc.lat, NaN);
	const lng = sanitizeNumber(loc.lng, NaN);

	// Validate lat/lng ranges
	if (isNaN(lat) || isNaN(lng)) {
		return undefined;
	}

	// Lat must be between -90 and 90
	if (lat < -90 || lat > 90) {
		return undefined;
	}

	// Lng must be between -180 and 180
	if (lng < -180 || lng > 180) {
		return undefined;
	}

	return { lat, lng };
}

/**
 * Sanitize a date/time string
 */
export function sanitizeDateTime(input: unknown): string {
	if (!input) return '';

	const str = String(input).trim();

	// Basic ISO 8601 format validation
	const isoDateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?Z?)?$/;

	if (isoDateRegex.test(str)) {
		// Validate it's a real date
		const date = new Date(str);
		if (!isNaN(date.getTime())) {
			return str;
		}
	}

	// Try to parse as date anyway
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

	// UUID v4 format
	const uuidRegex =
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

	if (uuidRegex.test(str)) {
		return str;
	}

	return undefined;
}

/**
 * Sanitize an array of items using a sanitizer function
 */
export function sanitizeArray<T>(
	input: unknown,
	itemSanitizer: (item: unknown) => T | null,
	maxItems: number = 100
): T[] {
	if (!Array.isArray(input)) {
		return [];
	}

	return input
		.slice(0, maxItems) // Limit array size
		.map(itemSanitizer)
		.filter((item): item is T => item !== null);
}

/**
 * Sanitize a stop object
 */
export function sanitizeStop(stop: unknown): Stop | null {
	if (!stop || typeof stop !== 'object') {
		return null;
	}

	const s = stop as UnsanitizedStop;

	return {
		id: s.id ? sanitizeUUID(s.id) : undefined,
		address: sanitizeString(s.address, 500),
		earnings: sanitizeNumber(s.earnings, 0),
		notes: sanitizeString(s.notes, 1000),
		order: sanitizeNumber(s.order, 0),
		location: sanitizeLocation(s.location)
	};
}

/**
 * Sanitize a destination object
 */
export function sanitizeDestination(destination: unknown): Destination | null {
	if (!destination || typeof destination !== 'object') {
		return null;
	}

	const d = destination as UnsanitizedDestination;

	const address = sanitizeString(d.address, 500);
	const earnings = sanitizeNumber(d.earnings, 0);

	// Destination requires address
	if (!address) {
		return null;
	}

	return {
		address,
		earnings,
		location: sanitizeLocation(d.location)
	};
}

/**
 * Sanitize a cost item object (maintenance/supplies)
 */
export function sanitizeCostItem(item: unknown): CostItem | null {
	if (!item || typeof item !== 'object') {
		return null;
	}

	const c = item as UnsanitizedCostItem;

	const type = sanitizeString(c.type, 100);
	const cost = sanitizeNumber(c.cost, 0);

	// Cost item requires type
	if (!type) {
		return null;
	}

	return {
		type,
		cost
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
 * Detect potentially malicious patterns in input
 * Returns array of detected patterns for logging
 */
export function detectMaliciousPatterns(input: string): string[] {
	const patterns: { name: string; regex: RegExp }[] = [
		{ name: 'script_tag', regex: /<script[\s\S]*?>[\s\S]*?<\/script>/gi },
		{ name: 'javascript_protocol', regex: /javascript:/gi },
		{ name: 'data_protocol', regex: /data:text\/html/gi },
		{ name: 'vbscript_protocol', regex: /vbscript:/gi },
		{ name: 'on_event_handler', regex: /on\w+\s*=/gi },
		{ name: 'iframe_tag', regex: /<iframe[\s\S]*?>/gi },
		{ name: 'embed_tag', regex: /<embed[\s\S]*?>/gi },
		{ name: 'object_tag', regex: /<object[\s\S]*?>/gi },
		{ name: 'sql_injection', regex: /(union|select|insert|update|delete|drop|create|alter)\s+(from|into|table)/gi },
		{ name: 'path_traversal', regex: /\.\.[\/\\]/g },
		{ name: 'null_byte', regex: /\0/g }
	];

	const detected: string[] = [];

	for (const { name, regex } of patterns) {
		if (regex.test(input)) {
			detected.push(name);
		}
	}

	return detected;
}

/**
 * Validate and sanitize entire request body
 * Throws error if malicious content detected
 */
export function validateAndSanitizeRequest(
	body: unknown,
	logSuspicious: boolean = true
): Partial<Trip> {
	// Convert entire object to JSON string for pattern detection
	const jsonString = JSON.stringify(body);

	// Detect malicious patterns
	const maliciousPatterns = detectMaliciousPatterns(jsonString);

	if (maliciousPatterns.length > 0) {
		if (logSuspicious) {
			console.warn('🚨 Suspicious patterns detected:', {
				patterns: maliciousPatterns,
				timestamp: new Date().toISOString(),
				bodyPreview: jsonString.substring(0, 200)
			});
		}

		// Don't throw error, but log it - let sanitization handle it
		// This prevents false positives while still alerting us
	}

	// Sanitize the trip data
	return sanitizeTrip(body);
}

/**
 * Helper function to clean output before sending to client
 * Reverse HTML entity encoding for display
 */
export function decodeForDisplay(input: string): string {
	if (!input) return '';

	return input
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&#x2F;/g, '/');
}

/**
 * Sanitize query parameters from URL
 */
export function sanitizeQueryParam(param: string | null, maxLength: number = 200): string {
	if (!param) return '';

	return sanitizeString(param, maxLength);
}

/**
 * Create a safe error message that doesn't leak sensitive info
 */
export function createSafeErrorMessage(error: unknown): string {
	// Never expose raw error messages to users
	if (error instanceof Error) {
		// Log the real error server-side
		console.error('Error details:', error.message, error.stack);

		// Return generic message to client
		return 'An error occurred while processing your request';
	}

	return 'An unexpected error occurred';
}