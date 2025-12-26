<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { trips } from '$lib/stores/trips';
  import { trash } from '$lib/stores/trash';
  import { user } from '$lib/stores/auth';
  import Modal from '$lib/components/ui/Modal.svelte';

  let username = '';
  let password = '';
  let loading = false;
  let orders: any[] = [];
  let isConnected = false;
  let logs: string[] = [];
  
  // Console Visibility State
  let showConsole = false;

  // Configuration State
  let installPay: number = 0;
  let repairPay: number = 0;
  let upgradePay: number = 0;
  let wifiExtenderPay: number = 0;
  let voipPay: number = 0;
  let driveTimeBonus: number = 0;
  
  // Supply Costs
  let poleCost: number = 0;
  let concreteCost: number = 0;
  let poleCharge: number = 0;
  
  // Times (Default to standard times)
  let installTime: number = 90; 
  let repairTime: number = 60;
  
  let overrideTimes = false;

  let showSuccess = false;
  let successMessage = '';
  let statusMessage = 'Sync Now';

  // Track batch for progress visualization
  let currentBatch = 0;

  // Config Sync State
  let isConfigLoaded = false;
  let saveTimeout: any; 
  let isSaving = false;

  // Conflict Management State
  let conflictTrips: any[] = [];
  let selectedConflicts: Set<string> = new Set(); // Track which trips to overwrite
  let showConflictModal = false;
  let conflictTimer = 60;
  let conflictInterval: any;

  function showSuccessMsg(msg: string) {
    successMessage = msg;
    showSuccess = true;
    setTimeout(() => showSuccess = false, 3000);
  }

  function addLog(msg: string) {
    logs = [`[${new Date().toLocaleTimeString()}] ${msg}`, ...logs];
  }

  function processServerLogs(serverLogs?: string[]) {
      if (serverLogs && Array.isArray(serverLogs)) {
          serverLogs.forEach(log => {
              logs = [`[Server] ${log}`, ...logs];
          });
      }
  }

  // Load Settings from Server (KV)
  async function loadSettings() {
      try {
          const res = await fetch('/api/hughesnet', {
              method: 'POST',
              body: JSON.stringify({ action: 'get_settings' })
          });
          const data = await res.json();
          
          if (data.settings) {
              installPay = data.settings.installPay ?? 0;
              repairPay = data.settings.repairPay ?? 0;
              upgradePay = data.settings.upgradePay ?? 0;
              wifiExtenderPay = data.settings.wifiExtenderPay ?? 0;
              voipPay = data.settings.voipPay ?? 0;
              driveTimeBonus = data.settings.driveTimeBonus ?? 0;
              poleCost = data.settings.poleCost ?? 0;
              concreteCost = data.settings.concreteCost ?? 0;
              poleCharge = data.settings.poleCharge ?? 0;
              installTime = data.settings.installTime ?? 90;
              repairTime = data.settings.repairTime ?? 60;
              overrideTimes = data.settings.overrideTimes ?? false;
              
              addLog('Settings loaded from cloud.');
          }
      } catch (e) {
          console.error('Failed to load settings', e);
          addLog('Error loading settings.');
      } finally {
          isConfigLoaded = true;
      }
  }

  // Save Settings to Server (KV)
  async function saveSettings() {
      if (!isConfigLoaded) return;
      isSaving = true;
      
      const settings = {
          installPay,
          repairPay,
          upgradePay,
          wifiExtenderPay,
          voipPay,
          driveTimeBonus,
          poleCost,
          concreteCost,
          poleCharge,
          installTime,
          repairTime,
          overrideTimes
      };

      try {
          const res = await fetch('/api/hughesnet', {
              method: 'POST',
              body: JSON.stringify({ 
                  action: 'save_settings', 
                  settings 
              })
           });
           const data = await res.json();
           if (!data.success) {
               console.error('Save failed:', data.error);
               addLog(`Save Error: ${data.error}`);
           }
      } catch (e) {
          console.error('Failed to auto-save settings', e);
          addLog('Failed to auto-save settings.');
      } finally {
          isSaving = false;
      }
  }

  // Reactive Watcher
  $: if (isConfigLoaded) {
      const _ = [installPay, repairPay, upgradePay, wifiExtenderPay, voipPay, driveTimeBonus, poleCost, concreteCost, poleCharge, installTime, repairTime, overrideTimes];
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
          saveSettings();
      }, 1000);
  }

  async function loadOrders() {
    addLog('Checking cache for existing orders...');
    try {
        const res = await fetch(`/api/hughesnet`);
        const data = await res.json();
        if (data.orders) {
            orders = Object.values(data.orders);
            if (orders.length > 0) {
                isConnected = true;
                addLog(`Found ${orders.length} cached orders.`);
            } else {
                addLog('No cached orders found.');
            }
        }
    } catch (e) {
        addLog('Error checking cache: ' + e);
    }
  }

  async function handleConnect() {
    if (!username || !password) {
        alert('Please enter username and password');
        return;
    }

    loading = true;
    statusMessage = 'Connecting...';
    addLog('Connecting...');
    try {
        const res = await fetch('/api/hughesnet', {
            method: 'POST',
            body: JSON.stringify({ action: 'connect', username, password })
        });
        const data = await res.json();
        processServerLogs(data.logs);

        if (data.success) {
            isConnected = true;
            addLog('Connected! Ready to sync.');
            showSuccessMsg('Connected successfully!');
        } else {
            addLog('Login Failed: ' + (data.error || 'Unknown error'));
            alert('Login Failed: ' + (data.error || 'Check logs'));
        }
    } catch (e: any) {
        addLog('Network Error: ' + e.message);
    } finally {
        loading = false;
        statusMessage = 'Sync Now';
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect from HughesNet?')) return;
    loading = true;
    addLog('Disconnecting...');
    try {
        const res = await fetch('/api/hughesnet', {
            method: 'POST',
            body: JSON.stringify({ action: 'disconnect' })
        });
        const data = await res.json();
        processServerLogs(data.logs);
        
        if (data.success) {
            isConnected = false;
            orders = []; 
            addLog('Disconnected.');
            showSuccessMsg('Disconnected.');
        }
    } catch (e: any) { 
        addLog('Error: ' + e.message);
    } finally { 
        loading = false;
    }
  }

  async function handleSync(batchCount = 1, recentOnly = false, forceOverrideDates: string[] = []) {
    loading = true;
    currentBatch = batchCount;
    statusMessage = `Syncing Batch ${batchCount}...`;
    
    // Reset conflicts on first batch if not a force run
    if (batchCount === 1 && forceOverrideDates.length === 0) {
        conflictTrips = []; 
    }

    const skipScan = batchCount > 1;
    let data: any = null;
    if (batchCount === 1) {
        addLog(recentOnly ? `🚀 Starting Quick Sync (Last 7 Days)...` : `📡 Starting Full History Scan...`);
        showConsole = true;
        
        // CRITICAL: Sync local changes to cloud BEFORE HughesNet sync
        // This ensures any manual edits are uploaded so conflict detection works
        const userId = $user?.name || $user?.token;
        if (userId) {
            addLog('⬆️ Uploading local changes first...');
            try {
                // Force sync any pending local changes to cloud
                const result = await trips.syncPendingToCloud(userId);
                if (result.synced > 0) {
                    addLog(`✅ Uploaded ${result.synced} local change(s) to cloud`);
                } else {
                    addLog('✅ No pending local changes');
                }
                if (result.failed > 0) {
                    addLog(`⚠️ Warning: ${result.failed} change(s) failed to upload`);
                }
            } catch (e: any) {
                addLog('⚠️ Warning: Could not sync local changes - ' + e.message);
            }
        }
    } else {
        addLog(`📦 Continuing Sync (Batch ${batchCount})...`);
    }

    try {
        const res = await fetch('/api/hughesnet', {
            method: 'POST',
            body: JSON.stringify({ 
                action: 'sync',
                installPay: installPay || 0,
                repairPay: repairPay || 0,
                upgradePay: upgradePay || 0,
                wifiExtenderPay: wifiExtenderPay || 0,
                voipPay: voipPay || 0,
                driveTimeBonus: driveTimeBonus || 0,
                poleCost: poleCost || 0,
                concreteCost: concreteCost || 0,
                poleCharge: poleCharge || 0, 
                installTime: installTime || 0,
                repairTime: repairTime || 0,
                overrideTimes,
                skipScan,
                recentOnly,
                forceDates: forceOverrideDates
            })
        });
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            addLog(`❌ Server returned HTML instead of JSON (Batch ${batchCount})`);
            addLog(`This usually means the session expired or there was a server error.`);
            addLog(`Please disconnect and reconnect, then try syncing again.`);
            alert('Session expired or server error. Please disconnect and reconnect.');
            loading = false;
            statusMessage = 'Sync Failed';
            currentBatch = 0;
            return;
        }

        data = await res.json();
        processServerLogs(data.logs);
        if (data.success) {
             const newOrders = data.orders || [];
             orders = newOrders;
             isConnected = true;
             
             // Collect conflicts
             if (data.conflicts && Array.isArray(data.conflicts)) {
                 // Merge unique conflicts by date
                 const existingDates = new Set(conflictTrips.map(c => c.date));
                 const newConflicts = data.conflicts.filter(c => !existingDates.has(c.date));
                 conflictTrips = [...conflictTrips, ...newConflicts];
             }

             if (data.incomplete) {
                 addLog(`✓ Batch ${batchCount} complete. Starting next batch...`);
                 await new Promise(r => setTimeout(r, 1500)); 
                 await handleSync(batchCount + 1, recentOnly, forceOverrideDates); 
                 return;
             }

             // Check for conflicts AFTER all batches complete
             if (conflictTrips.length > 0 && forceOverrideDates.length === 0) {
                 addLog(`⚠️ Found ${conflictTrips.length} user-modified trip(s) - awaiting decision...`);
                 startConflictTimer();
                 return;
             }

             addLog(`✅ Sync Complete! Processed ${newOrders.length} orders total.`);
             showSuccessMsg(`Synced ${newOrders.length} orders!`);
             statusMessage = 'Sync Complete';
             currentBatch = 0; 
             
             const userId = $user?.name || $user?.token;
             if (userId) {
                addLog('⬇️ Downloading generated trips...');
                await trips.syncFromCloud(userId);
                addLog('✅ Trips updated locally.');
             }

        } else {
            addLog('❌ Sync Failed: ' + data.error);
            if (data.error && (data.error.includes('login') || data.error.includes('Session expired'))) {
                addLog('⚠️ Session expired. Please disconnect and reconnect.');
                alert('Your HughesNet session expired. Please disconnect and reconnect.');
            }
            loading = false;
            statusMessage = 'Sync Failed';
            currentBatch = 0;
        }
    } catch (e: any) {
        addLog('❌ Sync Error: ' + e.message);
        if (e.message.includes('JSON')) {
            addLog('❌ Server returned invalid response. Session may have expired.');
            alert('Session error. Please disconnect and reconnect.');
        }
        loading = false;
        statusMessage = 'Sync Failed';
        currentBatch = 0;
    } finally {
        if (!data || (!data.incomplete && !showConflictModal)) {
            loading = false;
            statusMessage = 'Sync Now';
        }
    }
  }

  async function handleClear() {
      if (!confirm('Are you sure you want to delete ALL HughesNet trips? This cannot be undone.')) return;
      loading = true;
      statusMessage = 'Clearing...';
      addLog('🗑️ Clearing HNS trips...');
      try {
          const res = await fetch('/api/hughesnet', {
              method: 'POST',
              body: JSON.stringify({ action: 'clear' })
          });
          const data = await res.json();
          processServerLogs(data.logs);

          addLog(`✅ Cleared ${data.count} trips.`);
          showSuccessMsg(`Cleared ${data.count} trips.`);
          
          const userId = $user?.name || $user?.token;
          if (userId) {
              addLog('🔄 Syncing removal with local database...');
              await trash.syncFromCloud(userId);
              addLog('✅ Local trips cleaned up.');
          }

          await loadOrders();
      } catch (e: any) {
          addLog('❌ Clear Error: ' + e.message);
      } finally {
          loading = false;
          statusMessage = 'Sync Now';
      }
  }

  // Conflict Logic
  function startConflictTimer() {
      showConflictModal = true;
      conflictTimer = 60;
      selectedConflicts = new Set(); // Reset selection
      if (conflictInterval) clearInterval(conflictInterval);
      
      conflictInterval = setInterval(() => {
          conflictTimer--;
          if (conflictTimer <= 0) {
              // Default action is SKIP (preserve all user edits)
              cancelOverride();
          }
      }, 1000);
  }

  function toggleConflict(date: string) {
      if (selectedConflicts.has(date)) {
          selectedConflicts.delete(date);
      } else {
          selectedConflicts.add(date);
      }
      selectedConflicts = selectedConflicts; // Trigger reactivity
  }

  function selectAll() {
      selectedConflicts = new Set(conflictTrips.map(c => c.date));
  }

  function selectNone() {
      selectedConflicts = new Set();
  }

  function confirmOverride() {
      stopConflictTimer();
      
      if (selectedConflicts.size === 0) {
          // No trips selected, keep all edits
          addLog(`✅ No trips selected - preserved all user edits`);
          conflictTrips = [];
          loading = false;
          statusMessage = 'Sync Complete';
          return;
      }
      
      const forceDates = Array.from(selectedConflicts);
      const keepCount = conflictTrips.length - selectedConflicts.size;
      
      addLog(`🔄 Overwriting ${selectedConflicts.size} trip(s), keeping ${keepCount} user edit(s)...`);
      handleSync(1, true, forceDates);
  }

  function cancelOverride() {
      stopConflictTimer();
      addLog(`✅ Preserved ${conflictTrips.length} user-modified trip(s) (skipped HNS updates)`);
      conflictTrips = [];
      selectedConflicts = new Set();
      loading = false;
      statusMessage = 'Sync Complete';
  }

  function stopConflictTimer() {
      if (conflictInterval) clearInterval(conflictInterval);
      showConflictModal = false;
  }

  import ArchivedRestore from '$lib/components/hughesnet/ArchivedRestore.svelte';

  onMount(() => {
    loadSettings();
    loadOrders();
  });
  
  onDestroy(() => {
      if (saveTimeout) clearTimeout(saveTimeout);
      if (conflictInterval) clearInterval(conflictInterval);
  });
