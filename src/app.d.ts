// src/app.d.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';

declare global {
	namespace App {
		interface Locals {
			token: string | null;
			user: {
				id: string;
				token: string;
				plan: string;
				tripsThisMonth: number;
				maxTrips: number;
				resetDate: string;
				name?: string;
				email?: string;
				stripeCustomerId?: string; // [!code ++] Add this line
			} | null;
		}

		// Define strict Environment Interface
		interface Env {
			// KV Namespaces
			BETA_LOGS_KV: KVNamespace;
			BETA_USERS_KV: KVNamespace;
			BETA_LOGS_TRASH_KV: KVNamespace;
			BETA_USER_SETTINGS_KV: KVNamespace;
			BETA_HUGHESNET_KV: KVNamespace;
			BETA_PLACES_KV: KVNamespace;
			BETA_DIRECTIONS_KV: KVNamespace;
			BETA_SESSIONS_KV: KVNamespace;

			// Durable Objects
			TRIP_INDEX_DO: DurableObjectNamespace;
			PLACES_INDEX_DO: DurableObjectNamespace;

			// Secrets & Config
			HNS_ENCRYPTION_KEY: string;
			PUBLIC_GOOGLE_MAPS_API_KEY: string;
			PRIVATE_GOOGLE_MAPS_API_KEY: string;

			// Allow other environment bindings without strict typing
			[key: string]: unknown;
		}

		interface Platform {
			env: Env;
			context: {
				waitUntil(promise: Promise<unknown>): void;
			};
			caches: CacheStorage & { default: Cache };
		}
	}
}

export {};
