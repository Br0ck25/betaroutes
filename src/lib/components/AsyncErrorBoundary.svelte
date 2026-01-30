<!-- @migration-task Error while migrating Svelte code: can't migrate `let state: 'idle' | 'loading' | 'success' | 'error' = 'idle';` to `$state` because there's a variable named state.
     Rename the variable and try again or migrate by hand. -->
<script lang="ts">
  /**
   * AsyncErrorBoundary - Catches errors in async operations
   * Useful for wrapping data fetching components
   */

  // Use a narrow local props type instead of complex inline generics to avoid parser issues
  type ErrorSnippet = (opts: { error: Error; retry: () => void }) => unknown;

  const _props = $props() as {
    children?: import('svelte').Snippet;
    loading?: unknown;
    error?: ErrorSnippet;
    onRetry?: () => void | Promise<void>;
  };

  const { children, loading, error: errorSnippet, onRetry } = _props;

  let status = $state<'idle' | 'loading' | 'success' | 'error'>('idle');
  let errorMessage = $state<Error | null>(null);

  function retry() {
    status = 'loading';
    errorMessage = null;
    if (onRetry) {
      Promise.resolve(onRetry())
        .then(() => {
          status = 'success';
        })
        .catch((err) => {
          status = 'error';
          errorMessage = err;
        });
    } else {
      status = 'idle';
    }
  }

  export function setLoading() {
    status = 'loading';
    errorMessage = null;
  }

  export function setSuccess() {
    status = 'success';
  }

  export function setError(err: Error) {
    status = 'error';
    errorMessage = err;
  }

  $effect(() => {
    if (status === 'idle') {
      status = 'success';
    }
  });
</script>

{#if status === 'loading'}
  {#if loading}
    {@render (loading as any)()}
  {:else}
    <div class="async-loading">
      <div class="spinner"></div>
      <p>Loading...</p>
    </div>
  {/if}
{:else if status === 'error' && errorMessage}
  {#if errorSnippet}
    {@render (errorSnippet as any)({ error: errorMessage, retry })}
  {:else}
    <div class="async-error">
      <div class="error-icon">⚠️</div>
      <h3>Failed to load</h3>
      <p>{errorMessage.message}</p>
      <button onclick={retry}>Retry</button>
    </div>
  {/if}
{:else}
  {@render children?.()}
{/if}

<style>
  .async-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 2rem;
    color: #6b7280;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #e5e7eb;
    border-top-color: #667eea;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 1rem;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .async-error {
    text-align: center;
    padding: 2rem;
    background: #fef2f2;
    border-radius: 8px;
    border: 1px solid #fecaca;
  }

  .error-icon {
    font-size: 3rem;
    margin-bottom: 0.5rem;
  }

  .async-error h3 {
    margin: 0 0 0.5rem;
    color: #991b1b;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .async-error p {
    margin: 0 0 1.5rem;
    color: #7f1d1d;
    font-size: 0.875rem;
  }

  .async-error button {
    padding: 0.5rem 1.5rem;
    background: #dc2626;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .async-error button:hover {
    background: #b91c1c;
  }
</style>
