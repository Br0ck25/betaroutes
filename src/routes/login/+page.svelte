<script lang="ts">
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';

    let username = '';
    let email = '';
    let password = '';
    let confirmPassword = '';
    let responseError: string | null = null;
    let loading = false;
    let registrationSuccess = false; 

    $: isLogin = $page.url.searchParams.get('view') !== 'register';

    function toggleMode() {
        const url = new URL($page.url);
        if (isLogin) url.searchParams.set('view', 'register');
        else url.searchParams.delete('view');
        goto(url.pathname + url.search, { replaceState: true });
        
        username = ''; email = ''; password = ''; confirmPassword = '';
        responseError = null;
        registrationSuccess = false;
    }

    async function submitHandler() {
        responseError = null;
        loading = true;

        // Ensure we hit the correct API endpoint
        const endpoint = isLogin ? '/api/login' : '/register';
        
        let payload = {};
        if (isLogin) {
             // Login expects 'email' key even for username input
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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (response.ok) {
                if (isLogin) {
                    await goto('/dashboard', { invalidateAll: true });
                } else {
                    // Show success message instead of redirecting
                    registrationSuccess = true;
                    username = ''; email = ''; password = ''; confirmPassword = '';
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
</svelte:head>

<div class="auth-page">
	<div class="auth-brand">
		<div class="brand-content">
			<a href="/" class="brand-logo">
				<img src="/logo.png" alt="Go Route Yourself" />
			</a>
			<div class="brand-text">
				<h1>Welcome to Go Route Yourself</h1>
				<p>Professional route planning and profit tracking for delivery drivers and field workers.</p>
			</div>
		</div>
	</div>
	
	<div class="auth-form">
		<div class="form-container">
            {#if registrationSuccess}
                <div style="text-align: center;">
                    <div style="background: #F0FDF4; color: #166534; padding: 24px; border-radius: 12px; border: 1px solid #BBF7D0; margin-bottom: 24px;">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px auto;">
                            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 8px;">Check your inbox!</h3>
                        <p style="font-size: 15px;">We've sent a verification link to your email address. Please click it to activate your account.</p>
                    </div>
                    <button class="toggle-link" on:click={() => { registrationSuccess = false; toggleMode(); }}>
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
                    <div class="form-fields">
                        <div class="field-group">
                            <label for="username">{isLogin ? 'Username or Email' : 'Username'}</label>
                            <input type="text" id="username" bind:value={username} required placeholder={isLogin ? 'Enter username' : 'Choose username'} />
                        </div>
                        
                        {#if !isLogin}
                            <div class="field-group">
                                <label for="email">Email Address</label>
                                <input type="email" id="email" bind:value={email} required placeholder="Enter email" />
                            </div>
                        {/if}
                        
                        <div class="field-group">
                            <label for="password">Password</label>
                            <input type="password" id="password" bind:value={password} required placeholder="Enter password" />
                        </div>
                        
                        {#if !isLogin}
                            <div class="field-group">
                                <label for="confirmPassword">Confirm Password</label>
                                <input type="password" id="confirmPassword" bind:value={confirmPassword} required placeholder="Confirm password" />
                            </div>
                        {/if}
                    </div>
                    
                    {#if responseError}
                        <div class="alert error">{responseError}</div>
                    {/if}
                    
                    <button type="submit" class="btn-submit" disabled={loading}>
                        {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
                    </button>
                </form>
            {/if}
		</div>
	</div>
</div>

<style>
    /* ... Keep your existing CSS ... */
    /* Minimal restoration of styles used above to ensure it looks okay even if you paste over */
    .auth-page { display: grid; grid-template-columns: 45% 55%; min-height: 100vh; font-family: sans-serif; }
    .auth-brand { background: #2C4A6E; padding: 48px; color: white; }
    .auth-form { display: flex; align-items: center; justify-content: center; padding: 48px; background: #F9FAFB; }
    .form-container { width: 100%; max-width: 440px; }
    .form-fields { display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px; }
    .field-group { display: flex; flex-direction: column; gap: 8px; }
    input { padding: 12px; border: 1px solid #E5E7EB; border-radius: 8px; font-size: 16px; }
    .btn-submit { width: 100%; padding: 14px; background: #FF7F50; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
    .toggle-link { background: none; border: none; color: #FF7F50; cursor: pointer; text-decoration: underline; font-weight: 600; }
    .alert.error { background: #FEF2F2; color: #991B1B; padding: 12px; border-radius: 8px; margin-bottom: 16px; }
    @media (max-width: 1024px) { .auth-page { grid-template-columns: 1fr; } .auth-brand { display: none; } }
</style>