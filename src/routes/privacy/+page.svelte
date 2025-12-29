<script lang="ts">
	import Header from '$lib/components/layout/Header.svelte';
</script>

<svelte:head>
	<title>Privacy Policy - Go Route Yourself</title>
</svelte:head>

<Header />

<div class="legal-page">
	<div class="container">
		<div class="page-header">
			<h1 class="title">Privacy Policy</h1>
			<p class="last-updated">Last Updated: December 8, 2025</p>
		</div>

		<div class="content">
			<p class="intro">
				Go Route Yourself (“we,” “our,” or “us”) provides route-planning and trip-tracking tools
				designed to help users manage routes, track travel data, store logs, and sync information
				across devices. We value your privacy and are committed to protecting your personal
				information. This Privacy Policy explains what information we collect, how we use it, and
				your rights regarding your data.
			</p>

			<section>
				<h2>1. Information We Collect</h2>

				<h3>1.1 Information You Provide</h3>
				<p>We may collect the following information when you use Go Route Yourself:</p>
				<ul>
					<li>
						<strong>Account Information:</strong> Email address, password, username, and authentication
						details.
					</li>
					<li>
						<strong>Saved Data:</strong> Saved routes, trip logs, imported GPX/GeoJSON files, waypoints,
						folders, and track names.
					</li>
					<li>
						<strong>Support Requests:</strong> Any information you voluntarily provide when contacting
						support.
					</li>
				</ul>

				<h3>1.2 Automatically Collected Information</h3>
				<p>When you use the service, we may automatically collect:</p>
				<ul>
					<li>
						<strong>Device Information:</strong> Browser type, device type, operating system, and IP address.
					</li>
					<li>
						<strong>Usage Data:</strong> Features you access, pages viewed, buttons clicked, performance
						logs, and error diagnostics.
					</li>
					<li>
						<strong>Location Information (when enabled):</strong> Real-time location for navigation or
						trip recording, and GPS tracks when recording trips. We only collect location when you grant
						permission.
					</li>
				</ul>

				<h3>1.3 Storage and Services</h3>
				<p>Depending on your account type and features used, data may be stored using:</p>
				<ul>
					<li>Cloudflare Workers/KV Storage</li>
					<li>Cloudflare R2 (for uploaded GPX files or track data)</li>
					<li>LocalStorage on your device (for offline use and faster loading)</li>
				</ul>
				<p>We do not sell or share your uploaded tracks or personal data with third parties.</p>
			</section>

			<section>
				<h2>2. How We Use Your Information</h2>
				<p>We use your information to:</p>
				<ul>
					<li>Provide, maintain, and improve the Go Route Yourself service</li>
					<li>Sync routes, tracks, and settings across devices</li>
					<li>Authenticate users and prevent unauthorized access</li>
					<li>Display your GPS location and track your trips (only when enabled)</li>
					<li>Process imports and exports of GPX/GeoJSON</li>
					<li>Offer customer support and troubleshoot issues</li>
					<li>Analyze usage to improve performance and new features</li>
					<li>Send optional service updates or notifications</li>
				</ul>
				<p>We do not use your personal information for advertising or profiling.</p>
			</section>

			<section>
				<h2>3. How Your Data Is Stored</h2>
				<p>Depending on the feature:</p>
				<ul>
					<li>
						Your private tracks and logs are stored in an account-protected area of Cloudflare KV or
						R2.
					</li>
					<li>Public tracks are visible to all users if you choose to publish them.</li>
					<li>LocalStorage may store temporary app preferences or offline data.</li>
				</ul>
				<p>
					GPS data is only stored when you manually save a track. Real-time location data is not
					stored unless you are actively recording a trip. We use industry-standard security
					measures and Cloudflare infrastructure to protect your data.
				</p>
			</section>

			<section>
				<h2>4. Sharing and Disclosure</h2>
				<p>We do not sell, rent, or trade your data. We may share data only in these cases:</p>
				<ul>
					<li>
						<strong>Legal Requirements:</strong> If required by law, court order, or governmental request.
					</li>
					<li>
						<strong>Security Protections:</strong> To investigate potential violations, fraud, or threats.
					</li>
					<li>
						<strong>Service Providers:</strong> Limited technical partners that support hosting (e.g.,
						Cloudflare), who are contractually obligated to keep data secure.
					</li>
				</ul>
				<p>We do not share user location or GPS data with third parties.</p>
			</section>

			<section>
				<h2>5. Your Rights and Choices</h2>
				<p>Depending on your jurisdiction, you have rights including:</p>
				<ul>
					<li>Access the data in your account</li>
					<li>Update or edit your information</li>
					<li>Delete your account and associated data</li>
					<li>Export your tracks or logs (CSV/JSON)</li>
					<li>Opt out of non-essential emails</li>
				</ul>
				<p>
					You can request deletion or export by contacting support at:
					<a href="mailto:support@gorouteyourself.com">support@gorouteyourself.com</a>
				</p>
			</section>

			<section>
				<h2>6. Children’s Privacy</h2>
				<p>
					Go Route Yourself is not intended for children under 13. We do not knowingly collect
					information from minors. If we learn that a child’s data has been collected, we will
					delete it promptly.
				</p>
			</section>

			<section>
				<h2>7. Cookies & Tracking Technologies</h2>
				<p>We may use:</p>
				<ul>
					<li>Essential cookies for login sessions</li>
					<li>Performance analytics (privacy-focused and non-identifying)</li>
					<li>Local storage for offline maps and saved preferences</li>
				</ul>
				<p>We do not use advertising trackers or third-party behavioral tracking.</p>
			</section>

			<section>
				<h2>8. Data Retention</h2>
				<p>We retain data only as long as necessary to:</p>
				<ul>
					<li>Provide the service</li>
					<li>Maintain user accounts</li>
					<li>Meet legal obligations</li>
				</ul>
				<p>You may delete your data at any time through your account or by requesting removal.</p>
			</section>

			<section>
				<h2>9. International Users</h2>
				<p>
					If you access Go Route Yourself outside the United States, your information may be
					processed in the U.S. or other regions where our systems operate. We use privacy-compliant
					vendors to ensure data protection.
				</p>
			</section>

			<section>
				<h2>10. Changes to This Privacy Policy</h2>
				<p>
					We may update this policy from time to time. We will notify users of significant changes
					through:
				</p>
				<ul>
					<li>A notice in the app or website, or</li>
					<li>Email notification (if applicable)</li>
				</ul>
				<p>Continued use after changes means acceptance of the updated policy.</p>
			</section>

			<section>
				<h2>11. Contact Us</h2>
				<p>If you have questions about this Privacy Policy or your data, contact:</p>
				<div class="contact-box">
					<strong>Go Route Yourself</strong><br />
					Email: <a href="mailto:support@gorouteyourself.com">support@gorouteyourself.com</a><br />
					Website: gorouteyourself.com
				</div>
			</section>
		</div>
	</div>
