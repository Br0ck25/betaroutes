<script lang="ts">
	// FIX: Use a single $props() call with $bindable() and pull immutable props from rest.
	// 'open' must be declared with let because it's bindable and may be mutated.
	/* eslint-disable-next-line prefer-const */
	let { open = $bindable(false), ...rest } = $props();
	const { title, children } = rest;

	// REMOVED: previous multiple $props() calls
	// REMOVED: let open = _open;

	let dialog: HTMLDialogElement;

	// Sync Svelte state with the Native DOM API
	$effect(() => {
		if (dialog) {
			// Now 'open' is reactive and this effect will run when the parent changes it
			if (open && !dialog.open) {
				dialog.showModal();
			} else if (!open && dialog.open) {
				dialog.close();
			}
		}
	});

	// Handle native close events (e.g. Escape key)
	function handleBackdropClick(e: MouseEvent) {
		// ... (Rest of your existing code is fine) ...
		try {
			const path: unknown[] = (e as MouseEvent & { composedPath?: () => EventTarget[] })
				.composedPath
				? (e as MouseEvent & { composedPath?: () => EventTarget[] }).composedPath!()
				: [e.target];
			const hasPac = path.some((el) => {
				if (!el || typeof el !== 'object') return false;
				const candidate = el as { classList?: DOMTokenList };
				return !!(candidate.classList && candidate.classList.contains('pac-container'));
			});

			if (hasPac) return;
		} catch (_err: unknown) {
			void _err;
		}

		if (e.target === dialog) {
			dialog.close();
		}
	}

	function onDialogClose() {
		try {
			const meta = dialog as unknown as { __suppressClose?: boolean };
			if (meta.__suppressClose) {
				meta.__suppressClose = false;
				try {
					dialog.showModal();
				} catch (_e: unknown) {
					void _e;
				}
				return;
			}
		} catch (_e: unknown) {
			void _e;
		}

		// This effectively updates the parent variable because 'open' is $bindable
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
			<h3 class="modal-title">
				{title || 'Dialog'}
			</h3>
			<button
				onclick={() => dialog.close()}
				class="rounded-md p-2 hover:bg-neutral-100 transition-colors text-neutral-500 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
				aria-label="Close"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M18 6 6 18" /><path d="m6 6 12 12" />
				</svg>
			</button>
		</div>

		<div class="p-6 overflow-y-auto modal-body">
			{#if children}
				{@render children()}
			{/if}
		</div>
	</div>
</dialog>

<style>
	/* Styles remain exactly the same */
	dialog {
		margin: auto;
		inset: 0;
	}
	dialog::backdrop {
		background-color: rgb(0 0 0 / 0.5);
	}
	.modal-title {
		font-size: 1.125rem;
		font-weight: 700;
		color: #111827;
		margin: 0;
	}
	.modal-body {
		padding-top: 12px;
		padding-bottom: 12px;
		line-height: 1.4;
		color: #374151;
	}
	:global(.modal-actions) {
		display: flex;
		gap: 12px;
		margin-top: 20px;
	}
	:global(.modal-actions) :global(button),
	:global(.modal-actions) button {
		flex: 1;
		padding: 12px 16px;
		border-radius: 10px;
		font-weight: 600;
	}
	.modal-body :global(input),
	.modal-body :global(select),
	.modal-body :global(textarea) {
		padding: 10px 12px;
		border: 2px solid #e5e7eb;
		border-radius: 8px;
		font-size: 14px;
	}
</style>
