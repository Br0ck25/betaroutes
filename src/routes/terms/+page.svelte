<script lang="ts">
	import Header from '$lib/components/layout/Header.svelte';
</script>

<svelte:head>
	<title>Terms of Service - Go Route Yourself</title>
</svelte:head>

<Header />

<div class="legal-page">
	<div class="container">
		<div class="page-header">
			<h1 class="title">Terms of Service</h1>
			<p class="last-updated">Last Updated: December 8, 2025</p>
		</div>

		<div class="content">
			<p class="intro">
				Welcome to Go Route Yourself (“Go Route Yourself,” “we,” “our,” or “us”). These Terms of
				Service (“Terms”) govern your access to and use of the Go Route Yourself website, app, and
				related services (the “Service”). By accessing or using the Service, you agree to these
				Terms. If you do not agree, do not use the Service.
			</p>

			<section>
				<h2>1. Use of the Service</h2>
				<h3>1.1 Eligibility</h3>
				<p>
					You must be at least 13 years old to use the Service. By using the Service, you confirm
					that you are legally able to enter into these Terms.
				</p>

				<h3>1.2 Account Requirements</h3>
				<p>To access certain features, you may need to create an account. You agree to:</p>
				<ul>
					<li>Provide accurate account information</li>
					<li>Maintain the security of your login credentials</li>
					<li>Notify us immediately of any unauthorized access to your account</li>
				</ul>
				<p>You are responsible for all activity that occurs under your account.</p>
			</section>

			<section>
				<h2>2. User Content</h2>
				<h3>2.1 Your Data</h3>
				<p>
					You may upload, create, or generate route data, GPS tracks, GPX/GeoJSON files, logs, or
					other content (“User Content”). You retain all ownership rights to your User Content.
				</p>

				<h3>2.2 License to Us</h3>
				<p>By using the Service, you grant us a non-exclusive, worldwide license to:</p>
				<ul>
					<li>Store your User Content</li>
					<li>Process it for syncing, display, and backup</li>
					<li>Display it to you across your devices</li>
				</ul>
				<p>
					This license is solely for operating and improving the Service. We do not sell or share
					User Content with third parties.
				</p>

				<h3>2.3 Public Tracks</h3>
				<p>
					If you choose to publish a route/track publicly, you understand it becomes visible to all
					users. You may revoke public visibility at any time.
				</p>
			</section>

			<section>
				<h2>3. Acceptable Use</h2>
				<p>You agree not to:</p>
				<ul>
					<li>Misuse or interfere with the Service</li>
					<li>Upload harmful, illegal, or malicious content</li>
					<li>Attempt to hack, reverse-engineer, or bypass security</li>
					<li>Upload content that violates privacy, copyright, or the rights of others</li>
					<li>Use the Service while operating a vehicle in unsafe or illegal conditions</li>
					<li>Use the Service to stalk, track, or monitor others without consent</li>
				</ul>
				<p>We may suspend or terminate accounts that violate these rules.</p>
			</section>

			<section>
				<h2>4. Location Services</h2>
				<p>Certain features require access to your location, including:</p>
				<ul>
					<li>Real-time GPS display</li>
					<li>Trip recording</li>
					<li>Route creation based on your current position</li>
				</ul>
				<p>
					You must grant permission for location access. Real-time location is not stored unless you
					initiate a trip recording.
				</p>
			</section>

			<section>
				<h2>5. Data Storage & Syncing</h2>
				<p>Depending on your account type, data may be stored via:</p>
				<ul>
					<li>Cloudflare Workers / KV Storage</li>
					<li>Cloudflare R2 (for uploaded files or public tracks)</li>
					<li>LocalStorage (for offline mode and caching)</li>
				</ul>
				<p>We are not liable for data loss caused by:</p>
				<ul>
					<li>Device damage</li>
					<li>LocalStorage clearing</li>
					<li>Browser issues</li>
					<li>User deletion of files</li>
					<li>External service outages</li>
				</ul>
				<p>We recommend exporting or backing up important tracks regularly.</p>
			</section>

			<section>
				<h2>6. Availability & Updates</h2>
				<p>We aim to keep the Service available but do not guarantee:</p>
				<ul>
					<li>100% uptime</li>
					<li>Error-free performance</li>
					<li>Compatibility with all devices or browsers</li>
				</ul>
				<p>
					We may update or remove features at any time. We are not responsible for any downtime or
					service interruptions.
				</p>
			</section>

			<section>
				<h2>7. Third-Party Services</h2>
				<p>The Service may use third-party tools such as:</p>
				<ul>
					<li>Google Maps APIs</li>
					<li>Cloudflare services</li>
					<li>Open-source map providers</li>
				</ul>
				<p>Your use of these tools may be subject to their own terms and privacy policies.</p>
			</section>

			<section>
				<h2>8. Disclaimers</h2>
				<p>
					The Service is provided “as-is” and “as available” without warranties of any kind. We do
					not guarantee:
				</p>
				<ul>
					<li>Accuracy of maps, routes, travel times, elevation, or GPS data</li>
					<li>That the Service will meet your expectations</li>
					<li>That calculated routes are safe, legal, or passable</li>
				</ul>
				<p>Route decisions and safety are your responsibility. Use the Service at your own risk.</p>
			</section>

			<section>
				<h2>9. Limitation of Liability</h2>
				<p>To the maximum extent permitted by law, Go Route Yourself is not liable for:</p>
				<ul>
					<li>Loss of data</li>
					<li>Inaccurate routes or directions</li>
					<li>Incidents resulting from use of GPS or navigation features</li>
					<li>Damages arising from service outages</li>
					<li>Indirect, incidental, or consequential damages</li>
				</ul>
				<p>
					Our total liability shall not exceed the amount you paid for the Service (if any) within
					the past 12 months.
				</p>
			</section>

			<section>
				<h2>10. Termination</h2>
				<p>We may suspend or terminate your account if:</p>
				<ul>
					<li>You violate these Terms</li>
					<li>You misuse the Service</li>
					<li>We discontinue the Service</li>
				</ul>
				<p>
					You may delete your account at any time. Upon deletion, we delete or anonymize your
					personal data in accordance with our Privacy Policy.
				</p>
			</section>

			<section>
				<h2>11. Intellectual Property</h2>
				<p>
					The Go Route Yourself name, logo, design, and software are our property. You may not copy,
					distribute, or modify any part of the Service without permission.
				</p>
			</section>

			<section>
				<h2>12. Changes to These Terms</h2>
				<p>
					We may modify these Terms at any time. We will notify users of significant updates through
					the website, app, or email. Continued use of the Service means you accept the updated
					Terms.
				</p>
			</section>

			<section>
				<h2>13. Governing Law</h2>
				<p>
					These Terms are governed by the laws of the United States, without regard to conflict of
					law principles.
				</p>
			</section>

			<section>
				<h2>14. Contact Us</h2>
				<p>If you have questions about these Terms, you can contact us at:</p>
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
