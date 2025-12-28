<script lang="ts">
  import { userSettings } from '$lib/stores/userSettings';
  import { trips } from '$lib/stores/trips';
  import { user, auth } from '$lib/stores/auth';
  import { createEventDispatcher } from 'svelte';

  export let isPro: boolean;

  const dispatch = createEventDispatcher();

  function parseDuration(durationStr: string): number {
    if (!durationStr) return 0;
    let minutes = 0;
    const hoursMatch = durationStr.match(/(\d+)h/);
    const minsMatch = durationStr.match(/(\d+)m/);
    if (hoursMatch) minutes += parseInt(hoursMatch[1]) * 60;
    if (minsMatch) minutes += parseInt(minsMatch[1]);
    if (!hoursMatch && !minsMatch && !isNaN(parseInt(durationStr))) {
        minutes = parseInt(durationStr);
    }
    return minutes;
  }

  function parseItemString(str: string): any[] {
    if (!str || !str.trim()) return [];
    return str.split('|').map(part => {
        const [name, costStr] = part.split(':');
        return {
            id: crypto.randomUUID(),
            type: name ? name.trim() : 'Unknown',
            cost: parseFloat(costStr) || 0
        };
    }).filter(i => i.type && i.cost >= 0);
  }

  function exportData() {
    const data = {
      settings: $userSettings,
      trips: $trips,
      exportDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `goroute-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = async (e: any) => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.settings) {
            userSettings.set(data.settings);
            if ($user) dispatch('sync', { type: 'settings', payload: data.settings });
          }

          if (data.trips && Array.isArray(data.trips)) {
             if(confirm(`Found ${data.trips.length} trips in backup. Import them now?`)) {
                let userId = $user?.name || $user?.token || localStorage.getItem('offline_user_id') || 'offline';
                let count = 0;
                for (const trip of data.trips) {
                    await trips.create(trip, userId);
                    count++;
                }
                dispatch('success', `Successfully imported ${count} trips!`);
             }
          } else {
             dispatch('success', 'Settings imported. No trips found in backup.');
          }
        } catch (err) {
          console.error(err);
          alert('Invalid backup file');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function importCSV() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const lines = text.split(/\r?\n/);
        if (lines.length < 2) throw new Error("Empty CSV");

        const parsed: any[] = [];
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const row = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
          if (!row) continue;
          
          const cleanRow = row.map((c: string) => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
          const stopsStr = cleanRow[2];
          let stops: any[] = [];
          if (stopsStr) {
            stops = stopsStr.split('|').map(s => ({ 
                id: crypto.randomUUID(), 
                address: s.trim(), 
                earnings: 0 
            }));
          }

          const totalRevenue = parseFloat(cleanRow[9]) || 0;
          if (totalRevenue > 0) {
              if (stops.length > 0) stops[0].earnings = totalRevenue;
              else stops.push({ id: crypto.randomUUID(), address: 'Revenue Adjustment', earnings: totalRevenue });
          }

          const estimatedTime = parseDuration(cleanRow[6]);
          const maintenanceCost = parseFloat(cleanRow[11]) || 0;
          const suppliesCost = parseFloat(cleanRow[13]) || 0; 

          let maintenanceItems = parseItemString(cleanRow[12]);
          if (maintenanceItems.length === 0 && maintenanceCost > 0) {
              maintenanceItems.push({ id: crypto.randomUUID(), type: 'Maintenance', cost: maintenanceCost });
          }

          let suppliesItems = parseItemString(cleanRow[14]);
          if (suppliesItems.length === 0 && suppliesCost > 0) {
              suppliesItems.push({ id: crypto.randomUUID(), type: 'Supplies', cost: suppliesCost });
          }

          parsed.push({
            date: cleanRow[0] ? new Date(cleanRow[0]).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            startAddress: cleanRow[1] || 'Unknown Start',
            endAddress: cleanRow[3] || cleanRow[1] || 'Unknown End',
            stops: stops,
            totalMiles: parseFloat(cleanRow[5]) || 0,
            estimatedTime: estimatedTime,
            totalTime: cleanRow[6], 
            hoursWorked: parseFloat(cleanRow[7]) || 0,
            fuelCost: parseFloat(cleanRow[10]) || 0,
            maintenanceCost: maintenanceCost,
            maintenanceItems: maintenanceItems, 
            suppliesCost: suppliesCost,
            suppliesItems: suppliesItems, 
            notes: cleanRow[17] || '',
            startTime: '09:00',
            endTime: '17:00',
            mpg: 25,
            gasPrice: 3.50,
          });
        }

        if (parsed.length > 0) {
            if(confirm(`Found ${parsed.length} trips. Import them now?`)) {
                let userId = $user?.name || $user?.token || localStorage.getItem('offline_user_id') || 'offline';
                for (const trip of parsed) {
                    await trips.create(trip, userId);
                }
                dispatch('success', `Successfully imported ${parsed.length} trips from CSV!`);
            }
        } else {
            alert("No valid trips found in CSV.");
        }
      } catch (err) {
        console.error(err);
        alert('Failed to parse CSV file.');
      }
    };
    input.click();
  }

  function clearAllData() {
    if (!confirm('Are you sure? This will delete ALL your trip data locally.')) return;
    trips.set([]);
    dispatch('success', 'All trip data cleared.');
  }

  function openAdvancedExport() {
      dispatch('openAdvancedExport');
  }
</script>

<div class="settings-card">
  <div class="card-header">
   <div class="card-icon navy">
     <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
         <path d="M17 2H3C2.46957 2 1.96086 2.21071 1.58579 2.58579C1.21071 2.96086 1 3.46957 1 4V16C1 16.5304 1.21071 17.0391 1.58579 17.4142C1.96086 17.7893 2.46957 18 3 18H17C17.5304 18 18.0391 17.7893 18.4142 17.4142C18.7893 17.0391 19 16.5304 19 16V4C19 3.46957 18.7893 2.96086 18.4142 2.58579C18.0391 2.21071 17.5304 2 17 2Z" stroke="currentColor" stroke-width="2"/>
        <path d="M1 8H19M6 1V3M14 1V3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </div>
    <div>
      <h2 class="card-title">Data Management</h2>
      <p class="card-subtitle">Export, import, and manage your data</p>
    </div>
  </div>
  
  <div class="data-actions">
    <button class="action-btn" on:click={openAdvancedExport}>
      <div>
        <div class="action-title">Advanced Export</div>
        <div class="action-subtitle">Export trips, expenses, or tax bundle with date filters & PDF</div>
      </div>
    </button>

    <div class="divider"></div> 

    <button class="action-btn" on:click={importCSV}>
      <div>
        <div class="action-title">Import CSV</div>
        <div class="action-subtitle">Upload trips from spreadsheet</div>
      </div>
    </button>

    <div class="divider"></div>

    <button class="action-btn" on:click={exportData}>
      <div>
        <div class="action-title">Backup Full Data (JSON)</div>
        <div class="action-subtitle">Save settings and trips backup</div>
      </div>
    </button>
    
    <button class="action-btn" on:click={importData}>
      <div>
        <div class="action-title">Restore Backup (JSON)</div>
        <div class="action-subtitle">Restore from full backup</div>
      </div>
    </button>
    
    <div class="divider"></div>

    <button class="action-btn danger" on:click={clearAllData}>
      <div>
        <div class="action-title">Clear Local Data</div>
        <div class="action-subtitle">Delete local trip history</div>
      </div>
    </button>
  </div>
</div>

<style>
  .settings-card { background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 24px; }
  .card-header { display: flex; gap: 16px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #E5E7EB; }
  .card-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; }
  .card-icon.navy { background: linear-gradient(135deg, var(--navy, #1a3a5c) 0%, #1a3a5c 100%); }
  .card-title { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  .card-subtitle { font-size: 14px; color: #6B7280; }
  .data-actions { display: flex; flex-direction: column; gap: 12px; }
  .action-btn { display: flex; align-items: center; gap: 16px; padding: 16px; background: #F9FAFB; border: 2px solid #E5E7EB; border-radius: 12px; cursor: pointer; text-align: left; width: 100%; position: relative; }
  .action-btn:hover { border-color: var(--orange, #FF6A3D); background: white; }

  .action-title { font-size: 15px; font-weight: 600; color: #111827; }
  .action-subtitle { font-size: 13px; color: #6B7280; }
  .divider { height: 1px; background: #E5E7EB; margin: 24px 0; }
  .action-btn.danger:hover { border-color: #DC2626; background: white; }
</style>