<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import { user } from '$lib/stores/auth';

  let username = '';
  let password = '';
  let loading = false;
  let orders: any[] = [];
  let isConnected = false;
  let errorMessage = ''; // New error state

  async function loadOrders() {
    try {
        const res = await fetch(`/api/hughesnet`);
        const data = await res.json();
        if (data.orders) {
            orders = Object.values(data.orders);
            isConnected = orders.length > 0;
        }
    } catch (e) {
        console.warn('Could not load orders:', e);
    }
  }

  async function handleConnect() {
    console.log('Button clicked: handleConnect');
    loading = true;
    errorMessage = '';
    
    try {
        const res = await fetch('/api/hughesnet', {
            method: 'POST',
            body: JSON.stringify({ action: 'connect', username, password })
        });
        
        const data = await res.json();
        console.log('API Response:', data);

        if (data.success) {
            alert('Connected! Syncing orders...');
            await handleSync();
        } else {
            // Show the specific error from the server
            errorMessage = data.error || 'Connection failed. Check credentials.';
        }
    } catch (e: any) {
        console.error('Fetch error:', e);
        errorMessage = 'Network error: ' + e.message;
    } finally {
        loading = false;
    }
  }

  async function handleSync() {
    loading = true;
    errorMessage = '';
    try {
        const res = await fetch('/api/hughesnet', {
            method: 'POST',
            body: JSON.stringify({ action: 'sync' })
        });
        const data = await res.json();
        if (data.success && data.orders) {
             orders = data.orders; // Update list immediately
        }
        await loadOrders();
    } catch (e: any) {
        errorMessage = 'Sync failed: ' + e.message;
    } finally {
        loading = false;
    }
  }

  onMount(loadOrders);
</script>

<div class="p-6 max-w-4xl mx-auto">
    <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold text-gray-900">HughesNet Orders</h1>
        {#if isConnected || orders.length > 0}
            <Button on:click={handleSync} disabled={loading}>
                {loading ? 'Syncing...' : 'Sync Now'}
            </Button>
        {/if}
    </div>

    {#if errorMessage}
        <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
            <strong class="font-bold">Error:</strong>
            <span class="block sm:inline">{errorMessage}</span>
        </div>
    {/if}

    <div class="grid gap-6">
        {#if !isConnected && orders.length === 0}
            <Card>
                <h2 class="text-xl font-semibold mb-4">Connect Account</h2>
                <div class="space-y-4">
                    <Input label="Username" bind:value={username} placeholder="HNS Username" />
                    <Input type="password" label="Password" bind:value={password} placeholder="HNS Password" />
                    <div class="pt-2">
                        <Button on:click={handleConnect} disabled={loading}>
                            {loading ? 'Connecting...' : 'Connect & Sync'}
                        </Button>
                    </div>
                </div>
            </Card>
        {/if}

        {#if orders.length > 0}
            <div class="grid gap-4">
                {#each orders as order}
                    <Card>
                        <div class="flex justify-between items-start">
                            <div>
                                <h3 class="font-bold text-lg">Order #{order.id}</h3>
                                <p class="text-gray-600">{order.address}</p>
                                <p class="text-gray-500 text-sm">{order.city}, {order.state}</p>
                            </div>
                            <div class="text-right">
                                <span class="inline-block px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                                    {order.confirmScheduleDate || 'Unscheduled'}
                                </span>
                                <div class="text-xs text-gray-500 mt-1">
                                    {order.beginTime || 'No time'}
                                </div>
                            </div>
                        </div>
                    </Card>
                {/each}
            </div>
        {:else if isConnected}
            <div class="text-center text-gray-500 py-10">
                <p>No orders found. Try syncing again.</p>
            </div>
        {/if}
    </div>
</div>