</script>

<div class="settings">
  <div class="page-header">
    <div>
      <h1 class="page-title">HughesNet Integration</h1>
      <p class="page-subtitle">Sync your orders, automate trip creation, and calculate pay.</p>
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
        <div class="card-icon blue">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2C13.97 2 18 6.03 18 11C18 15.97 13.97 20 9 20H2V13C2 8.03 6.03 4 11 4H18V11C18 6.03 13.97 2 9 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Connection</h2>
          <p class="card-subtitle">{isConnected ? 'Connected to HughesNet' : 'Link your account'}</p>
        </div>
      </div>
      
      {#if !isConnected && orders.length === 0}
          <div class="form-group">
            <label for="hn-username">Username</label>
            <input id="hn-username" type="text" bind:value={username} placeholder="HughesNet Username" />
          </div>
          
          <div class="form-group">
            <label for="hn-password">Password</label>
            <input id="hn-password" type="password" bind:value={password} placeholder="HughesNet Password" />
          </div>

          <button class="btn-primary" on:click={handleConnect} disabled={loading}>
            {statusMessage === 'Sync Now' ? 'Connect' : statusMessage}
          </button>
      {:else}
          <div class="success-state">
              <div class="status-indicator">
                  <span class="dot"></span> Connected
              </div>
              <p class="last-sync">Found {orders.length} active orders in cache.</p>
          </div>
          
          <div class="warning-box">
              <p>⚠️ <strong>Important:</strong> Before syncing, please ensure your Start Address and MPG defaults are updated in <a href="/dashboard/settings">Global Settings</a>.</p>
          </div>

          {#if loading && currentBatch > 0}
             <div class="sync-progress-container">
                 <div class="progress-info">
                     <span class="progress-label">Syncing Batch {currentBatch}</span>
                     <span class="progress-sub">Fetching orders...</span>
                 </div>
                 <div class="progress-bar">
                     <div class="progress-fill indeterminate"></div>
                 </div>
             </div>
          {:else}
              <div class="button-group mt-4">
                   <button class="btn-primary" on:click={() => handleSync(1, true)} disabled={loading}>
                     <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                     Quick Sync (New Only)
                   </button>

                   <button class="btn-secondary" on:click={() => handleSync(1, false)} disabled={loading}>
                     <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                     Full History Scan
                   </button>
                   
                   <button class="btn-secondary danger-hover" on:click={handleDisconnect} disabled={loading}>
                     Disconnect
                   </button>

                   <button class="btn-secondary danger-hover" on:click={handleClear} disabled={loading}>
                       Delete HNS Trips
                   </button>
              </div>
          {/if}
      {/if}
    </div>

    {#if isConnected}
    <div class="settings-card">
      <div class="card-header">
        <div class="card-icon green">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M5 10.5L8.5 14L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Archived Orders</h2>
          <p class="card-subtitle">Restore previously synced HughesNet orders</p>
        </div>
      </div>

      <div style="padding:12px;">
        <ArchivedRestore on:restored={(e) => { if (e.detail?.imported) { addLog(`Imported ${e.detail.imported.length} archived orders`); } }} on:restoreAndSync={(e) => { if (e.detail?.dates) { addLog(`Imported orders for ${e.detail.dates.join(', ')}, syncing...`); handleSync(1, true, e.detail.dates); } }} />
      </div>
    </div>

    <div class="settings-card">
      <div class="card-header">
        <div class="card-icon orange">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
             <path d="M10 12C11.1046 12 12 11.1046 12 10C12 8.89543 11.1046 8 10 8C8.89543 8 8 8.89543 8 10C8 11.1046 8.89543 12 10 12Z" stroke="currentColor" stroke-width="2"/>
             <path d="M16.2 12C16.1 12.5 16.3 13 16.7 13.3L16.8 13.4C17.1 13.7 17.3 14.1 17.3 14.5C17.3 14.9 17.1 15.3 16.8 15.6C16.5 15.9 16.1 16.1 15.7 16.1C15.3 16.1 14.9 15.9 14.6 15.6L14.5 15.5C14.2 15.1 13.7 14.9 13.2 15C12.7 15.1 12.4 15.5 12.3 16V16.2C12.3 17.1 11.6 17.8 10.7 17.8C9.8 17.8 9.1 17.1 9.1 16.2V16.1C9 15.5 8.6 15.1 8 15C7.5 15 7 15.2 6.7 15.6L6.6 15.7C6.3 16 5.9 16.2 5.5 16.2C5.1 16.2 4.7 16 4.4 15.7C4.1 15.4 3.9 15 3.9 14.6C3.9 14.2 4.1 13.8 4.4 13.5L4.5 13.4C4.9 13.1 5.1 12.6 5 12.1C4.9 11.6 4.5 11.3 4 11.2H3.8C2.9 11.2 2.2 10.5 2.2 9.6C2.2 8.7 2.9 8 3.8 8H3.9C4.5 7.9 4.9 7.5 5 6.9C5 6.4 4.8 5.9 4.4 5.6L4.3 5.5C4 5.2 3.8 4.8 3.8 4.4C3.8 4 4 3.6 4.3 3.3C4.6 3 5 2.8 5.4 2.8C5.8 2.8 6.2 3 6.5 3.3L6.6 3.4C7 3.8 7.5 4 8 3.9C8.5 3.9 8.8 3.4 8.9 2.9V2.7C8.9 1.8 9.6 1.1 10.5 1.1C11.4 1.1 12.1 1.8 12.1 2.7V2.8C12.1 3.4 12.5 3.8 13.1 3.9C13.6 4 14.1 3.8 14.4 3.4L14.5 3.3C14.8 3 15.2 2.8 15.6 2.8C16 2.8 16.4 3 16.7 3.3C17 3.6 17.2 4 17.2 4.4C17.2 4.8 17 5.2 16.7 5.5L16.6 5.6C16.2 5.9 16 6.4 16.1 6.9C16.2 7.4 16.6 7.7 17.1 7.8H17.3C18.2 7.8 18.9 8.5 18.9 9.4C18.9 10.3 18.2 11 17.3 11H17.2C16.6 11.1 16.2 11.5 16.1 12.1L16.2 12Z" stroke="currentColor" stroke-width="2"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Configuration</h2>
          <p class="card-subtitle">Pay rates and supply costs</p>
        </div>
      </div>

      <h3 class="section-label">Pay Rates</h3>
      <div class="config-grid">
          <div class="form-group">
            <label for="install-pay">Install Pay ($)</label>
            <input id="install-pay" type="number" bind:value={installPay} placeholder="0.00" min="0" step="0.01" />
          </div>
          
          <div class="form-group">
            <label for="repair-pay">Repair Pay ($)</label>
            <input id="repair-pay" type="number" bind:value={repairPay} placeholder="0.00" min="0" step="0.01" />
          </div>

          <div class="form-group">
            <label for="upgrade-pay">Upgrade Pay ($)</label>
            <input id="upgrade-pay" type="number" bind:value={upgradePay} placeholder="0.00" min="0" step="0.01" />
          </div>

          <div class="form-group">
            <label for="wifi-pay">WIFI Extender Pay ($)</label>
            <input id="wifi-pay" type="number" bind:value={wifiExtenderPay} placeholder="0.00" min="0" step="0.01" />
          </div>

          <div class="form-group">
            <label for="voip-pay">Phone Pay ($)</label>
            <input id="voip-pay" type="number" bind:value={voipPay} placeholder="0.00" min="0" step="0.01" />
          </div>

          {#if $user?.name?.toLowerCase() === 'james'}
          <div class="form-group">
            <label>Drive Time Bonus ($)</label>
            <input type="number" bind:value={driveTimeBonus} placeholder="0.00" min="0" step="0.01" />
            <span class="help-text">Added to EACH order if total drive > 5.5h</span>
          </div>
          {/if}
      </div>
      
      <h3 class="section-label text-red">Supply Costs & Extras</h3>
      <div class="config-grid">
          <div class="form-group">
            <label for="pole-cost" class="text-red">Pole Cost ($)</label>
            <input id="pole-cost" type="number" bind:value={poleCost} placeholder="0.00" min="0" step="0.01" class="border-red" />
            <span class="help-text">Deducted if Pole detected</span>
          </div>
          
          <div class="form-group">
            <label for="conc-cost" class="text-red">Concrete Cost ($)</label>
            <input id="conc-cost" type="number" bind:value={concreteCost} placeholder="0.00" min="0" step="0.01" class="border-red" />
            <span class="help-text">Deducted if Pole detected</span>
          </div>

          <div class="form-group">
            <label for="pole-charge" class="text-green">Pole Charge Amount ($)</label>
            <input id="pole-charge" type="number" bind:value={poleCharge} placeholder="0.00" min="0" step="0.01" class="border-green" />
            <span class="help-text">Added to pay if Pole detected</span>
          </div>
      </div>

      <div class="separator"></div>

      <div class="config-grid">
          <div class="form-group">
            <label for="install-time">Install Time (min)</label>
            <input id="install-time" type="number" bind:value={installTime} placeholder="0" min="1" />
          </div>
          
          <div class="form-group">
            <label for="repair-time">Repair Time (min)</label>
            <input id="repair-time" type="number" bind:value={repairTime} placeholder="0" min="1" />
          </div>
      </div>
      
      <div class="checkbox-wrapper">
         <label class="checkbox-label">
            <input type="checkbox" bind:checked={overrideTimes} />
            <div>
                <span class="cb-title">Override Calculated Times</span>
                <span class="cb-desc">Ignore system logs and force the durations above</span>
            </div>
         </label>
      </div>
      
      <div class="tip-text">
        {isSaving ? 'Saving...' : 'Changes are saved to the cloud automatically.'}
      </div>

    </div>
    {/if}
    
    {#if isConnected && orders.length > 0}
    <div class="settings-card full-width">
      <div class="card-header">
        <div class="card-icon navy">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M17 2H3C2.46957 2 1.96086 2.21071 1.58579 2.58579C1.21071 2.96086 1 3.46957 1 4V16C1 16.5304 1.21071 17.0391 1.58579 17.4142C1.96086 17.7893 2.46957 18 3 18H17C17.5304 18 18.0391 17.7893 18.4142 17.4142C18.7893 17.0391 19 16.5304 19 16V4C19 3.46957 18.7893 2.96086 18.4142 2.58579C18.0391 2.21071 17.5304 2 17 2Z" stroke="currentColor" stroke-width="2"/>
            <path d="M1 8H19M6 1V3M14 1V3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Cached Orders</h2>
          <p class="card-subtitle">Orders currently stored in your session</p>
        </div>
      </div>

      <div class="orders-list">
          {#each orders as order}
             <div class="order-item">
                 <div class="order-main">
                     <span class="order-id">#{order.id}</span>
                     <span class="order-badge {order.type === 'Install' || order.type === 'Re-Install' ? 'blue' : (order.type === 'Upgrade' ? 'green' : 'purple')}">
                        {order.type || 'Unknown'}
                     </span>
                     {#if order.hasPoleMount}
                       <span class="order-badge pole">Pole</span>
                     {/if}
                     {#if order.hasWifiExtender}
                       <span class="order-badge wifi">Wifi</span>
                     {/if}
                     {#if order.hasVoip}
                       <span class="order-badge voip">Phone</span>
                     {/if}
                 </div>
                 <div class="order-details">
                     <div class="order-addr">{order.address}</div>
                     <div class="order-meta">{order.city}, {order.state}</div>
                 </div>
                 <div class="order-time">
                     <div class="date">{order.confirmScheduleDate}</div>
                     <div class="time">{order.beginTime}</div>
                 </div>
             </div>
          {/each}
      </div>
    </div>
    {/if}
    
    <div class="settings-card full-width bg-dark">
        <div class="console-header" on:click={() => showConsole = !showConsole} on:keydown={() => {}} role="button" tabindex="0">
            <div class="flex items-center gap-2">
                <span>Debug Console</span>
                <span class="console-count">({logs.length})</span>
            </div>
            <span class="toggle-icon" class:rotated={showConsole}>▶</span>
        </div>
        
        {#if showConsole}
            <div class="console-body" transition:slide>
                {#each logs as log}
                    <div class="log-line">
                        <span class="log-time">{log.includes('[') ? '' : '[' + new Date().toLocaleTimeString() + ']'}</span>
                        <span class="log-msg" class:server={log.includes('[Server]')}>{log}</span>
                    </div>
                {/each}
                {#if logs.length === 0}
                    <div class="log-line muted">System ready...</div>
                {/if}
            </div>
        {/if}
    </div>

  </div>
</div>

{#if showConflictModal}
<div class="modal-overlay">
    <div class="modal-content">
        <div class="modal-header">
            <h3>⚠️ User Modifications Detected</h3>
        </div>
        <div class="modal-body">
            <p>Found <strong>{conflictTrips.length}</strong> trip(s) you manually edited in the last 7 days.</p>
            <p class="modal-instruction">Select which trips to overwrite with HughesNet data:</p>
            
            <div class="selection-controls">
                <button class="select-btn" on:click={selectAll}>Select All</button>
                <button class="select-btn" on:click={selectNone}>Select None</button>
                <span class="selected-count">{selectedConflicts.size} of {conflictTrips.length} selected</span>
            </div>
            
            <div class="conflicts-list">
                {#each conflictTrips as conflict}
                    <div class="conflict-card" class:selected={selectedConflicts.has(conflict.date)}>
                        <label class="conflict-checkbox-label">
                            <input 
                                type="checkbox" 
                                checked={selectedConflicts.has(conflict.date)}
                                on:change={() => toggleConflict(conflict.date)}
                            />
                            <div class="conflict-content">
                                <div class="conflict-header">
                                    <span class="conflict-date">{conflict.date}</span>
                                    <span class="conflict-modified">Edited: {new Date(conflict.lastModified).toLocaleString()}</span>
                                </div>
                                
                                <div class="conflict-comparison">
                                    <div class="comparison-side your-version">
                                        <div class="comparison-label">Your Version</div>
                                        <div class="comparison-details">
                                            <div class="detail-row">
                                                <span class="detail-label">Stops:</span>
                                                <span class="detail-value">{conflict.stops}</span>
                                            </div>
                                            <div class="detail-row">
                                                <span class="detail-label">Earnings:</span>
                                                <span class="detail-value earnings">${conflict.earnings.toFixed(2)}</span>
                                            </div>
                                            <div class="detail-row address-row">
                                                <span class="detail-label">Address:</span>
                                                <span class="detail-value address">{conflict.address}</span>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div class="comparison-arrow">→</div>
                                    
                                    <div class="comparison-side hns-version">
                                        <div class="comparison-label">HughesNet Data</div>
                                        <div class="comparison-details">
                                            <div class="detail-row" class:changed={conflict.stops !== conflict.hnsStops}>
                                                <span class="detail-label">Stops:</span>
                                                <span class="detail-value">{conflict.hnsStops}</span>
                                                {#if conflict.stops !== conflict.hnsStops}
                                                    <span class="diff-badge">{conflict.hnsStops - conflict.stops > 0 ? '+' : ''}{conflict.hnsStops - conflict.stops}</span>
                                                {/if}
                                            </div>
                                            <div class="detail-row" class:changed={conflict.earnings !== conflict.hnsEarnings}>
                                                <span class="detail-label">Earnings:</span>
                                                <span class="detail-value earnings">${conflict.hnsEarnings.toFixed(2)}</span>
                                                {#if conflict.earnings !== conflict.hnsEarnings}
                                                    <span class="diff-badge">${(conflict.hnsEarnings - conflict.earnings).toFixed(2)}</span>
                                                {/if}
                                            </div>
                                            <div class="detail-row address-row" class:changed={conflict.address !== conflict.hnsAddress}>
                                                <span class="detail-label">Address:</span>
                                                <span class="detail-value address">{conflict.hnsAddress}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </label>
                    </div>
                {/each}
            </div>
            
            <p class="conflict-question">
                {#if selectedConflicts.size === 0}
                    Click "Keep All My Edits" to preserve all changes, or select trips to overwrite.
                {:else if selectedConflicts.size === conflictTrips.length}
                    All trips selected - will overwrite all with HughesNet data.
                {:else}
                    {selectedConflicts.size} trip(s) selected - will overwrite selected, keep others.
                {/if}
            </p>
            
            <div class="timer-bar">
                <div class="timer-fill" style="width: {(conflictTimer / 60) * 100}%"></div>
            </div>
            <p class="timer-text">
                {#if conflictTimer > 0}
                    Auto-keeping all edits in <strong>{conflictTimer}s</strong>...
                {:else}
                    Keeping your edits...
                {/if}
            </p>
        </div>
        <div class="modal-actions">
            <button class="btn-primary safe" on:click={cancelOverride}>
                <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                Keep All My Edits
            </button>
            <button class="btn-secondary danger" on:click={confirmOverride} disabled={selectedConflicts.size === 0}>
                <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                {selectedConflicts.size === 0 ? 'Select Trips to Overwrite' : `Overwrite ${selectedConflicts.size} Selected`}
            </button>
        </div>
    </div>
</div>
{/if}

<style>
  /* Mobile First Container */
  .settings { 
    max-width: 1200px;
    margin: 0 auto; 
    padding: 16px; 
  }

  .page-header { margin-bottom: 32px; }
  
  .page-title { 
    font-size: 24px; 
    font-weight: 800; 
    color: #111827; 
    margin-bottom: 4px;
  }
  
  .page-subtitle { font-size: 16px; color: #6B7280; }
  
  .alert { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-radius: 12px; font-size: 14px; font-weight: 500; margin-bottom: 24px; }
  .alert.success { background: #F0FDF4; color: #166534; border: 1px solid #BBF7D0; }
  
  /* Mobile First Grid System */
  .settings-grid { 
    display: grid;
    grid-template-columns: 1fr; /* Default to 1 column */
    gap: 16px;
  }
  
  .settings-card { 
    background: white; 
    border: 1px solid #E5E7EB; 
    border-radius: 16px; 
    padding: 16px;
  }
  
  .settings-card.full-width { grid-column: span 1; }

  /* Desktop Overrides */
  @media (min-width: 1024px) {
    .settings { padding: 20px; }
    .page-title { font-size: 32px; }
    
    .settings-grid { 
        grid-template-columns: repeat(2, 1fr);
        gap: 24px; 
    }
    .settings-card { padding: 24px; }
    .settings-card.full-width { grid-column: span 2; }
  }

  .card-header { display: flex; gap: 16px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #E5E7EB; }
  .card-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; }
  .card-icon.blue { background: linear-gradient(135deg, var(--blue) 0%, #1E9BCF 100%); }
  .card-icon.orange { background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%); }
  .card-icon.navy { background: linear-gradient(135deg, var(--navy) 0%, #1a3a5c 100%); }
  
  .card-title { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  .card-subtitle { font-size: 14px; color: #6B7280; }
  
  .form-group { margin-bottom: 20px; }
  .form-group label { display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 8px; }
  .form-group label.text-red { color: #DC2626; }
  .form-group label.text-green { color: #166534; }
  
  .form-group input { width: 100%; padding: 12px 16px; border: 2px solid #E5E7EB; border-radius: 10px; font-size: 15px; background: white; transition: all 0.2s; box-sizing: border-box; }
  .form-group input:focus { outline: none; border-color: var(--orange); box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1); }
  
  .form-group input.border-red { border-color: #FECACA; background: #FEF2F2; }
  .form-group input.border-red:focus { border-color: #DC2626; box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1); }

  .form-group input.border-green { border-color: #BBF7D0; background: #F0FDF4; }
  .form-group input.border-green:focus { border-color: #166534; box-shadow: 0 0 0 3px rgba(22, 101, 52, 0.1); }

  .help-text { font-size: 11px; color: #9CA3AF; margin-top: 4px; display: block; }
  
  /* Mobile First Config Grid */
  .config-grid { 
    display: grid;
    grid-template-columns: 1fr; /* Stack vertically on mobile */
    gap: 16px;
  }
  
  @media (min-width: 640px) {
    .config-grid { 
        grid-template-columns: 1fr 1fr;
        gap: 20px; 
    }
  }
  
  .section-label { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #9CA3AF; margin-bottom: 12px; letter-spacing: 0.05em; margin-top: 8px; }
  .section-label.text-red { color: #EF4444; }
  
  .separator { height: 1px; background: #E5E7EB; margin: 24px 0; }

  .btn-primary, .btn-secondary { width: 100%; padding: 14px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 15px; }
  .btn-primary { display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%); color: white; border: none; }
  .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(255, 127, 80, 0.3); }
  .btn-primary:disabled { opacity: 0.7; cursor: not-allowed; transform: none; box-shadow: none; }
  
  .btn-secondary { background: white; color: #374151; border: 2px solid #E5E7EB; }
  .btn-secondary:hover { border-color: var(--orange); color: var(--orange); }
  .btn-secondary.danger-hover:hover { border-color: #DC2626; color: #DC2626; }
  
  /* Mobile First Button Group */
  .button-group { 
    display: flex;
    flex-direction: column; /* Stack buttons on mobile */
    gap: 12px;
  }
  
  @media (min-width: 640px) {
    .button-group { 
        flex-direction: row;
    }
  }
  
  .mt-4 { margin-top: 16px; }

  /* SYNC PROGRESS STYLES */
  .sync-progress-container { background: #FFF7ED; border: 1px solid #FED7AA; border-radius: 12px; padding: 16px; text-align: center; margin-top: 16px; }
  .progress-info { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .progress-label { font-weight: 700; color: #9A3412; font-size: 14px; }
  .progress-sub { color: #C2410C; font-size: 12px; }
  .progress-bar { height: 8px; background: #FFEDD5; border-radius: 4px; overflow: hidden; position: relative; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, #F97316, #EA580C); border-radius: 4px; width: 30%; }
  .progress-fill.indeterminate { width: 50%; animation: pulse-progress 1.5s infinite ease-in-out; }
  
  @keyframes pulse-progress {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(200%); }
  }

  .success-state { padding: 20px; background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 12px; text-align: center; }
  .status-indicator { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; color: #166534; font-size: 16px; }
  .dot { width: 8px; height: 8px; background: #166534; border-radius: 50%; display: inline-block; }
  .last-sync { color: #15803D; font-size: 14px; margin-top: 4px; }
  
  .warning-box { margin: 16px 0; padding: 12px; background: #FFF7ED; border: 1px solid #FED7AA; border-radius: 8px; font-size: 13px; color: #9A3412; }
  .warning-box a { color: #C2410C; text-decoration: underline; font-weight: 600; }

  .checkbox-wrapper { margin: 20px 0; padding: 16px; background: #F9FAFB; border-radius: 10px; border: 1px solid #E5E7EB; }
  .checkbox-label { display: flex; align-items: flex-start; gap: 12px; cursor: pointer; }
  .checkbox-label input { margin-top: 4px; width: 16px; height: 16px; cursor: pointer; accent-color: var(--orange); }
  .cb-title { display: block; font-weight: 600; color: #111827; font-size: 14px; }
  .cb-desc { display: block; color: #6B7280; font-size: 13px; margin-top: 2px; }
  
  .tip-text { font-size: 13px; color: #6B7280; font-style: italic; margin-top: 10px; }

  .orders-list { display: grid; gap: 12px; max-height: 400px; overflow-y: auto; }
  
  /* Mobile First Order Item */
  .order-item { 
    display: flex;
    flex-direction: column; /* Stack content vertically */
    align-items: flex-start; 
    padding: 12px 16px; 
    border: 1px solid #E5E7EB;
    border-radius: 10px; 
    background: #F9FAFB;
    gap: 8px;
  }
  
  .order-main { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .order-id { font-weight: 700; color: #111827; }
  .order-badge { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
  .order-badge.blue { background: #DBEAFE; color: #1E40AF; }
  .order-badge.purple { background: #F3E8FF; color: #6B21A8; }
  .order-badge.green { background: #DCFCE7; color: #15803D; }
  .order-badge.pole { background: #FEE2E2; color: #991B1B; border: 1px solid #FCA5A5; }
  .order-badge.wifi { background: #D1FAE5; color: #065F46; border: 1px solid #6EE7B7; }
  .order-badge.voip { background: #FEF3C7; color: #92400E; border: 1px solid #FCD34D; }
  
  .order-details { flex: 1; margin: 0; width: 100%; }
  .order-addr { font-size: 14px; color: #374151; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .order-meta { font-size: 12px; color: #6B7280; }
  
  .order-time { 
    text-align: left; /* Left align on mobile */
    display: flex; 
    gap: 12px;
  }
  
  /* Desktop overrides for Order List */
  @media (min-width: 640px) {
    .order-item { 
        flex-direction: row;
        align-items: center; 
        gap: 0;
    }
    .order-details { 
        margin: 0 16px;
        width: auto;
    }
    .order-time { 
        text-align: right; 
        display: block;
    }
  }
  
  .date { font-weight: 700; color: #059669; font-size: 13px; }
  .time { color: #6B7280; font-size: 12px; }

  .bg-dark { background: #111827; border-color: #374151; padding: 0; overflow: hidden; }
  .console-header { 
      background: #1F2937; padding: 12px 24px; color: #9CA3AF; font-size: 12px; font-weight: 700; text-transform: uppercase; 
      border-bottom: 1px solid #374151; display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;
  }
  .console-header:hover { color: #E5E7EB; background: #374151; }
  .console-count { color: #6B7280; font-weight: 400; font-size: 11px; margin-left: 4px; }
  .toggle-icon { transition: transform 0.2s; font-size: 10px; }
  .toggle-icon.rotated { transform: rotate(90deg); }

  .console-body { padding: 16px 24px; height: 200px; overflow-y: auto; font-family: monospace; font-size: 12px; display: flex; flex-direction: column-reverse; border-top: 1px solid #374151; }
  .log-line { margin-bottom: 6px; }
  .log-time { color: #6B7280; margin-right: 8px; }
  .log-msg { color: #34D399; }
  .log-msg.server { color: #60A5FA; } 
  .log-line.muted { color: #4B5563; font-style: italic; }

  .w-4 { width: 16px; }
  .h-4 { height: 16px; }
  .mr-2 { margin-right: 8px; }

  /* Modal Styles */
  .modal-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6); z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(4px);
      padding: 16px;
  }
  .modal-content {
      background: white; width: 100%; max-width: 800px;
      border-radius: 16px; padding: 24px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
      max-height: 90vh;
      overflow-y: auto;
  }
  .modal-header h3 { 
      font-size: 20px; 
      font-weight: 700; 
      color: #111827; 
      margin: 0 0 16px 0; 
  }
  .modal-body p { 
      font-size: 14px; 
      color: #4B5563; 
      margin-bottom: 12px; 
      line-height: 1.5; 
  }
  
  .modal-instruction {
      font-weight: 600;
      color: #374151;
      margin-bottom: 16px !important;
  }
  
  .selection-controls {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      padding: 12px;
      background: #F9FAFB;
      border-radius: 8px;
  }
  
  .select-btn {
      padding: 6px 12px;
      background: white;
      border: 1px solid #D1D5DB;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      color: #374151;
      cursor: pointer;
      transition: all 0.2s;
  }
  
  .select-btn:hover {
      border-color: #F97316;
      color: #F97316;
  }
  
  .selected-count {
      margin-left: auto;
      font-size: 13px;
      font-weight: 600;
      color: #6B7280;
  }
  
  .conflicts-list { 
      background: #F9FAFB;
      border: 1px solid #E5E7EB;
      border-radius: 12px; 
      padding: 16px; 
      margin: 16px 0;
      max-height: 400px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
  }
  
  .conflict-card {
      background: white;
      border: 2px solid #E5E7EB;
      border-radius: 8px;
      transition: all 0.2s;
  }
  
  .conflict-card.selected {
      border-color: #F97316;
      background: #FFF7ED;
  }
  
  .conflict-checkbox-label {
      display: block;
      cursor: pointer;
      padding: 16px;
  }
  
  .conflict-checkbox-label input[type="checkbox"] {
      width: 20px;
      height: 20px;
      margin-right: 12px;
      cursor: pointer;
      accent-color: #F97316;
      float: left;
      margin-top: 4px;
  }
  
  .conflict-content {
      overflow: hidden;
  }
  
  .conflict-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
  }
  
  .conflict-date {
      font-weight: 700;
      color: #111827;
      font-size: 16px;
  }
  
  .conflict-modified {
      color: #9CA3AF;
      font-size: 12px;
      font-style: italic;
  }
  
  .conflict-comparison {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 16px;
      align-items: center;
  }
  
  @media (max-width: 640px) {
      .conflict-comparison {
          grid-template-columns: 1fr;
          gap: 12px;
      }
      .comparison-arrow {
          display: none;
      }
  }
  
  .comparison-side {
      background: #F9FAFB;
      border-radius: 6px;
      padding: 12px;
  }
  
  .comparison-side.your-version {
      border: 2px solid #10B981;
  }
  
  .comparison-side.hns-version {
      border: 2px solid #3B82F6;
  }
  
  .comparison-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
  }
  
  .your-version .comparison-label {
      color: #10B981;
  }
  
  .hns-version .comparison-label {
      color: #3B82F6;
  }
  
  .comparison-arrow {
      font-size: 24px;
      color: #9CA3AF;
      text-align: center;
  }
  
  .comparison-details {
      display: flex;
      flex-direction: column;
      gap: 6px;
  }
  
  .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      position: relative;
  }
  
  .detail-row.changed {
      background: #FEF3C7;
      padding: 4px 6px;
      border-radius: 4px;
      margin: -2px -6px;
  }
  
  .detail-row.address-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
  }
  
  .detail-label {
      font-weight: 600;
      color: #6B7280;
  }
  
  .detail-value {
      color: #111827;
      font-weight: 500;
  }
  
  .detail-value.earnings {
      color: #059669;
      font-weight: 700;
  }
  
  .detail-value.address {
      color: #4B5563;
      font-size: 12px;
      word-break: break-word;
  }
  
  .diff-badge {
      background: #FEE2E2;
      color: #991B1B;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 10px;
      margin-left: 6px;
  }
  
  .conflict-question { 
      font-weight: 600; 
      color: #374151; 
      margin-top: 16px;
      font-size: 14px;
      text-align: center;
      padding: 12px;
      background: #F9FAFB;
      border-radius: 8px;
  }
  .timer-text { 
      font-size: 13px; 
      color: #EA580C; 
      font-weight: 600; 
      margin-top: 8px; 
      text-align: center;
  }
  .timer-bar { 
      width: 100%; 
      height: 6px; 
      background: #FED7AA; 
      border-radius: 3px; 
      overflow: hidden; 
      margin: 12px 0; 
  }
  .timer-fill { 
      height: 100%; 
      background: linear-gradient(90deg, #EA580C, #DC2626);
      transition: width 1s linear; 
  }
  .modal-actions { 
      display: flex; 
      gap: 12px; 
      margin-top: 24px;
      flex-direction: column;
  }

  @media (min-width: 640px) {
      .modal-actions {
          flex-direction: row;
      }
  }

  .btn-primary.safe {
      background: linear-gradient(135deg, #059669 0%, #047857 100%);
  }
  .btn-primary.safe:hover {
      box-shadow: 0 8px 16px rgba(5, 150, 105, 0.3);
  }

  .btn-secondary.danger {
      border-color: #DC2626;
      color: #DC2626;
  }
  .btn-secondary.danger:hover:not(:disabled) {
      background: #DC2626;
      color: white;
  }
  .btn-secondary.danger:disabled {
      opacity: 0.5;
      cursor: not-allowed;
  }

  .flex { display: flex; }
  .items-center { align-items: center; }
  .gap-2 { gap: 8px; }
</style>