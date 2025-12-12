<script lang="ts">
    import { dev } from '$app/environment';
</script>

{#if dev}
    <div class="bg-blue-50 text-blue-900 p-4 rounded-lg mb-6 text-sm border border-blue-200">
        <strong>🔧 Debug Mode (Dev Only):</strong>
        <ul class="list-disc ml-5 mt-1">
            <li>Enter Start Address</li>
            <li>Add a Destination</li>
            <li>Click "Calculate Route" and check Console</li>
        </ul>
        <slot />
    </div>
{/if}