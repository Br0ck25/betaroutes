<script lang="ts">
  import { onMount } from 'svelte';
  import { trips } from '$lib/stores/trips';
  import { trash } from '$lib/stores/trash';
  import { user } from '$lib/stores/auth';
  
  import ConnectionStatus from '$lib/components/hughesnet/ConnectionStatus.svelte';
  import ConfigForm from '$lib/components/hughesnet/ConfigForm.svelte';
  import OrderList from '$lib/components/hughesnet/OrderList.svelte';
  import DebugConsole from '$lib/components/hughesnet/DebugConsole.svelte';

  // State
  let orders: any[] = [];
  let isConnected = false;
  let logs: string[] = [];
  let showConsole = false;
  let loading = false;
  let currentBatch = 0;
  let statusMessage = 'Sync Now';

  // Configuration
  let installPay = 150;
  let repairPay = 80;
  let upgradePay = 80;
  let poleCost = 0;
  let concreteCost = 0;
  let poleCharge = 0;
  let installTime = 90;
  let repairTime = 60;
  let overrideTimes = false;

  let showSuccess = false;
  let successMessage = '';

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

  async function loadOrders() {
    addLog('Checking cache for existing orders...');
    try {
        const res = await fetch(`/api/hughesnet`);
        const data = await res.json();
        
        if (data.config) {
            installPay = data.config.installPay ?? installPay;
            repairPay = data.config.repairPay ?? repairPay;
            upgradePay = data.config.upgradePay ?? upgradePay;
            poleCost = data.config.poleCost ?? poleCost;
            concreteCost = data.config.concreteCost ?? concreteCost;
            poleCharge = data.config.poleCharge ?? poleCharge;
        }

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

  async function handleConnect(event: CustomEvent) {
    const { username, password } = event.detail;
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
    } catch (e: any) { addLog('Error: ' + e.message);
    } finally { loading = false; }
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
                installPay, repairPay, upgradePay,
                poleCost, concreteCost, poleCharge, 
                installTime, repairTime, overrideTimes,
                skipScan 
            })
        });
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
             
             // [!code fix] Use ID first, then fallback
             const userId = $user?.id || $user?.name || $user?.token;
             if (userId) {
                addLog('Downloading generated trips...');
                // This triggers the local store to fetch the new data from the API
                await trips.syncFromCloud(userId);
                addLog('Trips updated locally.');
             }

        } else {
            addLog('Sync Failed: ' + data.error);
        }
    } catch (e: any) {
        addLog('Sync Error: ' + e.message);
    } finally {
       if (currentBatch === 0) loading = false;
       statusMessage = 'Sync Now';
    }
    
    if (currentBatch === 0) loading = false;
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
          
          const userId = $user?.id || $user?.name || $user?.token;
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

  onMount(loadOrders);
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
    <ConnectionStatus 
        {isConnected} 
        ordersCount={orders.length}
        {loading}
        {statusMessage}
        {currentBatch}
        on:connect={handleConnect}
        on:disconnect={handleDisconnect}
        on:sync={() => handleSync(1)}
        on:clear={handleClear}
    />

    {#if isConnected}
        <ConfigForm 
            bind:installPay bind:repairPay bind:upgradePay
            bind:poleCost bind:concreteCost bind:poleCharge
            bind:installTime bind:repairTime bind:overrideTimes
        />
    {/if}
    
    {#if isConnected && orders.length > 0}
        <OrderList {orders} />
    {/if}
    
    <DebugConsole {logs} bind:showConsole />

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
  
  @media (max-width: 768px) {
    .settings-grid { grid-template-columns: 1fr; }
  }
</style>