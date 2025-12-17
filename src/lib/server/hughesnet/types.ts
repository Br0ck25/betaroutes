// src/lib/server/hughesnet/types.ts

// Issue #3: Removed index signature for true type safety
export interface OrderData {
    id: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    confirmScheduleDate: string;
    beginTime: string;
    type: string;
    jobDuration: number;
    hasPoleMount?: boolean;
    hasWifiExtender?: boolean;
    hasVoip?: boolean;
    departureIncomplete?: boolean;
    arrivalTimestamp?: number;
    departureCompleteTimestamp?: number;
    departureIncompleteTimestamp?: number;
    _status?: 'pending' | 'failed';
    // Resync tracking fields
    syncStatus?: 'complete' | 'incomplete' | 'future' | 'removed';
    needsResync?: boolean;
    lastSyncTimestamp?: number;
    lastPaymentUpdate?: number;
}

// Type for orders with computed metadata
export interface OrderWithMeta extends OrderData {
    _sortTime: number;
    _isPaid: boolean;
    _actualDuration: number;
}

// Type for trip stops
export interface TripStop {
    id: string;
    address: string;
    order: number;
    notes: string;
    earnings: number;
    appointmentTime: string;
    type: string;
    duration: number;
}

// Type for supply items
export interface SupplyItem {
    id: string;
    type: string;
    cost: number;
}

// Type for complete trip
export interface Trip {
    id: string;
    userId: string;
    date: string;
    startTime: string;
    endTime: string;
    estimatedTime: number;
    totalTime: string;
    hoursWorked: number;
    startAddress: string;
    endAddress: string;
    totalMiles: number;
    mpg: number;
    gasPrice: number;
    fuelCost: number;
    totalEarnings: number;
    netProfit: number;
    suppliesCost: number;
    supplyItems: SupplyItem[];
    stops: TripStop[];
    createdAt: string;
    updatedAt: string;
    syncStatus: string;
    lastModified?: string;
}

// Type for sync configuration
export interface SyncConfig {
    installPay: number;
    repairPay: number;
    upgradePay: number;
    poleCost: number;
    concreteCost: number;
    poleCharge: number;
    wifiExtenderPay: number;
    voipPay: number;
    driveTimeBonus: number; // [!code ++] Changed from adminBonus
}

// Type for sync result
export interface SyncResult {
    orders: OrderData[];
    incomplete: boolean;
}

// Issue #1: Type for distributed lock
export interface DistributedLock {
    lockId: string;
    ownerId: string;
    expiresAt: number;
}

export interface GeocodedPoint {
    lat: number;
    lon: number;
    formattedAddress?: string;
}

export interface RouteLeg {
    distance: number; // meters
    duration: number; // seconds
}

export interface FetcherOptions {
    headers?: Record<string, string>;
    method?: string;
    body?: any;
    redirect?: RequestRedirect;
}