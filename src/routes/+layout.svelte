<script lang="ts">
	import '../app.css';
	import Header from '$lib/components/layout/Header.svelte';
	import Footer from '$lib/components/layout/Footer.svelte';
	import { setUserContext } from '$lib/stores/user.svelte';

	let { data, children } = $props();

	// 1. Initialize Context with server data
	// This is safe on the server (per-request) and client
	const userState = setUserContext(data.user);

	// 2. Keep it synced when data changes (e.g. after navigation)
	$effect(() => {
		userState.setUser(data.user);
	});
</script>

<div class="flex flex-col min-h-screen bg-neutral-bg-primary font-inter text-neutral-primary">
	<Header />

	<main class="flex-grow w-full">
		{@render children()}
	</main>

	<Footer />
</div>