// src/lib/constants.ts

// The internal URL scheme for Cloudflare Durable Objects.
export const DO_ORIGIN = 'http://internal';

export const APP_NAME = 'Go Route Yourself';

export const RETENTION = {
	THIRTY_DAYS: 30 * 24 * 60 * 60, // 2,592,000 seconds
	SESSION_TTL: 24 * 60 * 60 // 86,400 seconds
};

/**
 * [SECURITY FIX #41] Input length limits to prevent abuse
 * All user input should be validated against these limits before processing
 */
export const INPUT_LIMITS = {
	USERNAME: 64,
	EMAIL: 254, // RFC 5321 limit
	PASSWORD: 128, // Reasonable max - bcrypt/PBKDF2 will hash anyway
	NAME: 100,
	ADDRESS: 500,
	NOTES: 1000,
	URL: 2048,
	PHONE: 20,
	VEHICLE_NAME: 100,
	CATEGORY_NAME: 50,
	TRIP_PURPOSE: 200,
	WORK_ORDER: 50
};

// [!code ++]
export const PLAN_LIMITS = {
	FREE: {
		// Max stops allowed per single trip for Free users
		MAX_STOPS: 5,
		// How many trips a Free user may create in a rolling window
		MAX_TRIPS_PER_MONTH: 10, // kept for compatibility; interpreted as per WINDOW_DAYS
		MAX_TRIPS_IN_WINDOW: 10,
		// How many expenses a Free user may create in a rolling window
		MAX_EXPENSES_PER_MONTH: 10, // Updated to match trips/mileage
		MAX_EXPENSES_IN_WINDOW: 10,
		// How many mileage logs a Free user may create in a rolling window
		MAX_MILEAGE_PER_MONTH: 10,
		MAX_MILEAGE_IN_WINDOW: 10,
		// Rolling window length in days for the above limits
		WINDOW_DAYS: 30,
		// How many days of historical data to retain for Free users
		RETENTION_DAYS: 30
	}
};
