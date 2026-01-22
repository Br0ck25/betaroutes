<script lang="ts">
	// Svelte 5 runes
	import { autocomplete } from '$lib/utils/autocomplete';

	let { data } = $props();
	let API_KEY = $derived(() => String((data as any)?.googleMapsApiKey ?? ''));

	type Place = {
		geometry?: { location: { lat: number; lng: number } };
		formatted_address?: string;
		name?: string;
		place_id?: string;
	};
	type Tech = {
		id: string;
		name: string;
		start: string;
		end: string;
		startPlace?: Place | null;
		endPlace?: Place | null;
	};
	type Stop = { id: string; address: string; rank?: number | null; place?: Place | null };
	type Assignment = {
		tech: {
			name: string;
			startLoc?: { lat: number; lon: number };
			endLoc?: { lat: number; lon: number };
		};
		stops: Array<{ address: string; rank?: number | null; loc?: { lat: number; lon: number } }>;
		miles: number;
		minutes: number;
	};
	type Result = { assignments: Assignment[]; totals: { miles: number; minutes: number } };

	function buildStaticMapUrl(a: Assignment) {
		const key = API_KEY();
		if (!key) return '';
		const markers: string[] = [];
		if (a.tech.startLoc)
			markers.push(`markers=label:S|${a.tech.startLoc.lat},${a.tech.startLoc.lon}`);
		a.stops.forEach((s, i) => {
			if (s.loc) markers.push(`markers=label:${(i + 1) % 10}|${s.loc.lat},${s.loc.lon}`);
		});
		if (a.tech.endLoc) markers.push(`markers=label:E|${a.tech.endLoc.lat},${a.tech.endLoc.lon}`);
		return `https://maps.googleapis.com/maps/api/staticmap?size=600x200&${markers.join('&')}&key=${encodeURIComponent(
			key
		)}`;
	}

	function buildGoogleMapsDirectionsUrl(a: Assignment) {
		const origin = a.tech.startLoc
			? `${a.tech.startLoc.lat},${a.tech.startLoc.lon}`
			: encodeURIComponent(a.stops[0]?.address || '');
		const destination = a.tech.endLoc
			? `${a.tech.endLoc.lat},${a.tech.endLoc.lon}`
			: encodeURIComponent(a.stops[a.stops.length - 1]?.address || '');
		const waypoints = a.stops
			.map((s) => (s.loc ? `${s.loc.lat},${s.loc.lon}` : s.address))
			.join('|');
		return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ''}`;
	}
	let techName = $state('');
	let techStart = $state('');
	let techEnd = $state('');
	let techStartPlace: Place | null = $state(null);
	let techEndPlace: Place | null = $state(null);
	let techs = $state<Tech[]>([]);

	let stopAddress = $state('');
	let stopRank = $state<number | null>(null); // null or number
	let stopPlace: Place | null = $state(null);
	let stops = $state<Stop[]>([]);

	import { onMount } from 'svelte';
	let loading = $state(false);
	let message = $state('');
	let result = $state<Result | null>(null);

	let techStartInput: HTMLInputElement | null = null;
	let techEndInput: HTMLInputElement | null = null;
	let stopInput: HTMLInputElement | null = null;

	onMount(() => {
		if (techStartInput)
			techStartInput.addEventListener('place-selected', onTechStartSelected as EventListener);
		if (techEndInput)
			techEndInput.addEventListener('place-selected', onTechEndSelected as EventListener);
		if (stopInput) stopInput.addEventListener('place-selected', onStopSelected as EventListener);

		return () => {
			if (techStartInput)
				techStartInput.removeEventListener('place-selected', onTechStartSelected as EventListener);
			if (techEndInput)
				techEndInput.removeEventListener('place-selected', onTechEndSelected as EventListener);
			if (stopInput)
				stopInput.removeEventListener('place-selected', onStopSelected as EventListener);
		};
	});
	function addTech() {
		if (!techName || !techStart) return;
		techs = [
			...techs,
			{
				id: crypto.randomUUID(),
				name: techName,
				start: techStart,
				end: techEnd || techStart,
				startPlace: techStartPlace,
				endPlace: techEndPlace
			}
		];
		techName = '';
		techStart = '';
		techEnd = '';
		techStartPlace = null;
		techEndPlace = null;
		result = null;
	}

	function removeTech(id: string) {
		techs = techs.filter((t) => t.id !== id);
		result = null;
	}

	function addStop() {
		if (!stopAddress) return;
		stops = [
			...stops,
			{ id: crypto.randomUUID(), address: stopAddress, rank: stopRank, place: stopPlace }
		];
		stopAddress = '';
		stopRank = null;
		stopPlace = null;
		result = null;
	}

	function removeStop(id: string) {
		stops = stops.filter((s) => s.id !== id);
		result = null;
	}

	function onTechStartSelected(e: CustomEvent) {
		techStartPlace = e.detail;
		techStart = (e.detail.formatted_address as string) || (e.detail.name as string) || techStart;
	}

	function onTechEndSelected(e: CustomEvent) {
		techEndPlace = e.detail;
		techEnd = (e.detail.formatted_address as string) || (e.detail.name as string) || techEnd;
	}

	function onStopSelected(e: CustomEvent) {
		stopPlace = e.detail;
		stopAddress =
			(e.detail.formatted_address as string) || (e.detail.name as string) || stopAddress;
	}

	async function optimize() {
		message = '';
		result = null;
		if (techs.length === 0) {
			message = 'Add at least one tech.';
			return;
		}
		if (stops.length === 0) {
			message = 'Add at least one stop.';
			return;
		}

		loading = true;
		try {
			// Send place geometry when available to avoid extra server geocoding
			const payload = {
				techs: techs.map((t) => ({
					name: t.name,
					start: t.start,
					end: t.end,
					startLoc: t.startPlace?.geometry
						? {
								lat: t.startPlace!.geometry!.location.lat,
								lon: t.startPlace!.geometry!.location.lng,
								address: t.startPlace!.formatted_address || t.start
							}
						: undefined,
					endLoc: t.endPlace?.geometry
						? {
								lat: t.endPlace!.geometry!.location.lat,
								lon: t.endPlace!.geometry!.location.lng,
								address: t.endPlace!.formatted_address || t.end
							}
						: undefined
				})),
				stops: stops.map((s) => ({
					address: s.address,
					rank: s.rank,
					loc: s.place?.geometry
						? {
								lat: s.place!.geometry!.location.lat,
								lon: s.place!.geometry!.location.lng,
								address: s.place!.formatted_address || s.address
							}
						: undefined
				}))
			};

			const res = await fetch(location.pathname, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) {
				const err = (await res.json().catch(() => null)) as any;
				message = err?.error || 'Server error';
				loading = false;
				return;
			}
			result = await res.json();
			message = '';
		} catch (e) {
			message = 'Network error';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Assign Stops to Techs — Tools</title>
</svelte:head>

<div class="card">
	<h1>Assign Stops to Techs</h1>
	<p class="muted">
		This page is not linked in the app; open directly via URL. Create techs and stops, mark stop
		ordering positions (1 = first, 2 = second...), then click <strong>Optimize</strong> to assign stops
		to techs fairly.
	</p>

	<hr />

	<section>
		<h2>Techs</h2>
		<div class="form-row">
			<input placeholder="Tech name" bind:value={techName} />
			<input
				placeholder="Start address"
				bind:value={techStart}
				use:autocomplete={{ apiKey: API_KEY() }}
				bind:this={techStartInput}
			/>
			<input
				placeholder="End address (optional)"
				bind:value={techEnd}
				use:autocomplete={{ apiKey: API_KEY() }}
				bind:this={techEndInput}
			/>
			<button class="btn-secondary" onclick={addTech}>Add Tech</button>
		</div>

		{#if techs.length > 0}
			<ul class="list">
				{#each techs as t}
					<li>
						<strong>{t.name}</strong> — {t.start} → {t.end}
						<button class="small" onclick={() => removeTech(t.id)}>Remove</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section style="margin-top:1rem">
		<h2>Stops</h2>
		<div class="form-row">
			<input
				placeholder="Stop address"
				bind:value={stopAddress}
				use:autocomplete={{ apiKey: API_KEY() }}
				bind:this={stopInput}
			/>
			<select bind:value={stopRank}>
				<option value={null}>No rank</option>
				<option value={1}>First (1)</option>
				<option value={2}>Second (2)</option>
				<option value={3}>Third (3)</option>
				<option value={4}>Fourth (4)</option>
			</select>
			<button class="btn-secondary" onclick={addStop}>Add Stop</button>
		</div>

		{#if stops.length > 0}
			<table class="table">
				<thead>
					<tr><th>Address</th><th>Rank</th><th></th></tr>
				</thead>
				<tbody>
					{#each stops as s}
						<tr>
							<td>{s.address}</td>
							<td>{s.rank ?? '-'}</td>
							<td><button class="small" onclick={() => removeStop(s.id)}>Remove</button></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	<section style="margin-top:1rem">
		<button class="btn-primary" onclick={optimize} disabled={loading}
			>{loading ? 'Optimizing…' : 'Optimize'}</button
		>
		{#if message}
			<p class="error">{message}</p>
		{/if}
	</section>

	{#if result}
		<hr />
		<h2>Assignment Result</h2>
		{#each result.assignments as a}
			<div class="card small-card">
				<h3>{a.tech.name}</h3>
				<p><strong>Stops:</strong> {a.stops.length}</p>
				<p><strong>Mileage:</strong> {a.miles.toFixed(1)} mi</p>
				<p><strong>Drive time:</strong> {a.minutes.toFixed(0)} min</p>
				<ul>
					{#each a.stops as s}
						<li>{s.address} {s.rank ? ` (rank ${s.rank})` : ''}</li>
					{/each}
				</ul>
				{#if API_KEY() && (a.tech.startLoc || a.tech.endLoc || a.stops.some((s) => s.loc))}
					<div class="map-preview">
						<img src={buildStaticMapUrl(a)} alt="Route map" />
						<p style="margin-top:0.5rem">
							<a href={buildGoogleMapsDirectionsUrl(a)} target="_blank" rel="noopener"
								>Open in Google Maps</a
							>
						</p>
					</div>
				{/if}
			</div>
		{/each}

		<div style="margin-top:1rem">
			<p><strong>Total miles:</strong> {result.totals.miles.toFixed(1)} mi</p>
			<p><strong>Total minutes:</strong> {result.totals.minutes.toFixed(0)} min</p>
		</div>
	{/if}
</div>

<style>
	.card {
		padding: 1rem;
		background: var(--card-bg, #fff);
		border-radius: 6px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
	}
	.form-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.form-row input,
	.form-row select {
		padding: 0.6rem;
		flex: 1;
		border: 1px solid var(--border, #e6e6e6);
		border-radius: 6px;
	}
	.btn-primary {
		background: var(--primary, #f68a2e);
		color: #fff;
		padding: 0.6rem 1rem;
		border-radius: 6px;
	}
	.btn-secondary {
		background: #fff;
		border: 1px solid var(--border, #e6e6e6);
		padding: 0.5rem 0.8rem;
		border-radius: 6px;
	}
	.btn-secondary:hover {
		background: #fafafa;
	}
	.small {
		background: transparent;
		border: 1px solid #eee;
		padding: 0.25rem 0.5rem;
	}
	.table {
		width: 100%;
		border-collapse: collapse;
	}
	.table th,
	.table td {
		text-align: left;
		padding: 0.5rem;
		border-bottom: 1px solid #f0f0f0;
	}
	.small-card {
		margin-bottom: 0.5rem;
		padding: 0.75rem;
		border-radius: 6px;
		background: var(--card-bg, #fff);
		border: 1px solid var(--border, #eaeaea);
	}
	.map-preview img {
		width: 100%;
		height: 160px;
		object-fit: cover;
		border-radius: 6px;
		display: block;
	}
	.map-preview p {
		margin: 0.5rem 0 0 0;
		font-size: 0.9rem;
	}
	.error {
		color: #b00020;
	}
	.muted {
		color: #666;
		font-size: 0.9rem;
	}

	/* Layout: 2-column on wide screens */
	@media (min-width: 900px) {
		.card {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 1rem;
		}
		.card > section {
			margin-top: 0;
		}
		.card > section:first-of-type {
			grid-column: 1 / 2;
		}
		.card > section:nth-of-type(2) {
			grid-column: 2 / 3;
		}
		.card > section:nth-of-type(3) {
			grid-column: 1 / 3;
		}
	}
</style>
