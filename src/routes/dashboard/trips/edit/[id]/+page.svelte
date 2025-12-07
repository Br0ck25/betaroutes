<script lang="ts">
  import { page } from '$app/stores';
  import { trips } from '$lib/stores/trips';
  import { user } from '$lib/stores/auth';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  export let data; // layout data containing user/api key
  $: API_KEY = data.googleMapsApiKey;

  const tripId = $page.params.id;
  
  let tripData: any = null;
  let loading = true;
  let saving = false;

  onMount(async () => {
    // Wait for user/trips to load if refreshing directly
    if (!$trips || $trips.length === 0) {
        // Use stable ID logic matching other pages
        let userId = $user?.name || $user?.token;
        if (!userId) {
            userId = localStorage.getItem('offline_user_id');
        }
        
        if (userId) await trips.load(userId);
    }

    const found = $trips.find(t => t.id === tripId);
    
    if (found) {
        tripData = JSON.parse(JSON.stringify(found));
    } else {
        alert('Trip not found');
        goto('/dashboard/trips');
    }
    loading = false;
  });

  async function saveChanges() {
    saving = true;
    try {
        // FIX: Use stable user ID (username) for save operation
        let userId = $user?.name || $user?.token || localStorage.getItem('offline_user_id');
        
        if (!userId) throw new Error("No user ID found");

        tripData.updatedAt = new Date().toISOString();
        
        // Pass userId so store knows where to save it
        await trips.updateTrip(tripId, tripData, userId);
        
        alert('Trip updated successfully!');
        goto('/dashboard/trips');
    } catch (err) {
        console.error(err);
        alert('Failed to update trip');
    } finally {
        saving = false;
    }
  }

  function addStop() {
    tripData.stops = [...(tripData.stops || []), { id: crypto.randomUUID(), address: '', earnings: 0 }];
  }

  function removeStop(index: number) {
    tripData.stops.splice(index, 1);
    tripData.stops = tripData.stops;
  }
</script>

<div class="edit-page">
  <div class="header">
    <h1>Edit Trip</h1>
    <button on:click={() => goto('/dashboard/trips')} class="back-btn">Cancel</button>
  </div>

  {#if loading}
    <p>Loading trip details...</p>
  {:else if tripData}
    <div class="form-container">
      <div class="form-group">
        <label>Date</label>
        <input type="date" bind:value={tripData.date} />
      </div>

      <div class="row">
        <div class="form-group">
            <label>Start Time</label>
            <input type="time" bind:value={tripData.startTime} />
        </div>
        <div class="form-group">
            <label>End Time</label>
            <input type="time" bind:value={tripData.endTime} />
        </div>
      </div>

      <div class="form-group">
        <label>Start Address</label>
        <input type="text" bind:value={tripData.startAddress} />
      </div>

      <div class="stops-section">
        <h3>Stops</h3>
        {#if tripData.stops}
            {#each tripData.stops as stop, i}
                <div class="stop-row">
                    <input type="text" bind:value={stop.address} placeholder="Stop Address" class="address-input" />
                    <input type="number" bind:value={stop.earnings} placeholder="$" class="earnings-input" />
                    <button on:click={() => removeStop(i)} class="remove-btn">×</button>
                </div>
            {/each}
        {/if}
        <button on:click={addStop} class="add-btn">+ Add Stop</button>
      </div>

      <div class="form-group">
        <label>End Address</label>
        <input type="text" bind:value={tripData.endAddress} />
      </div>

      <div class="row">
        <div class="form-group">
            <label>Total Miles</label>
            <input type="number" bind:value={tripData.totalMiles} step="0.1" />
        </div>
        <div class="form-group">
            <label>Fuel Cost ($)</label>
            <input type="number" bind:value={tripData.fuelCost} step="0.01" />
        </div>
      </div>

      <div class="form-group">
        <label>Notes</label>
        <textarea bind:value={tripData.notes} rows="3"></textarea>
      </div>

      <button class="save-btn" on:click={saveChanges} disabled={saving}>
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  {/if}
</div>

<style>
  .edit-page { max-width: 800px; margin: 0 auto; padding: 20px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .form-container { background: white; padding: 24px; border-radius: 8px; border: 1px solid #e5e7eb; }
  .form-group { margin-bottom: 16px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  label { display: block; font-weight: 600; margin-bottom: 4px; font-size: 14px; }
  input, textarea { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; }
  
  .stops-section { background: #f9fafb; padding: 16px; border-radius: 8px; margin-bottom: 16px; }
  .stop-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .address-input { flex: 3; }
  .earnings-input { flex: 1; }
  .remove-btn { background: #fee2e2; color: #dc2626; border: none; padding: 0 12px; border-radius: 4px; cursor: pointer; }
  .add-btn { background: white; border: 1px solid #ccc; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }

  .save-btn { width: 100%; background: #4caf50; color: white; padding: 12px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; margin-top: 10px; }
  .save-btn:disabled { opacity: 0.7; }
  .back-btn { background: none; border: 1px solid #ddd; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
</style>