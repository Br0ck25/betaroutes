<script lang="ts">
	/* eslint-disable svelte/no-at-html-tags */
	// Sanitized static SVG icons (created using sanitizeStaticSvg). See SECURITY.md for rationale.
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { sanitizeStaticSvg } from '$lib/utils/sanitize';
	const resolve = (href: string) => `${base}${href}`;

	const errorDetails = $state({
		status: $page.status || 500,
		message: $page.error?.message || 'An unexpected error occurred',
		showDetails: false
	});

	// Log error for debugging
	onMount(() => {
		if ($page.error) {
			console.error('Error caught by boundary:', {
				status: $page.status,
				error: $page.error,
				url: $page.url.pathname
			});
		}
	});

	function toggleDetails() {
		errorDetails.showDetails = !errorDetails.showDetails;
	}

	function getErrorTitle(status: number): string {
		const titles: Record<number, string> = {
			400: 'Bad Request',
			401: 'Unauthorized',
			403: 'Access Denied',
			404: 'Page Not Found',
			429: 'Too Many Requests',
			500: 'Server Error',
			503: 'Service Unavailable'
		};
		return titles[status] || 'Error';
	}

	function getErrorDescription(status: number): string {
		const descriptions: Record<number, string> = {
			400: 'The request could not be understood by the server.',
			401: 'Please log in to access this page.',
			403: "You don't have permission to access this resource.",
			404: "The page you're looking for doesn't exist or has been moved.",
			429: "You've made too many requests. Please try again in a moment.",
			500: 'Something went wrong on our end. Our team has been notified.',
			503: 'The service is temporarily unavailable. Please try again later.'
		};
		return descriptions[status] || 'An unexpected error occurred while processing your request.';
	}

	// [!code fix] SECURITY (Issue #7, #43): Sanitize static SVG icons
	function getErrorIcon(status: number): string {
		if (status === 404) {
			return sanitizeStaticSvg(`<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="10"/>
				<path d="M16 16s-1.5-2-4-2-4 2-4 2"/>
				<line x1="9" y1="9" x2="9.01" y2="9"/>
				<line x1="15" y1="9" x2="15.01" y2="9"/>
			</svg>`);
		}
		if (status === 403) {
			return sanitizeStaticSvg(`<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
				<path d="M7 11V7a5 5 0 0 1 10 0v4"/>
			</svg>`);
		}
		if (status === 429) {
			return sanitizeStaticSvg(`<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="10"/>
				<polyline points="12 6 12 12 16 14"/>
			</svg>`);
		}
		// Default error icon
		return sanitizeStaticSvg(`<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<circle cx="12" cy="12" r="10"/>
			<line x1="12" y1="8" x2="12" y2="12"/>
			<line x1="12" y1="16" x2="12.01" y2="16"/>
		</svg>`);
	}

	// ← FIXED: Use $derived instead of $:
	const errorIcon = $derived(getErrorIcon(errorDetails.status));
	const errorTitle = $derived(getErrorTitle(errorDetails.status));
	const errorDescription = $derived(getErrorDescription(errorDetails.status));
</script>

<svelte:head>
	<title>{errorDetails.status} - {errorTitle} | Go Route Yourself</title>
</svelte:head>

