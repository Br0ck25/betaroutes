<script lang="ts">
  import { userSettings } from '$lib/stores/userSettings';
  import { auth, user } from '$lib/stores/auth';
  import { trips } from '$lib/stores/trips';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { autocomplete } from '$lib/utils/autocomplete';

  export let data; 
  $: API_KEY = data.googleMapsApiKey;

  // --- REMOTE SYNC LOGIC START ---
  let settings = { ...$userSettings };
  $: if (data.remoteSettings?.settings) {
    const merged = { ...$userSettings, ...data.remoteSettings.settings };
    userSettings.set(merged);
    settings = merged;
  }

  let profile = { name: '', email: '' };
  $: if ($user || data.remoteSettings?.profile) {
    const remote = data.remoteSettings?.profile || {};
    if (!profile.name) profile.name = remote.name || $user?.name || '';
    if (!profile.email) profile.email = remote.email || $user?.email || '';
  }

  async function syncToCloud(type: 'settings' | 'profile', payload: any) {
      try {
          const res = await fetch('/api/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [type]: payload })
           });
          if (!res.ok) console.error('Failed to sync settings to cloud');
      } catch (e) {
          console.error('Sync error:', e);
      }
  }
  // --- REMOTE SYNC LOGIC END ---

  // ... (Keep monthlyUsage logic) ...
  $: monthlyUsage = $trips.filter(t => {
      if (!t.date) return false;
      const tripDate = new Date(t.date);
      const now = new Date();
      return tripDate.getMonth() === now.getMonth() && tripDate.getFullYear() === now.getFullYear();
  }).length;

  let showSuccess = false;
  let successMessage = '';
  
  let showPasswordChange = false;
  let passwordData = { current: '', new: '', confirm: '' };
  let passwordError = '';

  let showDeleteConfirm = false;
  let deletePassword = '';
  let deleteError = '';
  let isDeleting = false;

  function handleAddressSelect(field: 'start' | 'end', e: CustomEvent) {
    const val = e.detail.formatted_address || e.detail.name;
    if (field === 'start') settings.defaultStartAddress = val;
    if (field === 'end') settings.defaultEndAddress = val;
  }

  async function saveDefaultSettings() {
    userSettings.set(settings);
    await syncToCloud('settings', settings);
    showSuccessMsg('Default values saved and synced!');
  }

  // Update function to call the new /api/user endpoint
  async function saveProfile() {
    // 1. Update local UI state immediately
    auth.updateProfile({
        name: profile.name,
        email: profile.email
    });

    try {
        // 2. Persist to User KV (Fixes the reset on logout issue)
        const res = await fetch('/api/user', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: profile.name,
                email: profile.email
            })
        });

        if (res.ok) {
            showSuccessMsg('Profile updated successfully!');
        } else {
            console.error('Failed to save profile to server');
            showSuccessMsg('Saved locally (Server error)');
        }
    } catch (e) {
        console.error('Save error:', e);
        showSuccessMsg('Saved locally (Network error)');
    }
  }
  
  function showSuccessMsg(msg: string) {
    successMessage = msg;
    showSuccess = true;
    setTimeout(() => showSuccess = false, 3000);
  }
  
  // ... (Rest of the file remains unchanged) ...
  async function changePassword() {
    if (passwordData.new !== passwordData.confirm) {
      passwordError = 'Passwords do not match';
      return;
    }
    if (passwordData.new.length < 8) {
      passwordError = 'Password must be at least 8 characters';
      return;
    }
    
    try {
        const response = await fetch('/api/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentPassword: passwordData.current,
                newPassword: passwordData.new
            })
        });
        const result = await response.json();

        if (!response.ok) {
            passwordError = result.message || 'Failed to update password';
            return;
        }

        passwordError = '';
        showPasswordChange = false;
        passwordData = { current: '', new: '', confirm: '' };
        showSuccessMsg('Password changed successfully');
    } catch (e) {
        console.error(e);
        passwordError = 'An unexpected network error occurred.';
    }
  }

  async function handleDeleteAccount() {
    if (!deletePassword) {
      deleteError = 'Please enter your password to confirm.';
      return;
    }
    
    if (!confirm('FINAL WARNING: This will permanently delete your account and all data. This cannot be undone.')) {
      return;
    }

    isDeleting = true;
    try {
      const result = await auth.deleteAccount($user?.name || '', deletePassword);
      if (result.success) {
        goto('/');
      } else {
        deleteError = result.error || 'Failed to delete account';
        isDeleting = false;
      }
    } catch (err) {
      deleteError = 'An unexpected error occurred';
      isDeleting = false;
    }
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
            if ($user) await syncToCloud('settings', data.settings);
          }

          if (data.trips && Array.isArray(data.trips)) {
             if(confirm(`Found ${data.trips.length} trips in backup. Import them now?`)) {
                let userId = $user?.name || $user?.token || localStorage.getItem('offline_user_id') || 'offline';
                let count = 0;
                for (const trip of data.trips) {
                    await trips.create(trip, userId);
                    count++;
                }
                showSuccessMsg(`Successfully imported ${count} trips!`);
             }
          } else {
             showSuccessMsg('Settings imported. No trips found in backup.');
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

  // ... (Keep the rest of the CSV logic and HTML) ...
  function formatDuration(minutes: number): string {
    if (!minutes) return '0m';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

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

  function exportCSV() {
    const data = $trips;
    if (data.length === 0) {
      alert("No trips to export.");
      return;
    }

    const headers = [
      'Date', 'Start Address', 'Stop Addresses', 'End Address', 'Stops Count',
      'Total Miles', 'Drive Time', 'Hours Worked', 'Hourly Pay ($/hr)',
      'Total Revenue', 'Fuel Cost', 
      'Maintenance Cost', 'Maintenance Items',
      'Supply Cost', 'Supply Items',
      'Total Expenses', 'Net Profit', 'Notes'
    ];
    const rows = data.map(trip => {
      const date = trip.date ? new Date(trip.date).toLocaleDateString() : '';
      const start = `"${(trip.startAddress || '').replace(/"/g, '""')}"`; 
      
      const stopsList = trip.stops && trip.stops.length > 0 
          ? trip.stops.map((s: any) => s.address).join(' | ') 
          : '';
      const stopAddresses = `"${stopsList.replace(/"/g, '""')}"`;

      const rawEnd = trip.endAddress ? trip.endAddress : trip.startAddress;
      const end = `"${(rawEnd || '').replace(/"/g, '""')}"`;

      const stopsCount = trip.stops?.length || 0;
      const miles = (trip.totalMiles || 0).toFixed(1);
      
      const driveTime = `"${formatDuration(trip.estimatedTime || 0)}"`; 
      
      const hoursWorked = (trip.hoursWorked || 0).toFixed(1);

      const revenue = trip.stops?.reduce((sum: number, stop: any) => sum + (stop.earnings || 0), 0) || 0;
      const fuel = trip.fuelCost || 0;
      
      const maint = trip.maintenanceCost || 0;
      const maintItemsStr = trip.maintenanceItems 
        ? `"${trip.maintenanceItems.map((i: any) => `${i.type}:${i.cost}`).join(' | ')}"` 
        : '""';
      
      const supplies = trip.suppliesCost || 0;
      const supplyItemsStr = trip.suppliesItems
        ? `"${trip.suppliesItems.map((i: any) => `${i.type}:${i.cost}`).join(' | ')}"`
        : '""';
      const totalExpenses = fuel + maint + supplies;
      const netProfit = revenue - totalExpenses;
      const hourlyPay = trip.hoursWorked > 0 ? (netProfit / trip.hoursWorked) : 0;
      const notes = `"${(trip.notes || '').replace(/"/g, '""')}"`;

      return [
        date, start, stopAddresses, end, stopsCount, miles, driveTime, hoursWorked, 
        hourlyPay.toFixed(2), revenue.toFixed(2), fuel.toFixed(2), 
        maint.toFixed(2), maintItemsStr, 
        supplies.toFixed(2), supplyItemsStr, 
        totalExpenses.toFixed(2), netProfit.toFixed(2), notes
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `trips_export_full_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
                showSuccessMsg(`Successfully imported ${parsed.length} trips from CSV!`);
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
    showSuccessMsg('All trip data cleared.');
  }
  
  async function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
      await fetch('/api/logout', { method: 'POST' });
      auth.logout();
      goto('/login');
    }
  }
</script>

<svelte:head>
  <title>Settings - Go Route Yourself</title>
  <style>
    .pac-container { z-index: 10000 !important; }
  </style>
</svelte:head>

<div class="settings">
  <div class="page-header">
    <div>
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Manage your account and preferences</p>
    </div>
  </div>
  
  {#if showSuccess}
    <div class="alert success">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M16.6 5L7.5 14L3.4 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      {successMessage}
    </div>
  {/if}
  
  <div class="settings-grid">
    <div class="settings-card">
      <div class="card-header">
        <div class="card-icon orange">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 10C12.7614 10 15 7.76142 15 5C15 2.23858 12.7614 0 10 0C7.23858 0 5 2.23858 5 5C5 7.76142 7.23858 10 10 10Z" fill="currentColor"/>
            <path d="M10 12C4.47715 12 0 15.3579 0 19.5C0 19.7761 0.223858 20 0.5 20H19.5C19.7761 20 20 19.7761 20 19.5C20 15.3579 15.5228 12 10 12Z" fill="currentColor"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Profile</h2>
          <p class="card-subtitle">Your account information</p>
        </div>
      </div>
      
      <div class="form-group">
        <label for="profile-name">Name</label>
        <input id="profile-name" type="text" bind:value={profile.name} placeholder="Your name" />
      </div>
      
      <div class="form-group">
        <label for="profile-email">Email</label>
        <input id="profile-email" type="email" bind:value={profile.email} placeholder="your@email.com" />
      </div>

      <button class="btn-secondary" on:click={saveProfile}>Save Profile</button>
      
      <div class="divider"></div>

      <div class="plan-section">
        <div class="plan-info">
          <label for="plan-badge">Current Plan</label>
          <div class="plan-row">
            <div id="plan-badge" class="plan-badge" style="text-transform: capitalize;">
              {$auth.user?.plan || 'free'} Plan
            </div>
            
            {#if !$auth.user?.plan || $auth.user?.plan === 'free'}
              <a href="/#pricing" class="upgrade-link">Upgrade to Pro</a>
            {:else if $auth.user?.plan === 'pro'}
              <a href="/contact" class="upgrade-link">Upgrade to Business</a>
            {/if}
          </div>
        </div>

        {#if $auth.user?.plan === 'free'}
          <div class="usage-stats">
            <div class="usage-header">
              <span>Monthly Usage</span>
              <span>{monthlyUsage} / {$auth.user?.maxTrips || 10} trips</span>
            </div>
            <div class="progress-bar">
              <div 
                class="progress-fill" 
                style="width: {Math.min((monthlyUsage / ($auth.user?.maxTrips || 10)) * 100, 100)}%"
                class:warning={monthlyUsage >= ($auth.user?.maxTrips || 10)}
              ></div>
            </div>
          </div>
        {/if}
      </div>
    </div>
    
    <div class="settings-card">
      <div class="card-header">
        <div class="card-icon blue">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2C13.97 2 18 6.03 18 11C18 15.97 13.97 20 9 20H2V13C2 8.03 6.03 4 11 4H18V11C18 6.03 13.97 2 9 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Default Values</h2>
          <p class="card-subtitle">Pre-fill forms with these values</p>
        </div>
      </div>
      
      <div class="form-group">
        <label for="default-mpg">Default MPG</label>
        <input id="default-mpg" type="number" bind:value={settings.defaultMPG} placeholder="25" min="1" step="0.1" />
      </div>
      
      <div class="form-group">
        <label for="default-gas">Default Gas Price</label>
        <div class="input-prefix">
          <span class="prefix">$</span>
          <input id="default-gas" type="number" bind:value={settings.defaultGasPrice} placeholder="3.50" min="0" step="0.01" />
        </div>
      </div>
      
      <div class="form-group">
        <label for="default-start">Default Start Address</label>
        <input 
          id="default-start"
          type="text" 
          bind:value={settings.defaultStartAddress}
          placeholder="Start typing address..."
          autocomplete="off"
          use:autocomplete={{ apiKey: API_KEY }}
          on:place-selected={(e) => handleAddressSelect('start', e)}
        />
      </div>
      
      <div class="form-group">
        <label for="default-end">Default End Address</label>
        <input 
          id="default-end"
          type="text" 
          bind:value={settings.defaultEndAddress}
          placeholder="Start typing address..."
          autocomplete="off"
          use:autocomplete={{ apiKey: API_KEY }}
          on:place-selected={(e) => handleAddressSelect('end', e)}
        />
      </div>
      
      <button class="btn-primary" on:click={saveDefaultSettings}>
        Save Default Values
      </button>
    </div>
    
    <div class="settings-card">
      <div class="card-header">
        <div class="card-icon green">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
             <path d="M10 12C11.1046 12 12 11.1046 12 10C12 8.89543 11.1046 8 10 8C8.89543 8 8 8.89543 8 10C8 11.1046 8.89543 12 10 12Z" stroke="currentColor" stroke-width="2"/>
             <path d="M16.2 12C16.1 12.5 16.3 13 16.7 13.3L16.8 13.4C17.1 13.7 17.3 14.1 17.3 14.5C17.3 14.9 17.1 15.3 16.8 15.6C16.5 15.9 16.1 16.1 15.7 16.1C15.3 16.1 14.9 15.9 14.6 15.6L14.5 15.5C14.2 15.1 13.7 14.9 13.2 15C12.7 15.1 12.4 15.5 12.3 16V16.2C12.3 17.1 11.6 17.8 10.7 17.8C9.8 17.8 9.1 17.1 9.1 16.2V16.1C9 15.5 8.6 15.1 8 15C7.5 15 7 15.2 6.7 15.6L6.6 15.7C6.3 16 5.9 16.2 5.5 16.2C5.1 16.2 4.7 16 4.4 15.7C4.1 15.4 3.9 15 3.9 14.6C3.9 14.2 4.1 13.8 4.4 13.5L4.5 13.4C4.9 13.1 5.1 12.6 5 12.1C4.9 11.6 4.5 11.3 4 11.2H3.8C2.9 11.2 2.2 10.5 2.2 9.6C2.2 8.7 2.9 8 3.8 8H3.9C4.5 7.9 4.9 7.5 5 6.9C5 6.4 4.8 5.9 4.4 5.6L4.3 5.5C4 5.2 3.8 4.8 3.8 4.4C3.8 4 4 3.6 4.3 3.3C4.6 3 5 2.8 5.4 2.8C5.8 2.8 6.2 3 6.5 3.3L6.6 3.4C7 3.8 7.5 4 8 3.9C8.5 3.9 8.8 3.4 8.9 2.9V2.7C8.9 1.8 9.6 1.1 10.5 1.1C11.4 1.1 12.1 1.8 12.1 2.7V2.8C12.1 3.4 12.5 3.8 13.1 3.9C13.6 4 14.1 3.8 14.4 3.4L14.5 3.3C14.8 3 15.2 2.8 15.6 2.8C16 2.8 16.4 3 16.7 3.3C17 3.6 17.2 4 17.2 4.4C17.2 4.8 17 5.2 16.7 5.5L16.6 5.6C16.2 5.9 16 6.4 16.1 6.9C16.2 7.4 16.6 7.7 17.1 7.8H17.3C18.2 7.8 18.9 8.5 18.9 9.4C18.9 10.3 18.2 11 17.3 11H17.2C16.6 11.1 16.2 11.5 16.1 12.1L16.2 12Z" stroke="currentColor" stroke-width="2"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Integrations</h2>
          <p class="card-subtitle">Connect external services</p>
        </div>
      </div>
      
      <div class="data-actions">
        <a href="/dashboard/hughesnet" class="action-btn" style="text-decoration: none; color: inherit;">
          <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
             <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #0D9488;">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M2 12h20"></path>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
             </svg>
             <div>
                <div class="action-title">HughesNet</div>
                <div class="action-subtitle">Configure satellite integration</div>
             </div>
             <div style="margin-left: auto;">
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                   <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
             </div>
          </div>
        </a>
      </div>
    </div>
    
    <div class="settings-card">
      <div class="card-header">
        <div class="card-icon purple">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M15 7H14V5C14 3.67392 13.4732 2.40215 12.5355 1.46447C11.5979 0.526784 10.3261 0 9 0C7.67392 0 6.40215 0.526784 5.46447 1.46447C4.52678 2.40215 4 3.67392 4 5V7H3C2.46957 7 1.96086 7.21071 1.58579 7.58579C1.21071 7.96086 1 8.46957 1 9V17C1 17.5304 1.21071 18.0391 1.58579 18.4142C1.96086 18.7893 2.46957 19 3 19H15C15.5304 19 16.0391 18.7893 16.4142 18.4142C16.7893 18.0391 17 17.5304 17 17V9C17 8.46957 16.7893 7.96086 16.4142 7.58579C16.0391 7.21071 15.5304 7 15 7ZM6 5C6 4.20435 6.31607 3.44129 6.87868 2.87868C7.44129 2.31607 8.20435 2 9 2C9.79565 2 10.5587 2.31607 11.1213 2.87868C11.6839 3.44129 12 4.20435 12 5V7H6V5Z" fill="currentColor"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Security</h2>
          <p class="card-subtitle">Password and authentication</p>
        </div>
      </div>
      
      {#if !showPasswordChange}
        <button class="btn-secondary" on:click={() => showPasswordChange = true}>Change Password</button>
      {:else}
        <div class="password-change">
          {#if passwordError}<div class="alert error">{passwordError}</div>{/if}
          <div class="form-group"><label for="curr-pass">Current Password</label><input id="curr-pass" type="password" bind:value={passwordData.current} /></div>
          <div class="form-group"><label for="new-pass">New Password</label><input id="new-pass" type="password" bind:value={passwordData.new} /></div>
          <div class="form-group"><label for="confirm-pass">Confirm New Password</label><input id="confirm-pass" type="password" bind:value={passwordData.confirm} /></div>
          <div class="button-group">
            <button class="btn-primary" on:click={changePassword}>Update</button>
            <button class="btn-secondary" on:click={() => showPasswordChange = false}>Cancel</button>
          </div>
        </div>
      {/if}
    </div>
    
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
          <p class="card-subtitle">Export, import, or delete your data</p>
        </div>
      </div>
      
      <div class="data-actions">
        <button class="action-btn" on:click={exportCSV}>
          <div>
            <div class="action-title">Export All Trips (CSV)</div>
            <div class="action-subtitle">Download detailed spreadsheet of all trips</div>
          </div>
        </button>
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
    
    <div class="settings-card danger-card">
      <div class="card-header">
        <div class="card-icon red">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M7 17H3C2.46957 17 1.96086 16.7893 1.58579 16.4142C1.21071 16.0391 1 15.5304 1 15V3C1 2.46957 1.21071 1.96086 1.58579 1.58579C1.96086 1.21071 2.46957 1 3 1H7M13 13L17 9M17 9L13 5M17 9H7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Account Actions</h2>
          <p class="card-subtitle">Sign out or delete account</p>
        </div>
      </div>
      
      <div class="danger-actions">
        <button class="btn-logout" on:click={handleLogout}>
          Logout
        </button>
        
        {#if !showDeleteConfirm}
          <button class="btn-delete" on:click={() => showDeleteConfirm = true}>
            Delete Account
          </button>
        {:else}
          <div class="delete-confirmation">
            <p class="delete-warning">To verify, please enter your password:</p>
            <input type="password" bind:value={deletePassword} placeholder="Enter your password" class="delete-input" />
            {#if deleteError}<p class="error-text">{deleteError}</p>{/if}
            
            <div class="button-group">
              <button class="btn-delete-confirm" on:click={handleDeleteAccount} disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : 'Permanently Delete Account'}
              </button>
              <button class="btn-secondary" on:click={() => { showDeleteConfirm = false; deletePassword = ''; deleteError = ''; }}>Cancel</button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .settings { max-width: 1200px; margin: 0 auto; padding: 20px; }
  .page-header { margin-bottom: 32px; }
  .page-title { font-size: 32px; font-weight: 800; color: #111827; margin-bottom: 4px; }
  .page-subtitle { font-size: 16px; color: #6B7280; }
  
  .alert { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-radius: 12px; font-size: 14px; font-weight: 500; margin-bottom: 24px; }
  .alert.success { background: #F0FDF4; color: #166534; border: 1px solid #BBF7D0; }
  .alert.error { background: #FEF2F2; color: #991B1B; border: 1px solid #FECACA; }
  
  .settings-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; }
  .settings-card { background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 24px; }
  .settings-card.danger-card { border-color: #FEE2E2; background: #FEF2F2; }
  
  .card-header { display: flex; gap: 16px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #E5E7EB; }
  .card-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; }
  .card-icon.orange { background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%); }
  .card-icon.blue { background: linear-gradient(135deg, var(--blue) 0%, #1E9BCF 100%); }
  .card-icon.green { background: linear-gradient(135deg, var(--green) 0%, #7AB82E 100%); }
  .card-icon.purple { background: linear-gradient(135deg, var(--purple) 0%, #764a89 100%); }
  .card-icon.navy { background: linear-gradient(135deg, var(--navy) 0%, #1a3a5c 100%); }
  .card-icon.red { background: linear-gradient(135deg, #DC2626 0%, #B91C1C 100%); }
  .card-icon.teal { background: linear-gradient(135deg, #14B8A6 0%, #0D9488 100%); }
  
  .card-title { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  .card-subtitle { font-size: 14px; color: #6B7280; }
  
  .form-group { margin-bottom: 20px; }
  .form-group label { display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 8px; }
  
  .form-group input, .form-group select { 
    width: 100%; max-width: 450px; 
    padding: 12px 16px; 
    border: 2px solid #E5E7EB;
    /* UPDATED: 16px to prevent zoom */
    border-radius: 10px; font-size: 16px; font-family: inherit; background: white; transition: all 0.2s;
    display: block; box-sizing: border-box;
  }
  .form-group input:focus, .form-group select:focus { 
    outline: none; border-color: var(--orange);
    box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1); 
  }
  .form-group input:disabled { background: #F9FAFB; color: #9CA3AF; cursor: not-allowed; }
  
  .input-prefix { position: relative; width: 100%; max-width: 450px; box-sizing: border-box; }
  .input-prefix .prefix { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #6B7280; font-weight: 600; }
  .input-prefix input { padding-left: 36px; }

  .divider { height: 1px; background: #E5E7EB; margin: 24px 0; }
  .plan-row { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
  .plan-badge { display: inline-block; padding: 6px 12px; background: #F3F4F6; color: #374151; border-radius: 8px; font-weight: 600; font-size: 14px; }
  .upgrade-link { color: var(--orange); font-size: 14px; font-weight: 600; text-decoration: none; }
  /* UPDATED: Wrap hover */
  @media (hover: hover) {
    .upgrade-link:hover { text-decoration: underline; }
  }
  .usage-stats { margin-top: 16px; }
  .usage-header { display: flex; justify-content: space-between; font-size: 13px; color: #6B7280; margin-bottom: 6px; }
  .progress-bar { height: 8px; background: #E5E7EB; border-radius: 4px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--green); border-radius: 4px; transition: width 0.3s; }
  .progress-fill.warning { background: #F59E0B; }
  
  .btn-primary, .btn-secondary, .btn-logout, .btn-delete, .btn-delete-confirm { 
      width: 100%; padding: 14px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 15px;
  }
  .btn-primary { background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%); color: white; border: none; }
  .btn-secondary { background: white; color: #374151; border: 2px solid #E5E7EB; }
  .btn-logout { background: white; color: #DC2626; border: 2px solid #FEE2E2; }
  
  /* UPDATED: Wrap hover states */
  @media (hover: hover) {
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(255, 127, 80, 0.3); }
    .btn-secondary:hover { border-color: var(--orange); color: var(--orange); }
    .btn-logout:hover { background: #FEF2F2; border-color: #FCA5A5; }
    .btn-delete:hover { color: #B91C1C; }
    .btn-delete-confirm:hover { background: #B91C1C; }
    .action-btn:hover { border-color: var(--orange); background: white; }
    .action-btn.danger:hover { border-color: #DC2626; background: white; }
  }
  
  .btn-delete { background: transparent; color: #DC2626; border: none; margin-top: 12px; font-size: 14px; text-decoration: underline; }
  .delete-confirmation { margin-top: 16px; padding: 16px; background: white; border-radius: 10px; border: 1px solid #FECACA; }
  .delete-warning { font-size: 14px; color: #374151; margin-bottom: 12px; font-weight: 500; }
  .delete-input { width: 100%; padding: 10px; border: 1px solid #E5E7EB; border-radius: 8px; margin-bottom: 12px; }
  .error-text { color: #DC2626; font-size: 13px; margin-bottom: 12px; }
  .btn-delete-confirm { background: #DC2626; color: white; border: none; margin-bottom: 8px; }

  .button-group { display: flex; flex-direction: column; gap: 8px; }
  .data-actions { display: flex; flex-direction: column; gap: 12px; }
  .action-btn { display: flex; align-items: center; gap: 16px; padding: 16px; background: #F9FAFB; border: 2px solid #E5E7EB; border-radius: 12px; cursor: pointer; text-align: left; width: 100%; }
  .action-title { font-size: 15px; font-weight: 600; color: #111827; }
  .action-subtitle { font-size: 13px; color: #6B7280; }

  @media (max-width: 1024px) {
    .settings-grid { grid-template-columns: 1fr; }
  }
</style>