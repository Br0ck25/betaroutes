// src/lib/utils/calculations.ts

import type { Trip, Destination, MaintenanceCost, SupplyCost } from '$lib/types';

export function calculateFuelCost(miles: number, mpg: number, gasPrice: number): number {
  if (mpg <= 0) return 0;
  const gallons = miles / mpg;
  return Number((gallons * gasPrice).toFixed(2));
}

export function calculateTotalEarnings(destinations: Destination[]): number {
  return destinations.reduce((sum, dest) => sum + (dest.earnings || 0), 0);
}

export function calculateMaintenanceCost(items: MaintenanceCost[]): number {
  return items.reduce((sum, item) => sum + (item.cost || 0), 0);
}

export function calculateSupplyCost(items: SupplyCost[]): number {
  return items.reduce((sum, item) => sum + (item.cost || 0), 0);
}

export function calculateNetProfit(
  totalEarnings: number,
  fuelCost: number,
  maintenanceCost: number,
  suppliesCost: number
): number {
  return Number((totalEarnings - fuelCost - maintenanceCost - suppliesCost).toFixed(2));
}

export function calculateProfitPerHour(netProfit: number, hoursWorked: number): number {
  if (hoursWorked <= 0) return 0;
  return Number((netProfit / hoursWorked).toFixed(2));
}

export function calculateHoursWorked(startTime: string, endTime: string): number {
  if (!startTime || !endTime) return 0;
  
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  
  let diffMinutes = endMinutes - startMinutes;
  if (diffMinutes < 0) {
    diffMinutes += 24 * 60; // Handle overnight shifts
  }
  
  return Number((diffMinutes / 60).toFixed(2));
}

export function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  
  if (hours === 0) {
    return `${mins} minutes`;
  } else if (mins === 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  } else {
    return `${hours} hour${hours > 1 ? 's' : ''} ${mins} minute${mins > 1 ? 's' : ''}`;
  }
}

export function calculateTripTotals(
  distance: number,
  durationMinutes: number,
  destinations: Destination[],
  mpg: number,
  gasPrice: number,
  maintenanceItems: MaintenanceCost[] = [],
  supplyItems: SupplyCost[] = [],
  startTime?: string,
  endTime?: string
): Partial<Trip> {
  const totalEarnings = calculateTotalEarnings(destinations);
  const fuelCost = calculateFuelCost(distance, mpg, gasPrice);
  const maintenanceCost = calculateMaintenanceCost(maintenanceItems);
  const suppliesCost = calculateSupplyCost(supplyItems);
  const netProfit = calculateNetProfit(totalEarnings, fuelCost, maintenanceCost, suppliesCost);
  const hoursWorked = startTime && endTime ? calculateHoursWorked(startTime, endTime) : 0;
  const profitPerHour = hoursWorked > 0 ? calculateProfitPerHour(netProfit, hoursWorked) : 0;

  return {
    totalMileage: Number(distance.toFixed(2)),
    totalTime: formatTime(durationMinutes),
    totalEarnings,
    fuelCost,
    maintenanceCost,
    suppliesCost,
    netProfit,
    profitPerHour,
    hoursWorked,
  };
}

export function milesToKm(miles: number): number {
  return Number((miles * 1.60934).toFixed(2));
}

export function kmToMiles(km: number): number {
  return Number((km / 1.60934).toFixed(2));
}
