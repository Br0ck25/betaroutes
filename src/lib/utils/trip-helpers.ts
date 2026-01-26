import type { Trip, Stop } from '$lib/types';

export function formatCurrency(amount: number): string {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2
	}).format(amount);
}

export function formatDate(dateString: string): string {
	if (!dateString) return '';
	const date = new Date(dateString);
	if (isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(date);
}

export function formatTime(time: string): string {
	if (!time) return '';
	if (time.toLowerCase().includes('am') || time.toLowerCase().includes('pm')) {
		return time;
	}
	const [h = 0, m = 0] = time.split(':').map(Number);
	if (isNaN(h)) return time;
	const ampm = h >= 12 ? 'PM' : 'AM';
	const h12 = h % 12 || 12;
	const mStr = !isNaN(m) ? m.toString().padStart(2, '0') : '00';
	return `${h12}:${mStr} ${ampm}`;
}

export function formatDuration(minutes: number): string {
	if (!minutes) return '-';
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

export function formatHours(hours: number): string {
	if (!hours || hours === 0) return '-';
	const h = Math.floor(hours);
	const m = Math.round((hours - h) * 60);
	if (h > 0 && m > 0) return `${h}h ${m}m`;
	if (h > 0) return `${h}h`;
	return `${m}m`;
}

export function calculateNetProfit(trip: Partial<Trip>): number {
	const earnings =
		(trip.stops as Stop[] | undefined)?.reduce(
			(s: number, stop: Stop) => s + (stop.earnings || 0),
			0
		) || 0;
	const costs = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
	return earnings - costs;
}

export function calculateHourlyPay(trip: Partial<Trip>): number {
	const profit = calculateNetProfit(trip);
	const hours = trip.hoursWorked || 0;
	return hours > 0 ? profit / hours : 0;
}
