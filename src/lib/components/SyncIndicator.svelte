<script lang="ts">
  import { syncStatus, syncIcon, syncLabel } from '$lib/stores/sync';
  import { syncManager } from '$lib/sync/syncManager';
  let showDetails = $state(false);

  async function handleForceSync() {
    await syncManager.forceSyncNow();
  }

  function toggleDetails() {
    showDetails = !showDetails;
  }
</script>

<div class="sync-indicator">
  <button
    class="sync-button"
    class:synced={$syncStatus.status === 'synced'}
    class:syncing={$syncStatus.status === 'syncing'}
    class:offline={$syncStatus.status === 'offline'}
    class:pending={$syncStatus.status === 'pending'}
    class:error={$syncStatus.status === 'error'}
    onclick={toggleDetails}
    title={$syncLabel}
  >
    <span class="sync-icon" class:spinning={$syncStatus.status === 'syncing'}>
      {$syncIcon}
    </span>
    <span class="sync-text">{$syncLabel}</span>
  </button>

  {#if showDetails}
    <button
      class="backdrop"
      onclick={() => (showDetails = false)}
      aria-label="Close details"
      type="button"
    ></button>

    <div class="sync-details">
      <div class="details-header">
        <h3>Sync Status</h3>
        <button class="close-btn" onclick={() => (showDetails = false)}>×</button>
      </div>

      <div class="details-content">
        <div class="detail-row">
          <span class="detail-label">Status:</span>
          <span class="detail-value status-badge" class:synced={$syncStatus.status === 'synced'}>
            {$syncStatus.status}
          </span>
        </div>

        <div class="detail-row">
          <span class="detail-label">Connection:</span>
          <span class="detail-value">
            {$syncStatus.online ? '🟢 Online' : '🔴 Offline'}
          </span>
        </div>

        {#if $syncStatus.pendingCount > 0}
          <div class="detail-row">
            <span class="detail-label">Pending Changes:</span>
            <span class="detail-value pending-count">
              {$syncStatus.pendingCount}
            </span>
          </div>
        {/if}

        {#if $syncStatus.lastSyncAt}
          <div class="detail-row">
            <span class="detail-label">Last Synced:</span>
            <span class="detail-value">
              {new Date($syncStatus.lastSyncAt).toLocaleTimeString()}
            </span>
          </div>
        {/if}

        {#if $syncStatus.errorMessage}
          <div class="detail-row error">
            <span class="detail-label">Error:</span>
            <span class="detail-value">{$syncStatus.errorMessage}</span>
          </div>
        {/if}
      </div>

      {#if $syncStatus.online && $syncStatus.pendingCount > 0}
        <button class="force-sync-btn" onclick={handleForceSync}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 8C2 5.79086 3.79086 4 6 4C7 4 7.8 4.4 8.4 5M14 8C14 10.2091 12.2091 12 10 12C9 12 8.2 11.6 7.6 11"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
            <path
              d="M8 2V5H5M8 14V11H11"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          Sync Now
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .sync-indicator {
    position: relative;
  }

  .sync-button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: white;
    border: 2px solid #e5e7eb;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
    color: #6b7280;
  }

  .sync-button:hover {
    border-color: #d1d5db;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  /* Status-specific colors */
  .sync-button.synced {
    border-color: #10b981;
    color: #059669;
    background: #f0fdf4;
  }
  .sync-button.syncing {
    border-color: #3b82f6;
    color: #2563eb;
    background: #eff6ff;
  }
  .sync-button.offline {
    border-color: #f59e0b;
    color: #d97706;
    background: #fffbeb;
  }
  .sync-button.pending {
    border-color: #f59e0b;
    color: #d97706;
    background: #fffbeb;
  }
  .sync-button.error {
    border-color: #ef4444;
    color: #dc2626;
    background: #fef2f2;
  }

  .sync-icon {
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .sync-icon.spinning {
    animation: spin 2s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .sync-text {
    font-size: 13px;
    white-space: nowrap;
  }

  /* --- BACKDROP (Click Outside) --- */
  .backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 998;
    background: rgba(0, 0, 0, 0.05);
    /* Reset button styles */
    border: none;
    cursor: default;
    width: 100%;
    height: 100%;
    display: block;
  }

  /* --- DETAILS PANEL --- */
  .sync-details {
    background: white;
    border: 2px solid #e5e7eb;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
    z-index: 999;
    animation: slideDown 0.2s ease;
    /* DEFAULT (Mobile) */
    position: fixed;
    top: 80px;
    left: 16px;
    right: 16px;
    width: auto;
    max-width: 400px;
    margin: 0 auto;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .details-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid #e5e7eb;
  }

  .details-header h3 {
    font-size: 16px;
    font-weight: 700;
    color: #111827;
    margin: 0;
  }

  .close-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f3f4f6;
    border: none;
    border-radius: 6px;
    color: #6b7280;
    font-size: 20px;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
  }

  .close-btn:hover {
    background: #e5e7eb;
    color: #111827;
  }

  .details-content {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 14px;
  }

  .detail-row.error {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 12px;
    background: #fef2f2;
    border-radius: 8px;
  }

  .detail-label {
    color: #6b7280;
    font-weight: 500;
  }
  .detail-value {
    color: #111827;
    font-weight: 600;
  }

  .status-badge {
    padding: 4px 10px;
    background: #f3f4f6;
    border-radius: 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .status-badge.synced {
    background: #d1fae5;
    color: #065f46;
  }

  .pending-count {
    padding: 4px 10px;
    background: #fef3c7;
    color: #92400e;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
  }

  .force-sync-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: 0 16px 16px;
    padding: 10px 16px;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
  }

  .force-sync-btn:hover {
    background: #2563eb;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  }

  /* --- DESKTOP (Sidebar) --- */
  @media (min-width: 1024px) {
    .sync-details {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      right: auto;
      width: 320px;
      margin: 0;
    }
  }

  @media (max-width: 640px) {
    .sync-text {
      display: none;
    }
  }
</style>
