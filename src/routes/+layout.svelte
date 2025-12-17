<script lang="ts">
	import '../app.css';
	import Footer from '$lib/components/layout/Footer.svelte';
	import { setUserContext } from '$lib/stores/user.svelte';
    import { onMount } from 'svelte';
    import { syncManager } from '$lib/sync/syncManager';
    import { trips } from '$lib/stores/trips';
    import { env } from '$env/dynamic/public';
    // [!code ++] Import page store to check current route
    import { page } from '$app/stores';

    let { data, children } = $props();

	// 1. Initialize Context
	const userState = setUserContext(data.user);

	// 2. Keep user state synced
	$effect(() => {
		userState.setUser(data.user);
	});

    // 3. Initialize Sync & Wire to UI Store
    onMount(async () => {
        // Load local data immediately
        await trips.load();

        if (data.user) {
            // Connect SyncManager to the UI Store
            syncManager.setStoreUpdater((enrichedTrip) => {
                trips.updateLocal(enrichedTrip);
            });

            // Access key safely via dynamic env object
            const apiKey = env.PUBLIC_GOOGLE_MAPS_KEY;
            
            if (apiKey) {
                syncManager.initialize(apiKey);
            } else {
                console.warn('Google Maps API Key missing in environment variables.');
            }
        }
    });
</script>

<div class="flex flex-col min-h-screen bg-neutral-bg-primary font-inter text-neutral-primary">
	<main class="flex-grow w-full">
		{@render children()}
	</main>

    {#if $page.url.pathname !== '/'}
	    <Footer />
    {/if}
</div>