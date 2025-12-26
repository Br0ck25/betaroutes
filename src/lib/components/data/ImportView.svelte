<script lang="ts">
  import { trips } from '$lib/stores/trips';
  import { user } from '$lib/stores/auth';
  
  let importFormat = 'csv';
  let isProcessing = false;
  let previewTrips: any[] = [];
  
  async function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;
    
    const file = files.item(0);
    if (!file) return;
    isProcessing = true;

    try {
      if (importFormat === 'csv') {
        const text = await file.text();
        parseCSV(text);
      } else {
        alert('PDF import is not fully supported yet. Please use CSV for best results.');
        previewTrips = [];
      }
    } catch (err) {
      console.error('Parse error:', err);
      alert('Failed to parse file.');
    } finally {
      isProcessing = false;
    }
  }

  function parseCSV(content: string) {
    const lines: string[] = content.split(/\r?\n/);
    if (lines.length < 2) return;

    const parsed: any[] = [];

    const dataLines = lines.slice(1);
    for (const line of dataLines) {
      const trimmed = (line || '').trim();
      if (!trimmed) continue;

      const row = trimmed.split(',').map((c) => (c ?? '').toString().trim().replace(/"/g, '')) as string[];

      const dateStr = row[0] ?? '';
      const milesStr = row[1] ?? '0';
      const trip: any = {
        date: dateStr ? new Date(String(dateStr)).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        totalMiles: parseFloat(String(milesStr)) || 0,
        startAddress: row[2] ?? 'Unknown Start',
        endAddress: row[3] ?? 'Unknown End',
        notes: 'Imported CSV',
        startTime: '09:00',
        endTime: '17:00',
        mpg: 25,
        gasPrice: 3.50,
        stops: []
      };

      parsed.push(trip);
    }
    previewTrips = parsed;
  }

  async function saveTrips() {
    if (previewTrips.length === 0) return;
    
    const maybeUserId = $user?.name ?? $user?.token ?? localStorage.getItem('offline_user_id');
    const userId: string = maybeUserId ?? 'offline';
    
    try {
        for (const trip of previewTrips) {
            await trips.create(trip, userId);
        }
        alert(`Successfully imported ${previewTrips.length} trips!`);
        previewTrips = []; 
    } catch (e) {
        alert('Error saving trips.');
    }
  }
</script>

<div class="import-grid">
  <div class="options-card">
    <h2 class="card-title">1. Import Settings</h2>
    
    <div class="option-group spacing-large">
      <h3 class="option-label">Format</h3>
      <div class="format-buttons">
        <button 
          class="format-btn" 
          class:active={importFormat === 'csv'} 
          on:click={() => importFormat = 'csv'}
        >
          CSV (Excel)
        </button>
        <button 
          class="format-btn" 
          class:active={importFormat === 'pdf'} 
          on:click={() => importFormat = 'pdf'}
        >
          PDF (Document)
        </button>
      </div>
    </div>
    
    <div class="option-group">
      <h3 class="option-label">Select File</h3>
      <div class="file-drop-area">
        <input 
          type="file" 
          accept={importFormat === 'csv' ? '.csv' : '.pdf'}
          on:change={handleFileUpload}
          disabled={isProcessing} 
        />
        <div class="file-placeholder">
          {#if isProcessing}
            <span>Processing...</span>
          {:else}
            <span>Click to upload <b>.{importFormat.toUpperCase()}</b> file</span>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <div class="selection-card">
    <div class="selection-header">
        <h2 class="card-title">2. Preview</h2>
        {#if previewTrips.length > 0}
            <button class="btn-text" on:click={saveTrips}>Save All</button>
        {/if}
    </div>

    {#if previewTrips.length > 0}
      <div class="trips-list">
        {#each previewTrips as trip}
          <div class="trip-item">
            <div class="trip-content">
              <div class="trip-top">
                <span>{trip.date}</span>
                <span>{trip.totalMiles} mi</span>
              </div>
              <div class="trip-route">{trip.startAddress} → {trip.endAddress}</div>
            </div>
          </div>
        {/each}
      </div>
      
      <button class="btn-import-action" on:click={saveTrips}>
        Import {previewTrips.length} Trips
      </button>
    {:else}
      <div class="empty-state">Upload a file to preview trips</div>
    {/if}
  </div>
</div>

<style>
  .import-grid { display: grid; grid-template-columns: 1fr; gap: 24px; }
  .options-card, .selection-card { background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 20px; }
  .card-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; color: #111827; }
  
  .option-group { margin-bottom: 24px; }
  .spacing-large { margin-bottom: 48px; }

  .option-label { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 8px; }
  
  .format-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .format-btn { padding: 12px; border: 2px solid #E5E7EB; border-radius: 10px; background: white; font-weight: 600; font-size: 13px; color: #6B7280; cursor: pointer; transition: all 0.2s; }
  .format-btn.active { border-color: #29ABE2; color: #29ABE2; background: #F0F9FF; }
  
  .file-drop-area { position: relative; border: 2px dashed #E5E7EB; border-radius: 10px; padding: 32px; text-align: center; background: #F9FAFB; transition: all 0.2s; }
  .file-drop-area:hover { border-color: #29ABE2; background: #F0F9FF; }
  .file-drop-area input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
  .file-placeholder { font-size: 14px; color: #6B7280; font-weight: 500; }
  .file-placeholder b { color: #29ABE2; }
  
  .selection-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .btn-text { color: #29ABE2; background: none; border: none; font-weight: 600; cursor: pointer; }

  .trips-list { display: flex; flex-direction: column; gap: 8px; max-height: 400px; overflow-y: auto; margin-bottom: 16px; }
  .trip-item { padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; background: #F9FAFB; }
  .trip-top { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 4px; font-size: 13px; color: #111827; }
  .trip-route { font-size: 12px; color: #6B7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  
  /* MATCHED STYLE: Updated to Orange Gradient */
  .btn-import-action { 
    width: 100%; 
    padding: 14px; 
    background: linear-gradient(135deg, #FF7F50 0%, #FF6A3D 100%); 
    color: white; 
    border: none; 
    border-radius: 10px; 
    font-weight: 700; 
    cursor: pointer;
    font-size: 15px;
    box-shadow: 0 4px 12px rgba(255, 127, 80, 0.3);
  }

  .btn-import-action:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(255, 127, 80, 0.4);
  }
  
  .empty-state { text-align: center; color: #9CA3AF; padding: 20px; font-size: 14px; }

  @media (min-width: 1024px) {
    .import-grid { grid-template-columns: 350px 1fr; align-items: start; }
  }
</style>