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
			} | null;
		}
	}
}

export {};
