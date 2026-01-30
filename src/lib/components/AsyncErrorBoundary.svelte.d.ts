import type { SvelteComponent } from 'svelte';

// Minimal component type so consumers can bind:this and pass typed props
export default class AsyncErrorBoundary extends SvelteComponent {
  $$prop_def: {
    children?: unknown;
    loading?: unknown;
    error?: (opts: { error: Error; retry: () => void }) => unknown;
    onRetry?: () => void | Promise<void>;
  };

  setLoading(): void;
  setSuccess(): void;
  setError(err: Error): void;
}
