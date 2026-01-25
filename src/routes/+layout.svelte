<script lang="ts">
	import '../app.css';
	import Footer from '$lib/components/layout/Footer.svelte';
	// PWAInstall removed per user request
	import { setUserContext } from '$lib/stores/user.svelte';
	import { onMount } from 'svelte';
	import { syncManager } from '$lib/sync/syncManager';
	import { trips } from '$lib/stores/trips';
	import { env } from '$env/dynamic/public';
	import { page } from '$app/stores';
	const { data, children } = $props();

	// 1. Initialize Context
	const userState = setUserContext(undefined);
	// Initialize with current value via reactive effect below (keeps capture correct)
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
			const apiKey = (env as any)['PUBLIC_GOOGLE_MAPS_KEY'];

			if (apiKey) {
				syncManager.initialize(apiKey);
			} else {
				console.warn('Google Maps API Key missing in environment variables.');
			}
		}

		// Register service worker (if supported) and wire install prompt
		if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
			try {
				const reg = await navigator.serviceWorker.register('/service-worker.js');
				console.log('Service worker registered:', reg);

				// Detect when a new SW is found (useful to prompt user to refresh)
				reg.addEventListener('updatefound', () => {
					const newWorker = reg.installing;
					if (newWorker) {
						newWorker.addEventListener('statechange', () => {
							if (newWorker.state === 'installed') {
								// New content is available; notify the app if needed
								console.log('New service worker installed.');
							}
						});
					}
				});
			} catch (err) {
				console.warn('Service worker registration failed:', err);
			}
		}

		// Handle beforeinstallprompt so the UI can offer a custom install flow
		if (typeof window !== 'undefined') {
			window.addEventListener('beforeinstallprompt', (e: Event) => {
				const ev = e as any;
				ev.preventDefault(); // prevent automatic browser prompt
				// store the event so other parts of the app can trigger the prompt
				(window as any).__deferredPWAInstall = ev;
				// dispatch the original event as detail so consumers can call prompt()
				window.dispatchEvent(new CustomEvent('pwa:beforeinstallprompt', { detail: ev }));
			});

			// Optional: log successful installs
			window.addEventListener('appinstalled', () => {
				console.log('PWA installed');
			});
		}
	});
</script>

<div class="flex flex-col min-h-dvh bg-neutral-bg-primary font-inter text-neutral-primary">
	<main class="flex-grow w-full">
		{@render children()}
	</main>

	{#if $page.url.pathname !== '/'}
		<Footer class="hidden tablet:block" />
	{/if}
</div>
