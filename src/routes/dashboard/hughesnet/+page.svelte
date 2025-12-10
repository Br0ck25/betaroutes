<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  
  // NEW IMPORTS for Immediate Syncing
  import { trips } from '$lib/stores/trips';
  import { trash } from '$lib/stores/trash';
  import { user } from '$lib/stores/auth';

  let username = '';
  let password = '';
  let loading = false;
  let orders: any[] = [];
  let isConnected = false;
  let logs: string[] = [];

  function addLog(msg: string) {
    logs = [`[${new Date().toLocaleTimeString()}] ${msg}`, ...logs];
    console.log('[HNS UI]', msg);
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
    addLog('Connect button clicked. Sending request...');
    if (!username || !password) {
        alert('Please enter username and password');
        return;
    }

    loading = true;
    
    try {
        const res = await fetch('/api/hughesnet', {
            method: 'POST',
            body: JSON.stringify({ action: 'connect', username, password })
        });
        const data = await res.json();

        if (data.success) {
            isConnected = true;
            addLog('Login successful! Starting sync...');
            await handleSync();
        } else {
            addLog('Login Failed: ' + (data.error || 'Unknown error'));
            alert('Login Failed: ' + (data.error || 'Check logs'));
        }
    } catch (e: any) {
        addLog('Network Error: ' + e.message);
    } finally {
        loading = false;
    }
  }

  async function handleSync() {
    loading = true;
    addLog('Syncing orders...');
    try {
        const res = await fetch('/api/hughesnet', {
            method: 'POST',
            body: JSON.stringify({ action: 'sync' })
        });
        const data = await res.json();
        
        if (data.success) {
             const newOrders = data.orders || [];
             orders = newOrders;
             isConnected = true;
             addLog(`Sync complete. Found ${newOrders.length} orders.`);
             
             // --- SYNC FIX: Pull the newly created trips to local DB ---
             const userId = $user?.name || $user?.token;
             if (userId) {
                addLog('Downloading generated trips...');
                await trips.syncFromCloud(userId);
                addLog('Trips updated locally.');
             }

        } else {
            addLog('Sync Failed: ' + data.error);
        }
    } catch (e: any) {
        addLog('Sync Error: ' + e.message);
    } finally {
        loading = false;
    }
  }

  async function handleClear() {
      if (!confirm('Are you sure you want to delete ALL HughesNet trips? This cannot be undone.')) return;
      loading = true;
      addLog('Clearing HNS trips...');
      try {
          const res = await fetch('/api/hughesnet', {
              method: 'POST',
              body: JSON.stringify({ action: 'clear' })
          });
          const data = await res.json();
          addLog(`Cleared ${data.count} trips.`);
          
          // --- SYNC FIX: Sync Trash to remove them locally ---
          // Because we moved them to Trash on server, syncing trash will delete them from local active trips
          const userId = $user?.name || $user?.token;
          if (userId) {
              addLog('Syncing removal with local database...');
              await trash.syncFromCloud(userId);
              addLog('Local trips cleaned up.');
          }

          // Reload to reflect empty state
          await loadOrders();
      } catch (e: any) {
          addLog('Clear Error: ' + e.message);
      } finally {
          loading = false;
      }
  }

  onMount(loadOrders);
</script>

<div class="p-6 max-w-4xl mx-auto">
    <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold text-gray-900">HughesNet Dashboard</h1>
        {#if isConnected}
            <div class="flex gap-2">
                <button 
                    class="px-4 py-2 rounded-md font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                    on:click={handleClear} 
                    disabled={loading}
                >
                    Reset HNS Trips
                </button>
                <button 
                    class="px-4 py-2 rounded-md font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                    on:click={handleSync} 
                    disabled={loading}
                >
                    {loading ? 'Syncing...' : 'Sync Now'}
                </button>
            </div>
        {/if}
    </div>

    <div class="grid gap-6">
        {#if !isConnected && orders.length === 0}
            <Card>
                <h2 class="text-xl font-semibold mb-4">Connect Account</h2>
                <div class="space-y-4">
                    <Input label="Username" bind:value={username} placeholder="Username" />
                    <Input type="password" label="Password" bind:value={password} placeholder="Password" />
                    <div class="pt-2">
                        <button 
                            class="w-full px-4 py-2 rounded-md font-semibold text-white bg-green-600 hover:bg-green-700 shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            on:click={handleConnect}
                            disabled={loading}
                        >
                            {loading ? 'Connecting...' : 'Connect & Sync'}
                        </button>
                    </div>
                </div>
            </Card>
        
        {:else}
            {#if orders.length > 0}
                <div class="grid gap-4">
                    {#each orders as order}
                        <Card>
                            <div class="flex justify-between">
                                <div>
                                    <h3 class="font-bold">Order #{order.id}</h3>
                                    <p class="text-sm text-gray-600">{order.address}</p>
                                    <p class="text-sm text-gray-500">{order.city}, {order.state} {order.zip}</p>
                                </div>
                                <div class="text-right text-sm">
                                    <div class="font-semibold text-green-700">{order.confirmScheduleDate || 'No Date'}</div>
                                    <div class="text-gray-500">{order.beginTime || 'No Time'}</div>
                                </div>
                            </div>
                        </Card>
                    {/each}
                </div>
             {:else}
                <Card>
                    <div class="text-center py-8 text-gray-500">
                        <p class="mb-4">Connected, but no orders found.</p>
                        <button 
                            class="px-4 py-2 text-sm border rounded hover:bg-gray-50"
                            on:click={handleSync} 
                            disabled={loading}
                        >
                            Check Again
                        </button>
                    </div>
                </Card>
             {/if}
        {/if}
    </div>

    <div class="mt-8 p-4 bg-gray-900 text-green-400 rounded text-xs font-mono border border-gray-700">
        <h4 class="font-bold mb-2 text-white border-b border-gray-700 pb-1">Debug Console:</h4>
        <div class="h-32 overflow-y-auto flex flex-col-reverse">
            {#each logs as log}
                <div class="mb-1">{log}</div>
            {/each}
            {#if logs.length === 0}
                <span class="text-gray-600">Waiting for actions...</span>
            {/if}
        </div>
    </div>
</div>