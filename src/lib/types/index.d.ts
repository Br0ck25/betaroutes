// Lightweight shared types used across the app

export type Location = { lat: number; lng: number };

export type Stop = {
	id?: string;
	address?: string;
	earnings?: number;
	notes?: string;
	order?: number;
	location?: Location;
};

export type Destination = {
	address?: string;
	earnings?: number;
	location?: Location;
};

export type CostItem = {
	id?: string;
	type?: string;
	item?: string;
	cost?: number;
	taxDeductible?: boolean;
};

export type Trip = {
	id?: string;
	date?: string;
	payDate?: string;
	startTime?: string;
	endTime?: string;
	hoursWorked?: number;
	startAddress?: string;
	startLocation?: Location;
	endAddress?: string;
	endLocation?: Location;
	totalMiles?: number;
	estimatedTime?: number;
	totalTime?: string;
	mpg?: number;
	gasPrice?: number;
	fuelCost?: number;
	maintenanceCost?: number;
	suppliesCost?: number;
	totalEarnings?: number;
	netProfit?: number;
	notes?: string;
	stops?: Stop[];
	destinations?: Destination[];
	maintenanceItems?: CostItem[];
	suppliesItems?: CostItem[];
	lastModified?: string;
	serviceType?: string;
};

export type UnsanitizedLocation = { lat?: unknown; lng?: unknown };
export type UnsanitizedStop = {
	id?: unknown;
	address?: unknown;
	earnings?: unknown;
	notes?: unknown;
	order?: unknown;
	location?: unknown;
};
export type UnsanitizedDestination = {
	address?: unknown;
	earnings?: unknown;
	location?: unknown;
};
export type UnsanitizedCostItem = {
	id?: unknown;
	type?: unknown;
	item?: unknown;
	cost?: unknown;
};
export type UnsanitizedTrip = {
	id?: unknown;
	date?: unknown;
	payDate?: unknown;
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
};

export type RateLimitData = {
	count: number;
	windowStart: number;
};

export type User = {
	id?: string;
	name?: string;
	email?: string;
	token?: string;
	plan?: 'free' | 'premium' | 'pro' | 'business' | string;
	tripsThisMonth?: number;
	maxTrips?: number;
	resetDate?: string;
};

export type LatLng = Location;
export type TripRecord = Trip;
export type Settings = Record<string, unknown>;
export type AuthResponse = { token?: string; resetKey?: string };
export type Subscription = {
	plan?: string;
	tripsThisMonth?: number;
	maxTrips?: number;
	resetDate?: string;
};
export type MaintenanceCost = CostItem;
export type SupplyCost = CostItem;

export type GeocodeResult = {
	formatted_address?: string;
	name?: string;
	geometry?: { location?: { lat?: number; lng?: number } };
};

export {};
