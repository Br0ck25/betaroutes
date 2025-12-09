// src/app.d.ts
declare global {
	namespace App {
		interface Locals {
			token: string | null;
			user: {
				token: string;
				plan: string;
				tripsThisMonth: number;
				maxTrips: number;
				resetDate: string;
				name?: string;  // Add these for profile sync
				email?: string; // Add these for profile sync
			} | null;
		}
		// Add the Platform interface with your KVs
		interface Platform {
			env: {
				BETA_LOGS_KV: KVNamespace;
				BETA_USERS_KV: KVNamespace;
				BETA_LOGS_TRASH_KV: KVNamespace;
				BETA_USER_SETTINGS_KV: KVNamespace;
				PUBLIC_GOOGLE_MAPS_API_KEY: string;
			};
		}
	}
}

export {};