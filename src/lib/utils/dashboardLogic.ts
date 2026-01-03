// src/lib/utils/dashboardLogic.ts

export type TimeRange = '30d' | '60d' | '90d' | '1y' | 'all';

export function formatCurrency(amount: number): string {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	}).format(amount);
}

export function formatDate(dateString: string): string {
	if (/^\d{4}-\d{2}$/.test(dateString)) {
		const parts = dateString.split('-');
		const y = Number(parts[0] || '0');
		const m = Number(parts[1] || '1');
		const date = new Date(y, (m || 1) - 1, 1);
		return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(date);
	}
	const date = new Date(dateString.includes('T') ? dateString : dateString + 'T00:00:00');
	return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

// Helper to assign consistent colors to categories
function getCategoryColor(category: string): string {
	const map: Record<string, string> = {
		fuel: '#FF7F50', // Orange
		maintenance: '#29ABE2', // Blue
		supplies: '#8DC63F', // Green
		insurance: '#9333EA', // Purple
		other: '#6B7280' // Gray
	};
	const catKey = category.toLowerCase();
	const mappedColor = map[catKey];
	if (mappedColor) return mappedColor;

	// Generate pastel color for custom categories
	let hash = 0;
	for (let i = 0; i < category.length; i++) {
		hash = category.charCodeAt(i) + ((hash << 5) - hash);
	}
	const h = Math.abs(hash) % 360;
	return `hsl(${h}, 70%, 60%)`;
}

export function calculateDashboardStats(
	allTrips: any[],
	allExpenses: any[] = [],
	range: TimeRange = '30d'
) {
	const now = new Date();
	now.setHours(23, 59, 59, 999);
	const currentYear = now.getFullYear();

	// 1. Determine Date Ranges
	let startDate: Date;
	let prevStartDate: Date;
	let groupBy: 'day' | 'month' = 'day';

	switch (range) {
		case '30d':
			startDate = new Date(now);
			startDate.setDate(now.getDate() - 30);
			prevStartDate = new Date(startDate);
			prevStartDate.setDate(startDate.getDate() - 30);
			break;
		case '60d':
			startDate = new Date(now);
			startDate.setDate(now.getDate() - 60);
			prevStartDate = new Date(startDate);
			prevStartDate.setDate(startDate.getDate() - 60);
			break;
		case '90d':
			startDate = new Date(now);
			startDate.setDate(now.getDate() - 90);
			prevStartDate = new Date(startDate);
			prevStartDate.setDate(startDate.getDate() - 90);
			break;
		case '1y':
			startDate = new Date(currentYear, 0, 1);
			prevStartDate = new Date(currentYear - 1, 0, 1);
			groupBy = 'month';
			break;
		case 'all':
			startDate = new Date(0);
			prevStartDate = new Date(0);
			groupBy = 'month';
			break;
		default:
			startDate = new Date(now);
			startDate.setDate(now.getDate() - 30);
			prevStartDate = new Date(startDate);
			prevStartDate.setDate(startDate.getDate() - 30);
	}

	const chartDataMap = new Map<string, number>();

	// Fill buckets
	if (range !== 'all') {
		const d = new Date(startDate);
		while (d <= now) {
			let key: string;
			if (groupBy === 'month') {
				key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
				d.setMonth(d.getMonth() + 1);
			} else {
				key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
				d.setDate(d.getDate() + 1);
			}
			if (!chartDataMap.has(key)) chartDataMap.set(key, 0);
		}
	}

	const currentTrips: any[] = [];
	let totalProfit = 0;
	let prevTotalProfit = 0;
	let totalMiles = 0;

	// Track costs by category (e.g., fuel: 100, insurance: 50)
	const categoryTotals: Record<string, number> = {
		fuel: 0,
		maintenance: 0,
		supplies: 0
	};

	// 2. Process Trips
	for (const trip of allTrips) {
		if (!trip.date) continue;
		const d = new Date(trip.date.includes('T') ? trip.date : trip.date + 'T00:00:00');
		const tTime = d.getTime();

		const earnings =
			trip.stops?.reduce((s: number, stop: any) => s + (Number(stop.earnings) || 0), 0) || 0;
		const fuelCost = Number(trip.fuelCost) || 0;
		const maintCost = Number(trip.maintenanceCost) || 0;
		const supplyCost = Number(trip.suppliesCost) || 0;

		const tripCosts = fuelCost + maintCost + supplyCost;
		const tripProfit = earnings - tripCosts;

		// Current Range
		if (tTime >= startDate.getTime() && tTime <= now.getTime()) {
			currentTrips.push(trip);
			totalProfit += tripProfit;
			totalMiles += Number(trip.totalMiles) || 0;

			categoryTotals['fuel'] = (categoryTotals['fuel'] || 0) + fuelCost;
			categoryTotals['maintenance'] = (categoryTotals['maintenance'] || 0) + maintCost;
			categoryTotals['supplies'] = (categoryTotals['supplies'] || 0) + supplyCost;

			// Chart Data
			let key: string;
			if (groupBy === 'month') {
				key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
			} else {
				key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
			}
			const currentVal = chartDataMap.get(key) || 0;
			chartDataMap.set(key, currentVal + tripProfit);
		}

		// Previous Range
		if (range !== 'all' && tTime >= prevStartDate.getTime() && tTime < startDate.getTime()) {
			prevTotalProfit += tripProfit;
		}
	}

	// 3. Process General Expenses
	for (const exp of allExpenses) {
		if (!exp.date) continue;
		const d = new Date(exp.date.includes('T') ? exp.date : exp.date + 'T00:00:00');
		const tTime = d.getTime();
		const amount = Number(exp.amount) || 0;
		const category = (exp.category || 'other').toLowerCase();

		if (tTime >= startDate.getTime() && tTime <= now.getTime()) {
			totalProfit -= amount; // Deduct expense from profit

			// Add to Cost Breakdown
			categoryTotals[category] = (categoryTotals[category] || 0) + amount;

			// Deduct from Chart Data (Daily Profit)
			let key: string;
			if (groupBy === 'month') {
				key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
			} else {
				key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
			}
			// For 'all' range with month grouping, key might not exist yet if only expense exists
			if (!chartDataMap.has(key) && range === 'all') chartDataMap.set(key, 0);

			if (chartDataMap.has(key)) {
				chartDataMap.set(key, chartDataMap.get(key)! - amount);
			}
		}

		if (range !== 'all' && tTime >= prevStartDate.getTime() && tTime < startDate.getTime()) {
			prevTotalProfit -= amount;
		}
	}

	// 4. Final Shaping
	const chartData = Array.from(chartDataMap.entries())
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([date, profit]) => ({ date, profit }));

	// Generate Dynamic Cost Breakdown Array
	const totalCost = Object.values(categoryTotals).reduce((a, b) => a + b, 0);

	const costBreakdown = Object.entries(categoryTotals)
		.filter(([, amount]) => amount > 0)
		.map(([category, amount]) => ({
			category,
			amount,
			percentage: totalCost > 0 ? (amount / totalCost) * 100 : 0,
			color: getCategoryColor(category)
		}))
		.sort((a, b) => b.amount - a.amount); // Largest first

	// Comparison Stats
	let change = 0;
	if (range !== 'all') {
		if (prevTotalProfit !== 0) {
			change = ((totalProfit - prevTotalProfit) / Math.abs(prevTotalProfit)) * 100;
		} else if (totalProfit > 0) {
			change = 100;
		}
	}

	const periodComparison = {
		current: totalProfit,
		last: prevTotalProfit,
		change: change,
		isPositive: change >= 0
	};

	const sortedCurrentTrips = [...currentTrips].sort(
		(a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
	);

	return {
		recentTrips: sortedCurrentTrips.slice(0, 5),
		totalTrips: currentTrips.length,
		totalProfit,
		totalMiles,
		avgProfitPerTrip: currentTrips.length > 0 ? totalProfit / currentTrips.length : 0,
		chartData,
		costBreakdown, // Now an array of objects
		totalCost,
		periodComparison
	};
}

/**
 * Compute maintenance banner visibility and message.
 * Returns { visible, message, dueIn, reminderThreshold }
 */
export function computeMaintenance(opts: {
	vehicleOdometerStart?: number | string;
	totalMilesAllTime?: number | string;
	lastServiceOdometer?: number | string;
	serviceIntervalMiles?: number | string;
	reminderThresholdMiles?: number | string;
}) {
	const vehicleOdometerStart = Number(opts.vehicleOdometerStart || 0);
	const totalMilesAllTime = Number(opts.totalMilesAllTime || 0);
	const lastServiceOdometer = Number(opts.lastServiceOdometer || 0);
	const serviceIntervalMiles = Number(opts.serviceIntervalMiles || 0);
	const reminderThreshold = Number(opts.reminderThresholdMiles || 500);

	const currentOdometer = vehicleOdometerStart + totalMilesAllTime;
	const milesSinceService = Math.max(0, currentOdometer - lastServiceOdometer);
	const dueIn = serviceIntervalMiles - milesSinceService;

	const visible = Boolean(serviceIntervalMiles && dueIn <= reminderThreshold);
	const message =
		dueIn >= 0
			? `You have driven ${Math.round(milesSinceService).toLocaleString()} miles since your last service. Due in ${Math.round(dueIn).toLocaleString()} miles.`
			: `Overdue by ${Math.abs(Math.round(dueIn)).toLocaleString()} miles — please service now.`;

	return { visible, message, dueIn, reminderThreshold };
}
