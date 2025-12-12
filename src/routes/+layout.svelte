<script lang="ts">
    let { data, children } = $props();
    import { setUser } from '$lib/stores/currentUser';
    import ToastContainer from '$lib/components/ui/ToastContainer.svelte'; // New import

    $effect(() => {
        setUser(data?.user ?? null);
    });
</script>

<ToastContainer /> {@render children()}