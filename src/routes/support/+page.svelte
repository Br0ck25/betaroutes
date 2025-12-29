<script lang="ts">
	import Header from '$lib/components/layout/Header.svelte';
</script>

<svelte:head>
	<title>Support - Go Route Yourself</title>
</svelte:head>

<Header />

<div class="support-page">
	<div class="container">
		<div class="page-header">
			<h1 class="title">Support Center</h1>
			<p class="subtitle">Need help? We've got you covered.</p>
		</div>

		<div class="content">
			<section>
				<h2>Contact Us</h2>
				<p>
					Whether you have a question about features, pricing, need a demo, or anything else, our
					team is ready to answer all your questions.
				</p>
				<div class="contact-box">
					<strong>Email Support</strong><br />
					For general inquiries and technical support:<br />
					<a href="mailto:support@gorouteyourself.com">support@gorouteyourself.com</a>
				</div>
			</section>

			<section>
				<h2>Frequently Asked Questions</h2>

				<div class="faq-item">
					<h3>How do I reset my password?</h3>
					<p>
						If you've forgotten your password, you can request a reset link by visiting the <a
							href="/forgot-password">Forgot Password</a
						> page.
					</p>
				</div>

				<div class="faq-item">
					<h3>How does data syncing work?</h3>
					<p>
						Your trips and routes automatically sync across all your devices when you are logged in.
						If you notice data missing, check the "Sync Status" indicator in the navigation bar to
						ensure you are connected.
					</p>
				</div>

				<div class="faq-item">
					<h3>Can I export my route data?</h3>
					<p>
						Yes. You can export your tracks and logs in standard formats like GPX or JSON from your
						Dashboard. Visit the "Data" tab in your dashboard to manage your exports.
					</p>
				</div>

				<div class="faq-item">
					<h3>How do I report a bug?</h3>
					<p>
						Please email us at <a href="mailto:support@gorouteyourself.com"
							>support@gorouteyourself.com</a
						> with a description of the issue. Including screenshots and details about your device helps
						us resolve issues faster.
					</p>
				</div>
			</section>
		</div>
	</div>
</div>

<style>
	/* Styles consistent with Privacy/Terms pages */
	:global(:root) {
		--navy: #2c4a6e;
		--orange: #ff7f50;
		--gray-600: #4b5563;
		--gray-900: #111827;
		--bg-light: #f9fafb;
	}

	.support-page {
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

	.subtitle {
		font-size: 18px;
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
		margin: 24px 0 8px;
	}

	p {
		margin-bottom: 16px;
		color: var(--gray-600);
		font-size: 16px;
	}

	.contact-box {
		background: #f3f4f6;
		padding: 24px;
		border-radius: 8px;
		margin-top: 20px;
		color: var(--navy);
		border-left: 4px solid var(--orange);
	}

	.faq-item {
		margin-bottom: 24px;
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
