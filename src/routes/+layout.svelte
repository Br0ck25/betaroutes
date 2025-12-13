<script lang="ts">
	import '../app.css';
	import Footer from '$lib/components/layout/Footer.svelte';
	import { setUserContext } from '$lib/stores/user.svelte';
    
    // [!code ++] Imports for Sync Wiring
    import { onMount } from 'svelte';
    import { syncManager } from '$lib/sync/syncManager';
    import { trips } from '$lib/stores/trips';
    // [!code ++] Import your public key (ensure this is in .env)
    import { PUBLIC_GOOGLE_MAPS_KEY } from '$env/static/public';

	let { data, children } = $props();

	// 1. Initialize Context
	const userState = setUserContext(data.user);

	// 2. Keep user state synced
	$effect(() => {
		userState.setUser(data.user);
	});

    // [!code ++] 3. Initialize Sync & Wire to UI Store
    onMount(async () => {
        // Load local data immediately so user sees something
        await trips.load();

        if (data.user) {
            // Connect SyncManager to the UI Store
            syncManager.setStoreUpdater((enrichedTrip) => {
                trips.updateItem(enrichedTrip);
            });

            // Start the Sync Engine
            // Using a public env variable is safer practice than hardcoding
            syncManager.initialize(PUBLIC_GOOGLE_MAPS_KEY || 'YOUR_KEY_HERE');
        }
    });
</script>

<div class="flex flex-col min-h-screen bg-neutral-bg-primary font-inter text-neutral-primary">
	<main class="flex-grow w-full">
		{@render children()}
	</main>

	<Footer />
</div>