<script lang="ts">
  import Footer from '$lib/components/layout/Footer.svelte';
  import '../app.css';
  // PWAInstall removed per user request
  import { page } from '$app/state';
  import { env } from '$env/dynamic/public';
  import { trips } from '$lib/stores/trips';
  import { expenses } from '$lib/stores/expenses';
  import { mileage } from '$lib/stores/mileage';
  import { trash } from '$lib/stores/trash';
  import { auth } from '$lib/stores/auth';
  import { setUserContext } from '$lib/stores/user.svelte';
  import { syncManager } from '$lib/sync/syncManager';
  const { data, children } = $props();

  // 1. Initialize Context
  const userState = setUserContext(undefined);
  // Initialize with current value via reactive effect below (keeps capture correct)
  // 2. Keep user state synced
  $effect(() => {
    userState.setUser(data.user);
  });

  // 3. Initialize Sync & Wire to UI Store (client-only $effect replacement for onMount)
  $effect(() => {
    let beforeinstallHandler: ((e: Event) => void) | undefined;
    let appinstalledHandler: (() => void) | undefined;
    let swUpdateFoundHandler: ((e: Event) => void) | undefined;

    (async () => {
      // Load local data immediately (awaited)
      await trips.load();

      // If we have an authenticated user, wire sync manager and start background loads
      const userId = (data?.user as { id?: string } | undefined)?.id;

      if (userId) {
        // Connect SyncManager to the UI Store
        syncManager.setStoreUpdater((enrichedTrip) => {
          trips.updateLocal(enrichedTrip);
        });

        // Access key via public env binding
        const apiKey = env.PUBLIC_GOOGLE_MAPS_KEY as string | undefined;

        if (apiKey) {
          syncManager.initialize(apiKey);
        } else {
          console.warn('Google Maps API Key missing in environment variables.');
        }

        // Defer heavy initialization until after first paint so the LCP can render quickly
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

        const doInit = async () => {
          try {
            console.log('[LAYOUT] Loading data for:', userId);

            // Kick off loads without awaiting them (explicitly ignored with void)
            void trips.load(userId);
            void expenses.load(userId);
            void mileage.load(userId);
            void trash.load(userId);

            // Background syncs (fire-and-forget)
            void trips.syncFromCloud(userId);
            void expenses.syncFromCloud(userId);
            void mileage.syncFromCloud(userId);
          } catch (err) {
            console.error('[LAYOUT] Failed to start data load:', err);
          }
        };

        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
          (requestIdleCallback as any)(() => void doInit().catch(console.error));
        } else {
          setTimeout(() => void doInit().catch(console.error), 0);
        }
      } else {
        await auth.init();
      }

      // Register service worker (if supported) and wire install prompt
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.register('/service-worker.js');
          console.log('Service worker registered:', reg);

          // Detect when a new SW is found (useful to prompt user to refresh)
          swUpdateFoundHandler = () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed') {
                  // New content is available; notify the app if needed
                  console.log('New service worker installed.');
                }
              });
            }
          };

          reg.addEventListener('updatefound', swUpdateFoundHandler);
        } catch (err) {
          console.warn('Service worker registration failed:', err);
        }
      }

      // Handle beforeinstallprompt so the UI can offer a custom install flow
      if (typeof window !== 'undefined') {
        beforeinstallHandler = (e: Event) => {
          const ev = e as any;
          ev.preventDefault(); // prevent automatic browser prompt
          // store the event so other parts of the app can trigger the prompt
          (window as any).__deferredPWAInstall = ev;
          // dispatch the original event as detail so consumers can call prompt()
          window.dispatchEvent(new CustomEvent('pwa:beforeinstallprompt', { detail: ev }));
        };

        appinstalledHandler = () => console.log('PWA installed');

        window.addEventListener('beforeinstallprompt', beforeinstallHandler);
        window.addEventListener('appinstalled', appinstalledHandler);
      }
    })().catch(console.error);

    return () => {
      // cleanup
      if (typeof window !== 'undefined') {
        if (beforeinstallHandler)
          window.removeEventListener('beforeinstallprompt', beforeinstallHandler);
        if (appinstalledHandler) window.removeEventListener('appinstalled', appinstalledHandler);
        // remove SW updatefound handler if registered (best-effort)
        try {
          if (
            swUpdateFoundHandler &&
            'serviceWorker' in navigator &&
            navigator.serviceWorker?.getRegistrations
          ) {
            void navigator.serviceWorker.getRegistrations().then((regs) => {
              regs.forEach((r) => {
                try {
                  r.removeEventListener?.('updatefound', swUpdateFoundHandler as any);
                } catch (e) {
                  void e;
                }
              });
            });
          }
        } catch (e) {
          void e;
        }
      }
    };
  });
</script>

<div class="flex flex-col min-h-dvh bg-neutral-bg-primary font-inter text-neutral-primary">
  <main class="flex-grow w-full">
    {@render children()}
  </main>

  {#if page.url.pathname !== '/'}
    <Footer class="hidden tablet:block" />
  {/if}
</div>