<div class="error-container">
	<div class="error-content">
		<div class="error-icon" class:not-found={errorDetails.status === 404}>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<!-- Sanitized static SVG (sanitizeStaticSvg) - safe to render with {@html} -->
			{@html errorIcon}
		</div>
		<h2 class="error-title">{errorTitle}</h2>
		<p class="error-description">{errorDescription}</p>

		{#if errorDetails.message && errorDetails.message !== 'An unexpected error occurred'}
			<div class="error-message">
				<p>{errorDetails.message}</p>
			</div>
		{/if}

		<div class="error-actions">
			<a href={resolve('/dashboard')} class="btn-primary">
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
					<polyline points="9 22 9 12 15 12 15 22" />
				</svg>
				Go to Dashboard
			</a>

			<button onclick={() => window.history.back()} class="btn-secondary">
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<line x1="19" y1="12" x2="5" y2="12" />
					<polyline points="12 19 5 12 12 5" />
				</svg>
				Go Back
			</button>

			{#if errorDetails.status >= 500}
				<button onclick={toggleDetails} class="btn-text">
					{errorDetails.showDetails ? 'Hide' : 'Show'} Technical Details
				</button>
			{/if}
		</div>

		{#if errorDetails.showDetails && $page.error}
			<div class="error-details">
				<h3>Technical Information</h3>
				<pre><code
						>{JSON.stringify(
							{
								status: $page.status,
								message: $page.error.message,
								url: $page.url.pathname,
								timestamp: new Date().toISOString()
							},
							null,
							2
						)}</code
					></pre>
			</div>
		{/if}

		<div class="error-help">
			<p>
				Need help? <a href="mailto:support@gorouteyourself.com">Contact Support</a>
			</p>
		</div>
	</div>
</div>

<style>
	.error-container {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
	}

	.error-content {
		max-width: 600px;
		width: 100%;
		background: white;
		border-radius: 16px;
		padding: 3rem;
		text-align: center;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
		animation: slideUp 0.5s ease-out;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.error-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 80px;
		height: 80px;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		border-radius: 50%;
		margin-bottom: 1.5rem;
		color: white;
		animation: pulse 2s ease-in-out infinite;
	}

	.error-icon.not-found {
		background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
	}

	@keyframes pulse {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.05);
		}
	}

	.error-title {
		font-size: 1.75rem;
		font-weight: 600;
		margin: 0.5rem 0;
		color: #1f2937;
	}

	.error-description {
		font-size: 1rem;
		color: #6b7280;
		margin: 1rem 0 1.5rem;
		line-height: 1.6;
	}

	.error-message {
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 8px;
		padding: 1rem;
		margin: 1.5rem 0;
	}

	.error-message p {
		margin: 0;
		color: #991b1b;
		font-size: 0.875rem;
	}

	.error-actions {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin: 2rem 0;
	}

	.btn-primary,
	.btn-secondary,
	.btn-text {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		border-radius: 8px;
		font-weight: 500;
		font-size: 1rem;
		text-decoration: none;
		transition: all 0.2s;
		cursor: pointer;
		border: none;
		font-family: inherit;
	}

	.btn-primary {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
	}

	.btn-primary:hover {
		transform: translateY(-2px);
		box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
	}

	.btn-secondary {
		background: #f3f4f6;
		color: #374151;
	}

	.btn-secondary:hover {
		background: #e5e7eb;
	}

	.btn-text {
		background: transparent;
		color: #6b7280;
		padding: 0.5rem;
	}

	.btn-text:hover {
		color: #374151;
		text-decoration: underline;
	}

	.error-details {
		margin-top: 2rem;
		text-align: left;
		background: #f9fafb;
		border-radius: 8px;
		padding: 1.5rem;
		border: 1px solid #e5e7eb;
	}

	.error-details h3 {
		margin: 0 0 1rem;
		font-size: 1rem;
		color: #374151;
		font-weight: 600;
	}

	.error-details pre {
		margin: 0;
		background: #1f2937;
		color: #f3f4f6;
		padding: 1rem;
		border-radius: 6px;
		overflow-x: auto;
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.error-help {
		margin-top: 2rem;
		padding-top: 2rem;
		border-top: 1px solid #e5e7eb;
	}

	.error-help p {
		margin: 0;
		color: #6b7280;
		font-size: 0.875rem;
	}

	.error-help a {
		color: #667eea;
		text-decoration: none;
		font-weight: 500;
	}

	.error-help a:hover {
		text-decoration: underline;
	}

	@media (min-width: 640px) {
		.error-actions {
			flex-direction: row;
			justify-content: center;
		}
	}

	@media (max-width: 639px) {
		.error-content {
			padding: 2rem 1.5rem;
		}

		.error-title {
			font-size: 1.5rem;
		}
	}
</style>
