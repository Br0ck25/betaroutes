<script lang="ts">
	import { trips } from '$lib/stores/trips';
	import { base } from '$app/paths';
	const resolve = (href: string) => `${base}${href}`;
	import { expenses } from '$lib/stores/expenses'; // [!code ++]
	import { userSettings } from '$lib/stores/userSettings';
	import { toasts } from '$lib/stores/toast';
	import {
		calculateDashboardStats,
		formatCurrency,
		formatDate,
		type TimeRange
	} from '$lib/utils/dashboardLogic';

	let selectedRange: TimeRange = '30d';

	// [!code change] Pass $expenses to the calculator
	$: stats = calculateDashboardStats($trips, $expenses, selectedRange);

	// --- Maintenance reminder calculations (all-time) ---
	$: allStats = calculateDashboardStats($trips, $expenses, 'all');
	$: currentOdometer = (Number($userSettings.vehicleOdometerStart || 0) + Number(allStats.totalMiles || 0));
	$: milesSinceService = Math.max(0, currentOdometer - Number($userSettings.lastServiceOdometer || 0));
	$: dueIn = (Number($userSettings.serviceIntervalMiles || 5000) - milesSinceService);
	$: reminderThreshold = Number($userSettings.reminderThresholdMiles || 500);
	$: maintenanceMessage = dueIn >= 0
		? `You have driven ${Math.round(milesSinceService).toLocaleString()} miles since your last service. Due in ${Math.round(dueIn).toLocaleString()} miles.`
		: `Overdue by ${Math.abs(Math.round(dueIn)).toLocaleString()} miles — please service now.`;

	async function markServicedNow() {
		const newOdo = Math.round(currentOdometer || 0);
		try {
			userSettings.update((s) => ({ ...s, lastServiceOdometer: newOdo, lastServiceDate: new Date().toISOString() }));
			// Persist
			const res = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ settings: { lastServiceOdometer: newOdo, lastServiceDate: new Date().toISOString() } })
			});
			if (!res.ok) throw new Error('Failed to persist service mark');
			toasts.success('Marked vehicle as serviced');
		} catch (e) {
			console.error(e);
			toasts.error('Could not mark serviced');
		}
	}

	const rangeLabels = {
		// ... existing labels
		'30d': 'Last 30 days',
		'60d': 'Last 60 days',
		'90d': 'Last 90 days',
		'1y': 'Current Year',
		all: 'All Time'
	};
</script>

<svelte:head>
	<title>Dashboard - Go Route Yourself</title>
</svelte:head>

