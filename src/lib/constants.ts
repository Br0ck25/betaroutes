// src/lib/constants.ts

// The internal URL scheme for Cloudflare Durable Objects.
export const DO_ORIGIN = 'http://internal';

export const APP_NAME = 'Go Route Yourself';

export const RETENTION = {
	THIRTY_DAYS: 30 * 24 * 60 * 60, // 2,592,000 seconds
	SESSION_TTL: 24 * 60 * 60 // 86,400 seconds
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
		MAX_EXPENSES_PER_MONTH: 20, // kept for compatibility
		MAX_EXPENSES_IN_WINDOW: 20,
		// Rolling window length in days for the above limits
		WINDOW_DAYS: 30,
		// How many days of historical data to retain for Free users
		RETENTION_DAYS: 30
	}
};
