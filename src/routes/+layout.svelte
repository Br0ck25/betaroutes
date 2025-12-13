<script lang="ts">
	import '../app.css';
	import Footer from '$lib/components/layout/Footer.svelte';
	import { setUserContext } from '$lib/stores/user.svelte';
    import { onMount } from 'svelte';
    import { syncManager } from '$lib/sync/syncManager';
    import { trips } from '$lib/stores/trips';
    
    // [!code fix] Use the standard static import now that .env exists
    import { PUBLIC_GOOGLE_MAPS_KEY } from '$env/static/public';

	let { data, children } = $props();

	const userState = setUserContext(data.user);

	$effect(() => {
		userState.setUser(data.user);
	});

    onMount(async () => {
        // Load local data immediately
        await trips.load();

        if (data.user) {
            syncManager.setStoreUpdater((enrichedTrip) => {
                trips.updateLocal(enrichedTrip);
            });

            // Initialize with the environment variable
            syncManager.initialize(PUBLIC_GOOGLE_MAPS_KEY);
        }
    });
</script>

<div class="flex flex-col min-h-screen bg-neutral-bg-primary font-inter text-neutral-primary">
	<main class="flex-grow w-full">
		{@render children()}
	</main>

	<Footer />
</div>