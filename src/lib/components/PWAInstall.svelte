<script lang="ts">
	import { onMount } from 'svelte';
	let visible = false;
	let deferredPrompt: any = null;

	onMount(() => {
		const handler = (e: Event) => {
			const ev: any = e;
			ev.preventDefault();
			deferredPrompt = ev;
			visible = true;
		};

		window.addEventListener('pwa:beforeinstallprompt', handler);

		// if the prompt was stored directly on window (registration path), pick it up
		if ((window as any).__deferredPWAInstall) {
			deferredPrompt = (window as any).__deferredPWAInstall;
			visible = true;
		}

		const onInstalled = () => {
			visible = false;
		};

		window.addEventListener('appinstalled', onInstalled);

		return () => {
			window.removeEventListener('pwa:beforeinstallprompt', handler);
			window.removeEventListener('appinstalled', onInstalled);
		};
	});

	async function install() {
		if (!deferredPrompt && (window as any).__deferredPWAInstall)
			deferredPrompt = (window as any).__deferredPWAInstall;
		if (!deferredPrompt) return;

		try {
			await deferredPrompt.prompt();
			const choice = await deferredPrompt.userChoice;
			if (choice && choice.outcome === 'accepted') {
				visible = false;
			}
		} catch (err) {
			console.warn('PWA install prompt failed:', err);
		} finally {
			deferredPrompt = null;
			(window as any).__deferredPWAInstall = null;
		}
	}
</script>

{#if visible}
	<div class="pwa-install" role="status" aria-live="polite">
		<button class="btn-install" on:click={install} aria-label="Install Go Route Yourself"
			>Install app</button
		>
	</div>
{/if}

<style>
	.pwa-install {
		position: fixed;
		bottom: 1.25rem;
		right: 1.25rem;
		z-index: 60;
	}
	.btn-install {
		background: var(--color-primary, #06b6d4);
		color: white;
		padding: 0.6rem 1rem;
		border-radius: 8px;
		font-weight: 600;
		box-shadow: 0 6px 20px rgba(2, 6, 23, 0.12);
	}
</style>
