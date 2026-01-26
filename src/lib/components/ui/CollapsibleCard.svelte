<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	const {
		title = '',
		subtitle = '',
		storageKey = null,
		icon,
		children,
		open: _open = $bindable(true)
	}: {
		title?: string;
		subtitle?: string;
		storageKey?: string | null;
		icon?: Snippet;
		children?: Snippet;
		open?: boolean;
	} = $props();
	let open = $state(_open);

	const contentId = `collapsible-${Math.random().toString(36).slice(2, 9)}`;

	onMount(() => {
		if (storageKey && typeof localStorage !== 'undefined') {
			const raw = localStorage.getItem(storageKey);
			if (raw !== null) open = raw === '1';
		}
	});

	function toggle() {
		open = !open;
		if (storageKey && typeof localStorage !== 'undefined') {
			localStorage.setItem(storageKey, open ? '1' : '0');
		}
	}
</script>

<section class="settings-card collapsible" aria-labelledby={contentId + '-title'}>
	<div
		class="card-header clickable"
		role="button"
		onclick={toggle}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				toggle();
			}
		}}
		tabindex="0"
	>
		<div class="card-icon-wrapper">
			{@render icon?.()}
		</div>
		<div class="card-header-text">
			<h2 id={contentId + '-title'} class="card-title">{title}</h2>
			{#if subtitle}
				<p class="card-subtitle">{subtitle}</p>
			{/if}
		</div>

		<button
			class="toggle-btn"
			type="button"
			aria-expanded={open}
			aria-controls={contentId}
			onclick={(e) => {
				e.stopPropagation();
				toggle();
			}}
			aria-label={open ? 'Collapse' : 'Expand'}
		>
			{#if open}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg
				>
			{:else}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg
				>
			{/if}
		</button>
	</div>

	<div id={contentId} class:closed={!open} class:open class="collapsible-body" hidden={!open}>
		{@render children?.()}
	</div>
</section>

<style>
	.settings-card.collapsible {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 16px;
		padding: 20px;
	}

	.card-header.clickable {
		display: flex;
		align-items: center;
		gap: 12px;
		cursor: pointer;
	}

	.card-icon-wrapper {
		width: 48px;
		height: 48px;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		font-size: 20px;
	}

	.card-title {
		font-size: 18px;
		font-weight: 700;
		color: #111827;
		margin: 0;
	}

	.card-subtitle {
		font-size: 14px;
		color: #6b7280;
		margin: 0;
	}

	.toggle-btn {
		margin-left: auto;
		background: transparent;
		border: none;
		padding: 6px;
		border-radius: 8px;
		color: #6b7280;
		cursor: pointer;
	}

	.toggle-btn:hover {
		background: rgba(0, 0, 0, 0.03);
		color: #374151;
	}

	.collapsible-body {
		transition:
			max-height 0.25s ease,
			opacity 0.2s ease,
			transform 0.2s ease;
		overflow: hidden;
		opacity: 1;
		transform-origin: top;
	}
	.collapsible-body.closed {
		max-height: 0;
		opacity: 0;
		transform: scaleY(0.98);
	}
	.collapsible-body.open {
		max-height: 2000px;
		opacity: 1;
		transform: scaleY(1);
	}
</style>
