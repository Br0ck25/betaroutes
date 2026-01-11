<script lang="ts">
	import Header from '$lib/components/layout/Header.svelte';
	import { base } from '$app/paths';
	const resolve = (href: string) => `${base}${href}`;

	// Simple smooth scroll handler
	function scrollToSection(id: string) {
		if (typeof document === 'undefined') return;
		const element = document.getElementById(id);
		if (element) {
			element.scrollIntoView({ behavior: 'smooth' });
		}
	}
</script>

<svelte:head>
	<title>Documentation - Go Route Yourself</title>
	<meta
		name="description"
		content="API documentation, user guides, and FAQs for Go Route Yourself."
	/>
</svelte:head>

<Header />

<div class="docs-page">
	<div class="container">
		<div class="docs-layout">
			<aside class="sidebar">
				<div class="sidebar-content">
					<h3 class="nav-title">User Guide</h3>
					<button on:click={() => scrollToSection('getting-started')}>Getting Started</button>
					<button on:click={() => scrollToSection('profit-tracking')}>Profit Tracking</button>
					<button on:click={() => scrollToSection('exporting')}>Exporting Reports</button>

					<h3 class="nav-title">API Reference</h3>
					<button on:click={() => scrollToSection('authentication')}>Authentication</button>
					<button on:click={() => scrollToSection('endpoints')}>Endpoints</button>

					<h3 class="nav-title">Support</h3>
					<button on:click={() => scrollToSection('faq')}>FAQs</button>
				</div>
			</aside>

			<main class="content">
				<div class="page-header">
					<h1>Documentation</h1>
					<p>
						Everything you need to manage your routes, track profits, and integrate with our
						platform.
					</p>
				</div>

				<section id="getting-started" class="doc-section">
					<h2>Getting Started</h2>
					<p>
						Go Route Yourself helps drivers plan efficient routes and track their net profit in
						real-time. To begin, create an account and set your default values (MPG, Gas Price) in
						the
						<a href={resolve('/dashboard/settings')}>Settings</a> menu.
					</p>
				</section>

				<section id="profit-tracking" class="doc-section">
					<h2>Profit Tracking</h2>
					<p>
						Unlike standard GPS apps, we focus on your bottom line. Here is how we calculate your
						"True Profit":
					</p>
					<div class="info-box">
						<strong>Formula:</strong><br />
						<code>(Stop Earnings) - (Fuel Cost + Maintenance + Supplies) = Net Profit</code>
					</div>
					<ul>
						<li><strong>Earnings:</strong> Assign a dollar value to every stop or delivery.</li>
						<li>
							<strong>Fuel:</strong> Calculated automatically based on your vehicle's MPG and local gas
							prices, or entered manually.
						</li>
						<li>
							<strong>Maintenance:</strong> Log oil changes, repairs, or set a "per-mile" wear-and-tear
							cost.
						</li>
					</ul>
				</section>

				<section id="exporting" class="doc-section">
					<h2>Exporting Reports</h2>
					<p>You can export your data for tax purposes or team reporting.</p>
					<ol>
						<li>Navigate to <strong>Settings > Data Management</strong>.</li>
						<li>
							Choose <strong>Export All Trips (CSV)</strong> for a spreadsheet compatible with Excel/Google
							Sheets.
						</li>
						<li>
							For a visual summary, use the <strong>Print/PDF</strong> button on the Dashboard.
						</li>
					</ol>
				</section>

				<hr class="divider" />

				<section id="authentication" class="doc-section">
					<div class="badge-api">Business Plan Only</div>
					<h2>API Authentication</h2>
					<p>
						The Go Route Yourself API allows Business Plan users to integrate route data directly
						into their own systems. All API requests require a Bearer Token.
					</p>
					<div class="code-block">
						<div class="code-header">Header Format</div>
						<pre>Authorization: Bearer YOUR_API_KEY</pre>
					</div>
				</section>

				<section id="endpoints" class="doc-section">
					<h2>Endpoints</h2>

					<div class="endpoint">
						<div class="endpoint-header">
							<span class="method get">GET</span>
							<span class="url">/v1/trips</span>
						</div>
						<p>Retrieve a list of all trips within a date range.</p>
						<div class="code-block">
							<pre>
// Request
GET /v1/trips?start=2025-01-01&end=2025-01-31

// Response
&#123;
  "data": [
    &#123;
      "id": "trip_123",
      "date": "2025-01-15",
      "netProfit": 145.50,
      "totalMiles": 45.2
    &#125;
  ]
