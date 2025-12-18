// src/lib/constants.ts

// The internal URL scheme for Cloudflare Durable Objects.
// DOs are accessed via stub.fetch(), and the protocol/host is often arbitrary
// but 'http://internal' is the standard convention.
export const DO_ORIGIN = 'http://internal';

// Add other shared constants here if needed
export const APP_NAME = 'Go Route Yourself';