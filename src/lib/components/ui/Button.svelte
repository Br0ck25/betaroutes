<script lang="ts">
	import type { Snippet } from 'svelte';
	import { createEventDispatcher } from 'svelte';
	const {
		variant = 'primary',
		disabled = false,
		type = 'button',
		className = '',
		onclick,
		children
	}: {
		variant?: 'primary' | 'secondary' | 'outline' | 'danger';
		disabled?: boolean;
		type?: 'button' | 'submit' | 'reset';
		className?: string;
		onclick?: (event: MouseEvent) => void;
		children?: Snippet;
	} = $props();

	const dispatch = createEventDispatcher();

	function handleClick(e: MouseEvent) {
		if (disabled) {
			e.preventDefault();
			return;
		}

		// Call legacy onclick prop if provided
		if (typeof onclick === 'function') {
			try {
				onclick(e as MouseEvent);
			} catch (err) {
				console.error('Button onclick prop error', err);
			}
		}

		// Dispatch 'click' so parent components using on:click receive it
		dispatch('click', e);
	}
</script>

<button
	{type}
	class={`px-4 py-2 rounded-md font-semibold transition-all active:scale-95 active:brightness-90
    ${variant === 'primary' ? 'bg-primary-green text-white hover:bg-primary-green-dark shadow-md hover:shadow-lg' : ''}
    ${variant === 'secondary' ? 'bg-white text-primary-green border border-primary-green hover:bg-primary-green hover:text-white' : ''}
    ${variant === 'outline' ? 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50' : ''}
    ${variant === 'danger' ? 'bg-red-600 text-white hover:bg-red-700' : ''}
    ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
    ${className}`}
	{disabled}
	onclick={handleClick}
>
	{@render children?.()}
</button>
