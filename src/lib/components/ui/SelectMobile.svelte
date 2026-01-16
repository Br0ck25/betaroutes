<script lang="ts">
	import { onMount, createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();
	export let id: string | undefined;
	export let options: { value: string; label: string }[] = [];
	export let value: string | null = null;
	export let placeholder: string = '';
	export let className: string = '';

	let open = false;
	let focusedIndex = -1;
	let buttonEl: HTMLElement | null = null;
	let listEl: HTMLElement | null = null;

	function toggle() {
		open = !open;
		if (open) focusedIndex = options.findIndex((o) => o.value === value);
	}

	function close() {
		open = false;
		focusedIndex = -1;
	}

	function selectOption(opt: { value: string; label: string }) {
		value = opt.value;
		dispatch('change', { value });
		close();
		setTimeout(() => (buttonEl as any)?.focus(), 0);
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			toggle();
			return;
		}
		if (!open) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			focusedIndex = Math.min(focusedIndex + 1, options.length - 1);
			a11yScroll();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			focusedIndex = Math.max(focusedIndex - 1, 0);
			a11yScroll();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (focusedIndex >= 0) selectOption(options[focusedIndex]);
		} else if (e.key === 'Escape') {
			close();
		}
	}

	function a11yScroll() {
		if (!listEl) return;
		const child = listEl.querySelectorAll('[role="option"]')[focusedIndex] as
			| HTMLElement
			| undefined;
		child?.scrollIntoView({ block: 'nearest' });
	}

	// Click outside to close
	onMount(() => {
		function docClick(e: MouseEvent) {
			if (!open) return;
			if (!buttonEl) return;
			const path = (e.composedPath && e.composedPath()) || (e as any).path || [];
			if (path.includes(buttonEl) || (listEl && path.includes(listEl))) return;
			close();
		}
		document.addEventListener('click', docClick);
		return () => document.removeEventListener('click', docClick);
	});
</script>

<div class={`select-mobile ${className}`} on:keydown={onKeydown}>
	<button
		{id}
		bind:this={buttonEl}
		type="button"
		role="combobox"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={id ? `list-${id}` : undefined}
		class="select-btn"
		on:click={toggle}
	>
		<span class="label">{options.find((o) => o.value === value)?.label ?? placeholder}</span>
		<svg class="caret" width="16" height="16" viewBox="0 0 24 24" fill="none">
			<path
				d="M6 9l6 6 6-6"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</button>

	{#if open}
		<ul
			class="options"
			role="listbox"
			bind:this={listEl}
			aria-activedescendant={focusedIndex >= 0 ? `option-${focusedIndex}` : undefined}
		>
			{#each options as opt, i}
				<li
					id={`option-${i}`}
					role="option"
					class:selected={options[i].value === value}
					on:click={() => selectOption(opt)}
					on:mouseenter={() => (focusedIndex = i)}
					title={opt.label}
				>
					{opt.label}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.select-mobile {
		display: block; /* visible when component is rendered by Svelte (mobile) */
		position: relative;
	}

	.select-btn {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		padding: 12px 14px;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: white;
		font-size: 16px;
		text-align: left;
		cursor: pointer;
	}

	.select-btn:focus {
		outline: none;
		box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.12);
	}

	.select-btn .label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: inline-block;
		max-width: calc(100% - 28px);
	}

	.options {
		position: absolute;
		left: 0;
		right: 0;
		margin-top: 6px;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		max-height: 220px;
		overflow: auto;
		z-index: 1000;
		padding: 6px 6px;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.08);
	}

	.options li {
		padding: 10px 12px;
		border-radius: 8px;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.options li:hover,
	.options li.selected {
		background: #f9fafb;
	}
</style>
