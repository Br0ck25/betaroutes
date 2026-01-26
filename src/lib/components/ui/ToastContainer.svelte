<script lang="ts">
	import { toasts } from '$lib/stores/toast';
	import { flip } from 'svelte/animate';
	import { fade, fly } from 'svelte/transition';
	import { sanitizeStaticSvg } from '$lib/utils/sanitize';

	// [!code fix] SECURITY (Issue #7, #43): Sanitize static SVG icons as defense-in-depth
	const icons = {
		success: sanitizeStaticSvg(
			'<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>'
		),
		error: sanitizeStaticSvg(
			'<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>'
		),
		warning: sanitizeStaticSvg(
			'<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>'
		),
		info: sanitizeStaticSvg(
			'<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
		)
	};

	const colors = {
		success: 'bg-green-50 text-green-800 border-green-200',
		error: 'bg-red-50 text-red-800 border-red-200',
		warning: 'bg-yellow-50 text-yellow-800 border-yellow-200',
		info: 'bg-blue-50 text-blue-800 border-blue-200'
	};
</script>

<!-- eslint-disable svelte/no-at-html-tags -->
<div
	class="fixed right-4 z-50 flex flex-col gap-2 pointer-events-none"
	style="bottom: calc(1rem + env(safe-area-inset-bottom, 0px));"
>
	{#each $toasts as toast (toast.id)}
		<div
			animate:flip
			in:fly={{ y: 20, duration: 300 }}
			out:fade={{ duration: 200 }}
			class="pointer-events-auto flex items-center w-full max-w-sm p-4 mb-2 border rounded-lg shadow-lg {colors[
				toast.type
			]}"
			role="alert"
		>
			<div class="inline-flex items-center justify-center flex-shrink-0 w-8 h-8 rounded-full">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				<!-- Sanitized static SVG inserted intentionally (see SECURITY.md sanitizeStaticSvg) -->
				{@html icons[toast.type]}
			</div>
			<div class="ml-3 text-sm font-normal">{toast.message}</div>
			<button
				type="button"
				class="ml-auto -mx-1.5 -my-1.5 rounded-lg focus:ring-2 p-1.5 inline-flex h-8 w-8 hover:bg-black/5"
				onclick={() => toasts.dismiss(toast.id)}
				aria-label="Close"
			>
				<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"
					><path
						fill-rule="evenodd"
						d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
						clip-rule="evenodd"
					></path></svg
				>
			</button>
		</div>
	{/each}
</div>
<!-- eslint-enable svelte/no-at-html-tags -->
