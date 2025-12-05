<!-- src/routes/login/+page.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData } from './$types';
  
  export let form: ActionData;
  
  let isLogin = true;
  let loading = false;
  
  function toggleMode() {
    isLogin = !isLogin;
    form = null;
  }
</script>

<svelte:head>
  <title>{isLogin ? 'Sign In' : 'Sign Up'} - Go Route Yourself</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</svelte:head>

<div class="auth-page">
  <!-- Left Side - Branding -->
  <div class="auth-brand">
    <div class="brand-content">
      <a href="/" class="brand-logo">
        <img src="/logo.png" alt="Go Route Yourself" />
      </a>
      
      <div class="brand-text">
        <h1>Welcome to Go Route Yourself</h1>
        <p>Professional route planning and profit tracking for delivery drivers and field workers.</p>
      </div>
      
      <div class="brand-features">
        <div class="feature-item">
          <div class="feature-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M9 11L12 14L22 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M21 12V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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
              <path d="M21 16V8C20.9996 7.64927 20.9071 7.30481 20.7315 7.00116C20.556 6.69751 20.3037 6.44536 20 6.27L13 2.27C12.696 2.09446 12.3511 2.00205 12 2.00205C11.6489 2.00205 11.304 2.09446 11 2.27L4 6.27C3.69626 6.44536 3.44398 6.69751 3.26846 7.00116C3.09294 7.30481 3.00036 7.64927 3 8V16C3.00036 16.3507 3.09294 16.6952 3.26846 16.9988C3.44398 17.3025 3.69626 17.5546 4 17.73L11 21.73C11.304 21.9055 11.6489 21.9979 12 21.9979C12.3511 21.9979 12.696 21.9055 13 21.73L20 17.73C20.3037 17.5546 20.556 17.3025 20.7315 16.9988C20.9071 16.6952 20.9996 16.3507 21 16Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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
  
  <!-- Right Side - Form -->
  <div class="auth-form">
    <div class="form-container">
      <div class="form-header">
        <h2>{isLogin ? 'Sign in to your account' : 'Create your account'}</h2>
        <p>
          {isLogin ? "Don't have an account?" : 'Already have an account?'}
          <button class="toggle-link" on:click={toggleMode}>
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
      
      <form method="POST" action={isLogin ? '?/login' : '?/signup'} use:enhance={() => {
        loading = true;
        return async ({ update }) => {
          await update();
          loading = false;
        };
      }}>
        <div class="form-fields">
          <div class="field-group">
            <label for="username">
              Username
              <span class="required">*</span>
            </label>
            <div class="input-wrapper">
              <svg class="input-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 10C12.7614 10 15 7.76142 15 5C15 2.23858 12.7614 0 10 0C7.23858 0 5 2.23858 5 5C5 7.76142 7.23858 10 10 10Z" fill="currentColor"/>
                <path d="M10 12C4.47715 12 0 15.3579 0 19.5C0 19.7761 0.223858 20 0.5 20H19.5C19.7761 20 20 19.7761 20 19.5C20 15.3579 15.5228 12 10 12Z" fill="currentColor"/>
              </svg>
              <input 
                type="text" 
                id="username" 
                name="username" 
                required 
                placeholder="Enter your username"
                autocomplete="username"
              />
            </div>
          </div>
          
          <div class="field-group">
            <label for="password">
              Password
              <span class="required">*</span>
            </label>
            <div class="input-wrapper">
              <svg class="input-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M15 7H14V5C14 3.67392 13.4732 2.40215 12.5355 1.46447C11.5979 0.526784 10.3261 0 9 0C7.67392 0 6.40215 0.526784 5.46447 1.46447C4.52678 2.40215 4 3.67392 4 5V7H3C2.46957 7 1.96086 7.21071 1.58579 7.58579C1.21071 7.96086 1 8.46957 1 9V17C1 17.5304 1.21071 18.0391 1.58579 18.4142C1.96086 18.7893 2.46957 19 3 19H15C15.5304 19 16.0391 18.7893 16.4142 18.4142C16.7893 18.0391 17 17.5304 17 17V9C17 8.46957 16.7893 7.96086 16.4142 7.58579C16.0391 7.21071 15.5304 7 15 7ZM6 5C6 4.20435 6.31607 3.44129 6.87868 2.87868C7.44129 2.31607 8.20435 2 9 2C9.79565 2 10.5587 2.31607 11.1213 2.87868C11.6839 3.44129 12 4.20435 12 5V7H6V5Z" fill="currentColor"/>
              </svg>
              <input 
                type="password" 
                id="password" 
                name="password" 
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
                  <path d="M15 7H14V5C14 3.67392 13.4732 2.40215 12.5355 1.46447C11.5979 0.526784 10.3261 0 9 0C7.67392 0 6.40215 0.526784 5.46447 1.46447C4.52678 2.40215 4 3.67392 4 5V7H3C2.46957 7 1.96086 7.21071 1.58579 7.58579C1.21071 7.96086 1 8.46957 1 9V17C1 17.5304 1.21071 18.0391 1.58579 18.4142C1.96086 18.7893 2.46957 19 3 19H15C15.5304 19 16.0391 18.7893 16.4142 18.4142C16.7893 18.0391 17 17.5304 17 17V9C17 8.46957 16.7893 7.96086 16.4142 7.58579C16.0391 7.21071 15.5304 7 15 7ZM6 5C6 4.20435 6.31607 3.44129 6.87868 2.87868C7.44129 2.31607 8.20435 2 9 2C9.79565 2 10.5587 2.31607 11.1213 2.87868C11.6839 3.44129 12 4.20435 12 5V7H6V5Z" fill="currentColor"/>
                </svg>
                <input 
                  type="password" 
                  id="confirmPassword" 
                  name="confirmPassword" 
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
        
        {#if form?.error}
          <div class="alert error">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 0C4.48 0 0 4.48 0 10C0 15.52 4.48 20 10 20C15.52 20 20 15.52 20 10C20 4.48 15.52 0 10 0ZM11 15H9V13H11V15ZM11 11H9V5H11V11Z" fill="currentColor"/>
            </svg>
            {form.error}
          </div>
        {/if}
        
        {#if form?.success}
          <div class="alert success">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 0C4.48 0 0 4.48 0 10C0 15.52 4.48 20 10 20C15.52 20 20 15.52 20 10C20 4.48 15.52 0 10 0ZM8 15L3 10L4.41 8.59L8 12.17L15.59 4.58L17 6L8 15Z" fill="currentColor"/>
            </svg>
            {form.message}
          </div>
        {/if}
        
        <button type="submit" class="btn-submit" disabled={loading}>
          {#if loading}
            <svg class="spinner" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="2" opacity="0.25"/>
              <path d="M10 2C10 2 10 2 10 2C14.4183 2 18 5.58172 18 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Processing...
          {:else}
            {isLogin ? 'Sign In' : 'Create Account'}
          {/if}
        </button>
      </form>
      
      <div class="form-footer">
        <p>By continuing, you agree to our <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a></p>
      </div>
    </div>
  </div>
</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  
  :root {
    --orange: #FF7F50;
    --blue: #29ABE2;
    --navy: #2C4A6E;
    --green: #8DC63F;
    --purple: #8B5A9E;
  }
  
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  
  .auth-page {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: grid;
    grid-template-columns: 45% 55%;
    min-height: 100vh;
  }
  
  /* Left Side - Branding */
  .auth-brand {
    background: linear-gradient(135deg, var(--navy) 0%, #1a3a5c 100%);
    position: relative;
    overflow: hidden;
    padding: 48px;
    display: flex;
    flex-direction: column;
  }
  
  .auth-brand::after {
    content: '';
    position: absolute;
    inset: 0;
    background: 
      radial-gradient(circle at 20% 30%, rgba(41, 171, 226, 0.15) 0%, transparent 50%),
      radial-gradient(circle at 80% 70%, rgba(141, 198, 63, 0.15) 0%, transparent 50%);
    pointer-events: none;
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
    height: 48px;
    width: auto;
  }
  
  .brand-text {
    margin-bottom: 64px;
  }
  
  .brand-text h1 {
    font-size: 36px;
    font-weight: 800;
    color: white;
    margin-bottom: 16px;
    line-height: 1.2;
  }
  
  .brand-text p {
    font-size: 18px;
    color: rgba(255, 255, 255, 0.8);
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
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(8px);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--orange);
    flex-shrink: 0;
  }
  
  .feature-text h3 {
    font-size: 16px;
    font-weight: 600;
    color: white;
    margin-bottom: 4px;
  }
  
  .feature-text p {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.7);
  }
  
  .brand-stats {
    display: flex;
    gap: 48px;
    padding-top: 48px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .stat {
    text-align: center;
  }
  
  .stat-value {
    font-size: 24px;
    font-weight: 800;
    color: white;
    margin-bottom: 4px;
  }
  
  .stat-label {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
  }
  
  /* Right Side - Form */
  .auth-form {
    background: #F9FAFB;
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
    color: #6B7280;
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
    color: #9CA3AF;
    pointer-events: none;
  }
  
  input[type="text"],
  input[type="password"] {
    width: 100%;
    padding: 14px 16px 14px 48px;
    border: 2px solid #E5E7EB;
    border-radius: 12px;
    font-size: 15px;
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
  
  .checkbox-label input[type="checkbox"] {
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
  
  .forgot-link:hover {
    text-decoration: underline;
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
    background: #FEF2F2;
    color: #991B1B;
  }
  
  .alert.success {
    background: #F0FDF4;
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
  
  .btn-submit:hover:not(:disabled) {
    background: #FF6A3D;
    transform: translateY(-1px);
    box-shadow: 0 8px 16px rgba(255, 127, 80, 0.3);
  }
  
  .btn-submit:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .spinner {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  .form-footer {
    margin-top: 24px;
    text-align: center;
  }
  
  .form-footer p {
    font-size: 13px;
    color: #6B7280;
  }
  
  .form-footer a {
    color: var(--orange);
    text-decoration: none;
    font-weight: 500;
  }
  
  .form-footer a:hover {
    text-decoration: underline;
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
