<script lang="ts">
  let visible = $state(false);
  let deferredPrompt: { prompt?: () => Promise<void>; userChoice?: { outcome?: string } } | null =
    $state(null);

  $effect(() => {
    const win = window as unknown as { __deferredPWAInstall?: typeof deferredPrompt };

    const handler = (e: Event) => {
      const ev = e as unknown as CustomEvent;
      // If dispatched from +layout, the original event is in ev.detail; otherwise fall back to window storage
      deferredPrompt =
        (ev?.detail as typeof deferredPrompt) ??
        win.__deferredPWAInstall ??
        (ev as unknown as typeof deferredPrompt);
      visible = true;
    };

    window.addEventListener('pwa:beforeinstallprompt', handler);

    // if the prompt was stored directly on window (registration path), pick it up
    if (win.__deferredPWAInstall) {
      deferredPrompt = win.__deferredPWAInstall;
      visible = true;
    }

    const onInstalled = () => {
      visible = false;
    };

    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('pwa:beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', onInstalled);
    };
  });

  async function install() {
    const win = window as unknown as { __deferredPWAInstall?: typeof deferredPrompt };
    if (!deferredPrompt && win.__deferredPWAInstall) deferredPrompt = win.__deferredPWAInstall;
    if (!deferredPrompt) return;

    try {
      if (deferredPrompt.prompt) {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          visible = false;
        }
      }
    } catch (err) {
      console.warn('PWA install prompt failed:', err);
    } finally {
      deferredPrompt = null;
      win.__deferredPWAInstall = null;
    }
  }
</script>

{#if visible}
  <div class="pwa-install" role="status" aria-live="polite">
    <button class="btn-install" onclick={install} aria-label="Install Go Route Yourself"
      >Install app</button
    >
  </div>
{/if}

<style>
  .pwa-install {
    position: fixed;
    bottom: 1.25rem;
    right: 1.25rem;
    z-index: 60;
  }
  .btn-install {
    background: var(--color-primary, #0369a1); /* darker blue for accessible white text */
    color: white;
    padding: 0.5rem 1rem;
    min-height: 48px;
    min-width: 48px;
    line-height: 1;
    border-radius: 8px;
    font-weight: 600;
    box-shadow: 0 6px 20px rgba(2, 6, 23, 0.12);
  }
</style>
