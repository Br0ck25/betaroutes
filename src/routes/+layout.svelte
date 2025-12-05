<script lang="ts">
    let { data, children } = $props();
    import { setUser } from '$lib/stores/currentUser';

    $effect(() => {
        setUser(data?.user ?? null);
    });
</script>

{@render children()}
