<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	export let sections: string[] = ['profile', 'maintenance', 'data', 'integrations', 'security'];

	// Ensure `active` is a string even if sections is empty
	let active: string = sections?.[0] ?? '';
	let observer: IntersectionObserver | null = null;

	onMount(() => {
		const opts = { root: null, rootMargin: '0px 0px -55%', threshold: 0.1 };
		observer = new IntersectionObserver((entries) => {
			// Pick the most visible section
			const visible = entries
				.filter((e) => e.isIntersecting)
				.sort((a, b) => (b.intersectionRatio || 0) - (a.intersectionRatio || 0));
			const entry = visible[0];
			if (entry && entry.target) {
				const id = (entry.target as HTMLElement).id;
				if (id) active = id;
			}
		}, opts);

		sections.forEach((id) => {
			const el = document.getElementById(id);
			if (el && observer) observer.observe(el);
		});
	});

	onDestroy(() => {
		if (observer) observer.disconnect();
	});

	function scrollTo(id: string) {
		const el = document.getElementById(id);
		if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<div class="settings-wrap">
	<nav class="side-nav" aria-label="Settings navigation">
		<ul>
			{#each sections as s}
				<li class:active={active === s}>
					<button
						type="button"
						on:click={() => scrollTo(s)}
						aria-current={active === s ? 'true' : 'false'}
					>
						{s ? s[0]?.toUpperCase() + s.slice(1) : ''}
					</button>
				</li>
			{/each}
		</ul>
	</nav>

	<main class="settings-main">
		<slot />
	</main>
</div>

<style>
	.settings-wrap {
		display: grid;
		grid-template-columns: 220px 1fr;
		gap: 24px;
		align-items: start;
	}

	.side-nav {
		position: sticky;
		top: 20px;
		height: calc(100vh - 40px);
		overflow: auto;
		padding: 12px 0;
	}
	.side-nav ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.side-nav li button {
		background: transparent;
		border: none;
		padding: 10px 12px;
		text-align: left;
		width: 100%;
		border-radius: 8px;
		cursor: pointer;
		color: #374151;
		font-weight: 600;
	}
	.side-nav li button:hover {
		background: rgba(255, 127, 80, 0.06);
		color: var(--orange, #ff6a3d);
	}
	.side-nav li.active button {
		background: linear-gradient(90deg, rgba(255, 127, 80, 0.12), rgba(255, 127, 80, 0.02));
		color: var(--orange, #ff6a3d);
		box-shadow: inset 0 0 0 1px rgba(255, 127, 80, 0.06);
	}

	.settings-main {
		min-width: 0;
	}

	/* Shared save button styling for settings (global so children can use it) */
	:global(.save-btn) {
		min-width: 120px;
		padding: 10px 14px;
		border-radius: 10px;
		font-weight: 700;
	}
	:global(.save-btn:focus-visible) {
		outline: 3px solid rgba(255, 127, 80, 0.18);
		outline-offset: 3px;
	}

	/* Global highlight styles for Save buttons */
	:global(.btn-secondary.highlight),
	:global(.btn-primary.highlight) {
		border-color: var(--orange, #ff6a3d);
		color: var(--orange, #ff6a3d);
		box-shadow: 0 8px 22px rgba(255, 127, 80, 0.16);
		transform: translateY(-1px);
		transition:
			box-shadow 0.18s ease,
			border-color 0.18s ease,
			transform 0.12s ease;
	}

	/* Responsive: move nav to top as scrollable horizontal row */
	@media (max-width: 1024px) {
		.settings-wrap {
			grid-template-columns: 1fr;
		}
		.side-nav {
			position: relative;
			top: 0;
			height: auto;
			overflow: auto;
			padding: 8px 0 12px;
		}
		.side-nav ul {
			flex-direction: row;
			gap: 6px;
			padding-left: 6px;
		}
		.side-nav li button {
			padding: 8px 14px;
			white-space: nowrap;
		}
	}
</style>
