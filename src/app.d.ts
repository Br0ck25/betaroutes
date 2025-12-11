// src/app.d.ts
declare global {
	namespace App {
		interface Locals {
			token: string | null;
			user: {
				id: string; // <--- ADD THIS
				token: string;
				plan: string;
				tripsThisMonth: number;
				maxTrips: number;
				resetDate: string;
				name?: string;
				email?: string;
			} | null;
		}
		interface Platform {
			env: {
				BETA_LOGS_KV: KVNamespace;
				BETA_USERS_KV: KVNamespace;
				BETA_LOGS_TRASH_KV: KVNamespace;
				BETA_USER_SETTINGS_KV: KVNamespace;
				BETA_HUGHESNET_KV: KVNamespace;
                		HNS_ENCRYPTION_KEY: string;
				PUBLIC_GOOGLE_MAPS_API_KEY: string;
			};
		}
	}
}

export {};