<script lang="ts">
	import { currentUser } from '$lib/stores/currentUser';
	import { goto } from '$app/navigation';
	import { setUser } from '$lib/stores/currentUser';

	// Navbar links (public navigation)
	const links = [
		{ name: 'Features', href: '/#features' },
		{ name: 'Pricing', href: '/#pricing' },
		{ name: 'Docs', href: '/docs' }
	];

	// Svelte 5 reactive state rune
	let mobileOpen = $state(false);

	// Logout handler
	async function logout() {
		await fetch('/api/logout', { method: 'POST' });
		setUser(null);
		goto('/');
	}
</script>

<header class="w-full border-b border-neutral-border bg-neutral-bg-primary">
	<div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
		
		<!-- Logo -->
		<a href="/" class="text-xl font-bold text-primary-green">Go Route Yourself</a>

		<!-- Desktop Nav -->
		<nav class="hidden tablet:flex gap-6 text-neutral-primary">
			{#each links as link}
				<a href={link.href} class="hover:text-primary-green">
					{link.name}
				</a>
			{/each}
		</nav>

		<!-- Desktop Auth Buttons -->
		<div class="hidden tablet:flex gap-4">
			{#if $currentUser}

				<!-- Settings link (desktop) -->
				<a 
					href="/settings" 
					class="text-neutral-primary hover:text-primary-green"
				>
					Settings
				</a>

				<button 
					on:click={logout}
					class="text-red-600 font-semibold hover:underline"
				>
					Logout
				</button>

			{:else}

				<a href="/login" class="text-neutral-primary hover:text-primary-green">
					Sign In
				</a>

				<a 
					href="/register" 
					class="bg-primary-green text-white px-4 py-2 rounded-md hover:bg-primary-green-dark"
				>
					Get Started
				</a>

			{/if}
		</div>

		<!-- Mobile Menu Button -->
		<button 
			class="tablet:hidden text-neutral-primary"
			onclick={() => mobileOpen = !mobileOpen}
		>
			{mobileOpen ? "✕" : "☰"}
		</button>
	</div>

	<!-- Mobile Menu -->
	{#if mobileOpen}
		<div class="tablet:hidden border-t border-neutral-border bg-white px-4 py-3">
			<nav class="flex flex-col gap-4">

				{#each links as link}
					<a href={link.href} class="text-neutral-primary hover:text-primary-green">
						{link.name}
					</a>
				{/each}

				{#if $currentUser}

					<!-- Settings link (mobile) -->
					<a 
						href="/settings" 
						class="text-neutral-primary hover:text-primary-green"
					>
						Settings
					</a>

					<button 
						on:click={logout}
						class="text-red-600 font-semibold text-left"
					>
						Logout
					</button>

				{:else}

					<a href="/login" class="text-neutral-primary hover:text-primary-green">
						Sign In
					</a>

					<a 
						href="/register" 
						class="bg-primary-green text-white px-4 py-2 rounded-md text-center"
					>
						Get Started
					</a>

				{/if}
			</nav>
		</div>
	{/if}
</header>