<div class="dashboard">
	<div class="page-header">
		<div class="header-left">
			<h1 class="page-title">Dashboard</h1>
			<p class="page-subtitle">
				Overview for <span class="highlight-text">{rangeLabels[selectedRange]}</span>
			</p>
		</div>

		<div class="header-actions">
			<select bind:value={selectedRange} class="range-select">
				<option value="30d">Last 30 Days</option>
				<option value="60d">Last 60 Days</option>
				<option value="90d">Last 90 Days</option>
				<option value="1y">Current Year</option>
				<option value="all">All Time</option>
			</select>

			<a href={resolve('/dashboard/trips/new')} class="btn-primary">
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
					<path
						d="M10 4V16M4 10H16"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				New Trip
			</a>
		</div>
	</div>

	{#if $userSettings.lastServiceOdometer && $userSettings.lastServiceOdometer > currentOdometer}
		<div class="alert info" style="background:#E0F2FE; color:#0369A1; border:1px solid #60A5FA; padding:12px; border-radius:8px; margin:16px 0;">
			Note: Your recorded last service odometer ({$userSettings.lastServiceOdometer.toLocaleString()}) is higher than the current estimated odometer ({Math.round(currentOdometer).toLocaleString()} mi). If this isn't expected, set <a href="/dashboard/settings">Vehicle odometer start</a> in Settings or update your last service reading.
		</div>
	{/if}

	{#if $userSettings.serviceIntervalMiles}
		<div class="alert maintenance" class:error={dueIn < 0} class:warning={dueIn >= 0 && dueIn <= reminderThreshold} style="display:flex; align-items:center; gap:12px; margin:16px 0; padding:12px; border-radius:10px; background:#FFFBEB; color:#92400E; border:1px solid #F59E0B;">
			<div style="font-weight:600">{maintenanceMessage}</div>
			<div style="margin-left:auto">
				<button class="btn-secondary" on:click={markServicedNow}>Mark serviced now</button>
			</div>
		</div>
	{/if}

	<div class="stats-grid">
		<div class="stat-card featured">
			<div class="stat-header">
				<div class="stat-icon orange">
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
						<path
							d="M12 2L2 7L12 12L22 7L12 2Z"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<path
							d="M2 17L12 22L22 17"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<path
							d="M2 12L12 17L22 12"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</div>
				<span class="stat-label">Total Profit</span>
			</div>
			<div class="stat-value">{formatCurrency(stats.totalProfit)}</div>

			{#if selectedRange !== 'all'}
				<div
					class="stat-change"
					class:positive={stats.periodComparison.isPositive}
					class:negative={!stats.periodComparison.isPositive}
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
						{#if stats.periodComparison.isPositive}
							<path
								d="M8 12V4M8 4L4 8M8 4L12 8"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						{:else}
							<path
								d="M8 4V12M8 12L4 8M8 12L12 8"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						{/if}
					</svg>
					{Math.abs(stats.periodComparison.change).toFixed(1)}% vs previous
				</div>
			{/if}
		</div>

		<div class="stat-card">
			<div class="stat-header">
				<div class="stat-icon blue">
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
						<path
							d="M21 10C21 17 12 23 12 23C12 23 3 17 3 10C3 7.61305 3.94821 5.32387 5.63604 3.63604C7.32387 1.94821 9.61305 1 12 1C14.3869 1 16.6761 1.94821 18.364 3.63604C20.0518 5.32387 21 7.61305 21 10Z"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<path
							d="M12 13C13.6569 13 15 11.6569 15 10C15 8.34315 13.6569 7 12 7C10.3431 7 9 8.34315 9 10C9 11.6569 10.3431 13 12 13Z"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</div>
				<span class="stat-label">Total Trips</span>
			</div>
			<div class="stat-value">{stats.totalTrips}</div>
			<div class="stat-info">{rangeLabels[selectedRange]}</div>
		</div>

		<div class="stat-card">
			<div class="stat-header">
				<div class="stat-icon green">
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
						<path
							d="M13 2L3 14H12L11 22L21 10H12L13 2Z"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</div>
				<span class="stat-label">Avg Profit/Trip</span>
			</div>
			<div class="stat-value">{formatCurrency(stats.avgProfitPerTrip)}</div>
			<div class="stat-info">{rangeLabels[selectedRange]}</div>
		</div>

		<div class="stat-card">
			<div class="stat-header">
				<div class="stat-icon purple">
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
						<path
							d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<path
							d="M2 12H22"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</div>
				<span class="stat-label">Total Miles</span>
			</div>
			<div class="stat-value">
				{stats.totalMiles.toLocaleString(undefined, { maximumFractionDigits: 1 })}
			</div>
			<div class="stat-info">{rangeLabels[selectedRange]}</div>
		</div>
	</div>

	<div class="charts-grid">
		<div class="chart-card">
			<div class="chart-header">
				<div>
					<h3 class="chart-title">Profit Trend</h3>
					<p class="chart-subtitle">{rangeLabels[selectedRange]}</p>
				</div>
				<div class="chart-legend">
					<div class="legend-item">
						<div class="legend-dot orange"></div>
						<span>Daily Profit</span>
					</div>
				</div>
			</div>

			<div class="chart-container">
				{#if stats.chartData.some((d) => d.profit !== 0)}
					{@const maxProfit = Math.max(...stats.chartData.map((d) => Math.abs(d.profit)), 1)}
					<div class="bar-chart">
						{#each stats.chartData as day}
							{@const height = (Math.abs(day.profit) / maxProfit) * 100}
							<div class="bar-wrapper">
								<div
									class="bar"
									class:negative={day.profit < 0}
									style="height: {height}%; opacity: {day.profit === 0 ? 0 : 1}"
									title="{formatDate(day.date)}: {formatCurrency(day.profit)}"
								></div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="empty-state">
						<svg width="48" height="48" viewBox="0 0 48 48" fill="none">
							<path
								d="M8 36V12M16 36V20M24 36V24M32 36V16M40 36V28"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
						<p>No data for this period</p>
					</div>
				{/if}
			</div>
		</div>

		<div class="chart-card">
			<div class="chart-header">
				<div>
					<h3 class="chart-title">Cost Breakdown</h3>
					<p class="chart-subtitle">Expenses in period</p>
				</div>
			</div>

			<div class="chart-container">
				{#if stats.totalCost > 0}
					{#key stats.costBreakdown}
						{@const radius = 70}
						{@const circumference = 2 * Math.PI * radius}

						<div class="donut-chart">
							<svg viewBox="0 0 200 200">
								{#each stats.costBreakdown as item, i}
									{@const prevItems = stats.costBreakdown.slice(0, i)}
									{@const offset = prevItems.reduce(
										(acc, curr) => acc + (curr.percentage / 100) * circumference,
										0
									)}
									{@const length = (item.percentage / 100) * circumference}

									<circle
										cx="100"
										cy="100"
										r={radius}
										fill="none"
										stroke={item.color}
										stroke-width="30"
										stroke-dasharray="{length} {circumference}"
										stroke-dashoffset={-offset}
										transform="rotate(-90 100 100)"
									/>
								{/each}
							</svg>

							<div class="donut-legend">
								{#each stats.costBreakdown as item}
									<div class="legend-item">
										<div class="legend-dot" style="background: {item.color}"></div>
										<div class="legend-text">
											<span class="legend-label" style="text-transform: capitalize"
												>{item.category}</span
											>
											<span class="legend-value">{formatCurrency(item.amount)}</span>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/key}
				{:else}
					<div class="empty-state">
						<svg width="48" height="48" viewBox="0 0 48 48" fill="none">
							<circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2" />
							<path
								d="M24 14V24L30 30"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
							/>
						</svg>
						<p>No expenses for this period</p>
					</div>
				{/if}
			</div>
		</div>
	</div>

	<div class="section-card">
		<div class="section-header">
			<div>
				<h3 class="section-title">Recent Trips</h3>
				<p class="section-subtitle">Latest from selected period</p>
			</div>
			<a href="/dashboard/trips" class="btn-secondary">
				View All
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
					<path
						d="M6 12L10 8L6 4"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</a>
		</div>

		{#if stats.recentTrips.length > 0}
			<div class="trips-list">
				{#each stats.recentTrips as trip}
					{@const earnings =
						trip.stops?.reduce((s: number, stop: any) => s + (Number(stop.earnings) || 0), 0) || 0}
					{@const costs =
						(Number(trip.fuelCost) || 0) +
						(Number(trip.maintenanceCost) || 0) +
						(Number(trip.suppliesCost) || 0)}
					{@const profit = earnings - costs}

					<a href="/dashboard/trips?id={trip.id}" class="trip-item">
						<div class="trip-icon">
							<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
								<path
									d="M17 9L9 2L1 9V17C1 17.5304 1.21071 18.0391 1.58579 18.4142C1.96086 18.7893 2.46957 19 3 19H15C15.5304 19 16.0391 18.7893 16.4142 18.4142C16.7893 18.0391 17 17.5304 17 17V9Z"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</div>

						<div class="trip-info">
							<div class="trip-route">
								<span class="trip-start">{trip.startAddress?.split(',')[0] || 'Unknown'}</span>
								<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
									<path
										d="M6 12L10 8L6 4"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
								<span class="trip-destination">
									{trip.stops && trip.stops.length > 0
										? trip.stops[trip.stops.length - 1].address?.split(',')[0] || 'Multiple stops'
										: 'No stops'}
								</span>
							</div>
							<div class="trip-meta">
								<span>{formatDate(trip.date || '')}</span>
								<span>•</span>
								<span>{(Number(trip.totalMiles) || 0).toFixed(1)} mi</span>
								{#if trip.stops && trip.stops.length > 0}
									<span>•</span>
									<span>{trip.stops.length} stops</span>
								{/if}
							</div>
						</div>

						<div class="trip-profit" class:positive={profit >= 0} class:negative={profit < 0}>
							{formatCurrency(profit)}
						</div>
					</a>
				{/each}
			</div>
		{:else}
			<div class="empty-state-large">
				<svg width="64" height="64" viewBox="0 0 64 64" fill="none">
					<path
						d="M8 24L32 8L56 24V48C56 49.0609 55.5786 50.0783 54.8284 50.8284C54.0783 51.5786 53.0609 52 52 52H12C10.9391 52 9.92172 51.5786 9.17157 50.8284C8.42143 50.0783 8 49.0609 8 48V24Z"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
					<path
						d="M24 52V32H40V52"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				<h4>No trips found</h4>
				<p>No trips found in this date range.</p>
				<a href="/dashboard/trips/new" class="btn-primary">
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
						<path
							d="M10 4V16M4 10H16"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					Create Trip
				</a>
			</div>
		{/if}
	</div>
</div>

<style>
	.bar.negative {
		background: linear-gradient(180deg, #ef4444 0%, #dc2626 100%);
	}

	.dashboard {
		max-width: 1400px;
		margin: 0 auto;
		padding: 16px;
	}
	.page-header {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-bottom: 24px;
	}
	.header-actions {
		display: flex;
		gap: 12px;
		width: 100%;
	}
	.range-select {
		flex: 1;
		padding: 10px;
		border-radius: 10px;
		border: 1px solid #e5e7eb;
		background: white;
		font-size: 14px;
		color: #374151;
		cursor: pointer;
	}
	@media (min-width: 640px) {
		.page-header {
			flex-direction: row;
			justify-content: space-between;
			align-items: center;
		}
		.header-actions {
			width: auto;
		}
		.range-select {
			width: 160px;
			flex: none;
		}
	}
	.page-title {
		font-size: 24px;
		font-weight: 800;
		color: #111827;
		margin-bottom: 4px;
		margin-top: 0;
	}
	.page-subtitle {
		font-size: 14px;
		color: #6b7280;
		margin: 0;
	}
	.highlight-text {
		color: var(--orange);
		font-weight: 600;
	}
	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 12px 16px;
		background: linear-gradient(135deg, var(--orange) 0%, #ff6a3d 100%);
		color: white;
		border: none;
		border-radius: 10px;
		font-weight: 600;
		font-size: 14px;
		text-decoration: none;
		cursor: pointer;
		transition: all 0.2s;
		box-shadow: 0 4px 12px rgba(255, 127, 80, 0.3);
		white-space: nowrap;
	}
	.btn-primary:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 16px rgba(255, 127, 80, 0.4);
	}
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 16px;
		background: white;
		color: #6b7280;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-weight: 600;
		font-size: 14px;
		text-decoration: none;
		transition: all 0.2s;
	}
	.btn-secondary:hover {
		border-color: var(--orange);
		color: var(--orange);
	}
	.stats-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 16px;
		margin-bottom: 24px;
	}
	.stat-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 16px;
		padding: 20px;
		transition: all 0.2s;
	}
	.stat-card:hover {
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
		transform: translateY(-2px);
	}
	.stat-card.featured {
		background: linear-gradient(135deg, var(--orange) 0%, #ff6a3d 100%);
		color: white;
		border: none;
		box-shadow: 0 8px 24px rgba(255, 127, 80, 0.3);
	}
	.stat-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
	}
	.stat-icon {
		width: 40px;
		height: 40px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
	}
	.stat-icon.orange {
		background: rgba(255, 127, 80, 0.2);
	}
	.stat-icon.blue {
		background: linear-gradient(135deg, var(--blue) 0%, #1e9bcf 100%);
	}
	.stat-icon.green {
		background: linear-gradient(135deg, var(--green) 0%, #7ab82e 100%);
	}
	.stat-icon.purple {
		background: linear-gradient(135deg, var(--purple) 0%, #764a89 100%);
	}
	.stat-card.featured .stat-icon {
		background: rgba(255, 255, 255, 0.2);
	}
	.stat-label {
		font-size: 14px;
		font-weight: 600;
		color: #6b7280;
	}
	.stat-card.featured .stat-label {
		color: rgba(255, 255, 255, 0.9);
	}
	.stat-value {
		font-size: 28px;
		font-weight: 800;
		color: #111827;
		margin-bottom: 4px;
	}
	.stat-card.featured .stat-value {
		color: white;
	}
	.stat-change {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
	}
	.stat-change.positive {
		color: rgba(255, 255, 255, 0.9);
	}
	.stat-change.negative {
		color: rgba(255, 255, 255, 0.8);
	}
	.stat-info {
		font-size: 13px;
		color: #9ca3af;
	}
	.charts-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 24px;
		margin-bottom: 32px;
	}
	.chart-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 16px;
		padding: 20px;
	}
	.chart-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 20px;
		flex-wrap: wrap;
		gap: 12px;
	}
	.chart-title {
		font-size: 18px;
		font-weight: 700;
		color: #111827;
		margin: 0 0 4px 0;
	}
	.chart-subtitle {
		font-size: 14px;
		color: #6b7280;
		margin: 0;
	}
	.chart-legend {
		display: flex;
		gap: 16px;
	}
	.legend-item {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: #6b7280;
	}
	.legend-dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
	}
	.legend-dot.orange {
		background: var(--orange);
	}
	.chart-container {
		height: 240px;
		position: relative;
	}
	.bar-chart {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 100%;
		padding: 12px 0;
	}
	.bar-wrapper {
		flex: 1;
		height: 100%;
		display: flex;
		align-items: flex-end;
	}
	.bar {
		width: 100%;
		background: linear-gradient(180deg, var(--orange) 0%, #ff6a3d 100%);
		border-radius: 4px 4px 0 0;
		min-height: 4px;
		transition: all 0.2s;
		cursor: pointer;
	}
	.bar:hover {
		opacity: 0.8;
	}
	.donut-chart {
		display: flex;
		flex-direction: column;
		gap: 24px;
		align-items: center;
		height: 100%;
		justify-content: center;
	}
	.donut-chart svg {
		width: 180px;
		height: 180px;
	}
	.donut-legend {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.donut-legend .legend-item {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
	}
	.donut-legend .legend-dot {
		width: 16px;
		height: 16px;
		border-radius: 4px;
		flex-shrink: 0;
	}
	.legend-text {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}
	.legend-label {
		font-size: 14px;
		color: #6b7280;
	}
	.legend-value {
		font-size: 16px;
		font-weight: 700;
		color: #111827;
	}
	.section-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 16px;
		padding: 20px;
	}
	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 20px;
	}
	.section-title {
		font-size: 18px;
		font-weight: 700;
		color: #111827;
		margin: 0 0 4px 0;
	}
	.section-subtitle {
		font-size: 14px;
		color: #6b7280;
		margin: 0;
	}
	.trips-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.trip-item {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		text-decoration: none;
		transition: all 0.2s;
	}
	.trip-item:hover {
		border-color: var(--orange);
		background: white;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
	}
	.trip-icon {
		width: 40px;
		height: 40px;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--orange);
		flex-shrink: 0;
		align-self: flex-start;
	}
	.trip-info {
		flex: 1;
		min-width: 0;
		width: 100%;
	}
	.trip-route {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		color: #111827;
		margin-bottom: 4px;
		flex-wrap: wrap;
	}
	.trip-route svg {
		color: #9ca3af;
		flex-shrink: 0;
	}
	.trip-start,
	.trip-destination {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}
	.trip-meta {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: #6b7280;
	}
	.trip-profit {
		font-size: 18px;
		font-weight: 700;
		flex-shrink: 0;
		align-self: flex-end;
	}
	.trip-profit.positive {
		color: var(--green);
	}
	.trip-profit.negative {
		color: #dc2626;
	}
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: #9ca3af;
		text-align: center;
	}
	.empty-state svg {
		margin-bottom: 12px;
		color: #d1d5db;
	}
	.empty-state p {
		font-size: 14px;
		color: #6b7280;
	}
	.empty-state-large {
		padding: 48px 24px;
		text-align: center;
	}
	.empty-state-large svg {
		color: #d1d5db;
		margin: 0 auto 24px;
	}
	.empty-state-large h4 {
		font-size: 18px;
		font-weight: 700;
		color: #111827;
		margin-bottom: 8px;
	}
	.empty-state-large p {
		font-size: 15px;
		color: #6b7280;
		margin-bottom: 24px;
	}
	@media (min-width: 640px) {
		.page-title {
			font-size: 32px;
		}
		.page-subtitle {
			font-size: 16px;
		}
		.btn-primary {
			padding: 12px 24px;
			font-size: 15px;
		}
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}
		.trip-item {
			flex-direction: row;
			align-items: center;
		}
		.trip-icon {
			align-self: center;
		}
		.trip-profit {
			align-self: center;
		}
	}
	@media (min-width: 1024px) {
		.stats-grid {
			grid-template-columns: repeat(4, 1fr);
		}
		.charts-grid {
			grid-template-columns: repeat(2, 1fr);
		}
		.donut-chart {
			flex-direction: row;
			justify-content: flex-start;
		}
		.donut-chart svg {
			width: 200px;
			height: 200px;
		}
		.legend-text {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
