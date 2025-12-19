// src/lib/constants.ts

// The internal URL scheme for Cloudflare Durable Objects.
export const DO_ORIGIN = 'http://internal';

export const APP_NAME = 'Go Route Yourself';

/**
 * Centralized Retention and TTL Policies (in seconds)
 */
export const RETENTION = {
    THIRTY_DAYS: 30 * 24 * 60 * 60, // 2,592,000 seconds
    SESSION_TTL: 24 * 60 * 60      // 86,400 seconds
};