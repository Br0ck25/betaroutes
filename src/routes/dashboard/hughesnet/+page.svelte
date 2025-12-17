<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { trips } from '$lib/stores/trips';
  import { trash } from '$lib/stores/trash';
  import { user } from '$lib/stores/auth';

  let username = '';
  let password = '';
  let loading = false;
  let orders: any[] = [];
  let isConnected = false;
  let logs: string[] = [];
  
  // Console Visibility State
  let showConsole = false;

  // Configuration State - Initialized as undefined so inputs are empty until loaded
  let installPay: number;
  let repairPay: number;
  let upgradePay: number;
  
  // Supply Costs - Initialized as undefined
  let poleCost: number;
  let concreteCost: number;
  let poleCharge: number;

  // Times - Initialized as undefined for KV sync
  let installTime: number; 
  let repairTime: number;
  
  let overrideTimes = false;

  let showSuccess = false;
  let successMessage = '';
  let statusMessage = 'Sync Now';
  
  // Track batch for progress visualization
  let currentBatch = 0;
  
  // Config Sync State
  let isConfigLoaded = false;
  let saveTimeout: any; // Timer for debouncing saves
  let isSaving = false;

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
              // Apply settings if they exist in KV
              installPay = data.settings.installPay;
              repairPay = data.settings.repairPay;
              upgradePay = data.settings.upgradePay;
              poleCost = data.settings.poleCost;
              concreteCost = data.settings.concreteCost;
              poleCharge = data.settings.poleCharge;
              installTime = data.settings.installTime;
              repairTime = data.settings.repairTime;
              addLog('Settings loaded from cloud.');
          }
      } catch (e) {
          console.error('Failed to load settings', e);
      } finally {
          isConfigLoaded = true; // Enable auto-save watcher
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
          poleCost,
          concreteCost,
          poleCharge,
          installTime,
          repairTime
      };

      try {
          await fetch('/api/hughesnet', {
              method: 'POST',
              body: JSON.stringify({ 
                  action: 'save_settings', 
                  settings 
              })
          });
          // Quietly saved
      } catch (e) {
          console.error('Failed to auto-save settings', e);
      } finally {
          isSaving = false;
      }
  }

  // Reactive Watcher: Auto-save when values change (Debounced)
  $: if (isConfigLoaded) {
      // Access all variables to trigger dependency
      const _ = [installPay, repairPay, upgradePay, poleCost, concreteCost, poleCharge, installTime, repairTime];
      
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
          saveSettings();
      }, 1000); // Wait 1 second after typing stops to save
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
    } catch (e: any) { addLog('Error: ' + e.message); }
    finally { loading = false; }
  }

  async function handleSync(batchCount = 1) {
    loading = true;
    currentBatch = batchCount; 
    statusMessage = `Syncing Batch ${batchCount}...`;
    
    const skipScan = batchCount > 1;
    if (batchCount === 1) {
        addLog(`Starting Full Sync...`);
        showConsole = true; 
    } else {
        addLog(`Continuing Sync (Batch ${batchCount})...`);
    }

    try {
        const res = await fetch('/api/hughesnet', {
            method: 'POST',
            body: JSON.stringify({ 
                action: 'sync',
                installPay: installPay || 0,
                repairPay: repairPay || 0,
                upgradePay: upgradePay || 0,
                poleCost: poleCost || 0,
                concreteCost: concreteCost || 0,
                poleCharge: poleCharge || 0, 
                installTime: installTime || 0,
                repairTime: repairTime || 0,
                overrideTimes,
                skipScan 
            })
        });

        // Check content type before parsing
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            addLog(`❌ Server returned HTML instead of JSON (Batch ${batchCount})`);
            addLog(`This usually means the session expired or there was a server error.`);
            addLog(`Please disconnect and reconnect, then try syncing again.`);
            
            // Show user-friendly error
            alert('Session expired or server error. Please disconnect and reconnect.');
            loading = false;
            statusMessage = 'Sync Failed';
            currentBatch = 0;
            return;
        }

        const data = await res.json();
        processServerLogs(data.logs);
        
        if (data.success) {
             const newOrders = data.orders || [];
             orders = newOrders;
             isConnected = true;
             
             if (data.incomplete) {
                 addLog(`Batch ${batchCount} complete. Starting next batch automatically...`);
                 await new Promise(r => setTimeout(r, 1500)); 
                 await handleSync(batchCount + 1);
                 return;
             }

             addLog(`Sync Complete! Processed ${newOrders.length} orders total.`);
             showSuccessMsg(`Synced ${newOrders.length} orders!`);
             statusMessage = 'Sync Complete';
             currentBatch = 0; 
             
             const userId = $user?.name || $user?.token;
             if (userId) {
                addLog('Downloading generated trips...');
                await trips.syncFromCloud(userId);
                addLog('Trips updated locally.');
             }

        } else {
            addLog('Sync Failed: ' + data.error);
            // Check if it's a session error
            if (data.error && (data.error.includes('login') || data.error.includes('Session expired'))) {
                addLog('⚠️ Session expired. Please disconnect and reconnect.');
                alert('Your HughesNet session expired. Please disconnect and reconnect.');
            }
            loading = false;
            statusMessage = 'Sync Failed';
            currentBatch = 0;
        }
    } catch (e: any) {
        addLog('Sync Error: ' + e.message);
        // Handle JSON parse errors specifically
        if (e.message.includes('JSON')) {
            addLog('❌ Server returned invalid response. Session may have expired.');
            alert('Session error. Please disconnect and reconnect.');
        }
        loading = false;
        statusMessage = 'Sync Failed';
        currentBatch = 0;
    } finally {
        // Only set loading = false if we're not recursing
        if (!data || !data.incomplete) {
            loading = false;
            statusMessage = 'Sync Now';
        }
    }
  }

  async function handleClear() {
      if (!confirm('Are you sure you want to delete ALL HughesNet trips? This cannot be undone.')) return;
      loading = true;
      statusMessage = 'Clearing...';
      addLog('Clearing HNS trips...');
      try {
          const res = await fetch('/api/hughesnet', {
              method: 'POST',
              body: JSON.stringify({ action: 'clear' })
          });
          const data = await res.json();
          processServerLogs(data.logs);

          addLog(`Cleared ${data.count} trips.`);
          showSuccessMsg(`Cleared ${data.count} trips.`);
          
          const userId = $user?.name || $user?.token;
          if (userId) {
              addLog('Syncing removal with local database...');
              await trash.syncFromCloud(userId);
              addLog('Local trips cleaned up.');
          }

          await loadOrders();
      } catch (e: any) {
          addLog('Clear Error: ' + e.message);
      } finally {
          loading = false;
          statusMessage = 'Sync Now';
      }
  }

  onMount(() => {
    loadSettings();
    loadOrders();
  });

  onDestroy(() => {
      if (saveTimeout) clearTimeout(saveTimeout);
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
                   <button class="btn-primary" on:click={() => handleSync(1)} disabled={loading}>
                     <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                     {statusMessage}
                   </button>
                   
                   <button class="btn-secondary" on:click={handleDisconnect} disabled={loading}>
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
      </div>
      
      <h3 class="section-label text-red">Supply Costs (Deductions)</h3>
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
                     <span class="order-badge {order.type === 'Install' ? 'blue' : (order.type === 'Upgrade' ? 'green' : 'purple')}">
                        {order.type || 'Unknown'}
                     </span>
                     {#if order.hasPoleMount}
                        <span class="order-badge pole">Pole</span>
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

<style>
  .settings { max-width: 1200px; margin: 0 auto; padding: 20px; }
  .page-header { margin-bottom: 32px; }
  .page-title { font-size: 32px; font-weight: 800; color: #111827; margin-bottom: 4px; }
  .page-subtitle { font-size: 16px; color: #6B7280; }
  
  .alert { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-radius: 12px; font-size: 14px; font-weight: 500; margin-bottom: 24px; }
  .alert.success { background: #F0FDF4; color: #166534; border: 1px solid #BBF7D0; }
  
  .settings-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; }
  .settings-card { background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 24px; }
  .settings-card.full-width { grid-column: span 2; }
  
  @media (max-width: 768px) {
    .settings-grid { grid-template-columns: 1fr; }
    .settings-card.full-width { grid-column: span 1; }
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
  
  .config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  
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
  
  .button-group { display: flex; gap: 12px; }
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
  .order-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border: 1px solid #E5E7EB; border-radius: 10px; background: #F9FAFB; }
  .order-main { display: flex; align-items: center; gap: 10px; }
  .order-id { font-weight: 700; color: #111827; }
  .order-badge { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
  .order-badge.blue { background: #DBEAFE; color: #1E40AF; }
  .order-badge.purple { background: #F3E8FF; color: #6B21A8; }
  .order-badge.green { background: #DCFCE7; color: #15803D; }
  .order-badge.pole { background: #FEE2E2; color: #991B1B; border: 1px solid #FCA5A5; }
  
  .order-details { flex: 1; margin: 0 16px; }
  .order-addr { font-size: 14px; color: #374151; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .order-meta { font-size: 12px; color: #6B7280; }
  
  .order-time { text-align: right; }
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
</style>
