<script lang="ts">
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';

    let username = '';
    let email = '';
    let password = '';
    let confirmPassword = '';
    let responseError: string | null = null;
    let loading = false;
    // [!code ++] New state for success message
    let registrationSuccess = false; 

    $: isLogin = $page.url.searchParams.get('view') !== 'register';

    function toggleMode() {
        const url = new URL($page.url);
        if (isLogin) url.searchParams.set('view', 'register');
        else url.searchParams.delete('view');
        goto(url.pathname + url.search, { replaceState: true });
        
        username = ''; email = ''; password = ''; confirmPassword = '';
        responseError = null;
        registrationSuccess = false; // Reset success state
    }

    async function submitHandler() {
        responseError = null;
        loading = true;

        const endpoint = isLogin ? '/api/login' : '/register'; // Ensure endpoints match your structure
        
        // ... (Keep existing client-side validation logic) ...
        let payload = {};
        if (isLogin) {
             payload = { email: username, password }; // Note: Server expects 'email' key even for username
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
                    // Login Success -> Dashboard
                    await goto('/dashboard', { invalidateAll: true });
                } else {
                    // [!code ++] Registration Success -> Show Message
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

<div class="auth-page">
    <div class="auth-form">
        <div class="form-container">
            
            {#if registrationSuccess}
                <div class="success-view" style="text-align: center;">
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
                    </div>
                
                <form on:submit|preventDefault={submitHandler}>
                    <button type="submit" class="btn-submit" disabled={loading}>
                        {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
                    </button>
                </form>
                {/if}
        </div>
    </div>
</div>