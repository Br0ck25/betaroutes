<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Input from '$lib/components/ui/Input.svelte';

  let username = '';
  let password = '';
  let loading = false;
  let orders: any[] = [];
  let isConnected = false;
  let logs: string[] = [];

  function addLog(msg: string) {
    logs = [...logs, `[${new Date().toLocaleTimeString()}] ${msg}`];
    console.log(msg);
  }

  async function loadOrders() {
    addLog('Checking for existing orders...');
    try {
        const res = await fetch(`/api/hughesnet`);
        const data = await res.json();
        if (data.orders) {
            orders = Object.values(data.orders);
            if (orders.length > 0) {
                isConnected = true;
                addLog(`Loaded ${orders.length} cached orders.`);
            } else {
                addLog('No cached orders found.');
            }
        }
    } catch (e) {
        addLog('Error loading orders: ' + e);
    }
  }

  async function handleConnect() {
    loading = true;
    addLog('Attempting connection...');
    
    try {
        const res = await fetch('/api/hughesnet', {
            method: 'POST',
            body: JSON.stringify({ action: 'connect', username, password })
        });
        const data = await res.json();
        
        if (data.success) {
            isConnected = true;
            addLog('Connection successful!');
            await handleSync();
        } else {
            addLog('Connection Failed: ' + (data.error || 'Unknown error'));
            alert(data.error || 'Connection failed');
        }
    } catch (e: any) {
        addLog('Network Error: ' + e.message);
    } finally {
        loading = false;
    }
  }

  async function handleSync() {
    loading = true;
    addLog('Syncing with HughesNet...');
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
        } else {
            addLog('Sync Failed: ' + data.error);
        }
    } catch (e: any) {
        addLog('Sync Error: ' + e.message);
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
            <Button on:click={handleSync} disabled={loading}>
                {loading ? 'Syncing...' : 'Sync Now'}
            </Button>
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
                        <Button on:click={handleConnect} disabled={loading}>
                            {loading ? 'Connecting...' : 'Connect'}
                        </Button>
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
                                    <p class="text-sm text-gray-500">{order.city}, {order.state}</p>
                                </div>
                                <div class="text-right text-sm">
                                    <div class="font-semibold text-green-700">{order.confirmScheduleDate}</div>
                                    <div class="text-gray-500">{order.beginTime}</div>
                                </div>
                            </div>
                        </Card>
                    {/each}
                </div>
             {:else}
                <Card>
                    <div class="text-center py-8 text-gray-500">
                        <p class="mb-4">Connected, but no orders found.</p>
                        <Button on:click={handleSync} disabled={loading}>Check Again</Button>
                    </div>
                </Card>
             {/if}
        {/if}
    </div>

    <div class="mt-8 p-4 bg-gray-100 rounded text-xs font-mono border border-gray-300">
        <h4 class="font-bold mb-2 text-gray-700">Debug Logs:</h4>
        <div class="max-h-32 overflow-y-auto">
            {#each logs as log}
                <div class="mb-1">{log}</div>
            {/each}
            {#if logs.length === 0}
                <span class="text-gray-400">Waiting for actions...</span>
            {/if}
        </div>
    </div>
</div>