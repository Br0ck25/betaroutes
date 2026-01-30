<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    children: import('svelte').Snippet;
    fallback?: import('svelte').Snippet<[{ error: Error; reset: () => void }]>;
    onError?: (error: Error, errorInfo?: any) => void;
  }

  const { children, fallback, onError }: Props = $props();

  let hasError = $state(false);
  let error = $state<Error | null>(null);

  // Reset error state
  function reset() {
    hasError = false;
    error = null;
  }

  // Catch errors in child components
  function handleError(err: Error) {
    hasError = true;
    error = err;

    // Log error
    console.error('[ErrorBoundary] Caught error:', err);

    // Call custom error handler if provided
    if (onError) {
      onError(err);
    }
  }

  onMount(() => {
    // Set up global error handler for this component tree
    const originalErrorHandler = window.onerror;

    window.onerror = (message, source, lineno, colno, err) => {
      if (err) {
        handleError(err);
      }
      // Call original handler
      if (originalErrorHandler) {
        return originalErrorHandler(message, source, lineno, colno, err);
      }
      return false;
    };

    return () => {
      window.onerror = originalErrorHandler;
    };
  });
</script>

{#if hasError && error}
  {#if fallback}
    {@render fallback({ error, reset })}
  {:else}
    <!-- Default error UI -->
    <div class="error-boundary">
      <div class="error-boundary-content">
        <div class="error-icon">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h3>Something went wrong</h3>
        <p>{error.message || 'An unexpected error occurred'}</p>
        <button onclick={reset} class="retry-button"> Try Again </button>
      </div>
    </div>
  {/if}
{:else}
  {@render children()}
{/if}

<style>
  .error-boundary {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    padding: 2rem;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    margin: 1rem 0;
  }

  .error-boundary-content {
    text-align: center;
    max-width: 400px;
  }

  .error-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    background: #fee2e2;
    border-radius: 50%;
    color: #dc2626;
    margin-bottom: 1rem;
  }

  h3 {
    margin: 0 0 0.5rem;
    font-size: 1.25rem;
    font-weight: 600;
    color: #991b1b;
  }

  p {
    margin: 0 0 1.5rem;
    color: #7f1d1d;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .retry-button {
    padding: 0.5rem 1rem;
    background: #dc2626;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .retry-button:hover {
    background: #b91c1c;
  }
</style>
