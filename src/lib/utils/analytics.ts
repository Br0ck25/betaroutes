// Analytics calculation functions for trip and expense data

import { SvelteDate } from '$lib/utils/svelte-reactivity';
import type { Trip, Stop } from '$lib/types';

export interface TripAnalytics {
  // Revenue metrics
  totalRevenue: number;
  avgRevenuePerTrip: number;
  avgRevenuePerMile: number;
  revenueByServiceType: Record<string, number>;

  // Cost metrics
  totalExpenses: number;
  totalFuelCost: number;
  totalMaintenanceCost: number;
  totalSuppliesCost: number;
  avgExpensePerTrip: number;
  avgCostPerMile: number;

  // Profit metrics
  netProfit: number;
  avgProfitPerTrip: number;
  profitMargin: number;

  // Mileage metrics
  totalMiles: number;
  avgMilesPerTrip: number;

  // Time metrics
  totalHours: number;
  avgHoursPerTrip: number;
  avgHourlyRate: number;

  // Trip counts
  totalTrips: number;
  tripsByServiceType: Record<string, number>;
}

export interface MonthlyComparison {
  currentMonth: {
    revenue: number;
    expenses: number;
    profit: number;
    trips: number;
    miles: number;
  };
  previousMonth: {
    revenue: number;
    expenses: number;
    profit: number;
    trips: number;
    miles: number;
  };
  changes: {
    revenue: { amount: number; percent: number };
    expenses: { amount: number; percent: number };
    profit: { amount: number; percent: number };
    trips: { amount: number; percent: number };
    miles: { amount: number; percent: number };
  };
}

export interface PeriodBreakdown {
  weekly: Array<{ week: string; revenue: number; expenses: number; profit: number; trips: number }>;
  monthly: Array<{
    month: string;
    revenue: number;
    expenses: number;
    profit: number;
    trips: number;
  }>;
  quarterly: Array<{
    quarter: string;
    revenue: number;
    expenses: number;
    profit: number;
    trips: number;
  }>;
}

/**
 * Calculate comprehensive analytics from trip data
 */
export function calculateTripAnalytics(trips: Trip[]): TripAnalytics {
  if (trips.length === 0) {
    return {
      totalRevenue: 0,
      avgRevenuePerTrip: 0,
      avgRevenuePerMile: 0,
      revenueByServiceType: {},
      totalExpenses: 0,
      totalFuelCost: 0,
      totalMaintenanceCost: 0,
      totalSuppliesCost: 0,
      avgExpensePerTrip: 0,
      avgCostPerMile: 0,
      netProfit: 0,
      avgProfitPerTrip: 0,
      profitMargin: 0,
      totalMiles: 0,
      avgMilesPerTrip: 0,
      totalHours: 0,
      avgHoursPerTrip: 0,
      avgHourlyRate: 0,
      totalTrips: 0,
      tripsByServiceType: {}
    };
  }

  let totalRevenue = 0;
  let totalFuelCost = 0;
  let totalMaintenanceCost = 0;
  let totalSuppliesCost = 0;
  let totalMiles = 0;
  let totalHours = 0;
  const revenueByServiceType: Record<string, number> = {};
  const tripsByServiceType: Record<string, number> = {};

  trips.forEach((trip) => {
    // Revenue from stops
    const tripRevenue =
      trip.stops?.reduce(
        (sum: number, stop: { earnings?: number }) => sum + (stop.earnings || 0),
        0
      ) || 0;
    totalRevenue += tripRevenue;

    // Expenses
    totalFuelCost += trip.fuelCost || 0;
    totalMaintenanceCost += trip.maintenanceCost || 0;
    totalSuppliesCost += trip.suppliesCost || 0;

    // Mileage
    totalMiles += trip.totalMiles || 0;

    // Hours
    totalHours += trip.hoursWorked || 0;

    // Service type tracking - ensure initialization before mutation
    const serviceType = trip.serviceType || 'Other';
    const prevRev = revenueByServiceType[serviceType] ?? 0;
    const prevTrips = tripsByServiceType[serviceType] ?? 0;
    revenueByServiceType[serviceType] = prevRev + tripRevenue;
    tripsByServiceType[serviceType] = prevTrips + 1;
  });

  const totalExpenses = totalFuelCost + totalMaintenanceCost + totalSuppliesCost;
  const netProfit = totalRevenue - totalExpenses;
  const totalTrips = trips.length;

  return {
    totalRevenue,
    avgRevenuePerTrip: totalTrips > 0 ? totalRevenue / totalTrips : 0,
    avgRevenuePerMile: totalMiles > 0 ? totalRevenue / totalMiles : 0,
    revenueByServiceType,
    totalExpenses,
    totalFuelCost,
    totalMaintenanceCost,
    totalSuppliesCost,
    avgExpensePerTrip: totalTrips > 0 ? totalExpenses / totalTrips : 0,
    avgCostPerMile: totalMiles > 0 ? totalExpenses / totalMiles : 0,
    netProfit,
    avgProfitPerTrip: totalTrips > 0 ? netProfit / totalTrips : 0,
    profitMargin: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0,
    totalMiles,
    avgMilesPerTrip: totalTrips > 0 ? totalMiles / totalTrips : 0,
    totalHours,
    avgHoursPerTrip: totalTrips > 0 ? totalHours / totalTrips : 0,
    avgHourlyRate: totalHours > 0 ? netProfit / totalHours : 0,
    totalTrips,
    tripsByServiceType
  };
}

/**
 * Compare current month to previous month
 */
