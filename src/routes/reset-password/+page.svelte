<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { page } from '$app/state';
  const resolve = (href: string) => `${base}${href}`;

  let password = $state<string>('');
  let confirmPassword = $state<string>('');
  let loading = $state<boolean>(false);
  let error = $state<string>('');
  let success = $state<boolean>(false);

  // Get token from URL
  const token = $derived(() => page.url.searchParams.get('token'));

  async function handleReset() {
    if (password !== confirmPassword) {
      error = 'Passwords do not match';
      return;
    }

    loading = true;
    error = '';

    try {
      const res = await fetch('/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });

      let data: { message?: string } | undefined;
      try {
        data = (await res.json()) as { message?: string };
      } catch {
        // ignore parse errors
      }

      if (res.ok) {
        success = true;
        // eslint-disable-next-line svelte/no-navigation-without-resolve
        setTimeout(() => {
          void goto(resolve('/login'));
        }, 3000);
      } else {
        error = (data && data.message) || 'Failed to reset password.';
      }
    } catch {
      error = 'Network error occurred.';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Set New Password - Go Route Yourself</title>
</svelte:head>

<div class="auth-page">
  <div class="form-container">
    {#if !token}
      <div class="alert error">Invalid link. Please request a new password reset.</div>
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a href={resolve('/forgot-password')} class="back-link">Go to Forgot Password</a>
    {:else if success}
      <div class="alert success">
        <h3>Success!</h3>
        <p>Your password has been reset. Redirecting to login...</p>
      </div>
    {:else}
      <div class="form-header">
        <h1>New Password</h1>
        <p>Enter your new secure password.</p>
      </div>

      {#if error}
        <div class="alert error">{error}</div>
      {/if}

      <form
        onsubmit={(e) => {
          e.preventDefault();
          void handleReset();
        }}
      >
        <div class="field-group">
          <label for="pass">New Password</label>
          <input
            type="password"
            id="pass"
            bind:value={password}
            required
            class="input-field"
            minlength="6"
          />
        </div>

        <div class="field-group">
          <label for="conf">Confirm Password</label>
          <input
            type="password"
            id="conf"
            bind:value={confirmPassword}
            required
            class="input-field"
            minlength="6"
          />
        </div>

        <button type="submit" class="btn-submit" disabled={loading}>
          {loading ? 'Updating...' : 'Set Password'}
        </button>
      </form>
    {/if}
  </div>
</div>

<style>
  /* Same styles as above */
  .auth-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f9fafb;
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
  .form-header {
    margin-bottom: 24px;
    text-align: center;
  }
  h1 {
    font-size: 24px;
    font-weight: 700;
    color: #111827;
    margin: 10px 0;
  }
  p {
    color: #6b7280;
    font-size: 14px;
  }
  .input-field {
    width: 100%;
    padding: 12px;
    border: 2px solid #e5e7eb;
    border-radius: 8px;
    font-size: 15px;
    margin-top: 6px;
  }
  .field-group {
    margin-bottom: 20px;
  }
  .btn-submit {
    width: 100%;
    padding: 12px;
    background: #ff7f50;
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
  }
  .alert {
    padding: 12px;
    border-radius: 8px;
    margin-bottom: 20px;
    font-size: 14px;
  }
  .alert.success {
    background: #f0fdf4;
    color: #166534;
    text-align: center;
  }
  .alert.error {
    background: #fef2f2;
    color: #991b1b;
  }
  .back-link {
    display: block;
    text-align: center;
    color: #ff7f50;
    margin-top: 20px;
    text-decoration: none;
  }
</style>
