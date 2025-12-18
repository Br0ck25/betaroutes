// src/lib/types/index.ts

// ============================================================================
// Location & Geography Types
// ============================================================================

export interface LatLng {
	lat: number;
	lng: number;
}

export interface Location {
	lat: number;
	lng: number;
}

export interface GeocodeResult {
	formatted_address?: string;
	name?: string;
	secondary_text?: string;
	place_id?: string;
	geometry?: {
		location: Location;
	};
	source?: string;
}

// ============================================================================
// User & Session Types
// ============================================================================

export interface User {
	id?: string;
	token: string;
	plan: 'free' | 'pro' | 'business' | 'premium' | 'enterprise';
	tripsThisMonth: number;
	maxTrips: number;
	resetDate: string;
	name?: string;
	email?: string;
}

export interface SessionData {
	id: string;
	name?: string;
	email?: string;
	plan?: string;
	tripsThisMonth?: number;
	maxTrips?: number;
	resetDate?: string;
}

// ============================================================================
// Trip Component Types
// ============================================================================

export interface Stop {
	id?: string;
	address?: string;
	earnings?: number;
	notes?: string;
	order?: number;
	location?: LatLng;
}

export interface Destination {
	address: string;
	earnings: number;
	location?: LatLng;
}

export interface MaintenanceCost {
	type: string;
	cost: number;
}

export interface SupplyCost {
	type: string;
	cost: number;
}

export interface CostItem {
	type: string;
	cost: number;
}

// ============================================================================
// Trip Types
// ============================================================================

export interface Trip {
	id?: string;
	date: string; // YYYY-MM-DD
	startTime?: string; // HH:MM
	endTime?: string; // HH:MM
	estimatedTime?: number; // Minutes
	totalTime?: string; // "1h 30m"
	startAddress: string;
	startLocation?: LatLng;
	endAddress: string;
	endLocation?: LatLng;
	destinations: Destination[];
	stops?: Stop[];
	totalMiles: number;
	totalEarnings: number;
	fuelCost: number;
	maintenanceCost: number;
	maintenanceItems?: MaintenanceCost[];
	suppliesCost: number;
	supplyItems?: SupplyCost[];
	suppliesItems?: SupplyCost[];
	hoursWorked?: number;
	netProfit: number;
	profitPerHour?: number;
	mpg: number;
	gasPrice: number;
	notes?: string;
	lastModified: string; // ISO 8601 timestamp
	isOptimized?: boolean;
	originalOrder?: Destination[];
	userId?: string;
	createdAt?: string;
	updatedAt?: string;
}

// ============================================================================
// Unsanitized Input Types (unknown data from user)
// ============================================================================

export type UnknownRecord = Record<string, unknown>;

export interface UnsanitizedLocation {
	lat?: unknown;
	lng?: unknown;
}

export interface UnsanitizedStop {
	id?: unknown;
	address?: unknown;
	earnings?: unknown;
	notes?: unknown;
	order?: unknown;
	location?: unknown;
}

export interface UnsanitizedDestination {
	address?: unknown;
	earnings?: unknown;
	location?: unknown;
}

export interface UnsanitizedCostItem {
	type?: unknown;
	cost?: unknown;
}

export interface UnsanitizedTrip extends UnknownRecord {
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

// ============================================================================
// Route & Optimization Types
// ============================================================================

export interface RouteResult {
	distance: number; // in miles
	duration: number; // in seconds
	totalMiles?: number;
	totalMinutes?: number;
	route: google.maps.DirectionsResult;
	optimizedOrder?: number[];
}

// ============================================================================
// Subscription & Features Types
// ============================================================================

export interface Subscription {
	plan: 'free' | 'pro' | 'business';
	tripsThisMonth: number;
	maxTrips: number;
	features: string[];
	resetDate: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface AuthResponse {
	token: string;
	resetKey?: string;
}

export interface ApiError {
	error: string;
	code?: string;
	message?: string;
	details?: unknown;
}

export interface ApiSuccess<T = unknown> {
	success: boolean;
	data?: T;
}

// ============================================================================
// Filter & Stats Types
// ============================================================================

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

// ============================================================================
// Chart & Visualization Types
// ============================================================================

export interface ChartData {
	labels: string[];
	datasets: {
		label: string;
		data: number[];
		backgroundColor?: string | string[];
		borderColor?: string;
	}[];
}

// ============================================================================
// Settings Types
// ============================================================================

export interface Settings {
	defaultStartAddress: string;
	defaultEndAddress: string;
	defaultMPG: number;
	defaultGasPrice: number;
	recentDestinations: string[];
	maintenanceCategories: string[];
	supplyCategories: string[];
}

// ============================================================================
// Rate Limiting Types
// ============================================================================

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	resetAt?: Date;
	limit?: number;
}

export interface RateLimitConfig {
	limit: number;
	windowMs: number;
}

export interface RateLimitData {
	count: number;
	windowStart: number;
}

// ============================================================================
// Utility Types
// ============================================================================

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type Maybe<T> = T | null | undefined;