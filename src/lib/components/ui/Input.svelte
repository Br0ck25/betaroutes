<script lang="ts">
	const {
		label = '',
		type = 'text',
		placeholder = '',
		id = '',
		value: _value = $bindable('')
	}: {
		label?: string;
		type?: string;
		value?: string;
		placeholder?: string;
		id?: string;
	} = $props();
	let value = $state(_value);
</script>

<label class="block w-full">
	<span class="block text-neutral-primary text-sm mb-1">{label}</span>
	<input
		{id}
		{type}
		bind:value
		{placeholder}
		class="w-full p-3 text-base border border-neutral-border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-green"
	/>
</label>
