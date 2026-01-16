// src/lib/utils/dates.ts

/**
 * Parse a variety of date inputs into a JavaScript Date that represents
 * the same calendar date in the local timezone when possible.
 */
function parseToDate(input?: string | Date): Date {
	if (!input) return new Date();
	if (input instanceof Date) return input;
	const s = input.trim();

	// If string contains a time or timezone, let Date parse it
	if (s.includes('T') || /[Z+\-]\d{2}:?\d{2}$/.test(s)) {
		return new Date(s);
	}

	// If date-only YYYY-MM-DD (common from CSV/CSV exports), construct local date
	const parts = s.split('-').map((p) => Number(p));
	if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
		return new Date(parts[0], parts[1] - 1, parts[2]);
	}

	// Fallback - let Date try
	return new Date(s);
}

/**
 * Return a YYYY-MM-DD string for the local calendar date.
 * If a value is provided, it will be interpreted conservatively and
 * returned as the corresponding local date (not UTC).
 */
export function localDateISO(value?: string | Date): string {
	const d = parseToDate(value);
	// Convert to a UTC-ish ISO representation for the local date by
	// compensating the timezone offset, then taking the date portion.
	const tzAdjusted = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
	return tzAdjusted.toISOString().split('T')[0];
}

export const getLocalDate = () => localDateISO();
