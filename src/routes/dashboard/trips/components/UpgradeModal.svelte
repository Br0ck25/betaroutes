<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { resolve } from '$app/paths';

	export let open = false;
</script>

<Modal bind:open title="Upgrade to Pro">
	<div class="space-y-6 text-center py-4">
		<div class="mx-auto w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
			<span class="text-3xl">🚀</span>
		</div>

		<h3 class="text-xl font-bold text-gray-900">Unlock Pro Features</h3>

		<p class="text-gray-600 text-base leading-relaxed">
			Data Export is a Pro feature. Upgrade now to download your trip history for taxes!
		</p>

		<div class="bg-gray-50 p-4 rounded-lg text-left text-sm space-y-2 border border-gray-100">
			<div class="flex items-center gap-2">
				<span class="text-green-500 text-lg">✓</span>
				<span class="text-gray-700">Unlimited Stops per Trip</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-green-500 text-lg">✓</span>
				<span class="text-gray-700">One-Click Route Optimization</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-green-500 text-lg">✓</span>
				<span class="text-gray-700">Unlimited Monthly Trips</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-green-500 text-lg">✓</span>
				<span class="text-gray-700">Data Export</span>
			</div>
		</div>

		<div class="flex gap-3 justify-center pt-2">
			<Button variant="outline" on:click={() => (open = false)}>Maybe Later</Button>

			<a
				href={resolve('/dashboard/settings')}
				class="inline-flex items-center justify-center rounded-lg bg-orange-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 transition-all"
			>
				Upgrade Now
			</a>
		</div>
	</div>
</Modal>
