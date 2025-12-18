{
type: uploaded file
fileName: br0ck25/betaroutes/betaroutes-b1d8bec7d840e26cdef864465d52784ebd5744bd/src/lib/components/ui/Button.svelte
fullContent:
<script lang="ts">
	export let variant: "primary" | "secondary" = "primary";
	export let disabled = false;
</script>

<button
	class={`px-4 py-2 rounded-md font-semibold transition-all
        /* UPDATED: Added active states for touch feedback */
        active:scale-95 active:brightness-90
		${variant === "primary"
			? "bg-primary-green text-white hover:bg-primary-green-dark shadow-md hover:shadow-lg"
			: "bg-white text-primary-green border border-primary-green hover:bg-primary-green hover:text-white"}
		${disabled ?
            "opacity-50 cursor-not-allowed" : ""}`}
	disabled={disabled}
>
	<slot />
</button>
}