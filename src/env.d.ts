/// <reference types="@sveltejs/kit" />
/// <reference types="@cloudflare/workers-types" />

declare namespace App {
	// Define the user object shape in locals
	interface Locals {
		user: {
			token: string;
			plan: 'free' | 'premium';
			tripsThisMonth: number;
			maxTrips: number;
			resetDate: string;
		} | null;
	}

	// Cloudflare Platform types
	interface Platform {
		env: {
			BETA_LOGS_KV: KVNamespace;
			BETA_USERS_KV: KVNamespace;
			BETA_LOGS_TRASH_KV: KVNamespace;
		};
		context: {
			waitUntil(promise: Promise<any>): void;
		};
		caches: CacheStorage & { default: Cache };
	}
}
