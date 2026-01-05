<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { toasts } from '$lib/stores/toast';
	// See Documentation/Simple Web Auth and Documentation/Svelte 5 for guidance on quick-sign and biometric flows
	// [!code ++] Import WebAuthn helper
	import { startAuthentication } from '@simplewebauthn/browser';

	let username = '';
	let email = '';
	let password = '';
	let confirmPassword = '';
	let responseError: string | null = null;
	let loading = false;
	let registrationSuccess = false;
	let submittedEmail = '';

	// Quick sign-in state: read from localStorage key 'passkey:preferred' (credentialID/email/name)
	let quickPasskey: { credentialID: string; email?: string; name?: string } | null = null;
	let quickLoading = false;

	// Check if we are in register mode based on URL query param
	$: isLogin = $page.url.searchParams.get('view') !== 'register';

	function toggleMode() {
		const url = new URL($page.url);
		if (isLogin) url.searchParams.set('view', 'register');
		else url.searchParams.delete('view');
		goto(url.pathname + url.search, { replaceState: true });

		username = '';
		email = '';
		password = '';
		confirmPassword = '';
		responseError = null;
		registrationSuccess = false;
	}

	// [!code ++] Biometric Login Handler
	export function base64UrlToBuffer(base64url: any): Uint8Array {
		// If already an ArrayBuffer or TypedArray, return a Uint8Array view
		if (!base64url) return new Uint8Array();
		if (base64url instanceof ArrayBuffer) return new Uint8Array(base64url);
		if (ArrayBuffer.isView(base64url))
			return new Uint8Array(
				(base64url as any).buffer,
				(base64url as any).byteOffset || 0,
				(base64url as any).byteLength || (base64url as any).length
			);

		// Otherwise assume base64url string and decode
		if (typeof base64url !== 'string') base64url = String(base64url);
		const pad = '=='.slice(0, (4 - (base64url.length % 4)) % 4);
		const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + pad;
		const binary = atob(b64);
		const len = binary.length;
		const bytes = new Uint8Array(len);
		for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
		return bytes;
	}

	async function handleBiometricLogin() {
		loading = true;
		responseError = null;

		try {
			// Optionally let user pick a named device first (better UX when multiple passkeys exist)
			let requestedCredential: string | null = null;
			if (username) {
				try {
					const listResp = await fetch(
						`/api/auth/webauthn/list-for-email?email=${encodeURIComponent(username)}`
					);
					if (listResp.ok) {
						const json: any = await listResp.json();
						const auths = json.authenticators || [];
						if (auths.length > 1) {
							// Simple selection prompt (can be replaced with nicer UI)
							const choices = auths
								.map(
									(a: any, i: number) =>
										`${i + 1}. ${a.name || 'Unnamed'} (${a.transports?.join(', ') || 'device'})`
								)
								.join('\n');
							const sel = prompt(`Choose a passkey:\n${choices}\nEnter the number to use:`);
							const idx = parseInt(String(sel || ''), 10);
							if (!isNaN(idx) && idx >= 1 && idx <= auths.length) {
								requestedCredential = auths[idx - 1].credentialID;
							}
						} else if (auths.length === 1) {
							// If only one passkey exists for this email, pre-select it
							requestedCredential = auths[0].credentialID;
						}
					}
				} catch (e) {
					console.error('Could not fetch passkey list for email', e);
				}
			}

			// 1. Request challenge from your server
			const optionsResp = await fetch(
				`/api/auth/webauthn${requestedCredential ? `?credential=${encodeURIComponent(requestedCredential)}` : ''}`,
				{ credentials: 'same-origin' }
			);
			const rawText = await optionsResp.text();
			let optionsJson: any;
			try {
				optionsJson = JSON.parse(rawText);
			} catch (e) {
				console.error('[Passkey] Failed to parse auth options JSON:', rawText);
				throw new Error('Invalid authentication options response');
			}

			if (!optionsResp.ok) {
				console.error('[Passkey] Auth options request failed:', optionsResp.status, optionsJson);
				throw new Error(optionsJson?.error || 'Biometric login not available');
			}

			const options: any = optionsJson;

			console.log('[Passkey] Auth options from server (raw):', rawText);
			if (!options || typeof options !== 'object') {
				console.error('[Passkey] Invalid auth options payload:', optionsJson);
				throw new Error('Invalid authentication options from server');
			}

			if (!options.challenge) {
				console.error('[Passkey] Missing challenge in auth options:', options);
				throw new Error('Authentication options missing challenge');
			}

			// Ensure challenge is a base64url string (don't convert to ArrayBuffer; the helper will manage it)
			if (typeof options.challenge !== 'string') {
				console.warn('[Passkey] Unexpected challenge type; converting to base64url string');
				const bytes =
					options.challenge instanceof Uint8Array
						? options.challenge
						: new Uint8Array(options.challenge);
				let binary = '';
				for (let i = 0; i < bytes.byteLength; i++)
					binary += String.fromCharCode(Number(bytes[i] ?? 0));
				options.challenge = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
			}

			if (Array.isArray(options.allowCredentials)) {
				options.allowCredentials = options.allowCredentials.map((c: any) => ({
					...c,
					id: String(c.id)
				}));
			}

			// 2. Prompt user for FaceID/TouchID (Browser Native Modal)
			const authResp = await startAuthentication({ optionsJSON: options as any });

			// 3. Verify signature with server (ensure credential.serializable fields are sent)
			function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array) {
				const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
				let binary = '';
				for (let i = 0; i < bytes.byteLength; i++)
					binary += String.fromCharCode(Number(bytes[i] ?? 0));
				return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
			}

			const normalised: any = { ...authResp } as any;
			if (
				normalised.rawId &&
				(normalised.rawId instanceof ArrayBuffer || ArrayBuffer.isView(normalised.rawId))
			) {
				normalised.rawId = bufferToBase64Url(normalised.rawId as ArrayBuffer);
			}
			const resp = normalised.response || {};
			if (
				resp.authenticatorData &&
				(resp.authenticatorData instanceof ArrayBuffer ||
					ArrayBuffer.isView(resp.authenticatorData))
			)
				resp.authenticatorData = bufferToBase64Url(resp.authenticatorData);
			if (
				resp.clientDataJSON &&
				(resp.clientDataJSON instanceof ArrayBuffer || ArrayBuffer.isView(resp.clientDataJSON))
			)
				resp.clientDataJSON = bufferToBase64Url(resp.clientDataJSON);
			if (
				resp.signature &&
				(resp.signature instanceof ArrayBuffer || ArrayBuffer.isView(resp.signature))
			)
				resp.signature = bufferToBase64Url(resp.signature);
			if (
				resp.userHandle &&
				(resp.userHandle instanceof ArrayBuffer || ArrayBuffer.isView(resp.userHandle))
			)
				resp.userHandle = bufferToBase64Url(resp.userHandle);

			const verificationResp = await fetch('/api/auth/webauthn', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(normalised)
			});

			if (!verificationResp.ok) {
				const err: any = await verificationResp.json();
				throw new Error(err.error || 'Verification failed');
			}

			const verificationJSON: any = await verificationResp.json();

			if (verificationJSON.verified) {
				await goto('/dashboard', { invalidateAll: true });
			} else {
				responseError = 'Biometric verification failed.';
			}
		} catch (e: any) {
			console.error('Biometric error:', e);
			// Don't show error if user just cancelled the dialog
			if (e.name !== 'NotAllowedError') {
				responseError = e.message || 'Biometric login failed.';
			}
		} finally {
			loading = false;
		}
	}

	// Load any preferred passkey saved on this device
	onMount(() => {
		const raw = localStorage.getItem('passkey:preferred');
		if (raw) {
			try {
				quickPasskey = JSON.parse(raw);
			} catch (e) {
				quickPasskey = null;
			}
		}
	});

	async function quickSignIn() {
		if (!quickPasskey) return;
		quickLoading = true;
		responseError = null;
		try {
			const requestedCredential = quickPasskey.credentialID;
			const optionsResp = await fetch(
				`/api/auth/webauthn?credential=${encodeURIComponent(requestedCredential)}`,
				{ credentials: 'same-origin' }
			);
			if (optionsResp.status === 401) {
				toasts.error('Session expired. Please sign in with password.');
				quickLoading = false;
				return;
			}
			const rawText = await optionsResp.text();
			let optionsJson: any;
			try {
				optionsJson = JSON.parse(rawText);
			} catch (e) {
				console.error('[Passkey] Failed to parse auth options JSON:', rawText);
				throw new Error('Invalid authentication options response');
			}

			if (!optionsResp.ok) {
				throw new Error(optionsJson?.error || 'Biometric login not available');
			}

			const options: any = optionsJson;
			if (!options.challenge) throw new Error('Authentication options missing challenge');
			if (typeof options.challenge !== 'string') {
				const bytes =
					options.challenge instanceof Uint8Array
						? options.challenge
						: new Uint8Array(options.challenge);
				let binary = '';
				for (let i = 0; i < bytes.byteLength; i++)
					binary += String.fromCharCode(Number(bytes[i] ?? 0));
				options.challenge = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
			}

			if (Array.isArray(options.allowCredentials)) {
				options.allowCredentials = options.allowCredentials.map((c: any) => ({
					...c,
					id: String(c.id)
				}));
			}

			const authResp = await startAuthentication({ optionsJSON: options as any });

			function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array) {
				const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
				let binary = '';
				for (let i = 0; i < bytes.byteLength; i++)
					binary += String.fromCharCode(Number(bytes[i] ?? 0));
				return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
			}

			const normalised: any = { ...authResp } as any;
			if (
				normalised.rawId &&
				(normalised.rawId instanceof ArrayBuffer || ArrayBuffer.isView(normalised.rawId))
			) {
				normalised.rawId = bufferToBase64Url(normalised.rawId as ArrayBuffer);
			}
			const resp = normalised.response || {};
			if (
				resp.authenticatorData &&
				(resp.authenticatorData instanceof ArrayBuffer ||
					ArrayBuffer.isView(resp.authenticatorData))
			)
				resp.authenticatorData = bufferToBase64Url(resp.authenticatorData);
			if (
				resp.clientDataJSON &&
				(resp.clientDataJSON instanceof ArrayBuffer || ArrayBuffer.isView(resp.clientDataJSON))
			)
				resp.clientDataJSON = bufferToBase64Url(resp.clientDataJSON);
			if (
				resp.signature &&
				(resp.signature instanceof ArrayBuffer || ArrayBuffer.isView(resp.signature))
			)
				resp.signature = bufferToBase64Url(resp.signature);
			if (
				resp.userHandle &&
				(resp.userHandle instanceof ArrayBuffer || ArrayBuffer.isView(resp.userHandle))
			)
				resp.userHandle = bufferToBase64Url(resp.userHandle);

			const verificationResp = await fetch('/api/auth/webauthn', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(normalised)
			});

			if (!verificationResp.ok) {
				const err: any = await verificationResp
					.json()
					.catch(() => ({ error: 'Verification failed' }));
				throw new Error(err.error || 'Verification failed');
			}

			const verificationJSON: any = await verificationResp.json();

			if (verificationJSON.verified) {
				await goto('/dashboard', { invalidateAll: true });
			} else {
				responseError = 'Biometric verification failed.';
			}
		} catch (e: any) {
			console.error('Quick Biometric error:', e);
			if (e.name !== 'NotAllowedError') {
				toasts.error(e.message || 'Biometric login failed.');
				responseError = e.message || 'Biometric login failed.';
			}
		} finally {
			quickLoading = false;
		}
	}

	async function submitHandler() {
		responseError = null;
		loading = true;

		const endpoint = isLogin ? '/login' : '/register';

		let payload = {};
		if (isLogin) {
			payload = { email: username, password };
		} else {
			if (password !== confirmPassword) {
				responseError = "Passwords don't match";
				loading = false;
				return;
			}
			payload = { username, email, password };
		}

		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			const result: any = await response.json();

			if (response.ok) {
				if (isLogin) {
					await goto('/dashboard', { invalidateAll: true });
				} else {
					submittedEmail = email;
					registrationSuccess = true;
					username = '';
					email = '';
					password = '';
					confirmPassword = '';
				}
			} else {
				responseError = result.message || result.error || 'An error occurred.';
			}
		} catch (e) {
			console.error('Fetch error:', e);
			responseError = 'Network error. Please try again.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{isLogin ? 'Sign In' : 'Sign Up'} - Go Route Yourself</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="auth-page">
	<div class="auth-brand">
		<div class="brand-content">
			<a href="/" class="brand-logo">
				<picture>
					<source type="image/avif" srcset="/logo-180x75.png 48w" sizes="48px" />
					<img
						src="/logo-180x75.png"
						alt="Go Route Yourself"
						width="180"
						height="75"
						decoding="async"
						style="width:180px; height:75px; object-fit:contain;"
					/>
				</picture>
			</a>

			<div class="brand-text">
				<h1>Welcome to Go Route Yourself</h1>
				<p>
					Professional route planning and profit tracking for delivery drivers and field workers.
				</p>
			</div>

			<div class="brand-features">
				<div class="feature-item">
					<div class="feature-icon">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
							<path
								d="M9 11L12 14L22 4"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
							<path
								d="M21 12V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H16"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</div>
					<div class="feature-text">
						<h3>Smart Route Planning</h3>
						<p>AI-powered optimization</p>
					</div>
				</div>

				<div class="feature-item">
					<div class="feature-icon">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
							<path
								d="M12 2L2 7L12 12L22 7L12 2Z"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
							<path
								d="M2 17L12 22L22 17"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
							<path
								d="M2 12L12 17L22 12"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</div>
					<div class="feature-text">
						<h3>Real-Time Analytics</h3>
						<p>Track every dollar</p>
					</div>
				</div>

				<div class="feature-item">
					<div class="feature-icon">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
							<path
								d="M21 16V8C20.9996 7.64927 20.9071 7.30481 20.7315 7.00116C20.556 6.69751 20.3037 6.44536 20 6.27L13 2.27C12.696 2.09446 12.3511 2.00205 12 2.00205C11.6489 2.00205 11.304 2.09446 11 2.27L4 6.27C3.69626 6.44536 3.44398 6.69751 3.26846 7.00116C3.09294 7.30481 3.00036 7.64927 3 8V16C3.00036 16.3507 3.09294 16.6952 3.26846 16.9988C3.44398 17.3025 3.69626 17.5546 4 17.73L11 21.73C11.304 21.9055 11.6489 21.9979 12 21.9979C12.3511 21.9979 12.696 21.9055 13 21.73L20 17.73C20.3037 17.5546 20.556 17.3025 20.7315 16.9988C20.9071 16.6952 20.9996 16.3507 21 16Z"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</div>
					<div class="feature-text">
						<h3>Cloud Sync</h3>
						<p>Access anywhere</p>
					</div>
				</div>
			</div>

			<div class="brand-stats">
				<div class="stat">
					<div class="stat-value">10K+</div>
					<div class="stat-label">Routes</div>
				</div>
				<div class="stat">
					<div class="stat-value">$2.5M+</div>
					<div class="stat-label">Tracked</div>
				</div>
				<div class="stat">
					<div class="stat-value">4.9/5</div>
					<div class="stat-label">Rating</div>
				</div>
			</div>
		</div>
	</div>

	<div class="auth-form">
		<div class="form-container">
			{#if registrationSuccess}
				<div style="text-align: center;">
					<div
						class="alert success"
						style="display: block; text-align: center; background: #F0FDF4; border-color: #BBF7D0;"
					>
						<svg
							width="48"
							height="48"
							viewBox="0 0 24 24"
							fill="none"
							stroke="#166534"
							stroke-width="2"
							style="margin: 0 auto 16px auto; display: block;"
						>
							<path
								d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
						<h3 style="font-size: 20px; font-weight: 700; margin-bottom: 8px; color: #166534;">
							Check your inbox!
						</h3>
						<p style="font-size: 15px; color: #166534;">
							We've sent a verification link to <strong>{submittedEmail}</strong>.
						</p>
					</div>
					<button
						class="toggle-link"
						on:click={() => {
							registrationSuccess = false;
							toggleMode();
						}}
					>
						Back to Sign In
					</button>
				</div>
			{:else}
				<div class="form-header">
					<h2>{isLogin ? 'Sign in to your account' : 'Create your account'}</h2>
					<p>
						{isLogin ? "Don't have an account?" : 'Already have an account?'}
						<button class="toggle-link" on:click={toggleMode}>
							{isLogin ? 'Sign up' : 'Sign in'}
						</button>
					</p>
				</div>

				<form on:submit|preventDefault={submitHandler}>
					{#if isLogin}
						{#if quickPasskey && (!username || username === quickPasskey.email)}
							<button
								type="button"
								class="btn-secondary"
								on:click={quickSignIn}
								disabled={quickLoading}
								style="margin-bottom:8px; display:flex; align-items:center; justify-content:center;"
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									style="margin-right:8px;"
								>
									<path
										d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
									/>
								</svg>
								{quickLoading
									? 'Signing in...'
									: `Quick sign-in${quickPasskey?.name ? ' (' + quickPasskey.name + ')' : ''}`}
							</button>
						{/if}

						<button
							type="button"
							class="btn-biometric"
							on:click={handleBiometricLogin}
							disabled={loading}
						>
							<svg
								width="24"
								height="24"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<path
									d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
								/>
								<path
									d="M2 12C2 6.48 6.48 2 12 2s10 4.48 10 10-4.48 10-10 10S2 17.52 2 12zm10 6c3.31 0 6-2.69 6-6s-2.69-6-6-6-6 2.69-6 6 2.69 6 6 6z"
									stroke-opacity="0.3"
								/>
							</svg>
							Sign in with Face ID / Touch ID
						</button>

						<div class="divider">
							<span>OR</span>
						</div>
					{/if}

					<div class="form-fields">
						<div class="field-group">
							<label for="username">
								{isLogin ? 'Username or Email' : 'Username'}
								<span class="required">*</span>
							</label>
							<div class="input-wrapper">
								<svg class="input-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
									<path
										d="M10 10C12.7614 10 15 7.76142 15 5C15 2.23858 12.7614 0 10 0C7.23858 0 5 2.23858 5 5C5 7.76142 7.23858 10 10 10Z"
										fill="currentColor"
									/>
									<path
										d="M10 12C4.47715 12 0 15.3579 0 19.5C0 19.7761 0.223858 20 0.5 20H19.5C19.7761 20 20 19.7761 20 19.5C20 15.3579 15.5228 12 10 12Z"
										fill="currentColor"
									/>
								</svg>
								<input
									type="text"
									id="username"
									bind:value={username}
									required
									placeholder={isLogin ? 'Enter username or email' : 'Choose a username'}
									autocomplete="username"
								/>
							</div>
						</div>

						{#if !isLogin}
							<div class="field-group">
								<label for="email">
									Email Address
									<span class="required">*</span>
								</label>
								<div class="input-wrapper">
									<svg class="input-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
										<path
											d="M2 4C2 3.44772 2.44772 3 3 3H17C17.5523 3 18 3.44772 18 4V16C18 16.5523 17.5523 17 17 17H3C2.44772 17 2 16.5523 2 16V4Z"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
										<path
											d="M18 4L10 10.5L2 4"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
									<input
										type="email"
										id="email"
										bind:value={email}
										required
										placeholder="Enter your email address"
										autocomplete="email"
									/>
								</div>
							</div>
						{/if}

						<div class="field-group">
							<label for="password">
								Password
								<span class="required">*</span>
							</label>
							<div class="input-wrapper">
								<svg class="input-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
									<path
										d="M15 7H14V5C14 3.67392 13.4732 2.40215 12.5355 1.46447C11.5979 0.526784 10.3261 0 9 0C7.67392 0 6.40215 0.526784 5.46447 1.46447C4.52678 2.40215 4 3.67392 4 5V7H3C2.46957 7 1.96086 7.21071 1.58579 7.58579C1.21071 7.96086 1 8.46957 1 9V17C1 17.5304 1.21071 18.0391 1.58579 18.4142C1.96086 18.7893 2.46957 19 3 19H15C15.5304 19 16.0391 18.7893 16.4142 18.4142C16.7893 18.0391 17 17.5304 17 17V9C17 8.46957 16.7893 7.96086 16.4142 7.58579C16.0391 7.21071 15.5304 7 15 7ZM6 5C6 4.20435 6.31607 3.44129 6.87868 2.87868C7.44129 2.31607 8.20435 2 9 2C9.79565 2 10.5587 2.31607 11.1213 2.87868C11.6839 3.44129 12 4.20435 12 5V7H6V5Z"
										fill="currentColor"
									/>
								</svg>
								<input
									type="password"
									id="password"
									bind:value={password}
									required
									placeholder="Enter your password"
									autocomplete={isLogin ? 'current-password' : 'new-password'}
								/>
							</div>
						</div>

						{#if !isLogin}
							<div class="field-group">
								<label for="confirmPassword">
									Confirm Password
									<span class="required">*</span>
								</label>
								<div class="input-wrapper">
									<svg class="input-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
										<path
											d="M15 7H14V5C14 3.67392 13.4732 2.40215 12.5355 1.46447C11.5979 0.526784 10.3261 0 9 0C7.67392 0 6.40215 0.526784 5.46447 1.46447C4.52678 2.40215 4 3.67392 4 5V7H3C2.46957 7 1.96086 7.21071 1.58579 7.58579C1.21071 7.96086 1 8.46957 1 9V17C1 17.5304 1.21071 18.0391 1.58579 18.4142C1.96086 18.7893 2.46957 19 3 19H15C15.5304 19 16.0391 18.7893 16.4142 18.4142C16.7893 18.0391 17 17.5304 17 17V9C17 8.46957 16.7893 7.96086 16.4142 7.58579C16.0391 7.21071 15.5304 7 15 7ZM6 5C6 4.20435 6.31607 3.44129 6.87868 2.87868C7.44129 2.31607 8.20435 2 9 2C9.79565 2 10.5587 2.31607 11.1213 2.87868C11.6839 3.44129 12 4.20435 12 5V7H6V5Z"
											fill="currentColor"
										/>
									</svg>
									<input
										type="password"
										id="confirmPassword"
										bind:value={confirmPassword}
										required
										placeholder="Confirm your password"
										autocomplete="new-password"
									/>
								</div>
							</div>
						{/if}

						{#if isLogin}
							<div class="form-options">
								<label class="checkbox-label">
									<input type="checkbox" name="remember" />
									<span>Remember me</span>
								</label>
								<a href="/forgot-password" class="forgot-link">Forgot password?</a>
							</div>
						{/if}
					</div>

					{#if responseError}
						<div class="alert error">
							<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
								<path
									d="M10 0C4.48 0 0 4.48 0 10C0 15.52 4.48 20 10 20C15.52 20 20 15.52 20 10C20 4.48 15.52 0 10 0ZM11 15H9V13H11V15ZM11 11H9V5H11V11Z"
									fill="currentColor"
								/>
							</svg>
							{responseError}
						</div>
					{/if}

					<button type="submit" class="btn-submit" disabled={loading}>
						{#if loading}
							<svg class="spinner" width="20" height="20" viewBox="0 0 20 20" fill="none">
								<circle
									cx="10"
									cy="10"
									r="8"
									stroke="currentColor"
									stroke-width="2"
									opacity="0.25"
								/>
								<path
									d="M10 2C10 2 10 2 10 2C14.4183 2 18 5.58172 18 10"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
								/>
							</svg>
							Processing...
						{:else}
							{isLogin ? 'Sign In' : 'Create Account'}
						{/if}
					</button>
				</form>

				<div class="form-footer">
					<p>
						By continuing, you agree to our <a href="/terms">Terms of Service</a> and
						<a href="/privacy">Privacy Policy</a>
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
	:root {
		--orange: #ff7f50;
		--blue: #29abe2;
		--navy: #2c4a6e;
		--green: #8dc63f;
		--purple: #8b5a9e;
		--gray-50: #f9fafb;
		--gray-100: #f3f4f6;
		--gray-600: #4b5563;
		--gray-900: #111827;
	}

	* {
		margin: 0;
		padding: 0;
		box-sizing: border-box;
	}

	.auth-page {
		font-family:
			'Inter',
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
		display: grid;
		grid-template-columns: 45% 55%;
		/* UPDATED: Dynamic viewport height */
		min-height: 100dvh;
	}

	/* Left Side - Branding */
	.auth-brand {
		background: var(--gray-50);
		position: relative;
		overflow: hidden;
		padding: 48px;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--gray-100);
	}

	.auth-brand::after {
		display: none;
	}

	.brand-content {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.brand-logo {
		display: block;
		margin-bottom: 64px;
	}

	.brand-logo img {
		width: 180px;
		height: 75px;
		object-fit: contain;
	}

	.brand-text {
		margin-bottom: 64px;
	}

	.brand-text h1 {
		font-size: 36px;
		font-weight: 800;
		color: var(--navy);
		margin-bottom: 16px;
		line-height: 1.2;
	}

	.brand-text p {
		font-size: 18px;
		color: var(--gray-600);
		line-height: 1.6;
	}

	.brand-features {
		display: flex;
		flex-direction: column;
		gap: 24px;
		margin-bottom: auto;
	}

	.feature-item {
		display: flex;
		gap: 16px;
		align-items: start;
	}

	.feature-icon {
		width: 48px;
		height: 48px;
		background: white;
		border: 1px solid var(--gray-100);
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--orange);
		flex-shrink: 0;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
	}

	.feature-text h3 {
		font-size: 16px;
		font-weight: 600;
		color: var(--navy);
		margin-bottom: 4px;
	}

	.feature-text p {
		font-size: 14px;
		color: var(--gray-600);
	}

	.brand-stats {
		display: flex;
		gap: 48px;
		padding-top: 48px;
		border-top: 1px solid var(--gray-200);
	}

	.stat {
		text-align: center;
	}

	.stat-value {
		font-size: 24px;
		font-weight: 800;
		color: var(--navy);
		margin-bottom: 4px;
	}

	.stat-label {
		font-size: 13px;
		color: var(--gray-600);
	}

	/* Right Side - Form */
	.auth-form {
		background: white;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 48px;
	}

	.form-container {
		width: 100%;
		max-width: 440px;
	}

	.form-header {
		margin-bottom: 32px;
	}

	.form-header h2 {
		font-size: 28px;
		font-weight: 700;
		color: #111827;
		margin-bottom: 8px;
	}

	.form-header p {
		font-size: 15px;
		color: #6b7280;
	}

	.toggle-link {
		background: none;
		border: none;
		color: var(--orange);
		font-weight: 600;
		cursor: pointer;
		text-decoration: underline;
	}

	.form-fields {
		display: flex;
		flex-direction: column;
		gap: 20px;
		margin-bottom: 24px;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	label {
		font-size: 14px;
		font-weight: 600;
		color: #374151;
	}

	.required {
		color: var(--orange);
	}

	.input-wrapper {
		position: relative;
	}

	.input-icon {
		position: absolute;
		left: 16px;
		top: 50%;
		transform: translateY(-50%);
		color: #9ca3af;
		pointer-events: none;
	}

	input[type='text'],
	input[type='email'],
	input[type='password'] {
		width: 100%;
		padding: 14px 16px 14px 48px;
		border: 2px solid #e5e7eb;
		border-radius: 12px;
		/* UPDATED: Increased font size to prevent iOS zoom */
		font-size: 16px;
		font-family: inherit;
		background: white;
		transition: all 0.2s;
	}

	input:focus {
		outline: none;
		border-color: var(--orange);
		box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1);
	}

	.form-options {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		color: #374151;
		cursor: pointer;
	}

	.checkbox-label input[type='checkbox'] {
		width: 18px;
		height: 18px;
		cursor: pointer;
	}

	.forgot-link {
		font-size: 14px;
		color: var(--orange);
		text-decoration: none;
		font-weight: 600;
	}

	/* UPDATED: Wrap hover in media query */
	@media (hover: hover) {
		.forgot-link:hover {
			text-decoration: underline;
		}
	}

	.alert {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 16px;
		border-radius: 12px;
		font-size: 14px;
		margin-bottom: 20px;
	}

	.alert.error {
		background: #fef2f2;
		color: #991b1b;
	}

	.alert.success {
		background: #f0fdf4;
		color: #166534;
	}

	.btn-submit {
		width: 100%;
		padding: 16px;
		background: var(--orange);
		color: white;
		border: none;
		border-radius: 12px;
		font-size: 16px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}

	/* UPDATED: Wrap hover in media query */
	@media (hover: hover) {
		.btn-submit:hover:not(:disabled) {
			background: #ff6a3d;
			transform: translateY(-1px);
			box-shadow: 0 8px 16px rgba(255, 127, 80, 0.3);
		}
	}

	.btn-submit:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.spinner {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.form-footer {
		margin-top: 24px;
		text-align: center;
	}

	.form-footer p {
		font-size: 13px;
		color: #6b7280;
	}

	.form-footer a {
		color: var(--orange);
		text-decoration: none;
		font-weight: 500;
	}

	/* UPDATED: Wrap hover in media query */
	@media (hover: hover) {
		.form-footer a:hover {
			text-decoration: underline;
		}
	}

	/* [!code ++] New Styles for Biometrics */
	.btn-biometric {
		width: 100%;
		padding: 14px;
		background: white;
		color: var(--gray-900);
		border: 2px solid #e5e7eb;
		border-radius: 12px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		margin-bottom: 24px;
		transition: all 0.2s;
		font-family: inherit;
	}

	@media (hover: hover) {
		.btn-biometric:hover:not(:disabled) {
			background: var(--gray-50);
			border-color: #d1d5db;
		}
	}

	.divider {
		display: flex;
		align-items: center;
		text-align: center;
		margin-bottom: 24px;
		color: #6b7280;
		font-size: 13px;
		font-weight: 500;
	}

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		border-bottom: 1px solid #e5e7eb;
	}

	.divider span {
		padding: 0 12px;
		color: #9ca3af;
		font-weight: 600;
		font-size: 12px;
	}

	/* Responsive */
	@media (max-width: 1024px) {
		.auth-page {
			grid-template-columns: 1fr;
		}

		.auth-brand {
			display: none;
		}
	}

	@media (max-width: 640px) {
		.auth-form {
			padding: 24px;
		}

		.form-header h2 {
			font-size: 24px;
		}
	}
</style>
