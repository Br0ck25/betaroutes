<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { createEventDispatcher } from 'svelte';
  import CollapsibleCard from '$lib/components/ui/CollapsibleCard.svelte';
  import { csrfFetch } from '$lib/utils/csrf';

  interface Props {
    profile: { name: string; email: string };
    monthlyUsage: number;
    isPro: boolean;
    isOpeningPortal?: boolean;
    isCheckingOut?: boolean;
  }

  let {
    profile = $bindable(),
    monthlyUsage,
    isPro,
    isOpeningPortal = false,
    isCheckingOut = false
  }: Props = $props();

  const dispatch = createEventDispatcher();
  let buttonHighlight = $state(false);

  async function saveProfile() {
    // Optimistic local update
    auth.updateProfile({ name: profile.name, email: profile.email });
    try {
      const res = await csrfFetch('/api/user', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: profile.name, email: profile.email })
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
        dispatch('success', 'Profile updated successfully!');
        buttonHighlight = true;
        setTimeout(() => (buttonHighlight = false), 3000);
      } else {
        console.error('Failed to save profile to server', { status: res.status, body: json });
        dispatch('success', 'Saved locally (Server error)');
        buttonHighlight = true;
        setTimeout(() => (buttonHighlight = false), 3000);
      }
    } catch {
      console.error('Save error: Network issue');
      dispatch('success', 'Saved locally (Network error)');
      buttonHighlight = true;
      setTimeout(() => (buttonHighlight = false), 3000);
    }
  }

  function handlePortal() {
    dispatch('portal');
  }

  function handleUpgrade() {
    dispatch('upgrade', 'generic');
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
    <input id="profile-name" type="text" bind:value={profile.name} placeholder="Your name" />
  </div>

  <div class="form-group">
    <label for="profile-email">Email</label>
    <input
      id="profile-email"
      type="email"
      bind:value={profile.email}
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
