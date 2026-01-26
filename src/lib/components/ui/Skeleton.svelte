<script lang="ts">
	const {
		width = '100%',
		height = 'auto',
		className = '',
		style = ''
	}: {
		width?: string;
		height?: string;
		className?: string;
		style?: string;
	} = $props();
</script>

<div
	class="skeleton {className}"
	style="width: {width}; height: {height}; {style}"
	role="status"
	aria-label="Loading..."
></div>

<style>
	.skeleton {
		background-color: #e5e7eb; /* gray-200 */
		border-radius: 0.375rem; /* rounded-md */
		animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}
</style>
