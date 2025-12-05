<script lang="ts">
	export let label = "";
	export let type = "text";
	export let value = "";
	export let placeholder = "";
</script>

<label class="block text-neutral-primary text-sm mb-1">{label}</label>
<input
	type={type}
	bind:value
	placeholder={placeholder}
	class="w-full p-3 border border-neutral-border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-green"
/>
