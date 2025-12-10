<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { trash } from '$lib/stores/trash';
  import { trips } from '$lib/stores/trips';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/auth';
  import { getDB } from '$lib/db/indexedDB';
  import { get } from 'svelte/store';
  import type { TrashRecord } from '$lib/db/types';

  let trashedTrips: TrashRecord[] = [];
  let loading = true;
  let restoring = new Set<string>();
  let deleting = new Set<string>();
  
  // --- LIMIT STATE ---
  let limitReached = false;

  onMount(async () => {
    await loadTrash();
    const userId = $user?.name || $user?.token;
    if (userId) {
        await trash.syncFromCloud(userId);
        await loadTrash(); 
    }
  });

  async function loadTrash() {
    loading = true;
    try {
        const potentialIds = new Set<string>();
        if ($user?.name) potentialIds.add($user.name);
        if ($user?.token) potentialIds.add($user.token);
        const offlineId = localStorage.getItem('offline_user_id');
        if (offlineId) potentialIds.add(offlineId);

        const db = await getDB();
        const tx = db.transaction('trash', 'readonly');
        const index = tx.objectStore('trash').index('userId');
        
        let allItems: TrashRecord[] = [];
        for (const id of potentialIds) {
            const items = await index.getAll(id);
            allItems = [...allItems, ...items];
        }
        
        const uniqueItems = Array.from(new Map(allItems.map(item => [item.id, item])).values());
        uniqueItems.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
        trashedTrips = uniqueItems;
    } catch (err) {
        console.error('Error loading trash:', err);
    } finally {
        loading = false;
    }
  }
  
  function handleUpgrade() {
      goto('/dashboard/settings');
  }

  async function restoreTrip(id: string) {
    if (restoring.has(id)) return;
    limitReached = false; // Reset state

    const item = trashedTrips.find(t => t.id === id);
    if (!item) {
        alert('Item not found locally');
        return;
    }

    // --- CHECK LIMIT ---
    const currentUser = get(user);
    if (currentUser?.plan === 'free') {
        const tripDate = item.date ? new Date(item.date) : new Date();
        const tYear = tripDate.getFullYear();
        const tMonth = tripDate.getMonth();

        const currentTrips = get(trips);
        const monthlyCount = currentTrips.filter(t => {
            if (!t.date) return false;
            const [y, m] = t.date.split('-').map(Number);
            return y === tYear && (m - 1) === tMonth;
        }).length;

        if (monthlyCount >= 10) {
            limitReached = true;
            await tick();
            document.getElementById('limit-alert')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
    }
    // -------------------

    restoring.add(id);
    restoring = restoring;
    
    try {
      await trash.restore(id, item.userId);
      await trips.load(item.userId);
      await loadTrash();
    } catch (err) {
      alert('Failed to restore trip.');
    } finally {
      restoring.delete(id);
      restoring = restoring;
    }
  }
  
  async function permanentDelete(id: string) {
    if (!confirm('Permanently delete this trip? Cannot be undone.')) return;
    const item = trashedTrips.find(t => t.id === id);
    if (!item) return;
    if (deleting.has(id)) return;
    deleting.add(id);
    deleting = deleting;
    try {
      await trash.permanentDelete(id, item.userId);
      await loadTrash();
    } catch (err) {
      alert('Failed to delete trip.');
    } finally {
      deleting.delete(id);
      deleting = deleting;
    }
  }
  
  async function emptyTrash() {
    if (!confirm('Permanently delete ALL items? Cannot be undone.')) return;
    try {
      const uniqueUserIds = new Set(trashedTrips.map(t => t.userId));
      let totalDeleted = 0;
      for (const uid of uniqueUserIds) {
          const count = await trash.emptyTrash(uid);
          totalDeleted += count;
      }
      await loadTrash();
    } catch (err) {
      alert('Failed to empty trash.');
    }
  }
  
  function formatDate(dateString: string | undefined): string {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }).format(date);
  }
  
  function getDaysUntilExpiration(expiresAt: string | undefined): number {
    if (!expiresAt) return 0;
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
  <div class="page-header">
    <div>
      <h1 class="page-title">Trash</h1>
      <p class="page-subtitle">Items deleted > 30 days ago are removed automatically</p>
    </div>
    
    <div class="header-actions">
      {#if trashedTrips.length > 0}
        <button class="btn-danger" on:click={emptyTrash}>
          Empty Trash
        </button>
      {/if}
      <button class="btn-secondary" on:click={() => goto('/dashboard/trips')}>
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
      <p>Deleted trips will appear here</p>
    </div>
  {:else}
    {#if limitReached}
        <div id="limit-alert" class="limit-alert">
            <div class="limit-content">
                <h3>Free Limit Reached</h3>
                <p>You have hit your monthly limit of 10 trips. Cannot restore trip.</p>
            </div>
            <button class="btn-upgrade-inline" on:click={handleUpgrade}>Upgrade to Pro</button>
        </div>
    {/if}

    <div class="trash-list">
      {#each trashedTrips as trip}
        {@const expiresAt = trip.expiresAt || (trip as any).metadata?.expiresAt}
        {@const deletedAt = trip.deletedAt || (trip as any).metadata?.deletedAt}
        {@const daysLeft = getDaysUntilExpiration(expiresAt)}
        
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
                <span class="deleted-date">Deleted {formatDate(deletedAt)}</span>
                <span class="expiration" class:warning={daysLeft <= 7}>
                  {daysLeft} days left
                </span>
              </div>
            </div>
            
            <div class="trip-details">
              <span class="detail">{new Date(trip.date || '').toLocaleDateString()}</span>
              <span class="detail">{trip.stops?.length || 0} stops</span>
              {#if trip.totalMiles}<span class="detail">{trip.totalMiles.toFixed(1)} mi</span>{/if}
            </div>
          </div>

          <div class="trip-actions">
            <button class="btn-restore" on:click={() => restoreTrip(trip.id)} disabled={restoring.has(trip.id)}>
              {restoring.has(trip.id) ? 'Restoring...' : 'Restore'}
            </button>
            <button class="btn-delete" on:click={() => permanentDelete(trip.id)} disabled={deleting.has(trip.id)}>
              Delete
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Mobile-First */
  .trash-page { padding: 16px; max-width: 1200px; margin: 0 auto; }
  
  .page-header { display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px; }
  .page-title { font-size: 24px; font-weight: 800; color: #111827; margin: 0 0 4px 0; }
  .page-subtitle { font-size: 14px; color: #6B7280; margin: 0; line-height: 1.4; }
  
  .header-actions { display: flex; gap: 12px; width: 100%; }
  .header-actions button { flex: 1; justify-content: center; }

  .trash-list { display: flex; flex-direction: column; gap: 16px; }
  
  .trash-item { 
    display: flex; flex-direction: column; /* Stack on mobile */
    gap: 16px; padding: 16px; 
    background: white; border: 1px solid #E5E7EB; border-radius: 12px;
    transition: all 0.2s; 
  }
  
  .trip-info { flex: 1; }
  .trip-title { font-size: 16px; font-weight: 700; color: #111827; margin: 0 0 8px 0; line-height: 1.3; }
  
  .trip-meta { display: flex; gap: 12px; font-size: 12px; flex-wrap: wrap; }
  .deleted-date { color: #6B7280; }
  .expiration { color: #10B981; font-weight: 600; }
  .expiration.warning { color: #F59E0B; }
  
  .trip-details { display: flex; gap: 12px; margin-top: 8px; font-size: 13px; color: #6B7280; flex-wrap: wrap; }
  .detail { display: flex; align-items: center; background: #F3F4F6; padding: 2px 8px; border-radius: 4px; }
  
  .trip-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; width: 100%; }
  
  button { 
    display: flex; align-items: center; gap: 6px; padding: 10px 16px;
    border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s;
  }
  
  .btn-secondary { background: white; color: #374151; border: 1px solid #D1D5DB; }
  .btn-restore { background: #DCFCE7; color: #166534; justify-content: center; }
  .btn-delete { background: #FEF2F2; color: #DC2626; justify-content: center; }
  .btn-danger { background: #DC2626; color: white; }

  .empty-state { text-align: center; padding: 40px 20px; }
  .empty-state svg { margin-bottom: 16px; }

  /* ALERT STYLES */
  .limit-alert {
      background: #FFF7ED;
      border: 1px solid #F97316;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 24px; /* Space between alert and list */
      display: flex;
      flex-direction: column;
      gap: 12px;
  }
  @media (min-width: 600px) {
      .limit-alert { flex-direction: row; align-items: center; justify-content: space-between; }
  }
  .limit-content h3 { color: #9A3412; font-size: 18px; font-weight: 700; margin: 0 0 4px 0; }
  .limit-content p { color: #C2410C; margin: 0; font-size: 15px; }
  .btn-upgrade-inline {
      background: #EA580C; color: white; border: none; padding: 12px 20px;
      border-radius: 8px; font-weight: 600; cursor: pointer; white-space: nowrap;
      text-align: center; font-size: 16px; justify-content: center;
  }
  .btn-upgrade-inline:hover { background: #C2410C; }
  
  /* Tablet/Desktop */
  @media (min-width: 640px) {
    .page-header { flex-direction: row; align-items: flex-start; justify-content: space-between; }
    .header-actions { width: auto; }
    
    .trash-item { flex-direction: row; align-items: center; }
    .trip-actions { width: auto; display: flex; }
    .btn-restore, .btn-delete { width: auto; }
  }
</style>