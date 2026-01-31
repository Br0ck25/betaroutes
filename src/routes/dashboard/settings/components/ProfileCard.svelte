<script module lang="ts">
  export interface Props {
    profile?: { name?: string; email?: string };
    // Callback props
    onSuccess?: (msg: string) => void;
    onPortal?: () => void;
    onUpgrade?: (plan?: 'generic' | 'export' | 'advanced-export') => void;
    onProfileChange?: (profile: { name: string; email: string }) => void;
  }
</script>

<script lang="ts">
  import CollapsibleCard from '$lib/components/ui/CollapsibleCard.svelte';
  import { auth } from '$lib/stores/auth';
  import { trips } from '$lib/stores/trips';
  import { csrfFetch } from '$lib/utils/csrf';
  import { SvelteDate } from '$lib/utils/svelte-reactivity';

  // Expose component prop types for consumers during migration (instance script required)
  type $$Props = Props & {
    onSuccess?: (msg: string) => void;
    onPortal?: () => void;
    onUpgrade?: (plan?: 'generic' | 'export' | 'advanced-export') => void;
  };

  // Single $props() call — declare props and callbacks (other values derived internally)
  let {
    profile = { name: '', email: '' },
    onSuccess,
    onPortal,
    onUpgrade,
    onProfileChange
  } = $props() as Props & {
    onSuccess?: (msg: string) => void;
    onPortal?: () => void;
    onUpgrade?: (plan?: 'generic' | 'export' | 'advanced-export') => void;
    onProfileChange?: (profile: { name: string; email: string }) => void;
  };

  // Local editable copy of the profile to avoid mutating props directly
  let localProfile = $state<{ name: string; email: string }>({
    name: '',
    email: ''
  });

  // Keep localProfile in sync when parent passes new profile
  $effect(() => {
    if (profile) {
      localProfile.name = profile.name ?? localProfile.name;
      localProfile.email = profile.email ?? localProfile.email;
    }
  });

  // Derived state: compute monthly usage and plan locally to avoid prop coupling
  const monthlyUsage = $derived(
    $trips.filter((t) => {
      if (!t.date) return false;
      const tripDate = SvelteDate.from(t.date).toDate();
      const now = SvelteDate.now().toDate();
      return tripDate.getMonth() === now.getMonth() && tripDate.getFullYear() === now.getFullYear();
    }).length
  );

  const isPro = $derived(
    ['pro', 'business', 'premium', 'enterprise'].includes($auth.user?.plan || '')
  );

  // Local UI state
  let buttonHighlight = $state(false);
  let isOpeningPortal = $state(false);
  let isCheckingOut = $state(false);

  async function handlePortalLocal() {
    if (isOpeningPortal) return;
    isOpeningPortal = true;
    try {
      const res = await csrfFetch('/api/stripe/portal', { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error((json?.message as string) || 'Failed to open portal');
      if (typeof json?.url === 'string') window.location.href = json.url as string;
    } catch (e) {
      console.error(e);
      alert('Could not open billing portal. If you recently upgraded, try refreshing the page.');
      isOpeningPortal = false;
    }
  }

  async function handleUpgradeLocal() {
    if (isCheckingOut) return;
    isCheckingOut = true;
    try {
      const res = await csrfFetch('/api/stripe/checkout', { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error((json?.message as string) || 'Checkout failed');
      if (typeof json?.url === 'string') window.location.href = json.url as string;
    } catch (e) {
      console.error('Checkout error:', e);
      alert('Failed to start checkout. Please try again.');
      isCheckingOut = false;
    }
  }
  async function saveProfile() {
    // Optimistic local update (update app-level auth store)
    auth.updateProfile({ name: localProfile.name, email: localProfile.email });
    try {
      const res = await csrfFetch('/api/user', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: localProfile.name, email: localProfile.email })
      });
      const json = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (
        res.ok &&
        json &&
        typeof json === 'object' &&
        'user' in json &&
        typeof (json as Record<string, unknown>)['user'] === 'object'
      ) {
        // Apply authoritative server values
        const userObj = (json as Record<string, unknown>)['user'] as Record<string, unknown>;
        const name = typeof userObj['name'] === 'string' ? (userObj['name'] as string) : undefined;
        const email =
          typeof userObj['email'] === 'string' ? (userObj['email'] as string) : undefined;
        const updates: { name?: string; email?: string } = {};
        if (typeof name === 'string') updates.name = name;
        if (typeof email === 'string') updates.email = email;
        if (Object.keys(updates).length > 0) auth.updateProfile(updates);

        // Propagate change to parent via callback
        onProfileChange?.({ name: name ?? localProfile.name, email: email ?? localProfile.email });

        onSuccess?.('Profile updated successfully!');
        buttonHighlight = true;
        setTimeout(() => (buttonHighlight = false), 3000);
      } else {
        console.error('Failed to save profile to server', { status: res.status, body: json });
        onSuccess?.('Saved locally (Server error)');
        // still notify parent of local save
        onProfileChange?.({ name: localProfile.name, email: localProfile.email });
        buttonHighlight = true;
        setTimeout(() => (buttonHighlight = false), 3000);
      }
    } catch {
      console.error('Save error: Network issue');
      onSuccess?.('Saved locally (Network error)');
      onProfileChange?.({ name: localProfile.name, email: localProfile.email });
      buttonHighlight = true;
      setTimeout(() => (buttonHighlight = false), 3000);
    }
  }

  function handlePortal() {
    onPortal?.();
  }

  function handleUpgrade() {
    onUpgrade?.('generic');
  }
</script>

<CollapsibleCard title="Profile" subtitle="Your account information" storageKey="settings:profile">
  {#snippet icon()}
    <span>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M10 10C12.7614 10 15 7.76142 15 5C15 2.23858 12.7614 0 10 0C7.23858 0 5 2.23858 5 5C5 7.76142 7.23858 10 10 10Z"
          fill="currentColor"
        />
        <path
          d="M10 12C4.47715 12 0 15.3579 0 19.5C0 19.7761 0.223858 20 0.5 20H19.5C19.7761 20 20 19.7761 20 19.5C20 15.3579 15.5228 12 10 12Z"
          fill="currentColor"
        />
      </svg>
    </span>
  {/snippet}

  <div class="form-group">
    <label for="profile-name">Name</label>
    <input id="profile-name" type="text" bind:value={localProfile.name} placeholder="Your name" />
  </div>

  <div class="form-group">
    <label for="profile-email">Email</label>
    <input
      id="profile-email"
      type="email"
      bind:value={localProfile.email}
      placeholder="your@email.com"
    />
  </div>

  <button class="btn-secondary save-btn" class:highlight={buttonHighlight} onclick={saveProfile}
    >Save Profile</button
  >

  <div class="divider"></div>

  <div class="plan-section">
    <div class="plan-info">
      <label for="plan-badge">Current Plan</label>
      <div class="plan-row">
        <div id="plan-badge" class="plan-badge" style="text-transform: capitalize;">
          {$auth.user?.plan || 'free'} Plan
        </div>

        {#if isPro}
          <button class="upgrade-link-btn" onclick={handlePortal} disabled={isOpeningPortal}>
            {isOpeningPortal ? 'Loading...' : 'Manage Subscription'}
          </button>
        {:else}
          <button class="upgrade-link-btn" onclick={handleUpgrade} disabled={isCheckingOut}>
            {isCheckingOut ? 'Loading...' : 'Upgrade to Pro'}
          </button>
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
</CollapsibleCard>

<style>
  .form-group {
    margin-bottom: 20px;
  }
  .form-group label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
    margin-bottom: 8px;
  }
  .form-group input {
    width: 100%;
    max-width: 450px;
    padding: 12px 16px;
    border: 2px solid #e5e7eb;
    border-radius: 10px;
    font-size: 16px;
    display: block;
    box-sizing: border-box;
  }
  .form-group input:focus {
    outline: none;
    border-color: var(--orange, #ff6a3d);
    box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1);
  }
  .divider {
    height: 1px;
    background: #e5e7eb;
    margin: 24px 0;
  }
  .plan-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 4px;
  }
  .plan-badge {
    display: inline-block;
    padding: 6px 12px;
    background: #f3f4f6;
    color: #374151;
    border-radius: 8px;
    font-weight: 600;
    font-size: 14px;
  }
  .upgrade-link-btn {
    background: none;
    border: none;
    color: var(--orange, #ff6a3d);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    text-decoration: none;
  }
  .upgrade-link-btn:hover {
    text-decoration: underline;
  }
  .usage-stats {
    margin-top: 16px;
  }
  .usage-header {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    color: #6b7280;
    margin-bottom: 6px;
  }
  .progress-bar {
    height: 8px;
    background: #e5e7eb;
    border-radius: 4px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--green, #22c55e);
    border-radius: 4px;
    transition: width 0.3s;
  }
  .progress-fill.warning {
    background: #f59e0b;
  }
  .btn-secondary {
    width: 100%;
    padding: 14px;
    border-radius: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 15px;
    background: white;
    color: #374151;
    border: 2px solid #e5e7eb;
  }
  .btn-secondary:hover {
    border-color: var(--orange, #ff6a3d);
    color: var(--orange, #ff6a3d);
  }
</style>
