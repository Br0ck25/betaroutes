<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children?: Snippet } = $props();
</script>

<div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-all">
	{@render children?.()}
</div>
