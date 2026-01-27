<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { PLAN_LIMITS } from '$lib/constants';
	import { calculateRoute as getRouteData, optimizeRoute } from '$lib/services/maps';
	import { toasts } from '$lib/stores/toast';
	import { draftTrip } from '$lib/stores/trips';
	import { getUserState } from '$lib/stores/user.svelte';
	import { userSettings } from '$lib/stores/userSettings';
	import type { Destination, LatLng, Trip } from '$lib/types';
	import { autocomplete } from '$lib/utils/autocomplete';
	import { calculateTripTotals } from '$lib/utils/calculations';
	import { storage } from '$lib/utils/storage';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { slide } from 'svelte/transition';
	import DestinationList from './DestinationList.svelte';
	import TripDebug from './TripDebug.svelte';
	import TripSummary from './TripSummary.svelte';

	// Svelte 5 Props using Runes
	const { googleApiKey = '', loading = false, trip = null } = $props();

	const settings = get(userSettings);
	const API_KEY = $derived(() => googleApiKey || 'dummy_key');

	const userState = getUserState();

	// --- Form State (Runes) ---
	let date = $state(new Date().toISOString().split('T')[0]);
	let startTime = $state('');
	let endTime = $state('');

	let startAddress = $state<string>(
		String(settings.startLocation || storage.getSetting('defaultStartAddress') || '')
	);
	let endAddress = $state<string>(
		String(settings.endLocation || storage.getSetting('defaultEndAddress') || '')
	);

	// Coordinates State
	let startLocation = $state<LatLng | undefined>(undefined);
	let endLocation = $state<LatLng | undefined>(undefined);

	let mpg = $state(settings.defaultMPG ?? storage.getSetting('defaultMPG') ?? 25);
	// Label shown in the UI is 'Fuel Price', field remains 'gasPrice' in data for backwards compat
	let gasPrice = $state(settings.defaultGasPrice ?? storage.getSetting('defaultGasPrice') ?? 3.5);

	// Whether fuelCost is auto-calculated from MPG+Fuel Price or manually provided
	let autoFuelCost = $state(true);

	const distanceUnit = $state(settings.distanceUnit || 'mi');

	// Destinations State
	let destinations = $state<Destination[]>([{ address: '', earnings: 0 }]);
	let notes = $state('');

	// Financials State (Runes)
	let supplies = $state<{ id: string; type: string; cost: number }[]>([]);
	let maintenance = $state<{ id: string; type: string; cost: number }[]>([]);
	let showFinancials = $state(true);

	// --- Calculation State (Runes) ---
	let calculating = $state(false);
	let calculated = $state(false);
	let calculationError = $state('');

	let totalMileage = $state(0);
	let totalTime = $state('');
	let fuelCost = $state(0);

	// Computed Costs
	const suppliesCost = $derived(supplies.reduce((sum, item) => sum + (Number(item.cost) || 0), 0));
	const maintenanceCost = $derived(
		maintenance.reduce((sum, item) => sum + (Number(item.cost) || 0), 0)
	);

	let netProfit = $state(0);

	// Upgrade Modal State with specific reason tracking
	let showUpgradeModal = $state(false);
	let upgradeReason = $state<'stops' | 'optimize' | 'trips' | 'general'>('general');

	// Computed upgrade message based on reason
	const upgradeMessage = $derived(() => {
		switch (upgradeReason) {
			case 'stops':
				return `You've hit the ${PLAN_LIMITS.FREE.MAX_STOPS || 5}-stop limit for Free plans. Upgrade to Pro for unlimited stops per trip!`;
			case 'optimize':
				return 'Route Optimization is available to all users; free tier limits still apply to trip size.';
			case 'trips':
				return `You've reached your limit (${PLAN_LIMITS.FREE.MAX_TRIPS_PER_MONTH || PLAN_LIMITS.FREE.MAX_TRIPS_IN_WINDOW || 10} trips per ${PLAN_LIMITS.FREE.WINDOW_DAYS || 30} days).`;
			default:
				return 'Upgrade to Pro to unlock additional conveniences and higher quotas.';
		}
	});

	// --- Auto-Calculation Effect ---
	$effect(() => {
		const _deps = { startAddress, endAddress, destinations, mpg, gasPrice };
		void _deps; // referenced intentionally to capture dependencies
		const hasStart = !!(startAddress && startAddress.length > 3);
		const hasDest =
			(destinations?.length ?? 0) > 0 && (destinations?.[0]?.address?.length ?? 0) > 3;

		if (hasStart && hasDest) {
			const timer = setTimeout(() => {
				handleCalculate(true); // true = silent mode
			}, 1500);

			return () => clearTimeout(timer);
		}

		return; // ensure consistent return type for the effect
	});

	// --- Handlers ---
	function handleAddressSelect(field: 'start' | 'end', e: CustomEvent) {
		const place = e.detail;
		const val = place.formatted_address || place.name || '';

		let location: LatLng | undefined;
		if (place.geometry && place.geometry.location) {
			const lat =
				typeof place.geometry.location.lat === 'function'
					? place.geometry.location.lat()
					: place.geometry.location.lat;
			const lng =
				typeof place.geometry.location.lng === 'function'
					? place.geometry.location.lng()
					: place.geometry.location.lng;
			location = { lat, lng };
		}

		if (field === 'start') {
			startAddress = val;
			startLocation = location;
		} else {
			endAddress = val;
			endLocation = location;
		}
	}

	// Action to listen for 'place-selected' events dispatched by the autocomplete action
	function placeSelector(node: HTMLElement, cb: (e: CustomEvent) => void) {
		const handler = (ev: Event) => cb(ev as CustomEvent);
		node.addEventListener('place-selected', handler);
		return {
			destroy() {
				node.removeEventListener('place-selected', handler);
			}
		};
	}

	// Financial Handlers
	function addSupply() {
		supplies = [...supplies, { id: crypto.randomUUID(), type: '', cost: 0 }];
	}
	function removeSupply(index: number) {
		supplies = supplies.filter((_, i) => i !== index);
	}
	function addMaintenance() {
		maintenance = [...maintenance, { id: crypto.randomUUID(), type: '', cost: 0 }];
	}
	function removeMaintenance(index: number) {
		maintenance = maintenance.filter((_, i) => i !== index);
	}

	async function handleCalculate(silent = false): Promise<any | null> {
		if (!startAddress) {
			if (!silent) toasts.error('Please enter a start address.');
			return null;
		}

		// Stop Limit Check
		if (!silent) {
			const validStopCount = destinations.filter(
				(d) => d.address && d.address.trim().length > 0
			).length;
			if (userState.value?.plan === 'free' && validStopCount > (PLAN_LIMITS.FREE.MAX_STOPS || 5)) {
				toasts.error(
					`You've hit the ${PLAN_LIMITS.FREE.MAX_STOPS || 5}-stop limit for Free plans.`
				);
				return null;
			}
		}

		calculating = true;
		calculationError = '';
		try {
			const effectiveEndAddress = endAddress ? endAddress : startAddress;
			const destsCopy = $state.snapshot(destinations) as Destination[];

			const routeData = await getRouteData(
				startAddress,
				effectiveEndAddress,
				destsCopy,
				distanceUnit as 'mi' | 'km'
			);

			// [!code fix] Capture 'miles' first, then 'totalMiles'
			const rawDist = (routeData as any).miles ?? routeData.totalMiles ?? 0;
			totalMileage = Number(rawDist);

			const duration = routeData.totalMinutes ?? (routeData as any).minutes ?? 0;

			const totals = calculateTripTotals(
				totalMileage,
				duration,
				destsCopy,
				mpg,
				gasPrice,
				[],
				[],
				startTime,
				endTime
			);

			totalTime = totals.totalTime || '';

			// Respect manual override if user edited Estimated Fuel Cost (autoFuelCost=false)
			if (!autoFuelCost) {
				// keep existing fuelCost (user-specified)
				fuelCost = Number(fuelCost) || 0;
			} else if (trip && trip.fuelCost && !startLocation) {
				fuelCost = trip.fuelCost;
			} else {
				fuelCost = totals.fuelCost || 0;
			}

			const grossEarnings = destsCopy.reduce(
				(acc: number, d: Destination) => acc + (Number(d.earnings) || 0),
				0
			);
			netProfit = grossEarnings - (fuelCost + suppliesCost + maintenanceCost);

			calculated = true;
			console.log('[TripForm] handleCalculate success', {
				miles: totalMileage,
				minutes: duration
			});

			if (!silent) toasts.success('Route calculated successfully!');

			return routeData;
		} catch (_err) {
			console.error('Calculation Error:', _err);
			const msg = (_err instanceof Error ? _err.message : String(_err || '')).toLowerCase();

			// Plan limit detection
			if (msg.includes('plan limit') || msg.includes('pro feature') || msg.includes('trip limit')) {
				upgradeReason = 'general';
				showUpgradeModal = true;
				return null;
			}

			if (!silent || !msg.includes('zero_results')) {
				calculationError = _err instanceof Error ? _err.message : String(_err || '');
				if (!silent) toasts.error(calculationError);
			}
			return null;
		} finally {
			calculating = false;
		}
	}

	async function handleOptimize() {
		if (!startAddress) {
			toasts.error('Please enter a start address first.');
			return;
		}

		const validDests = destinations.filter((d) => d.address && d.address.trim() !== '');
		if (validDests.length < 2) {
			toasts.error('Need at least 2 stops to optimize.');
			return;
		}

		calculating = true;

		try {
			const result: any = await optimizeRoute(startAddress, endAddress || '', validDests);

			if (result && (result as any).optimizedOrder && (result as any).optimizedOrder.length > 0) {
				const currentDestinations = $state.snapshot(destinations) as Destination[];
				const validDestinations = currentDestinations.filter(
					(d) => d.address && d.address.trim() !== ''
				);
				const emptyDestinations = currentDestinations.filter(
					(d) => !d.address || d.address.trim() === ''
				);

				let waypointsToReorder: Destination[] = [];
				let fixedEnd: Destination | null = null;

				if (!endAddress) {
					fixedEnd = validDestinations[validDestinations.length - 1] ?? null;
					waypointsToReorder = validDestinations.slice(0, -1);
				} else {
					waypointsToReorder = validDestinations;
				}

				const reorderedWaypoints = (result as any).optimizedOrder
					.map((index: number) => waypointsToReorder[index])
					.filter(Boolean) as Destination[];

				let newDestinations = [...reorderedWaypoints];

				if (fixedEnd) {
					newDestinations.push(fixedEnd);
				}

				newDestinations = [...newDestinations, ...emptyDestinations];
				destinations = newDestinations;

				toasts.success('Stops optimized for fastest route!');
				handleCalculate(true);
			} else {
				toasts.info('Route is already optimized or could not be improved.');
			}
		} catch (e: any) {
			const msg = (e.message || '').toLowerCase();

			// Catch ALL potential plan limit indicators
			const isPlanLimit =
				e.code === 'PLAN_LIMIT' ||
				msg.includes('plan limit') ||
				msg.includes('pro feature') ||
				msg.includes('upgrade');

			if (isPlanLimit) {
				upgradeReason = 'optimize';
				showUpgradeModal = true;
			} else {
				console.error('Optimization failed:', e);
				toasts.error(`Optimization failed: ${e.message}`);
			}
		} finally {
			calculating = false;
		}
	}

	// --- Draft Logic ---
	function loadDraft(draft: Partial<Trip>) {
		if (!draft || typeof draft !== 'object') return;
		if (draft.date) date = draft.date;
		if (draft.startTime) startTime = draft.startTime;
		if (draft.endTime) endTime = draft.endTime;
		if (draft.startAddress) startAddress = draft.startAddress;
		if (draft.endAddress) endAddress = draft.endAddress;
		if (draft.startLocation) startLocation = draft.startLocation;
		if (draft.endLocation) endLocation = draft.endLocation;
		if (draft.mpg) mpg = draft.mpg;
		if (draft.gasPrice) gasPrice = draft.gasPrice;
		if (draft.destinations && Array.isArray(draft.destinations)) destinations = draft.destinations;
		if (draft.notes) notes = draft.notes;
		// Load Supplies from Draft/Trip, normalize and ensure ids
		if (draft.suppliesItems && Array.isArray(draft.suppliesItems)) {
			supplies = (draft.suppliesItems as any[]).map((s) => ({
				id: s.id ?? crypto.randomUUID(),
				type: s.type ?? s.name ?? '',
				cost: Number(s.cost) || 0
			}));
		} else if ((draft as any).supplyItems && Array.isArray((draft as any).supplyItems)) {
			supplies = ((draft as any).supplyItems as any[]).map((s) => ({
				id: s.id ?? crypto.randomUUID(),
				type: s.type ?? s.name ?? '',
				cost: Number(s.cost) || 0
			}));
		}

		if (draft.maintenanceItems && Array.isArray(draft.maintenanceItems)) {
			maintenance = (draft.maintenanceItems as any[]).map((m) => ({
				id: m.id ?? crypto.randomUUID(),
				type: m.item ?? m.type ?? '',
				cost: Number(m.cost) || 0
			}));
		}
	}

	function saveDraft() {
		const draftData: Partial<Trip> = {
			startTime,
			endTime,
			startAddress,
			endAddress,
			destinations,
			mpg,
			gasPrice,
			notes,
			suppliesItems: supplies,
			maintenanceItems: maintenance
		};
		if (typeof date === 'string') draftData.date = date;
		if (startLocation !== undefined) draftData.startLocation = startLocation;
		if (endLocation !== undefined) draftData.endLocation = endLocation;
		draftTrip.save(draftData);
	}

	onMount(() => {
		// Support loading trip via prop (Edit Mode)
		if (trip) {
			loadDraft(trip);
			if (trip.totalMiles) totalMileage = trip.totalMiles;
			if (trip.fuelCost) {
				fuelCost = trip.fuelCost;
				// If trip has an explicit fuelCost, treat it as manual override
				autoFuelCost = false;
			} else {
				autoFuelCost = true;
			}
		} else {
			const rawDraft = draftTrip.load();
			if (rawDraft && confirm('Resume your last unsaved trip?')) {
				loadDraft(rawDraft as Partial<Trip>);
			}
		}

		const interval = setInterval(saveDraft, 5000);
		return () => clearInterval(interval);
	});
