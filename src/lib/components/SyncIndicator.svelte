<!-- src/lib/components/SyncIndicator.svelte -->
<script lang="ts">
  import { syncStatus } from '$lib/stores/sync';

  $: icon = $syncStatus === 'synced' ? '✓' : 
            $syncStatus === 'syncing' ? '↻' : 
            $syncStatus === 'offline' ? '📴' : '⚠';

  $: label = $syncStatus === 'synced' ? 'All changes saved' :
             $syncStatus === 'syncing' ? 'Syncing...' :
             $syncStatus === 'offline' ? 'Offline - will sync when online' :
             'Pending changes';

  $: color = $syncStatus === 'synced' ? 'text-green-600' :
             $syncStatus === 'syncing' ? 'text-blue-600' :
             $syncStatus === 'offline' ? 'text-orange-600' :
             'text-yellow-600';
</script>

<div class="sync-indicator {color}">
  <span class="icon">{icon}</span>
  <span class="label">{label}</span>
</div>

<style>
  .sync-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    padding: 8px 12px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }

  .icon {
    font-size: 16px;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .sync-indicator.text-blue-600 .icon {
    animation: spin 1s linear infinite;
  }
</style>