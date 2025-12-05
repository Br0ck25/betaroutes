<script lang="ts">
	export let open = false;
</script>

{#if open}
	<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
		<div class="bg-white rounded-xl shadow-xl p-6 w-11/12 max-w-md">
			<slot />
		</div>
	</div>
{/if}
