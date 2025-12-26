<script lang="ts">
  // Use $bindable for two-way binding on 'open'
  let { open = $bindable(false), title, children } = $props();
  let dialog: HTMLDialogElement;

  // Sync Svelte state with the Native DOM API
  $effect(() => {
    if (dialog) {
        if (open && !dialog.open) {
            dialog.showModal();
        } else if (!open && dialog.open) {
            dialog.close();
        }
    }
  });

  // Handle native close events (e.g. Escape key) — implementation below to allow suppression during autocomplete selection.

  // Close when clicking the backdrop
  function handleBackdropClick(e: MouseEvent) {
    // Debug: log composedPath in browsers where issues appear
    try {
      const path: any[] = (e as any).composedPath ? (e as any).composedPath() : [e.target];
      const hasPac = path.some((el) => el && el.classList && el.classList.contains && el.classList.contains('pac-container'));
      console.debug && console.debug('[modal] backdrop click', { target: e.target, hasPac, path });

      // If the click originated inside the autocomplete dropdown, ignore it so
      // selecting suggestions doesn't close the dialog.
      if (hasPac) return;
    } catch (err) { /* ignore debug errors */ }

    // In a native dialog, the backdrop is considered part of the dialog element
    // but the content is inside. If the target is the dialog itself, it's a backdrop click.
    if (e.target === dialog) {
        dialog.close();
    }
  }

  function onDialogClose() {
    // If we have a temporary suppression flag set (by the autocomplete selection),
    // reopen and clear it rather than letting the modal stay closed.
    try {
      if ((dialog as any).__suppressClose) {
        (dialog as any).__suppressClose = false;
        console.debug && console.debug('[modal] suppressed close - reopening');
        try { dialog.showModal(); } catch(e) { /* ignore */ }
        return;
      }
    } catch(e) { /* ignore */ }

    open = false;
  }
</script>

<dialog
  bind:this={dialog}
  onclose={() => onDialogClose()}
  onclick={handleBackdropClick}
  class="
    m-auto p-0 rounded-xl bg-white text-left shadow-xl w-full max-w-lg
    backdrop:bg-black/50 backdrop:backdrop-blur-sm
    open:animate-in open:fade-in-0 open:zoom-in-95
    closed:animate-out closed:fade-out-0 closed:zoom-out-95
    border border-neutral-200
  "
  style="max-height: calc(85vh - env(safe-area-inset-bottom, 20px));"
>
  <div class="relative flex flex-col h-full overflow-hidden">
    <div class="flex items-center justify-between px-6 py-4 border-b border-neutral-100 shrink-0">
      <h3 class="text-lg font-semibold text-neutral-900 leading-none tracking-tight">
        {title || 'Dialog'}
      </h3>
      <button 
        onclick={() => dialog.close()}
        class="rounded-md p-1 hover:bg-neutral-100 transition-colors text-neutral-500 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
        aria-label="Close"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
        </svg>
      </button>
    </div>

    <div class="p-6 overflow-y-auto">
      {@render children?.()}
    </div>
  </div>
</dialog>

<style>
  /* Reset default browser dialog styles */
  dialog {
    margin: auto; /* Centers the dialog */
    inset: 0;
  }
  
  dialog::backdrop {
    /* Tailwind 'backdrop:' utility covers this, but explicit inheritance ensures safety */
    background-color: rgb(0 0 0 / 0.5);
  }
</style>