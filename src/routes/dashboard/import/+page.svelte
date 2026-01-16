<script lang="ts">
	import { trips } from '$lib/stores/trips';
	import { user } from '$lib/stores/auth';
	import { goto } from '$app/navigation';
	let isProcessing = false;
	let previewTrip: any = null;

	async function handleFileUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const text = await file.text();

		parseGPX(text);
	}

	function parseGPX(gpxContent: string) {
		const parser = new DOMParser();
		const xmlDoc = parser.parseFromString(gpxContent, 'text/xml');
		const trkpts = xmlDoc.querySelectorAll('trkpt');
		if (trkpts.length === 0) {
			alert('No track points found in GPX file');
			return;
		}

		const first = trkpts[0];
		const last = trkpts[trkpts.length - 1];
		if (!first || !last) {
			alert('Invalid GPX structure');
			return;
		}

		// Basic parsing logic
		const startTimeElement = first.querySelector('time')?.textContent;
		const endTimeElement = last.querySelector('time')?.textContent;

		// Calculate roughly total distance (haversine formula simplified)
		let totalDistanceMeters = 0;
		for (let i = 0; i < trkpts.length - 1; i++) {
			const a = trkpts[i]!;
			const b = trkpts[i + 1]!;
			const lat1 = parseFloat(a.getAttribute('lat')!);
			const lon1 = parseFloat(a.getAttribute('lon')!);
			const lat2 = parseFloat(b.getAttribute('lat')!);
			const lon2 = parseFloat(b.getAttribute('lon')!);
			totalDistanceMeters += getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) * 1000;
		}

		previewTrip = {
			date: startTimeElement ? startTimeElement.split('T')[0] : localDateISO(),
			startTime: startTimeElement
				? (startTimeElement.split('T')[1]?.slice(0, 5) ?? '09:00')
				: '09:00',
			endTime: endTimeElement ? (endTimeElement.split('T')[1]?.slice(0, 5) ?? '17:00') : '17:00',
			totalMiles: Number((totalDistanceMeters * 0.000621371).toFixed(2)),
			startAddress: 'Imported Location (Start)',
			endAddress: 'Imported Location (End)',
			stops: [], // GPX usually doesn't have stops labeled
			mpg: 25,
			gasPrice: 3.5,
			notes: 'Imported from GPX file'
		};
	}

	function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
		const R = 6371; // Radius of the earth in km
		const dLat = deg2rad(lat2 - lat1);
		const dLon = deg2rad(lon2 - lon1);
		const a =
			Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}

	function deg2rad(deg: number) {
		return deg * (Math.PI / 180);
	}

	async function saveImport() {
		if (!previewTrip) return;
		isProcessing = true;
		try {
			// FIX: Use stable User ID
			let userId = $user?.name || $user?.token;
			if (!userId) {
				userId = localStorage.getItem('offline_user_id') || 'offline-user-' + Date.now();
				if (!localStorage.getItem('offline_user_id')) {
					localStorage.setItem('offline_user_id', userId);
				}
			}

			await trips.create(previewTrip, userId);
			alert('Trip imported successfully!');
			goto('/dashboard/trips');
		} catch (e) {
			console.error(e);
			alert('Error importing trip');
		} finally {
			isProcessing = false;
		}
	}
</script>

<div class="max-w-2xl mx-auto">
	<h1 class="text-2xl font-bold mb-4">Import GPX</h1>
	<p class="mb-6 text-gray-600">
		Upload a GPX file from your GPS device or other tracking apps to import your route data.
	</p>

	<div class="bg-white p-6 rounded-lg shadow border border-gray-200">
		<input
			type="file"
			accept=".gpx"
			on:change={handleFileUpload}
			class="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
		/>

		{#if previewTrip}
			<div class="mt-6 border-t pt-4">
				<h3 class="font-bold text-lg mb-4">Preview Import</h3>
				<div class="grid grid-cols-2 gap-4 text-sm mb-6">
					<div class="bg-gray-50 p-3 rounded">
						<span class="block text-xs text-gray-500 uppercase font-bold">Date</span>
						{previewTrip.date}
					</div>
					<div class="bg-gray-50 p-3 rounded">
						<span class="block text-xs text-gray-500 uppercase font-bold">Miles</span>
						{previewTrip.totalMiles}
					</div>
					<div class="bg-gray-50 p-3 rounded">
						<span class="block text-xs text-gray-500 uppercase font-bold">Start Time</span>
						{previewTrip.startTime}
					</div>
					<div class="bg-gray-50 p-3 rounded">
						<span class="block text-xs text-gray-500 uppercase font-bold">End Time</span>
						{previewTrip.endTime}
					</div>
				</div>

				<button
					on:click={saveImport}
					disabled={isProcessing}
					class="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
				>
					{isProcessing ? 'Saving...' : 'Save Trip'}
				</button>
			</div>
		{/if}
	</div>
</div>