&#125;</pre>
						</div>
					</div>

					<div class="endpoint">
						<div class="endpoint-header">
							<span class="method post">POST</span>
							<span class="url">/v1/routes/optimize</span>
						</div>
						<p>Submit a list of stops to receive an optimized route order.</p>
					</div>
				</section>

				<hr class="divider" />

				<section id="faq" class="doc-section">
					<h2>Frequently Asked Questions</h2>

					<div class="faq-item">
						<h4>How accurate is the GPS mileage?</h4>
						<p>
							We use the Google Maps API for high-accuracy routing. However, actual mileage may vary
							slightly due to road detours or GPS drift.
						</p>
					</div>

					<div class="faq-item">
						<h4>Can I cancel my subscription?</h4>
						<p>
							Yes, you can cancel anytime from the Settings page. Your data will be preserved for 30
							days in case you decide to return.
						</p>
					</div>

					<div class="faq-item">
						<h4>Do you support team accounts?</h4>
						<p>
							Yes! The Business Plan allows you to add multiple drivers and view a consolidated
							dashboard of all fleet earnings.
						</p>
					</div>
				</section>
			</main>
		</div>
	</div>
</div>

<style>
	:global(:root) {
		--navy: #2c4a6e;
		--orange: #ff7f50;
		--blue: #29abe2;
		--gray-100: #f3f4f6;
		--gray-200: #e5e7eb;
		--gray-600: #4b5563;
		--gray-800: #1f2937;
		--gray-900: #111827;
		--bg-light: #f9fafb;
	}

	.docs-page {
		background-color: var(--bg-light);
		min-height: 100vh;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		color: var(--gray-900);
		line-height: 1.6;
	}

	.container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 20px;
	}

	.docs-layout {
		display: grid;
		grid-template-columns: 250px 1fr;
		gap: 40px;
		padding: 40px 0;
	}

	/* Sidebar */
	.sidebar {
		position: sticky;
		top: 100px; /* Offset for fixed header */
		height: calc(100vh - 140px);
		overflow-y: auto;
	}

	.nav-title {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--gray-600);
		font-weight: 700;
		margin: 24px 0 12px;
	}

	.sidebar button {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		padding: 8px 0;
		color: var(--gray-600);
		cursor: pointer;
		font-size: 15px;
		transition: color 0.2s;
	}

	.sidebar button:hover {
		color: var(--orange);
	}

	/* Content */
	.content {
		background: white;
		padding: 48px;
		border-radius: 16px;
		box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
		border: 1px solid var(--gray-200);
	}

	.page-header {
		margin-bottom: 48px;
		border-bottom: 1px solid var(--gray-200);
		padding-bottom: 24px;
	}

	h1 {
		font-size: 42px;
		font-weight: 800;
		color: var(--navy);
		margin-bottom: 16px;
	}

	.doc-section {
		margin-bottom: 60px;
		scroll-margin-top: 100px; /* For sticky header clearance */
	}

	h2 {
		font-size: 28px;
		font-weight: 700;
		color: var(--navy);
		margin-bottom: 24px;
		display: flex;
		align-items: center;
		gap: 12px;
	}

	p,
	li {
		color: var(--gray-600);
		margin-bottom: 16px;
		font-size: 16px;
	}

	ul,
	ol {
		padding-left: 24px;
		margin-bottom: 24px;
	}

	li {
		margin-bottom: 8px;
	}

	a {
		color: var(--orange);
		text-decoration: none;
		font-weight: 500;
	}
	a:hover {
		text-decoration: underline;
	}

	/* API Styles */
	.badge-api {
		display: inline-block;
		background: var(--navy);
		color: white;
		font-size: 11px;
		font-weight: 700;
		padding: 4px 8px;
		border-radius: 4px;
		margin-bottom: 8px;
		text-transform: uppercase;
	}

	.code-block {
		background: var(--gray-900);
		color: var(--gray-100);
		border-radius: 8px;
		padding: 20px;
		font-family: 'Monaco', 'Consolas', monospace;
		font-size: 14px;
		overflow-x: auto;
		margin: 16px 0;
	}

	.endpoint {
		margin-bottom: 32px;
		border: 1px solid var(--gray-200);
		border-radius: 8px;
		padding: 20px;
	}

	.endpoint-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
		font-family: monospace;
		font-size: 16px;
	}

	.method {
		font-weight: 700;
		padding: 4px 8px;
		border-radius: 4px;
		color: white;
	}
	.method.get {
		background-color: var(--blue);
	}
	.method.post {
		background-color: var(--orange);
	}

	.info-box {
		background: #eff6ff; /* Light blue */
		border-left: 4px solid var(--blue);
		padding: 16px;
		margin-bottom: 24px;
		color: var(--navy);
	}

	.divider {
		border: 0;
		height: 1px;
		background: var(--gray-200);
		margin: 40px 0;
	}

	.faq-item {
		margin-bottom: 32px;
	}

	.faq-item h4 {
		font-size: 18px;
		font-weight: 600;
		color: var(--gray-900);
		margin-bottom: 8px;
	}

	/* Responsive */
	@media (max-width: 900px) {
		.docs-layout {
			grid-template-columns: 1fr;
		}
		.sidebar {
			display: none; /* Hide sidebar on mobile for simplicity, or make it a dropdown */
		}
		.content {
			padding: 24px;
		}
		h1 {
			font-size: 32px;
		}
	}
</style>
