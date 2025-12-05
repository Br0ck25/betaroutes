<script lang="ts">
	export let variant: "primary" | "secondary" = "primary";
	export let disabled = false;
</script>

<button
	class={`px-4 py-2 rounded-md font-semibold transition-all
		${variant === "primary"
			? "bg-primary-green text-white hover:bg-primary-green-dark shadow-md hover:shadow-lg"
			: "bg-white text-primary-green border border-primary-green hover:bg-primary-green hover:text-white"}
		${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
	disabled={disabled}
>
	<slot />
</button>
