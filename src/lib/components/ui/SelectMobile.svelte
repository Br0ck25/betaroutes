<script lang="ts">
	import { onDestroy } from 'svelte';

	const {
		id = undefined,
		options = [],
		placeholder = '',
		className = '',
		onchange,
		value: _value = $bindable(null)
	}: {
		id?: string | undefined;
		options?: { value: string; label: string }[];
		value?: string | null;
		placeholder?: string;
		className?: string;
		onchange?: (detail: { value: string }) => void;
	} = $props();
	let value = $state(_value);

	let open = $state(false);
	let focusedIndex = $state(-1);
	let buttonEl: HTMLElement | null = $state(null);
	let listEl: HTMLElement | null = $state(null);

	function toggle() {
		open = !open;
		if (open) focusedIndex = options.findIndex((o) => o.value === value);
	}

	function close() {
		open = false;
		focusedIndex = -1;
	}

	function selectOption(opt?: { value: string; label: string }) {
		if (!opt) return;
		value = opt.value;
		// Call the onchange callback if provided
		onchange?.({ value: opt.value });
		close();
		setTimeout(() => buttonEl?.focus(), 0);
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
			const opt = options[focusedIndex];
			if (opt) selectOption(opt);
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
	function docClick(e: MouseEvent) {
		if (!open) return;
		if (!buttonEl) return;
		const cp = (e as MouseEvent & { composedPath?: () => EventTarget[] }).composedPath?.() ?? [];
		const path: EventTarget[] = cp;
		if (path.includes(buttonEl) || (listEl && path.includes(listEl))) return;
		close();
	}

	if (typeof document !== 'undefined') {
		document.addEventListener('click', docClick);
	}

	onDestroy(() => {
		if (typeof document !== 'undefined') document.removeEventListener('click', docClick);
	});
</script>

<div class={`select-mobile ${className}`}>
	<button
		{id}
		bind:this={buttonEl}
		type="button"
		role="combobox"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={id ? `list-${id}` : undefined}
		class="select-btn"
		onclick={toggle}
		onkeydown={onKeydown}
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
			id={id ? `list-${id}` : undefined}
			class="options"
			role="listbox"
			bind:this={listEl}
			tabindex="0"
			aria-activedescendant={focusedIndex >= 0 ? `option-${focusedIndex}` : undefined}
		>
			{#each options as opt, idx (opt.value)}
				<li
					id={`option-${idx}`}
					role="option"
					class:selected={opt.value === value}
					aria-selected={opt.value === value}
					tabindex="0"
					onclick={() => selectOption(opt)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							selectOption(opt);
						}
					}}
					onmouseenter={() => (focusedIndex = idx)}
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
