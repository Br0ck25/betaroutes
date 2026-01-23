// src/lib/types/index.ts

/** Core user type used across the app */
export interface User {
	id?: string; // optional user id
	token: string;
	plan: 'free' | 'pro' | 'business' | 'premium'; // include legacy 'premium' value used in fixtures
	tripsThisMonth: number;
	maxTrips: number;
	resetDate: string;
	name?: string;
	email?: string;
	/** Phase 2 migration tracking - tracks storage key migration from username to user ID */
	migrationStatus?: {
		storageKeysMigrated: boolean;
		migratedAt?: string; // ISO timestamp
		recordsMigrated?: number;
	};
}

/** Geo helpers */
export interface LatLng {
	lat: number;
	lng: number;
}

export interface GeocodeResult {
	// Google/Mapbox style results (legacy code accesses these fields)
	formatted_address?: string;
	name?: string;
	geometry?: { location?: { lat?: number; lng?: number } };
	lat?: number;
	lng?: number;
	address?: string;
	raw?: any;
}

export interface Location extends LatLng {
	address?: string;
}

export interface UnsanitizedLocation {
	lat?: unknown;
	lng?: unknown;
	address?: unknown;
}

/** Destination / stop shapes */
export interface Destination {
	id?: string;
	address: string;
	earnings: number;
	location?: LatLng | null; // some code assigns a location object
}

export interface Stop {
	id?: string;
	address?: string;
	earnings?: number;
	notes?: string;
	order?: number;
	location?: LatLng | null;
}

export interface CostItem {
	id?: string;
	type: string;
	cost: number;
	taxDeductible?: boolean;
}

export type MaintenanceCost = CostItem;
export type SupplyCost = CostItem;

/** Trip shape (backwards-compatible fields included) */
export interface Trip {
	id?: string;
	date?: string; // YYYY-MM-DD
	// legacy/start time variants
	startTime?: string; // HH:MM
	endTime?: string; // HH:MM
	startClock?: string; // legacy name
	endClock?: string; // legacy name

	startAddress?: string;
	endAddress?: string;
	startLocation?: LatLng | null;
	endLocation?: LatLng | null;

	// Stops may be called 'stops' or 'destinations' depending on past versions
	stops?: Stop[];
	destinations?: Destination[];

	// mileage/earnings
	totalMiles?: number;
	totalMileage?: number;
	estimatedTime?: number;
	totalTime?: string;
	totalEarnings?: number;

	fuelCost?: number;
	maintenanceCost?: number;
	maintenanceItems?: MaintenanceCost[];
	suppliesCost?: number;
	supplyItems?: SupplyCost[]; // canonical
	suppliesItems?: SupplyCost[]; // legacy

	hoursWorked?: number;
	netProfit?: number;
	profitPerHour?: number;
	mpg?: number;
	gasPrice?: number;
	notes?: string;
	lastModified?: string; // ISO 8601 timestamp
	isOptimized?: boolean;
	originalOrder?: Destination[];
	serviceType?: string;
}

export interface RouteResult {
	distance: number; // in miles
	duration: number; // in seconds
	route: google.maps.DirectionsResult;
}

export interface Subscription {
	plan: 'free' | 'pro' | 'business' | 'premium';
	tripsThisMonth: number;
	maxTrips: number;
	features: string[];
	resetDate: string;
}

export interface AuthResponse {
	token: string;
	resetKey?: string;
}

export interface ApiError {
	error: string;
	code?: string;
	details?: any;
}

export interface TripFilters {
	startDate?: string;
	endDate?: string;
	searchQuery?: string;
	minProfit?: number;
	maxProfit?: number;
}

export interface TripStats {
	totalProfit: number;
	totalTrips: number;
	avgProfitPerHour: number;
	totalMiles: number;
	totalFuelCost: number;
	totalMaintenanceCost: number;
	totalSuppliesCost: number;
}

export interface ChartData {
	labels: string[];
	datasets: {
		label: string;
		data: number[];
		backgroundColor?: string | string[];
		borderColor?: string;
	}[];
}

export interface Settings {
	defaultStartAddress: string;
	defaultEndAddress: string;
	defaultMPG: number;
	defaultGasPrice: number;
	recentDestinations: string[];
	maintenanceCategories: string[];
	supplyCategories: string[];
}

/** Unsanitized input shapes (used by sanitize utilities) */
export interface UnsanitizedStop {
	id?: unknown;
	address?: unknown;
	earnings?: unknown;
	notes?: unknown;
	order?: unknown;
	location?: unknown;
}

export interface UnsanitizedDestination {
	id?: unknown;
	address?: unknown;
	earnings?: unknown;
	location?: unknown;
}

export interface UnsanitizedCostItem {
	type?: unknown;
	cost?: unknown;
	taxDeductible?: unknown;
}

export interface UnsanitizedTrip {
	id?: unknown;
	date?: unknown;
	startTime?: unknown;
	endTime?: unknown;
	hoursWorked?: unknown;
	startAddress?: unknown;
	startLocation?: unknown;
	endAddress?: unknown;
	endLocation?: unknown;
	totalMiles?: unknown;
	estimatedTime?: unknown;
	totalTime?: unknown;
	mpg?: unknown;
	gasPrice?: unknown;
	fuelCost?: unknown;
	maintenanceCost?: unknown;
	suppliesCost?: unknown;
	totalEarnings?: unknown;
	netProfit?: unknown;
	notes?: unknown;
	stops?: unknown;
	destinations?: unknown;
	maintenanceItems?: unknown;
	suppliesItems?: unknown;
	lastModified?: unknown;
}

/** Cloudflare KV rate limit shape used by rate limiter */
export interface RateLimitData {
	count: number;
	windowStart: number; // ms since epoch
}

// Backwards compat aliases (if code imports these exact names)
export type Geocode = GeocodeResult;
export type LatLngLiteral = LatLng;
