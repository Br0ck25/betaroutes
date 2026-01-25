<script lang="ts">
	// Svelte 5 runes
	import { autocomplete, loadGoogleMaps } from '$lib/utils/autocomplete';
	import { csrfFetch } from '$lib/utils/csrf';

	const { data } = $props();
	const API_KEY = $derived(() => String((data as any)?.googleMapsApiKey ?? ''));

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

	// Static map generation removed in favor of interactive JS maps (use the built-in map preview).

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

	function formatMinutes(mins: number) {
		if (!isFinite(mins) || isNaN(mins)) return '-';
		const total = Math.round(mins);
		const hrs = Math.floor(total / 60);
		const m = total % 60;
		return hrs > 0 ? `${hrs}h ${m}m` : `${m}m`;
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

			const res = await csrfFetch(location.pathname, {
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

	function initMap(node: HTMLElement, params: { assignment: Assignment }) {
		let map: google.maps.Map | null = null;
		let poly: google.maps.Polyline | null = null;
		let markers: google.maps.Marker[] = [];
		let destroyed = false;

		loadGoogleMaps(API_KEY())
			.then(() => {
				if (destroyed) return;
				const a = params.assignment;
				const path: google.maps.LatLngLiteral[] = [];
				if (a.tech.startLoc) path.push({ lat: a.tech.startLoc.lat, lng: a.tech.startLoc.lon });
				a.stops.forEach((s) => {
					if (s.loc) path.push({ lat: s.loc.lat, lng: s.loc.lon });
				});
				if (a.tech.endLoc) path.push({ lat: a.tech.endLoc.lat, lng: a.tech.endLoc.lon });

				if (path.length === 0) return;
				map = new google.maps.Map(node, {
					center: path[0],
					zoom: 12,
					gestureHandling: 'none',
					disableDefaultUI: true
				});

				poly = new google.maps.Polyline({
					path,
					strokeColor: '#1FA8DB',
					strokeOpacity: 0.95,
					strokeWeight: 3,
					clickable: false
				});
				poly.setMap(map);

				if (a.tech.startLoc)
					markers.push(
						new google.maps.Marker({
							position: { lat: a.tech.startLoc.lat, lng: a.tech.startLoc.lon },
							map,
							label: 'S'
						})
					);
				a.stops.forEach((s, idx) => {
					if (s.loc)
						markers.push(
							new google.maps.Marker({
								position: { lat: s.loc.lat, lng: s.loc.lon },
								map,
								label: ((idx + 1) % 10).toString()
							})
						);
				});
				if (a.tech.endLoc)
					markers.push(
						new google.maps.Marker({
							position: { lat: a.tech.endLoc.lat, lng: a.tech.endLoc.lon },
							map,
							label: 'E'
						})
					);

				const bounds = new google.maps.LatLngBounds();
				path.forEach((p) => bounds.extend(p));
				map.fitBounds(bounds);
			})
			.catch((e) => {
				console.warn('[Map] load failed', e);
			});

		return {
			update(_newParams: { assignment: Assignment }) {
				// No-op for now. Could implement rerendering if assignments change.
			},
			destroy() {
				destroyed = true;
				if (poly) poly.setMap(null);
				markers.forEach((m) => m.setMap(null));
				markers = [];
			}
		};
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
			<ul class="list tech-list">
				{#each techs as t}
					<li class="tech-row">
						<div class="tech-head">
							<strong class="tech-name">{t.name}</strong>
							<button class="small" onclick={() => removeTech(t.id)}>Remove</button>
						</div>
						<div class="tech-addrs">
							<div class="addr"><span class="label">Start:</span> {t.start}</div>
							<div class="addr"><span class="label">End:</span> {t.end}</div>
						</div>
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
				<div class="card-head">
					<h3>{a.tech.name}</h3>
					<div class="tech-addrs">
						<div class="addr">
							<span class="label">Start:</span>
							{a.tech.startLoc
								? `${a.tech.startLoc.lat.toFixed(5)}, ${a.tech.startLoc.lon.toFixed(5)}`
								: '—'}
						</div>
						<div class="addr">
							<span class="label">End:</span>
							{a.tech.endLoc
								? `${a.tech.endLoc.lat.toFixed(5)}, ${a.tech.endLoc.lon.toFixed(5)}`
								: '—'}
						</div>
					</div>
				</div>
				<p><strong>Stops:</strong> {a.stops.length}</p>
				<p><strong>Mileage:</strong> {a.miles.toFixed(1)} mi</p>
				<p><strong>Drive time:</strong> {formatMinutes(a.minutes)}</p>
				<ul>
					{#each a.stops as s}
						<li>{s.address} {s.rank ? ` (rank ${s.rank})` : ''}</li>
					{/each}
				</ul>
				{#if API_KEY() && (a.tech.startLoc || a.tech.endLoc || a.stops.some((s) => s.loc))}
					<div class="map-preview interactive-map" use:initMap={{ assignment: a }}></div>
					<p class="map-link">
						<a href={buildGoogleMapsDirectionsUrl(a)} target="_blank" rel="noopener"
							>Open in Google Maps</a
						>
					</p>
				{/if}
			</div>
		{/each}

		<div style="margin-top:1rem">
			<p><strong>Total miles:</strong> {result.totals.miles.toFixed(1)} mi</p>
			<p><strong>Total time:</strong> {formatMinutes(result.totals.minutes)}</p>
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
	.map-preview.interactive-map {
		width: 100%;
		height: 160px;
		border-radius: 6px;
		overflow: hidden;
		background: #f5f7fa;
	}
	.map-link {
		margin-top: 0.5rem;
		font-size: 0.9rem;
		display: block;
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

	/* Tech list and card layout improvements */
	.tech-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.tech-row {
		padding: 0.5rem 0;
		border-bottom: 1px solid #f5f5f5;
	}
	.tech-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}
	.tech-name {
		font-size: 1.05rem;
	}
	.tech-addrs {
		margin-top: 0.4rem;
		font-size: 0.9rem;
		color: #444;
	}
	.addr {
		display: block;
		white-space: normal;
		word-break: break-word;
	}
	.label {
		font-weight: 600;
		color: #666;
		margin-right: 0.25rem;
	}

	.card-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.8rem;
	}
</style>
