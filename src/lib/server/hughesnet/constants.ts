// src/lib/server/hughesnet/constants.ts

export const DISCOVERY_GAP_MAX_SIZE = 50;
export const DISCOVERY_MAX_FAILURES = 50;
export const DISCOVERY_MAX_CHECKS = 100;
export const USER_MODIFICATION_BUFFER_MS = 150000; // 15 seconds
export const MIN_JOB_DURATION_MINS = 10;
export const MAX_JOB_DURATION_MINS = 600;

// Delays
export const DELAY_BETWEEN_SCANS_MS = 150;
export const DELAY_BETWEEN_GAP_FILLS_MS = 50;
export const DELAY_BETWEEN_BACKWARD_SCANS_MS = 80;
export const DELAY_BETWEEN_DOWNLOADS_MS = 200;

// Locking
export const LOCK_TTL_MS = 300000; // 5 minutes
export const LOCK_RETRY_DELAY_MS = 1000; // 1 second
export const LOCK_MAX_RETRIES = 10;

// System
export const MAX_ROLLBACK_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const RESYNC_WINDOW_DAYS = 7;
export const RESYNC_WINDOW_MS = RESYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000;