</div>

<style>
	:global(:root) {
		--navy: #2c4a6e;
		--orange: #ff7f50;
		--gray-600: #4b5563;
		--gray-900: #111827;
		--bg-light: #f9fafb;
	}

	.legal-page {
		background-color: var(--bg-light);
		min-height: 100vh;
		padding-bottom: 80px;
		font-family:
			-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
		color: var(--gray-900);
		line-height: 1.6;
	}

	.container {
		max-width: 800px;
		margin: 0 auto;
		padding: 40px 20px;
	}

	.page-header {
		text-align: center;
		margin-bottom: 60px;
		padding-bottom: 40px;
		border-bottom: 1px solid #e5e7eb;
	}

	.title {
		font-size: 42px;
		font-weight: 800;
		color: var(--navy);
		margin-bottom: 16px;
	}

	.last-updated {
		font-size: 16px;
		color: var(--gray-600);
	}

	.content {
		background: white;
		padding: 48px;
		border-radius: 16px;
		box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
		border: 1px solid #e5e7eb;
	}

	section {
		margin-bottom: 40px;
	}

	h2 {
		font-size: 24px;
		font-weight: 700;
		color: var(--navy);
		margin-bottom: 20px;
		padding-bottom: 10px;
		border-bottom: 2px solid #f3f4f6;
	}

	h3 {
		font-size: 18px;
		font-weight: 600;
		color: var(--navy);
		margin: 24px 0 12px;
	}

	p {
		margin-bottom: 16px;
		color: var(--gray-600);
		font-size: 16px;
	}

	ul {
		list-style-type: disc;
		padding-left: 24px;
		margin-bottom: 16px;
		color: var(--gray-600);
	}

	li {
		margin-bottom: 8px;
	}

	.contact-box {
		background: #f3f4f6;
		padding: 20px;
		border-radius: 8px;
		margin-top: 20px;
		color: var(--navy);
	}

	a {
		color: var(--orange);
		text-decoration: none;
		font-weight: 500;
	}

	a:hover {
		text-decoration: underline;
	}

	@media (max-width: 768px) {
		.content {
			padding: 24px;
		}
		.title {
			font-size: 32px;
		}
	}
</style>
