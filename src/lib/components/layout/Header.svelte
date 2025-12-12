<script lang="ts">
	import { goto } from '$app/navigation';
	// [!code changed] Use the new Context getter
	import { getUserState } from '$lib/stores/user.svelte';
    import SyncIndicator from '$lib/components/SyncIndicator.svelte';

	// Get reactive state
	const userState = getUserState();

	const links = [
		{ name: 'Features', href: '/#features' },
		{ name: 'Pricing', href: '/#pricing' },
		{ name: 'Docs', href: '/docs' }
	];

	let mobileOpen = $state(false);

	async function logout() {
		await fetch('/api/logout', { method: 'POST' });
		// [!code changed] Update state directly via class method
		userState.logout();
		goto('/');
	}
</script>

<header class="w-full border-b border-neutral-border bg-neutral-bg-primary">
	<div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
		
		<a href="/" class="text-xl font-bold text-primary-green">Go Route Yourself</a>

		<nav class="hidden tablet:flex gap-6 text-neutral-primary">
			{#each links as link}
				<a href={link.href} class="hover:text-primary-green">
					{link.name}
				</a>
			{/each}
		</nav>

		<div class="hidden tablet:flex items-center gap-4">
			{#if userState.value}
                <SyncIndicator />

				<a 
					href="/dashboard/settings" 
					class="text-neutral-primary hover:text-primary-green"
				>
					Settings
				</a>

				<button 
					onclick={logout}
					class="text-red-600 font-semibold hover:underline"
				>
					Logout
				</button>

			{:else}
                <a href="/login" class="text-neutral-primary hover:text-primary-green">Sign In</a>
				<a href="/register" class="bg-primary-green text-white px-4 py-2 rounded-md">Get Started</a>
			{/if}
		</div>
        </div>
    </header>