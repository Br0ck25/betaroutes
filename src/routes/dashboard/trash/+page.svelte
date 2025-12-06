<!-- src/routes/dashboard/trash/+page.svelte -->

<script lang="ts">
  import { onMount } from 'svelte';
  import { trash, type TrashedTrip } from '$lib/stores/trash';
  import { trips } from '$lib/stores/trips';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/auth';
  
  let trashedTrips: TrashedTrip[] = [];
  let loading = true;
  let restoring = new Set<string>();
  let deleting = new Set<string>();
  
  onMount(async () => {
    await loadTrash();
  });
  
  async function loadTrash() {
    loading = true;
    try {
      trashedTrips = await trash.load($user.token);
    } finally {
      loading = false;
    }
  }
  
  async function restoreTrip(id: string) {
    if (restoring.has(id)) return;
    restoring.add(id);
    restoring = restoring;
    
    try {
      await trash.restore(id, $user.token);
      // Reload trips to show restored trip
      await trips.load($user.token);
      await loadTrash();
    } catch (err) {
      alert('Failed to restore trip: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      restoring.delete(id);
      restoring = restoring;
    }
  }
  
  async function permanentDelete(id: string) {
    if (!confirm('Are you sure? This will permanently delete this trip and cannot be undone.')) {
      return;
    }
    
    if (deleting.has(id)) return;
    deleting.add(id);
    deleting = deleting;
    
    try {
      await trash.permanentDelete(id, $user.token);
      await loadTrash();
    } catch (err) {
      alert('Failed to delete trip: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      deleting.delete(id);
      deleting = deleting;
    }
  }
  
  async function emptyTrash() {
    if (!confirm('Are you sure you want to permanently delete ALL trips in trash? This cannot be undone.')) {
      return;
    }
    
    try {
      const count = await trash.emptyTrash($user.token);
      alert(`Deleted ${count} item(s) from trash`);
      await loadTrash();
    } catch (err) {
      alert('Failed to empty trash: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  }
  
  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }
  
  function getDaysUntilExpiration(expiresAt: string): number {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diff = expires.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }
</script>

<svelte:head>
  <title>Trash - Go Route Yourself</title>
</svelte:head>

<div class="trash-page">
  <!-- Header -->
  <div class="page-header">
    <div>
      <h1 class="page-title">🗑️ Trash</h1>
      <p class="page-subtitle">Deleted trips are kept for 30 days before permanent deletion</p>
    </div>
    <div class="header-actions">
      {#if trashedTrips.length > 0}
        <button class="btn-danger" on:click={emptyTrash}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M2 4H18M16 4V16C16 17.1046 15.1046 18 14 18H6C4.89543 18 4 17.1046 4 16V4M7 4V2C7 0.89543 7.89543 0 9 0H11C12.1046 0 13 0.89543 13 2V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          Empty Trash
        </button>
      {/if}
      <button class="btn-secondary" on:click={() => goto('/dashboard/trips')}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        Back to Trips
      </button>
    </div>
  </div>

  {#if loading}
    <div class="loading">Loading trash...</div>
  {:else if trashedTrips.length === 0}
    <div class="empty-state">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <path d="M16 16H48M44 16V52C44 54.2091 42.2091 56 40 56H24C21.7909 56 20 54.2091 20 52V16M26 16V12C26 9.79086 27.7909 8 30 8H34C36.2091 8 38 9.79086 38 12V16" stroke="#9CA3AF" stroke-width="4" stroke-linecap="round"/>
      </svg>
      <h2>Trash is empty</h2>
      <p>Deleted trips will appear here and be kept for 30 days</p>
    </div>
  {:else}
    <div class="trash-list">
      {#each trashedTrips as trip}
        {@const daysLeft = getDaysUntilExpiration(trip.metadata.expiresAt)}
        <div class="trash-item">
          <div class="trip-info">
            <div class="trip-header">
              <h3 class="trip-title">
                {trip.startAddress?.split(',')[0] || 'Unknown'} 
                {#if trip.stops && trip.stops.length > 0}
                  → {trip.stops[trip.stops.length - 1].address?.split(',')[0]}
                {/if}
              </h3>
              <div class="trip-meta">
                <span class="deleted-date">Deleted {formatDate(trip.metadata.deletedAt)}</span>
                <span class="expiration" class:warning={daysLeft <= 7}>
                  Expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
            
            <div class="trip-details">
              <div class="detail">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2V8L12 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                {new Date(trip.date || '').toLocaleDateString()}
              </div>
              <div class="detail">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2"/>
                  <circle cx="8" cy="8" r="2" fill="currentColor"/>
                </svg>
                {trip.stops?.length || 0} stops
              </div>
              {#if trip.totalMiles}
                <div class="detail">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M2 8H14M14 8L10 4M14 8L10 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                  {trip.totalMiles.toFixed(1)} mi
                </div>
              {/if}
            </div>
          </div>

          <div class="trip-actions">
            <button 
              class="btn-restore" 
              on:click={() => restoreTrip(trip.id)}
              disabled={restoring.has(trip.id)}
            >
              {#if restoring.has(trip.id)}
                <svg class="spinner" width="20" height="20" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="2" fill="none" opacity="0.25"/>
                  <path d="M10 2 A8 8 0 0 1 18 10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
                </svg>
                Restoring...
              {:else}
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M4 10C4 6.68629 6.68629 4 10 4C11.5 4 12.8 4.6 13.7 5.5M16 10C16 13.3137 13.3137 16 10 16C8.5 16 7.2 15.4 6.3 14.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <path d="M13 2V5.5H9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Restore
              {/if}
            </button>
            
            <button 
              class="btn-delete" 
              on:click={() => permanentDelete(trip.id)}
              disabled={deleting.has(trip.id)}
            >
              {#if deleting.has(trip.id)}
                <svg class="spinner" width="20" height="20" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="2" fill="none" opacity="0.25"/>
                  <path d="M10 2 A8 8 0 0 1 18 10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
                </svg>
              {:else}
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              {/if}
              Delete Forever
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .trash-page {
    padding: 24px;
    max-width: 1200px;
    margin: 0 auto;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 32px;
    gap: 24px;
  }

  .page-title {
    font-size: 32px;
    font-weight: 800;
    color: #111827;
    margin: 0 0 8px 0;
  }

  .page-subtitle {
    font-size: 16px;
    color: #6B7280;
    margin: 0;
  }

  .header-actions {
    display: flex;
    gap: 12px;
  }

  .loading {
    text-align: center;
    padding: 48px;
    color: #6B7280;
  }

  .empty-state {
    text-align: center;
    padding: 64px 24px;
  }

  .empty-state svg {
    margin-bottom: 24px;
  }

  .empty-state h2 {
    font-size: 24px;
    font-weight: 700;
    color: #111827;
    margin: 0 0 8px 0;
  }

  .empty-state p {
    font-size: 16px;
    color: #6B7280;
    margin: 0;
  }

  .trash-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .trash-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24px;
    background: white;
    border: 2px solid #E5E7EB;
    border-radius: 12px;
    transition: all 0.2s;
  }

  .trash-item:hover {
    border-color: #D1D5DB;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  }

  .trip-info {
    flex: 1;
  }

  .trip-header {
    margin-bottom: 12px;
  }

  .trip-title {
    font-size: 18px;
    font-weight: 700;
    color: #111827;
    margin: 0 0 8px 0;
  }

  .trip-meta {
    display: flex;
    gap: 16px;
    font-size: 14px;
  }

  .deleted-date {
    color: #6B7280;
  }

  .expiration {
    color: #10B981;
    font-weight: 600;
  }

  .expiration.warning {
    color: #F59E0B;
  }

  .trip-details {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
  }

  .detail {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    color: #6B7280;
  }

  .detail svg {
    color: #9CA3AF;
  }

  .trip-actions {
    display: flex;
    gap: 12px;
  }

  button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-primary {
    background: linear-gradient(135deg, #FF7F50 0%, #FF6A3D 100%);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(255, 127, 80, 0.3);
  }

  .btn-secondary {
    background: white;
    color: #374151;
    border: 2px solid #E5E7EB;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #F9FAFB;
    border-color: #D1D5DB;
  }

  .btn-restore {
    background: #10B981;
    color: white;
  }

  .btn-restore:hover:not(:disabled) {
    background: #059669;
  }

  .btn-delete {
    background: white;
    color: #DC2626;
    border: 2px solid #FCA5A5;
  }

  .btn-delete:hover:not(:disabled) {
    background: #FEF2F2;
    border-color: #DC2626;
  }

  .btn-danger {
    background: #DC2626;
    color: white;
  }

  .btn-danger:hover:not(:disabled) {
    background: #B91C1C;
  }

  .spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @media (max-width: 768px) {
    .page-header {
      flex-direction: column;
    }

    .header-actions {
      width: 100%;
      flex-direction: column;
    }

    .trash-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 16px;
    }

    .trip-actions {
      width: 100%;
    }

    .trip-actions button {
      flex: 1;
    }
  }
</style>