</script>

<div class="max-w-4xl mx-auto p-4 md:p-6">
	<h2 class="text-2xl font-bold mb-6">{trip ? 'Edit Trip' : 'Plan Your Trip'}</h2>

	<TripDebug />

	<div class="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 mb-6 space-y-6">
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<div>
				<label for="trip-date" class="block font-semibold mb-2 text-sm text-gray-700">Date</label>
				{#if loading}
					<Skeleton height="48px" className="rounded-lg" />
				{:else}
					<input
						id="trip-date"
						type="date"
						bind:value={date}
						class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
					/>
				{/if}
			</div>
		</div>

		<div>
			<label for="start-address" class="block font-semibold mb-2 text-sm text-gray-700"
				>Start Address</label
			>
			{#if loading}
				<Skeleton height="48px" className="rounded-lg" />
			{:else}
				<input
					id="start-address"
					type="text"
					bind:value={startAddress}
					placeholder="Enter start location"
					class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
					autocomplete="off"
					use:autocomplete={{ apiKey: API_KEY() }}
					use:placeSelector={(e: CustomEvent) => handleAddressSelect('start', e)}
				/>
			{/if}
		</div>

		{#if loading}
			<div class="space-y-3">
				<div class="block font-semibold text-sm text-gray-700">Destinations</div>
				<Skeleton height="50px" className="rounded-lg" />
				<Skeleton height="50px" className="rounded-lg" />
			</div>
		{:else}
			<DestinationList bind:destinations apiKey={API_KEY()} />
		{/if}

		<div>
			<label for="end-address" class="block font-semibold mb-2 text-sm text-gray-700"
				>End Address (Optional)</label
			>
			{#if loading}
				<Skeleton height="48px" className="rounded-lg" />
			{:else}
				<input
					id="end-address"
					type="text"
					bind:value={endAddress}
					placeholder="Leave empty to return to Start"
					class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
					autocomplete="off"
					use:autocomplete={{ apiKey: API_KEY() }}
					use:placeSelector={(e: CustomEvent) => handleAddressSelect('end', e)}
				/>
			{/if}
		</div>

		<div class="grid grid-cols-2 gap-4">
			<div>
				<label for="mpg" class="block font-semibold mb-2 text-sm text-gray-700">MPG</label>
				{#if loading}
					<Skeleton height="48px" className="rounded-lg" />
				{:else}
					<input
						id="mpg"
						type="number"
						bind:value={mpg}
						step="0.1"
						class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
					/>
				{/if}
			</div>
			<div>
				<label for="fuel-price" class="block font-semibold mb-2 text-sm text-gray-700"
					>Fuel Price ($)</label
				>
				{#if loading}
					<Skeleton height="48px" className="rounded-lg" />
				{:else}
					<input
						id="fuel-price"
						type="number"
						bind:value={gasPrice}
						step="0.01"
						class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
					/>
				{/if}
			</div>
			<div>
				<label for="estimated-fuel-cost" class="block font-semibold mb-2 text-sm text-gray-700"
					>Estimated Fuel Cost ($)</label
				>
				{#if loading}
					<Skeleton height="48px" className="rounded-lg" />
				{:else}
					<input
						id="estimated-fuel-cost"
						type="number"
						bind:value={fuelCost}
						step="0.01"
						oninput={() => (autoFuelCost = false)}
						class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
					/>
					<div class="mt-2 flex gap-2">
						<button
							class="btn-small"
							type="button"
							onclick={() => {
								autoFuelCost = true;
								handleCalculate(true);
							}}
						>
							Use MPG calc
						</button>
						<span class="text-sm text-gray-500">Or set the estimated cost manually</span>
					</div>
				{/if}
			</div>

			<div>
				<label for="start-time" class="block font-semibold mb-2 text-sm text-gray-700"
					>Start Time</label
				>
				{#if loading}
					<Skeleton height="48px" className="rounded-lg" />
				{:else}
					<input
						id="start-time"
						type="time"
						bind:value={startTime}
						class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
					/>
				{/if}
			</div>
			<div>
				<label for="end-time" class="block font-semibold mb-2 text-sm text-gray-700">End Time</label
				>
				{#if loading}
					<Skeleton height="48px" className="rounded-lg" />
				{:else}
					<input
						id="end-time"
						type="time"
						bind:value={endTime}
						class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
					/>
				{/if}
			</div>
		</div>

		<div class="border-t border-gray-100 pt-4">
			<div class="flex justify-between items-center mb-4">
				<div class="block font-semibold text-sm text-gray-700">Expenses & Supplies</div>
				<button
					type="button"
					class="text-sm text-blue-600"
					onclick={() => (showFinancials = !showFinancials)}
				>
					{showFinancials ? 'Hide' : 'Show'}
				</button>
			</div>

			{#if showFinancials}
				<div transition:slide class="space-y-4 bg-gray-50 p-4 rounded-lg">
					<div>
						<div class="flex justify-between items-center mb-2">
							<span class="text-xs font-semibold text-gray-500 uppercase"
								>Supplies (Pole, Concrete)</span
							>
							<button
								type="button"
								onclick={addSupply}
								class="text-xs bg-white border px-2 py-1 rounded hover:bg-gray-100">+ Add</button
							>
						</div>
						{#each supplies as item, i (i)}
							<div class="flex gap-2 mb-2 items-center">
								<input
									type="text"
									placeholder="Item Type"
									bind:value={item.type}
									class="w-full p-2 text-sm border rounded"
								/>
								<input
									type="number"
									placeholder="$"
									step="0.01"
									bind:value={item.cost}
									class="w-24 p-2 text-sm border rounded"
								/>
								<button
									type="button"
									onclick={() => removeSupply(i)}
									class="text-red-400 hover:text-red-600">✕</button
								>
							</div>
						{/each}
						{#if supplies.length > 0}
							<div class="text-right text-xs text-gray-600 font-medium">
								Subtotal: ${suppliesCost.toFixed(2)}
							</div>
						{/if}
					</div>

					<div>
						<div class="flex justify-between items-center mb-2">
							<span class="text-xs font-semibold text-gray-500 uppercase">Vehicle / Other</span>
							<button
								type="button"
								onclick={addMaintenance}
								class="text-xs bg-white border px-2 py-1 rounded hover:bg-gray-100">+ Add</button
							>
						</div>
						{#each maintenance as item, i (i)}
							<div class="flex gap-2 mb-2 items-center">
								<input
									type="text"
									placeholder="Description"
									bind:value={item.type}
									class="w-full p-2 text-sm border rounded"
								/>
								<input
									type="number"
									placeholder="$"
									step="0.01"
									bind:value={item.cost}
									class="w-24 p-2 text-sm border rounded"
								/>
								<button
									type="button"
									onclick={() => removeMaintenance(i)}
									class="text-red-400 hover:text-red-600">✕</button
								>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<div>
			<label for="notes" class="block font-semibold mb-2 text-sm text-gray-700">Notes</label>
			{#if loading}
				<Skeleton height="100px" className="rounded-lg" />
			{:else}
				<textarea
					id="notes"
					bind:value={notes}
					rows="3"
					class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
				></textarea>
			{/if}
		</div>
	</div>

	{#if calculationError}
		<div class="bg-red-50 text-red-700 p-4 rounded-lg mb-6 border border-red-200">
			{calculationError}
		</div>
	{/if}

	{#if calculated}
		<TripSummary {totalMileage} {distanceUnit} {totalTime} {fuelCost} {netProfit} />
	{:else if calculating}
		<div
			class="p-6 text-center text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-300"
		>
			<div class="inline-block animate-spin mr-2">⟳</div>
			Calculating route...
		</div>
	{/if}

	<div class="flex flex-col sm:flex-row gap-3 mt-6">
		{#if loading}
			<Skeleton height="48px" width="160px" className="rounded-lg" />
		{:else}
			<button
				class="w-full sm:w-auto px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
				onclick={() => handleCalculate(false)}
				disabled={calculating}
			>
				{calculating ? 'Calculating...' : 'Recalculate Route'}
			</button>

			<button
				class="w-full sm:w-auto px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
				onclick={handleOptimize}
				disabled={calculating}
				title={userState.value?.plan === 'free'
					? 'Pro Feature - Upgrade to Unlock'
					: 'Reorder stops for fastest route'}
			>
				{#if userState.value?.plan === 'free'}
					🔒 Optimize Stops (Pro)
				{:else}
					Optimize Stops
				{/if}
			</button>
		{/if}
	</div>
</div>

<Modal bind:open={showUpgradeModal} title="Upgrade to Pro">
	<div class="space-y-6 text-center py-4">
		<div class="mx-auto w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
			{#if upgradeReason === 'stops'}
				<span class="text-3xl">📍</span>
			{:else if upgradeReason === 'optimize'}
				<span class="text-3xl">🚀</span>
			{:else if upgradeReason === 'trips'}
				<span class="text-3xl">📊</span>
			{:else}
				<span class="text-3xl">⭐</span>
			{/if}
		</div>

		<h3 class="text-xl font-bold text-gray-900">
			{#if upgradeReason === 'stops'}
				Too Many Stops
			{:else if upgradeReason === 'optimize'}
				Pro Feature Required
			{:else if upgradeReason === 'trips'}
				Monthly Limit Reached
			{:else}
				Unlock Pro Features
			{/if}
		</h3>

		<p class="text-gray-600 text-base leading-relaxed">
			{upgradeMessage()}
		</p>

		{#if upgradeReason === 'trips' && userState.value}
			<div class="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm">
				<div class="font-semibold text-orange-900">Your Free Plan Status:</div>
				<div class="text-orange-700 mt-1">
					{userState.value.tripsThisMonth} / {userState.value.maxTrips} trips used this month
				</div>
			</div>
		{/if}

		<div class="bg-gray-50 p-4 rounded-lg text-left text-sm space-y-2 border border-gray-100">
			<div class="font-semibold text-gray-900 mb-3">Pro Plan Includes:</div>
			<div class="flex items-center gap-2">
				<span class="text-green-500 text-lg">✓</span>
				<span class="text-gray-700"><strong>Unlimited</strong> Stops per Trip</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-green-500 text-lg">✓</span>
				<span class="text-gray-700"><strong>One-Click</strong> Route Optimization</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-green-500 text-lg">✓</span>
				<span class="text-gray-700"><strong>Unlimited</strong> Monthly Trips</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-green-500 text-lg">✓</span>
				<span class="text-gray-700"><strong>Priority</strong> Support</span>
			</div>
		</div>

		<div class="bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg p-4">
			<div class="text-sm opacity-90">Only</div>
			<div class="text-3xl font-bold">$9.99<span class="text-lg font-normal">/mo</span></div>
			<div class="text-sm opacity-90">Cancel anytime</div>
		</div>

		<div class="flex gap-3 justify-center pt-2">
			<Button variant="outline" onclick={() => (showUpgradeModal = false)}>Maybe Later</Button>

			<a
				href={resolve('/dashboard/settings')}
				class="inline-flex items-center justify-center rounded-lg bg-orange-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 transition-all"
			>
				Upgrade to Pro →
			</a>
		</div>
	</div>
</Modal>