export function calculateMonthlyComparison(allTrips: Trip[]): MonthlyComparison {
  const now = SvelteDate.now().toDate();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const currentMonthTrips = allTrips.filter((trip) => {
    if (!trip.date) return false;
    const tripDate = SvelteDate.from(trip.date).toDate();
    if (isNaN(tripDate.getTime())) return false;
    return tripDate >= currentMonthStart;
  });

  const previousMonthTrips = allTrips.filter((trip) => {
    if (!trip.date) return false;
    const tripDate = SvelteDate.from(trip.date).toDate();
    if (isNaN(tripDate.getTime())) return false;
    return tripDate >= previousMonthStart && tripDate <= previousMonthEnd;
  });

  const current = calculateTripAnalytics(currentMonthTrips);
  const previous = calculateTripAnalytics(previousMonthTrips);

  const calculateChange = (curr: number, prev: number) => ({
    amount: curr - prev,
    percent: prev > 0 ? ((curr - prev) / prev) * 100 : 0
  });

  return {
    currentMonth: {
      revenue: current.totalRevenue,
      expenses: current.totalExpenses,
      profit: current.netProfit,
      trips: current.totalTrips,
      miles: current.totalMiles
    },
    previousMonth: {
      revenue: previous.totalRevenue,
      expenses: previous.totalExpenses,
      profit: previous.netProfit,
      trips: previous.totalTrips,
      miles: previous.totalMiles
    },
    changes: {
      revenue: calculateChange(current.totalRevenue, previous.totalRevenue),
      expenses: calculateChange(current.totalExpenses, previous.totalExpenses),
      profit: calculateChange(current.netProfit, previous.netProfit),
      trips: calculateChange(current.totalTrips, previous.totalTrips),
      miles: calculateChange(current.totalMiles, previous.totalMiles)
    }
  };
}

/**
 * Break down data by time periods
 */
export function calculatePeriodBreakdown(trips: Trip[]): PeriodBreakdown {
  type PeriodAggregate = {
    week: string;
    month: string;
    quarter: string;
    revenue: number;
    expenses: number;
    profit: number;
    trips: number;
  };
  const weeklyData: Record<string, PeriodAggregate> = {};
  const monthlyData: Record<string, PeriodAggregate> = {};
  const quarterlyData: Record<string, PeriodAggregate> = {};

  trips.forEach((trip) => {
    if (!trip.date) return;
    const tripDate = SvelteDate.from(trip.date).toDate();
    if (isNaN(tripDate.getTime())) return;

    const revenue =
      trip.stops?.reduce((sum: number, stop: Stop) => sum + (stop.earnings || 0), 0) || 0;
    const expenses = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
    const profit = revenue - expenses;

    // Weekly
    const weekStart = new Date(tripDate);
    weekStart.setDate(tripDate.getDate() - tripDate.getDay());
    const weekKey: string = String(weekStart.toISOString().split('T')[0]);
    const wk =
      weeklyData[weekKey] ??
      (weeklyData[weekKey] = {
        week: weekKey,
        month: weekKey.slice(0, 7),
        quarter: `${weekKey.slice(0, 4)}-Q${Math.floor(SvelteDate.from(weekKey).getMonth() / 3) + 1}`,
        revenue: 0,
        expenses: 0,
        profit: 0,
        trips: 0
      });
    wk.revenue += revenue;
    wk.expenses += expenses;
    wk.profit += profit;
    wk.trips++;

    // Monthly
    const monthKey: string = `${tripDate.getFullYear()}-${String(tripDate.getMonth() + 1).padStart(2, '0')}`;
    const mn =
      monthlyData[monthKey] ??
      (monthlyData[monthKey] = {
        month: monthKey,
        week: `${monthKey}-W01`,
        quarter: `${monthKey.slice(0, 4)}-Q${Math.floor(SvelteDate.from(monthKey + '-01').getMonth() / 3) + 1}`,
        revenue: 0,
        expenses: 0,
        profit: 0,
        trips: 0
      });
    mn.revenue += revenue;
    mn.expenses += expenses;
    mn.profit += profit;
    mn.trips++;

    // Quarterly
    const quarter = Math.floor(tripDate.getMonth() / 3) + 1;
    const quarterKey = `${tripDate.getFullYear()}-Q${quarter}`;
    const qtr =
      quarterlyData[quarterKey] ??
      (quarterlyData[quarterKey] = {
        quarter: quarterKey,
        month: `${quarterKey}-M01`,
        week: `${quarterKey}-W01`,
        revenue: 0,
        expenses: 0,
        profit: 0,
        trips: 0
      });
    qtr.revenue += revenue;
    qtr.expenses += expenses;
    qtr.profit += profit;
    qtr.trips++;
  });

  return {
    weekly: Object.values(weeklyData).sort((a: PeriodAggregate, b: PeriodAggregate) =>
      (a.week || '').localeCompare(b.week || '')
    ),
    monthly: Object.values(monthlyData).sort((a: PeriodAggregate, b: PeriodAggregate) =>
      (a.month || '').localeCompare(b.month || '')
    ),
    quarterly: Object.values(quarterlyData).sort((a: PeriodAggregate, b: PeriodAggregate) =>
      (a.quarter || '').localeCompare(b.quarter || '')
    )
  };
}

/**
 * Format currency
 */
export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Format percentage with sign
 */
export function formatPercentChange(percent: number): string {
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(1)}%`;
}

/**
 * Get trend indicator
 */
export function getTrendIndicator(percent: number): string {
  if (percent > 5) return '↑';
  if (percent < -5) return '↓';
  return '→';
}
