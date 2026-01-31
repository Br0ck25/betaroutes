<script lang="ts">
  import { resolve } from '$app/paths';
  import Button from '$lib/components/ui/Button.svelte';
  import CollapsibleCard from '$lib/components/ui/CollapsibleCard.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { user } from '$lib/stores/auth';
  import { trips } from '$lib/stores/trips';
  import { userSettings } from '$lib/stores/userSettings';
  import { csrfFetch } from '$lib/utils/csrf';
  import { SvelteDate } from '$lib/utils/svelte-reactivity';
  import ExportModal from './components/ExportModal.svelte';
  import MaintenanceCard from './components/MaintenanceCard.svelte';
  import ProfileCard from './components/ProfileCard.svelte';
  import SecurityCard from './components/SecurityCard.svelte';
  import SettingsLayout from './SettingsLayout.svelte';

  interface LoadData {
    remoteSettings?: {
      settings?: Record<string, unknown>;
      profile?: { name?: string; email?: string };
    };
  }

  // Props (runes pattern)
  const { data } = $props<{ data?: LoadData }>();

  // --- REMOTE SYNC LOGIC ---
  $effect(() => {
    if (data?.remoteSettings?.settings) {
      const merged = { ...$userSettings, ...data.remoteSettings!.settings };
      // runtime-validated partial settings merge; full shape enforced elsewhere
      // @ts-expect-error: merging partial remote settings into typed settings (validated elsewhere)
      userSettings.set(merged as unknown as Settings);
    }
  });

  const profile = $state<{ name: string; email: string }>({ name: '', email: '' }); // typed state for profile

  // Keep profile in sync with server-side remote settings or auth user when available
  $effect(() => {
    if ($user || data?.remoteSettings?.profile) {
      const remote = data?.remoteSettings?.profile || {};
      // Prefer explicit display name or email. Never use the internal UUID as a fallback.
      if (!profile.name) profile.name = String(remote.name ?? $user?.name ?? $user?.email ?? '');
      if (!profile.email) profile.email = String(remote.email ?? $user?.email ?? '');
    }
  });

  const _monthlyUsage = $derived(
    $trips.filter((t) => {
      if (!t.date) return false;
      const tripDate = SvelteDate.from(t.date).toDate();
      const now = SvelteDate.now().toDate();
      return tripDate.getMonth() === now.getMonth() && tripDate.getFullYear() === now.getFullYear();
    }).length
  );

  let showSuccess = $state(false);
  let successMessage = $state('');

  function showSuccessMsg(msg: string) {
    successMessage = msg;
    showSuccess = true;
    setTimeout(() => (showSuccess = false), 3000);
  }

  // Upgrade/Pro Logic
  const _isPro = $derived(['pro', 'business', 'premium', 'enterprise'].includes($user?.plan || ''));
  let isUpgradeModalOpen = $state(false);
  let upgradeSource = $state<'generic' | 'export' | 'advanced-export'>('generic');
  let isCheckingOut = $state(false);
  let isOpeningPortal = $state(false);

  async function handleCheckout() {
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

  async function handlePortal() {
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

  // Called when ProfileCard requests an upgrade flow; opens modal with requested source
  function handleUpgradeFromCard(source: 'generic' | 'export' | 'advanced-export' = 'generic') {
    upgradeSource = source;
    isUpgradeModalOpen = true;
  }

  let showAdvancedExport = $state(false);

  // (Export tax bundle logic moved to utilities or the ExportModal component.)
</script>

<svelte:head>
  <title>Settings - Go Route Yourself</title>
  <style>
    .pac-container {
      z-index: 10000 !important;
      pointer-events: auto !important;
    }
    :root {
      --orange: #ff6a3d;
      --green: #22c55e;
      --navy: #1a3a5c;
      --purple: #764a89;
    }
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
        <path
          d="M16.6 5L7.5 14L3.4 10"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      {successMessage}
    </div>
  {/if}

  <SettingsLayout>
    <section id="profile" class="settings-section">
      <!-- Use direct component invocation (Svelte 5: components are dynamic by default) -->
      <!-- @ts-expect-error ProfileCard prop types are in migration; passing profile + callbacks explicitly -->
      <ProfileCard
        {profile}
        onProfileChange={(p: { name: string; email: string }) => {
          profile.name = p.name;
          profile.email = p.email;
          showSuccessMsg('Profile saved');
        }}
        onSuccess={showSuccessMsg}
        onPortal={handlePortal}
        onUpgrade={handleUpgradeFromCard}
      />
    </section>

    <section id="maintenance" class="settings-section">
      <!-- @ts-expect-error MaintenanceCard prop types are in migration; using callback prop -->
      <MaintenanceCard onSuccess={showSuccessMsg} />
    </section>

    <section id="integrations" class="settings-section">
      <CollapsibleCard
        title="Integrations"
        subtitle="Connect external services"
        storageKey="settings:integrations"
      >
        {#snippet icon()}
          <span>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M10 12C11.1046 12 12 11.1046 12 10C12 8.89543 11.1046 8 10 8C8.89543 8 8 8.89543 8 10C8 11.1046 8.89543 12 10 12Z"
                stroke="currentColor"
                stroke-width="2"
              />
              <path
                d="M16.2 12C16.1 12.5 16.3 13 16.7 13.3L16.8 13.4C17.1 13.7 17.3 14.1 17.3 14.5C17.3 14.9 17.1 15.3 16.8 15.6C16.5 15.9 16.1 16.1 15.7 16.1C15.3 16.1 14.9 15.9 14.6 15.6L14.5 15.5C14.2 15.1 13.7 14.9 13.2 15C12.7 15.1 12.4 15.5 12.3 16V16.2C12.3 17.1 11.6 17.8 10.7 17.8C9.8 17.8 9.1 17.1 9.1 16.2V16.1C9 15.5 8.6 15.1 8 15C7.5 15 7 15.2 6.7 15.6L6.6 15.7C6.3 16 5.9 16.2 5.5 16.2C5.1 16.2 4.7 16 4.4 15.7C4.1 15.4 3.9 15 3.9 14.6C3.9 14.2 4.1 13.8 4.4 13.5L4.5 13.4C4.9 13.1 5.1 12.6 5 12.1C4.9 11.6 4.5 11.3 4 11.2H3.8C2.9 11.2 2.2 10.5 2.2 9.6C2.2 8.7 2.9 8 3.8 8H3.9C4.5 7.9 4.9 7.5 5 6.9C5 6.4 4.8 5.9 4.4 5.6L4.3 5.5C4 5.2 3.8 4.8 3.8 4.4C3.8 4 4 3.6 4.3 3.3C4.6 3 5 2.8 5.4 2.8C5.8 2.8 6.2 3 6.5 3.3L6.6 3.4C7 3.8 7.5 4 8 3.9C8.5 3.9 8.8 3.4 8.9 2.9V2.7C8.9 1.8 9.6 1.1 10.5 1.1C11.4 1.1 12.1 1.8 12.1 2.7V2.8C12.1 3.4 12.5 3.8 13.1 3.9C13.6 4 14.1 3.8 14.4 3.4L14.5 3.3C14.8 3 15.2 2.8 15.6 2.8C16 2.8 16.4 3 16.7 3.3C17 3.6 17.2 4 17.2 4.4C17.2 4.8 17 5.2 16.7 5.5L16.6 5.6C16.2 5.9 16 6.4 16.1 6.9C16.2 7.4 16.6 7.7 17.1 7.8H17.3C18.2 7.8 18.9 8.5 18.9 9.4C18.9 10.3 18.2 11 17.3 11H17.2C16.6 11.1 16.2 11.5 16.1 12.1L16.2 12Z"
                stroke="currentColor"
                stroke-width="2"
              />
            </svg>
          </span>
        {/snippet}
        <div class="card-header">
          <div class="card-icon green">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M10 12C11.1046 12 12 11.1046 12 10C12 8.89543 11.1046 8 10 8C8.89543 8 8 8.89543 8 10C8 11.1046 8.89543 12 10 12Z"
                stroke="currentColor"
                stroke-width="2"
              />
              <path
                d="M16.2 12C16.1 12.5 16.3 13 16.7 13.3L16.8 13.4C17.1 13.7 17.3 14.1 17.3 14.5C17.3 14.9 17.1 15.3 16.8 15.6C16.5 15.9 16.1 16.1 15.7 16.1C15.3 16.1 14.9 15.9 14.6 15.6L14.5 15.5C14.2 15.1 13.7 14.9 13.2 15C12.7 15.1 12.4 15.5 12.3 16V16.2C12.3 17.1 11.6 17.8 10.7 17.8C9.8 17.8 9.1 17.1 9.1 16.2V16.1C9 15.5 8.6 15.1 8 15C7.5 15 7 15.2 6.7 15.6L6.6 15.7C6.3 16 5.9 16.2 5.5 16.2C5.1 16.2 4.7 16 4.4 15.7C4.1 15.4 3.9 15 3.9 14.6C3.9 14.2 4.1 13.8 4.4 13.5L4.5 13.4C4.9 13.1 5.1 12.6 5 12.1C4.9 11.6 4.5 11.3 4 11.2H3.8C2.9 11.2 2.2 10.5 2.2 9.6C2.2 8.7 2.9 8 3.8 8H3.9C4.5 7.9 4.9 7.5 5 6.9C5 6.4 4.8 5.9 4.4 5.6L4.3 5.5C4 5.2 3.8 4.8 3.8 4.4C3.8 4 4 3.6 4.3 3.3C4.6 3 5 2.8 5.4 2.8C5.8 2.8 6.2 3 6.5 3.3L6.6 3.4C7 3.8 7.5 4 8 3.9C8.5 3.9 8.8 3.4 8.9 2.9V2.7C8.9 1.8 9.6 1.1 10.5 1.1C11.4 1.1 12.1 1.8 12.1 2.7V2.8C12.1 3.4 12.5 3.8 13.1 3.9C13.6 4 14.1 3.8 14.4 3.4L14.5 3.3C14.8 3 15.2 2.8 15.6 2.8C16 2.8 16.4 3 16.7 3.3C17 3.6 17.2 4 17.2 4.4C17.2 4.8 17 5.2 16.7 5.5L16.6 5.6C16.2 5.9 16 6.4 16.1 6.9C16.2 7.4 16.6 7.7 17.1 7.8H17.3C18.2 7.8 18.9 8.5 18.9 9.4C18.9 10.3 18.2 11 17.3 11H17.2C16.6 11.1 16.2 11.5 16.1 12.1L16.2 12Z"
                stroke="currentColor"
                stroke-width="2"
              />
            </svg>
          </div>
          <div>
            <h2 class="card-title">Integrations</h2>
            <p class="card-subtitle">Connect external services</p>
          </div>
        </div>

        <!-- eslint-disable svelte/no-navigation-without-resolve -->
        <div class="data-actions">
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- using local resolve() helper (base-aware) -->
          <a
            href={resolve('/dashboard/hughesnet')}
            class="action-btn"
            style="text-decoration: none; color: inherit; display:flex; align-items:center; gap:16px; padding:16px; background:#F9FAFB; border:2px solid #E5E7EB; border-radius:12px;"
          >
            <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                style="color: #0D9488;"
              >
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M2 12h20"></path>
                <path
                  d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
                ></path>
              </svg>
              <div>
                <div class="action-title" style="font-weight:600; font-size:15px;">HughesNet</div>
                <div class="action-subtitle" style="color:#6B7280; font-size:13px;">
                  Configure satellite integration
                </div>
              </div>
              <div style="margin-left: auto;">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#9CA3AF"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </div>
            </div>
          </a>
        </div>
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      </CollapsibleCard>
    </section>

    <section id="security" class="settings-section">
      <!-- @ts-expect-error SecurityCard prop types being migrated; using callback prop -->
      <SecurityCard onSuccess={showSuccessMsg} />
    </section>
  </SettingsLayout>
</div>

<!-- @ts-ignore ExportModal prop types being migrated; using callback prop -->
<ExportModal bind:showAdvancedExport onSuccess={showSuccessMsg} />

<Modal bind:open={isUpgradeModalOpen} title="Upgrade to Pro">
  <div class="space-y-6 text-center py-4">
    <div class="mx-auto w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
      <span class="text-3xl">🚀</span>
    </div>

    <h3 class="text-xl font-bold text-gray-900">
      {#if upgradeSource === 'export' || upgradeSource === 'advanced-export'}
        Unlock Advanced Exports
      {:else}
        Unlock Pro Features
      {/if}
    </h3>

    <p class="text-gray-600 text-base leading-relaxed">
      {#if upgradeSource === 'export' || upgradeSource === 'advanced-export'}
        Advanced export features including tax bundles, PDF exports, and comprehensive expense
        tracking are Pro features. Upgrade now to unlock professional-grade data exports!
      {:else}
        Take your business to the next level. Get unlimited trips, powerful route optimization, and
        tax-ready data exports.
      {/if}
    </p>

    <div class="bg-gray-50 p-4 rounded-lg text-left text-sm space-y-2 border border-gray-100">
      <div class="flex items-center gap-2">
        <span class="text-green-500 text-lg">✓</span>
        <span class="text-gray-700">Unlimited Stops per Trip</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-green-500 text-lg">✓</span>
        <span class="text-gray-700">One-Click Route Optimization</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-green-500 text-lg">✓</span>
        <span class="text-gray-700">Unlimited Monthly Trips</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-green-500 text-lg">✓</span>
        <span class="text-gray-700">Advanced Exports (CSV/PDF)</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-green-500 text-lg">✓</span>
        <span class="text-gray-700">Tax Bundle Generation</span>
      </div>
    </div>

    <div class="flex gap-3 justify-center pt-2">
      <Button variant="outline" action={() => (isUpgradeModalOpen = false)}>Maybe Later</Button>
      <Button
        variant="primary"
        className="px-6 py-2.5 text-sm"
        onclick={handleCheckout}
        disabled={isCheckingOut}>{isCheckingOut ? 'Loading...' : 'Upgrade Now'}</Button
      >
    </div>
  </div>
</Modal>

<style>
  .settings {
    max-width: 1400px;
    margin: 0 auto;
    padding: 16px;
    padding-bottom: 80px;
  }
  .page-header {
    margin-bottom: 32px;
  }
  .page-title {
    font-size: 32px;
    font-weight: 800;
    color: #111827;
    margin-bottom: 4px;
  }
  .page-subtitle {
    font-size: 16px;
    color: #6b7280;
  }

  .alert {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 24px;
  }
  .alert.success {
    background: #f0fdf4;
    color: #166534;
    border: 1px solid #bbf7d0;
  }

  /* Section spacing when using the SettingsLayout */
  .settings-section {
    margin-bottom: 24px;
  }

  @media (max-width: 1024px) {
    /* On narrow screens, sections stack naturally and nav becomes horizontal */
    .settings-section {
      margin-bottom: 18px;
    }
  }

  @media (max-width: 640px) {
    .settings {
      padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1px);
    }
  }
</style>
