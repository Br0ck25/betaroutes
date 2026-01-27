/// <reference types="@sveltejs/kit" />
/// <reference types="@cloudflare/workers-types" />

declare namespace App {
	// Define the user object shape in locals
	interface Locals {
		user: {
			id?: string;
			token: string;
			plan: 'free' | 'premium';
			tripsThisMonth: number;
			maxTrips: number;
			resetDate: string;
			name?: string;
			email?: string;
		} | null;
	}

	// Cloudflare Platform types
	interface Platform {
		env: {
			BETA_LOGS_KV: KVNamespace;
			BETA_USERS_KV: KVNamespace;
			BETA_EXPENSES_KV?: KVNamespace;
			BETA_MILEAGE_KV?: KVNamespace;
			BETA_PLACES_KV?: KVNamespace;
		};
		context: {
			waitUntil(promise: Promise<unknown>): void;
		};
		caches: CacheStorage & { default: Cache };
	}
}
