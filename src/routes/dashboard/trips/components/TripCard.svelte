<script lang="ts">
	import {
		formatCurrency,
		formatDate,
		formatTime,
		formatDuration,
		calculateNetProfit,
		calculateHourlyPay
	} from '$lib/utils/trip-helpers';
	import { swipeable } from '$lib/actions/swipe';
	import { createEventDispatcher } from 'svelte';

	export let trip: any;
	export let isExpanded = false;
	export let isSelected = false;

	const dispatch = createEventDispatcher();

	$: profit = calculateNetProfit(trip);
	$: hourlyPay = calculateHourlyPay(trip);
	$: totalCosts = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
	$: supplies = trip.supplyItems || trip.suppliesItems || [];

	function openGoogleMaps(e: MouseEvent, trip: any) {
		e.stopPropagation();
		const origin = encodeURIComponent(trip.startAddress || '');
		const destination = encodeURIComponent(trip.endAddress || trip.startAddress || '');

		let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
		if (trip.stops && trip.stops.length > 0) {
			const waypoints = trip.stops
				.map((s: any) => encodeURIComponent(s.address || ''))
				.filter((a: string) => a.length > 0)
				.join('|');
			if (waypoints) {
				url += `&waypoints=${waypoints}`;
			}
		}
		window.open(url, '_blank');
	}

	async function openMapToStop(e: MouseEvent, trip: any, stopIndex: number) {
		e.stopPropagation();
		const targetStop = trip.stops[stopIndex];
		const destination = targetStop.address || '';

		// Try to get the user's current location (with a timeout). If unavailable, omit origin so Google uses current location.
		let originParam = '';
		function getCurrentPosition(timeout = 5000) {
			return new Promise<GeolocationPosition>((resolve, reject) => {
				if (!navigator.geolocation) return reject(new Error('Geolocation unsupported'));
				let timedOut = false;
				const timer = setTimeout(() => {
					timedOut = true;
					reject(new Error('Geolocation timeout'));
				}, timeout);

				navigator.geolocation.getCurrentPosition(
					(pos) => {
						if (timedOut) return;
						clearTimeout(timer);
						resolve(pos);
					},
					(err) => {
						if (timedOut) return;
						clearTimeout(timer);
						reject(err);
					},
					{ enableHighAccuracy: true, maximumAge: 0 }
				);
			});
		}

		try {
			const pos = await getCurrentPosition(5000);
			originParam = `${pos.coords.latitude},${pos.coords.longitude}`;
		} catch (_err) {
			// If we can't get geolocation, omit the origin parameter so Google will use the user's current location.
			originParam = '';
		}

		const params = new URLSearchParams({ api: '1', destination });
		if (originParam) params.set('origin', originParam);
		// Note: do not include earlier stops as waypoints — map should go from current location to the selected stop only.

		const url = `https://www.google.com/maps/dir/?${params.toString()}`;
		window.open(url, '_blank');
	}

	function handleEdit() {
		dispatch('edit', trip.id);
	}
	function handleDelete() {
		dispatch('delete', trip.id);
	}
	function handleExpand() {
		dispatch('toggleExpand', trip.id);
	}
	function handleSelection() {
		dispatch('toggleSelection', trip.id);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleExpand();
		}
	}
</script>

