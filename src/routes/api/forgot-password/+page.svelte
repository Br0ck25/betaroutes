<script lang="ts">
    let email = '';
    let loading = false;
    let message = '';
    let error = '';

    async function handleSubmit() {
        loading = true;
        message = '';
        error = '';

        try {
            const res = await fetch('/api/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            const data: any = await res.json();

            if (res.ok) {
                message = 'If an account exists with that email, we have sent a reset link.';
                email = ''; // Clear form
            } else {
                error = data.message || 'An error occurred.';
            }
        } catch (err) {
            error = 'Network error. Please try again.';
        } finally {
            loading = false;
        }
    }
</script>

<svelte:head>
    <title>Forgot Password - Go Route Yourself</title>
</svelte:head>

<div class="auth-page">
    <div class="form-container">
        <div class="form-header">
            <a href="/login" class="back-link">← Back to Login</a>
            <h1>Reset Password</h1>
            <p>Enter your email to receive a reset link.</p>
        </div>

        {#if message}
            <div class="alert success">{message}</div>
        {/if}

        {#if error}
            <div class="alert error">{error}</div>
        {/if}

        <form on:submit|preventDefault={handleSubmit}>
            <div class="field-group">
                <label for="email">Email Address</label>
                <input 
                    type="email" 
                    id="email" 
                    bind:value={email} 
                    required 
                    placeholder="Enter your email" 
                    class="input-field"
                />
            </div>

            <button type="submit" class="btn-submit" disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
        </form>
    </div>
</div>

<style>
    /* Reusing similar styles to your login page for consistency */
    .auth-page {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #F9FAFB;
        font-family: 'Inter', sans-serif;
    }
    .form-container {
        background: white;
        padding: 40px;
        border-radius: 12px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        width: 100%;
        max-width: 400px;
    }
    .form-header { margin-bottom: 24px; text-align: center; }
    h1 { font-size: 24px; font-weight: 700; color: #111827; margin: 10px 0; }
    p { color: #6B7280; font-size: 14px; }
    .back-link { color: #FF7F50; text-decoration: none; font-size: 14px; font-weight: 600; }
    .input-field {
        width: 100%;
        padding: 12px;
        border: 2px solid #E5E7EB;
        border-radius: 8px;
        font-size: 15px;
        margin-top: 6px;
    }
    .field-group { margin-bottom: 20px; }
    .btn-submit {
        width: 100%;
        padding: 12px;
        background: #FF7F50;
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
    }
    .btn-submit:disabled { opacity: 0.7; }
    .alert { padding: 12px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; }
    .alert.success { background: #F0FDF4; color: #166534; }
    .alert.error { background: #FEF2F2; color: #991B1B; }
</style>