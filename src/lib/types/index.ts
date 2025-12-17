// src/lib/types/index.ts

// [!code ++] New Interface
export interface LatLng {
    lat: number;
    lng: number;
}

export interface User {
	token: string;
	plan: 'free' | 'pro' | 'business';
	tripsThisMonth: number;
	maxTrips: number;
	resetDate: string;
	name?: string;
	email?: string;
}

export interface Destination {
	address: string;
	earnings: number;
    location?: LatLng; // [!code ++]
}

export interface MaintenanceCost {
	type: string;
	cost: number;
}

export interface SupplyCost {
	type: string;
	cost: number;
}

export interface Trip {
	id?: string;
	date: string; // YYYY-MM-DD
	startTime?: string; // HH:MM
	endTime?: string; // HH:MM
    estimatedTime?: number; // Minutes
    totalTime?: string; // "1h 30m"
	startAddress: string;
    startLocation?: LatLng; // [!code ++]
	endAddress: string;
    endLocation?: LatLng;   // [!code ++]
	destinations: Destination[];
	
    totalMiles: number; 

	totalEarnings: number;
	fuelCost: number;
	maintenanceCost: number;
	maintenanceItems?: MaintenanceCost[];
	suppliesCost: number;
	supplyItems?: SupplyCost[];
	hoursWorked?: number;
	netProfit: number;
	profitPerHour: number;
	mpg: number;
	gasPrice: number;
	notes?: string;
	lastModified: string; // ISO 8601 timestamp
	isOptimized?: boolean;
	originalOrder?: Destination[];
    [key: string]: any;
}

export interface RouteResult {
	distance: number; // in miles
	duration: number; // in seconds
	route: google.maps.DirectionsResult;
}

export interface Subscription {
	plan: 'free' | 'pro' | 'business';
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

export interface RouteResult {
    totalMiles: number;
    totalMinutes: number;
    route: google.maps.DirectionsResult;
    optimizedOrder?: number[]; // [!code ++]
}