<div class="trip-card-wrapper">
	<div class="swipe-bg">
		<div class="swipe-action edit"><span>Edit</span></div>
		<div class="swipe-action delete"><span>Delete</span></div>
	</div>

	<div
		class="trip-card"
		id={'trip-' + trip.id}
		class:expanded={isExpanded}
		class:selected={isSelected}
		on:click={handleExpand}
		on:keydown={handleKeydown}
		role="button"
		tabindex="0"
		aria-expanded={isExpanded}
		use:swipeable={{ onEdit: handleEdit, onDelete: handleDelete }}
	>
		<div class="card-top">
			<div class="selection-box" role="none">
				<label class="checkbox-container">
					<input
						type="checkbox"
						aria-labelledby={'trip-' + trip.id + '-title'}
						checked={isSelected}
						on:click|stopPropagation
						on:keydown|stopPropagation
						on:change={handleSelection}
					/>
					<span class="checkmark"></span>
				</label>
			</div>

			<div class="trip-route-date">
				<span class="trip-date-display">
					{formatDate(trip.date || '')}
					{#if trip.startTime}
						<span class="time-range"
							>• {formatTime(trip.startTime)} - {formatTime(trip.endTime || '17:00')}</span
						>
					{/if}
				</span>

				<div class="trip-title-row">
					<h3 class="trip-route-title" id={'trip-' + trip.id + '-title'}>
						{typeof trip.startAddress === 'string' ? trip.startAddress.split(',')[0] : 'Unknown'}
						{#if trip.stops && trip.stops.length > 0}
							→ {typeof trip.stops[trip.stops.length - 1]?.address === 'string'
								? trip.stops[trip.stops.length - 1].address.split(',')[0]
								: 'Stop'}
						{/if}
					</h3>

					<button
						class="map-link-btn"
						on:click|stopPropagation={(e) => openGoogleMaps(e, trip)}
						title="View Route in Google Maps"
						aria-label="View Route in Google Maps"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"></path>
							<path
								d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z"
							></path>
						</svg>
					</button>
				</div>
			</div>

			<div class="profit-display-large" class:positive={profit >= 0} class:negative={profit < 0}>
				{formatCurrency(profit)}
			</div>

			<svg
				class="expand-icon"
				width="20"
				height="20"
				viewBox="0 0 20 20"
				fill="none"
				aria-hidden="true"
			>
				<path
					d="M6 15L10 11L14 15M14 5L10 9L6 5"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				/>
			</svg>
		</div>

		<div class="card-stats">
			<div class="stat-item">
				<span class="stat-label">Miles</span>
				<span class="stat-value">{trip.totalMiles?.toFixed(1) || '0.0'}</span>
			</div>
			<div class="stat-item">
				<span class="stat-label">Stops</span>
				<span class="stat-value">{trip.stops?.length || 0}</span>
			</div>
			<div class="stat-item">
				<span class="stat-label">Hours</span>
				<span class="stat-value">{trip.hoursWorked?.toFixed(1) || '-'}</span>
			</div>
			<div class="stat-item">
				<span class="stat-label">Drive</span>
				<span class="stat-value">{formatDuration(trip.estimatedTime)}</span>
			</div>

			<div class="stat-item">
				<span class="stat-label">$/Hr</span>
				<span class="stat-value hourly-pay"
					>{trip.hoursWorked > 0 ? formatCurrency(hourlyPay) : '-'}</span
				>
			</div>
		</div>

		{#if isExpanded}
			<div class="expanded-details" role="group">
				<div class="detail-section">
					<h4 class="section-heading">Stops & Addresses</h4>
					<div class="address-list">
						<div class="address-row">
							<span class="address-text"><strong>Start:</strong> {trip.startAddress}</span>
						</div>
						{#if trip.stops}
							{#each trip.stops as stop, i}
								<div class="address-row">
									<span class="address-text"><strong>Stop {i + 1}:</strong> {stop.address}</span>
									{#if Number(stop.earnings) > 0}
										<span
											class="stop-amount"
											title={formatCurrency(Number(stop.earnings))}
											aria-label={`Stop amount ${formatCurrency(Number(stop.earnings))}`}
											data-testid={`stop-amount-${i}`}
										>
											{formatCurrency(Number(stop.earnings))}
										</span>
									{/if}
									<button
										class="mini-map-btn"
										on:click|stopPropagation={(e) => openMapToStop(e, trip, i)}
										title="Map route from Start to here"
									>
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
										</svg>
									</button>
								</div>
							{/each}
						{/if}

						{#if trip.endAddress && trip.endAddress !== trip.startAddress}
							<div class="address-row">
								<span class="address-text"><strong>End:</strong> {trip.endAddress}</span>
								<button
									class="mini-map-btn"
									on:click|stopPropagation={(e) => openGoogleMaps(e, trip)}
									title="Map full route"
								>
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
									</svg>
								</button>
							</div>
						{/if}
					</div>
				</div>

				{#if totalCosts > 0}
					<div class="detail-section">
						<h4 class="section-heading">Expenses & Costs</h4>
						<div class="expense-list">
							{#if trip.fuelCost > 0}
								<div class="expense-row">
									<span>Fuel</span>
									<span>{formatCurrency(trip.fuelCost)}</span>
								</div>
							{/if}

							{#if trip.maintenanceItems}
								{#each trip.maintenanceItems as item}
									<div class="expense-row">
										<span>{item.type}</span>
										<span>{formatCurrency(item.cost)}</span>
									</div>
								{/each}
							{/if}
							{#if supplies.length > 0}
								{#each supplies as item}
									<div class="expense-row">
										<span>{item.type}</span>
										<span>{formatCurrency(item.cost)}</span>
									</div>
								{/each}
							{/if}
							<div class="expense-row total">
								<span>Total Costs</span>
								<span>{formatCurrency(totalCosts)}</span>
							</div>
						</div>
					</div>
				{/if}

				{#if trip.notes}
					<div class="detail-section">
						<h4 class="section-heading">Notes</h4>
						<p class="trip-notes">{trip.notes}</p>
					</div>
				{/if}

				<div class="action-buttons-footer">
					<button class="action-btn-lg edit-btn" on:click|stopPropagation={handleEdit}>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none"
							><path
								d="M11 2L14 5L5 14H2V11L11 2Z"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/></svg
						>
						Edit
					</button>
					<button class="action-btn-lg delete-btn" on:click|stopPropagation={handleDelete}>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none"
							><path
								d="M2 4H14M12 4V13C12 13.5304 11.7893 14.0391 11.4142 14.4142C11.0391 14.7893 10.5304 15 10 15H6C5.46957 15 4.96086 14.7893 4.58579 14.4142C4.21071 14.0391 4 13.5304 4 13V4M5 4V3C5 2.46957 5.21071 1.96086 5.58579 1.58579C5.96086 1.21071 6.46957 1 7 1H9C9.53043 1 10.0391 1.21071 10.4142 1.58579C10.7893 1.96086 11 2.46957 11 3V4"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/></svg
						>
						Trash
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.trip-card-wrapper {
		position: relative;
		overflow: hidden;
		border-radius: 12px;
		background: #f3f4f6;
	}
	.swipe-bg {
		position: absolute;
		inset: 0;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0 20px;
		z-index: 0;
	}
	.swipe-action {
		font-weight: 700;
		font-size: 14px;
		text-transform: uppercase;
		letter-spacing: 1px;
	}
	.swipe-action.edit {
		color: #2563eb;
	}
	.swipe-action.delete {
		color: #dc2626;
	}
	.trip-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 16px;
		cursor: pointer;
		transition: all 0.2s;
		position: relative;
		z-index: 1;
	}
	.trip-card:active {
		background-color: #f9fafb;
	}
	.trip-card.expanded {
		border-color: #ff7f50;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
	}
	.trip-card.selected {
		background-color: #fff7ed;
		border-color: #ff7f50;
	}

	.card-top {
		display: grid;
		grid-template-columns: auto 1fr auto 20px;
		align-items: center;
		gap: 12px;
		padding-bottom: 12px;
		margin-bottom: 12px;
		border-bottom: 1px solid #f3f4f6;
	}
	.selection-box {
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.trip-route-date {
		overflow: hidden;
	}
	.trip-date-display {
		display: block;
		font-size: 12px;
		font-weight: 600;
		color: #6b7280;
		margin-bottom: 4px;
	}
	.time-range {
		color: #4b5563;
		margin-left: 4px;
		font-weight: 500;
	}

	.trip-title-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.trip-route-title {
		font-size: 16px;
		font-weight: 700;
		color: #111827;
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
	}

	.stop-amount {
		font-size: 13px;
		font-weight: 700;
		color: #111827;
		background: white;
		border: 1px solid #e5e7eb;
		padding: 4px 8px;
		border-radius: 6px;
		white-space: nowrap;
		flex-shrink: 0;
		margin-left: 8px;
		box-shadow: 0 1px 0 rgba(16, 24, 40, 0.03);
	}

	.map-link-btn {
		background: none;
		border: 1px solid #e5e7eb;
		color: #6b7280;
		cursor: pointer;
		padding: 4px;
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
		flex-shrink: 0;
		height: 24px;
		width: 24px;
	}
	.map-link-btn:hover {
		color: #ff7f50;
		border-color: #ff7f50;
		background: #fff7ed;
	}

	.address-row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		color: #374151;
		margin: 4px 0;
	}
	.address-text {
		flex: 1;
		min-width: 0;
		word-break: break-word;
	}

	.mini-map-btn {
		background: none;
		border: 1px solid #e5e7eb;
		color: #9ca3af;
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
		flex-shrink: 0;
	}
	.mini-map-btn:hover {
		color: #ff7f50;
		border-color: #ff7f50;
		background: #fff7ed;
	}

	.profit-display-large {
		font-size: 18px;
		font-weight: 800;
		white-space: nowrap;
	}
	.profit-display-large.positive {
		color: #10b981;
	}
	.profit-display-large.negative {
		color: #dc2626;
	}
	.expand-icon {
		color: #9ca3af;
		transition: transform 0.2s;
	}
	.trip-card.expanded .expand-icon {
		transform: rotate(180deg);
	}

	.card-stats {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 12px;
	}
	.stat-item {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.stat-label {
		font-size: 11px;
		color: #9ca3af;
		text-transform: uppercase;
	}
	.stat-value {
		font-size: 14px;
		font-weight: 600;
		color: #4b5563;
	}
	.hourly-pay {
		color: #059669;
	}

	.expanded-details {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding-top: 16px;
		border-top: 1px dashed #e5e7eb;
		margin-top: 16px;
	}
	.detail-section {
		background: #f9fafb;
		padding: 12px;
		border-radius: 8px;
	}
	.section-heading {
		font-size: 13px;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 8px;
		border-bottom: 1px solid #e5e7eb;
		padding-bottom: 6px;
	}
	.address-text {
		font-size: 14px;
		color: #374151;
		margin: 4px 0;
	}
	.expense-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.expense-row {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
		color: #4b5563;
	}
	.expense-row.total {
		border-top: 1px solid #e5e7eb;
		margin-top: 4px;
		padding-top: 4px;
		font-weight: 700;
		color: #111827;
	}
	.trip-notes {
		font-style: italic;
		font-size: 14px;
		color: #4b5563;
		line-height: 1.4;
	}

	.action-buttons-footer {
		display: flex;
		gap: 12px;
	}
	.action-btn-lg {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 10px;
		border-radius: 8px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
		border: 2px solid;
		font-size: 14px;
	}
	.edit-btn {
		background: #eff6ff;
		color: #2563eb;
		border-color: #2563eb;
	}
	.delete-btn {
		background: #fef2f2;
		color: #dc2626;
		border-color: #dc2626;
	}

	@keyframes pulse-border {
		0% {
			border-color: #ff7f50;
			box-shadow: 0 0 0 0 rgba(255, 127, 80, 0.4);
		}
		70% {
			border-color: #ff7f50;
			box-shadow: 0 0 0 10px rgba(255, 127, 80, 0);
		}
		100% {
			border-color: #e5e7eb;
			box-shadow: 0 0 0 0 rgba(255, 127, 80, 0);
		}
	}
	:global(.highlight-pulse) {
		animation: pulse-border 2s ease-out;
	}

	.checkbox-container {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 600;
		color: #4b5563;
		position: relative;
		padding-left: 28px;
		user-select: none;
	}
	.checkbox-container input {
		position: absolute;
		opacity: 0;
		cursor: pointer;
		height: 0;
		width: 0;
	}
	.checkmark {
		position: absolute;
		top: 0;
		left: 0;
		height: 20px;
		width: 20px;
		background-color: white;
		border: 2px solid #d1d5db;
		border-radius: 6px;
		transition: all 0.2s;
	}
	.checkbox-container:hover input ~ .checkmark {
		border-color: #9ca3af;
	}
	.checkbox-container input:checked ~ .checkmark {
		background-color: #ff7f50;
		border-color: #ff7f50;
	}
	.checkmark:after {
		content: '';
		position: absolute;
		display: none;
	}
	.checkbox-container input:checked ~ .checkmark:after {
		display: block;
	}
	.checkbox-container .checkmark:after {
		left: 6px;
		top: 2px;
		width: 5px;
		height: 10px;
		border: solid white;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}
</style>
