<script lang="ts">
	/**
	 * AsyncErrorBoundary - Catches errors in async operations
	 * Useful for wrapping data fetching components
	 */
	import { onMount } from 'svelte';

	export let children: import('svelte').Snippet;
	export let loading: import('svelte').Snippet | undefined;
	export let error: import('svelte').Snippet<[{ error: Error; retry: () => void }]> | undefined;
	export let onRetry: (() => void | Promise<void>) | undefined;

	const errorSnippet = error;

	let state: 'idle' | 'loading' | 'success' | 'error' = 'idle';
	let errorMessage: Error | null = null;

	function retry() {
		state = 'loading';
		errorMessage = null;
		if (onRetry) {
			Promise.resolve(onRetry())
				.then(() => {
					state = 'success';
				})
				.catch((err) => {
					state = 'error';
					errorMessage = err;
				});
		} else {
			state = 'idle';
		}
	}

	export function setLoading() {
		state = 'loading';
		errorMessage = null;
	}

	export function setSuccess() {
		state = 'success';
	}

	export function setError(err: Error) {
		state = 'error';
		errorMessage = err;
	}

	onMount(() => {
		if (state === 'idle') {
			state = 'success';
		}
	});
</script>

{#if state === 'loading'}
	{#if loading}
		{@render loading()}
	{:else}
		<div class="async-loading">
			<div class="spinner"></div>
			<p>Loading...</p>
		</div>
	{/if}
{:else if state === 'error' && errorMessage}
	{#if errorSnippet}
		{@render errorSnippet({ error: errorMessage, retry })}
	{:else}
		<div class="async-error">
			<div class="error-icon">⚠️</div>
			<h3>Failed to load</h3>
			<p>{errorMessage.message}</p>
			<button onclick={retry}>Retry</button>
		</div>
	{/if}
{:else}
	{@render children()}
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
