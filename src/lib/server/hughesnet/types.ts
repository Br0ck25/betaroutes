// src/lib/server/hughesnet/types.ts
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
    departureIncomplete?: boolean;
    _status?: string;
    [key: string]: any;
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