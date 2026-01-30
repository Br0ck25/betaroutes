// src/lib/utils/calculations.ts

import type { Trip, Destination, MaintenanceCost, SupplyCost } from '$lib/types';

// [!code ++] Helper functions for Integer Math
const toCents = (amount: number) => Math.round(amount * 100);
const toDollars = (cents: number) => cents / 100;

export function calculateFuelCost(miles: number, mpg: number, gasPrice: number): number {
  if (mpg <= 0) return 0;
  const gallons = miles / mpg;

  // Calculate in cents to avoid floating point errors
  const costInCents = Math.round(gallons * gasPrice * 100);
  return toDollars(costInCents);
}

export function calculateTotalEarnings(destinations: Destination[]): number {
  const totalCents = destinations.reduce((sum, dest) => {
    return sum + toCents(dest.earnings || 0);
  }, 0);
  return toDollars(totalCents);
}

export function calculateMaintenanceCost(items: MaintenanceCost[]): number {
  const totalCents = items.reduce((sum, item) => {
    return sum + toCents(item.cost || 0);
  }, 0);
  return toDollars(totalCents);
}

export function calculateSupplyCost(items: SupplyCost[]): number {
  const totalCents = items.reduce((sum, item) => {
    return sum + toCents(item.cost || 0);
  }, 0);
  return toDollars(totalCents);
}

export function calculateNetProfit(
  totalEarnings: number,
  fuelCost: number,
  maintenanceCost: number,
  suppliesCost: number
): number {
  // Convert all inputs to cents before subtracting
  const earningsCents = toCents(totalEarnings);
  const fuelCents = toCents(fuelCost);
  const maintCents = toCents(maintenanceCost);
  const suppliesCents = toCents(suppliesCost);

  const netCents = earningsCents - fuelCents - maintCents - suppliesCents;
  return toDollars(netCents);
}

export function calculateProfitPerHour(netProfit: number, hoursWorked: number): number {
  if (hoursWorked <= 0) return 0;

  const netCents = toCents(netProfit);
  // Calculate rate in cents/hour, then round to nearest cent
  const perHourCents = netCents / hoursWorked;

  return toDollars(Math.round(perHourCents));
}

export function calculateHoursWorked(startTime: string, endTime: string): number {
  if (!startTime || !endTime) return 0;

  const [startHour = 0, startMin = 0] = startTime.split(':').map(Number);
  const [endHour = 0, endMin = 0] = endTime.split(':').map(Number);

  const startMinutes = (startHour || 0) * 60 + (startMin || 0);
  const endMinutes = (endHour || 0) * 60 + (endMin || 0);

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
  // Use the integer-math functions
  const totalEarnings = calculateTotalEarnings(destinations);
  const fuelCost = calculateFuelCost(distance, mpg, gasPrice);
  const maintenanceCost = calculateMaintenanceCost(maintenanceItems);
  const suppliesCost = calculateSupplyCost(supplyItems);

  const netProfit = calculateNetProfit(totalEarnings, fuelCost, maintenanceCost, suppliesCost);
  const hoursWorked = startTime && endTime ? calculateHoursWorked(startTime, endTime) : 0;
  const profitPerHour = hoursWorked > 0 ? calculateProfitPerHour(netProfit, hoursWorked) : 0;

  return {
    totalMiles: Number(distance.toFixed(2)),
    totalMileage: Number(distance.toFixed(2)), // backward-compat alias
    totalTime: formatTime(durationMinutes),
    totalEarnings,
    fuelCost,
    maintenanceCost,
    suppliesCost,
    netProfit,
    profitPerHour,
    hoursWorked
  };
}

export function milesToKm(miles: number): number {
  return Number((miles * 1.60934).toFixed(2));
}

export function kmToMiles(km: number): number {
  return Number((km / 1.60934).toFixed(2));
}
