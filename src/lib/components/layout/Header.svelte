<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { getUserState } from '$lib/stores/user.svelte';
	import SyncIndicator from '$lib/components/SyncIndicator.svelte';

	const resolve = (href: string) => `${base}${href}`;

	// Get reactive state
	const userState = getUserState();

	let isMobileMenuOpen = $state(false);

	function toggleMenu() {
		isMobileMenuOpen = !isMobileMenuOpen;
	}

	async function logout() {
		await fetch('/api/logout', { method: 'POST' });
		userState.logout();
		goto(resolve('/'));
	}

	// Links for the public site (Logged Out)
	const publicLinks = [
		{ name: 'Features', href: '/#features' },
		{ name: 'Pricing', href: '/#pricing' },
		{ name: 'How It Works', href: '/#how-it-works' },
		{ name: 'Docs', href: '/docs' }
	];

	// Links for the app (Logged In)
	const appLinks = [
		{ name: 'Dashboard', href: '/dashboard' },
		{ name: 'Trips', href: '/dashboard/trips' },
		{ name: 'Settings', href: '/dashboard/settings' }
	];
</script>

<header class="header">
	<div class="container">
		<div class="header-content">
			<a href={resolve('/')} class="logo-link">
				<picture>
					<source type="image/avif" srcset="/180x75.avif 180w" sizes="64px" />
					<source type="image/webp" srcset="/180x75.avif 180w" sizes="64px" />
					<img
						src="/180x75.avif"
						alt="Go Route Yourself"
						class="logo"
						width="180"
						height="75"
						srcset="/180x75.avif 1x, /180x75.avif 2x"
						decoding="async"
					/>
				</picture>
			</a>

			<nav class="nav desktop-nav">
				{#if userState.value}
					{#each appLinks as link}
						<a href={resolve(link.href)} class="nav-link">{link.name}</a>
					{/each}

					<div class="separator"></div>

					<SyncIndicator />
					<button onclick={logout} class="btn-login">Logout</button>
				{:else}
					{#each publicLinks as link}
						<a href={resolve(link.href)} class="nav-link">{link.name}</a>
					{/each}

					<a href={resolve('/login')} class="btn-login">Sign In</a>
					<a href={resolve('/register')} class="btn-primary">Get Started Free</a>
				{/if}
			</nav>

			<div class="mobile-nav-controls">
				{#if !userState.value}
					<a href={resolve('/login')} class="mobile-signin">Sign In</a>
				{/if}

				<button class="hamburger-btn" onclick={toggleMenu} aria-label="Toggle menu">
					<svg
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						{#if isMobileMenuOpen}
							<path d="M18 6L6 18M6 6L18 18"></path>
						{:else}
							<path d="M3 12h18M3 6h18M3 18h18"></path>
						{/if}
					</svg>
				</button>
			</div>
		</div>
	</div>

	{#if isMobileMenuOpen}
		<div class="mobile-menu">
			{#if userState.value}
				{#each appLinks as link}
					<a href={resolve(link.href)} class="mobile-link" onclick={toggleMenu}>{link.name}</a>
				{/each}
				<div class="divider"></div>
				<button
					onclick={() => {
						logout();
						toggleMenu();
					}}
					class="mobile-link text-red">Logout</button
				>
			{:else}
				{#each publicLinks as link}
					<a href={resolve(link.href)} class="mobile-link" onclick={toggleMenu}>{link.name}</a>
				{/each}
				<div class="divider"></div>
				<a href={resolve('/register')} class="btn-primary mobile-btn" onclick={toggleMenu}
					>Get Started Free</a
				>
			{/if}
		</div>
	{/if}
</header>

<style>
	/* Match variables from the main page */
	:root {
		--orange: #ff7f50;
		--navy: #2c4a6e;
		--gray-100: #f3f4f6;
		--gray-600: #4b5563;
		--gray-900: #111827;
	}

	.header {
		position: sticky;
		top: 0;
		left: 0;
		right: 0;
		background: white;
		border-bottom: 1px solid var(--gray-100);
		z-index: 1000;
		padding: 16px 0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 20px;
	}

	.header-content {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.logo {
		height: 100%;
		width: 100%;
		object-fit: contain;
	}

	.logo-link {
		display: flex;
		align-items: center;
	}

	/* Desktop Nav */
	.desktop-nav {
		display: flex;
		align-items: center;
		gap: 24px;
	}

	.nav-link {
		background: none;
		border: none;
		color: var(--gray-600);
		font-size: 16px;
		cursor: pointer;
		text-decoration: none;
		transition: color 0.2s;
		font-weight: 500;
	}

	.nav-link:hover {
		color: var(--orange);
	}

	.btn-login {
		background: none;
		border: none;
		color: var(--gray-600);
		text-decoration: none;
		font-weight: 500;
		font-size: 16px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		height: 44px;
		padding: 0 8px;
	}

	.btn-login:hover {
		color: var(--navy);
	}

	.btn-primary {
		background: var(--orange);
		color: white;
		padding: 10px 24px;
		border-radius: 8px;
		text-decoration: none;
		font-weight: 600;
		transition: transform 0.2s;
	}

	.btn-primary:hover {
		transform: translateY(-2px);
	}

	.separator {
		width: 1px;
		height: 24px;
		background-color: var(--gray-100);
	}

	/* Mobile Controls */
	.mobile-nav-controls {
		display: none;
		align-items: center;
		gap: 16px;
	}

	.mobile-signin {
		text-decoration: none;
		color: var(--navy);
		font-weight: 600;
		font-size: 15px;
	}

	.hamburger-btn {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--gray-600);
		display: flex;
		align-items: center;
		padding: 4px;
	}

	/* Mobile Menu */
	.mobile-menu {
		position: absolute;
		top: 100%;
		left: 0;
		width: 100%;
		background: white;
		border-bottom: 1px solid var(--gray-100);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
	}

	.mobile-link {
		background: none;
		border: none;
		text-align: left;
		font-size: 16px;
		color: var(--gray-600);
		padding: 8px 0;
		cursor: pointer;
		text-decoration: none;
	}

	.mobile-link.text-red {
		color: #dc2626;
	}

	.divider {
		height: 1px;
		background: var(--gray-100);
		margin: 4px 0;
	}

	.mobile-btn {
		text-align: center;
		display: block;
	}

	@media (max-width: 768px) {
		.desktop-nav {
			display: none;
		}
		.mobile-nav-controls {
			display: flex;
		}
	}
</style>
