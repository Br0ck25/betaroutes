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

  async function loadOrders() {
    const res = await fetch(`/api/hughesnet`);
    const data = await res.json();
    if (data.orders) {
        orders = Object.values(data.orders);
        isConnected = orders.length > 0;
    }
  }

  async function handleConnect() {
    loading = true;
    try {
        const res = await fetch('/api/hughesnet', {
            method: 'POST',
            body: JSON.stringify({ action: 'connect', username, password })
        });
        const data = await res.json();
        if (data.success) {
            alert('Connected! Syncing orders...');
            await handleSync();
        } else {
            alert('Connection failed. Check credentials.');
        }
    } catch (e) {
        console.error(e);
        alert('Error connecting');
    } finally {
        loading = false;
    }
  }

  async function handleSync() {
    loading = true;
    try {
        const res = await fetch('/api/hughesnet', {
            method: 'POST',
            body: JSON.stringify({ action: 'sync' })
        });
        await loadOrders();
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