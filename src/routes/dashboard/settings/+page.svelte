<!-- src/routes/dashboard/settings/+page.svelte -->
<script lang="ts">
  import { userSettings } from '$lib/stores/userSettings';
  import { auth } from '$lib/stores/auth';
  import { trips } from '$lib/stores/trips';
  import { goto } from '$app/navigation';
  
  let settings = { ...$userSettings };
  let showSuccess = false;
  let showPasswordChange = false;
  let passwordData = {
    current: '',
    new: '',
    confirm: ''
  };
  let passwordError = '';
  
  function saveSettings() {
    userSettings.set(settings);
    showSuccess = true;
    setTimeout(() => showSuccess = false, 3000);
  }
  
  function changePassword() {
    if (passwordData.new !== passwordData.confirm) {
      passwordError = 'Passwords do not match';
      return;
    }
    if (passwordData.new.length < 8) {
      passwordError = 'Password must be at least 8 characters';
      return;
    }
    
    // TODO: Call API to change password
    passwordError = '';
    showPasswordChange = false;
    passwordData = { current: '', new: '', confirm: '' };
    showSuccess = true;
    setTimeout(() => showSuccess = false, 3000);
  }
  
  function exportData() {
    const data = {
      settings: $userSettings,
      trips: $trips,
      exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `goroute-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  
  function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.settings) userSettings.set(data.settings);
          if (data.trips) trips.set(data.trips);
          showSuccess = true;
          setTimeout(() => showSuccess = false, 3000);
        } catch (err) {
          alert('Invalid backup file');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }
  
  function clearAllData() {
    if (!confirm('Are you sure? This will delete ALL your data permanently.')) return;
    if (!confirm('Last chance! This cannot be undone. Delete everything?')) return;
    
    trips.set([]);
    userSettings.set({
      defaultMPG: 25,
      defaultGasPrice: 3.50,
      defaultStartAddress: '',
      defaultEndAddress: '',
      currency: 'USD',
      distanceUnit: 'miles'
    });
    
    showSuccess = true;
    setTimeout(() => showSuccess = false, 3000);
  }
  
  async function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
      await fetch('/logout', { method: 'POST' });
      auth.logout();
      goto('/login');
    }
  }
</script>

<svelte:head>
  <title>Settings - Go Route Yourself</title>
</svelte:head>

<div class="settings">
  <!-- Header -->
  <div class="page-header">
    <div>
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Manage your account and preferences</p>
    </div>
  </div>
  
  <!-- Success Message -->
  {#if showSuccess}
    <div class="alert success">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M16.6 5L7.5 14L3.4 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Settings saved successfully!
    </div>
  {/if}
  
  <div class="settings-grid">
    <!-- Profile Section -->
    <div class="settings-card">
      <div class="card-header">
        <div class="card-icon orange">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 10C12.7614 10 15 7.76142 15 5C15 2.23858 12.7614 0 10 0C7.23858 0 5 2.23858 5 5C5 7.76142 7.23858 10 10 10Z" fill="currentColor"/>
            <path d="M10 12C4.47715 12 0 15.3579 0 19.5C0 19.7761 0.223858 20 0.5 20H19.5C19.7761 20 20 19.7761 20 19.5C20 15.3579 15.5228 12 10 12Z" fill="currentColor"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Profile</h2>
          <p class="card-subtitle">Your account information</p>
        </div>
      </div>
      
      <div class="form-group">
        <label>Name</label>
        <input type="text" placeholder="Your name" value={$auth.user?.name || ''} disabled />
      </div>
      
      <div class="form-group">
        <label>Email</label>
        <input type="email" placeholder="your@email.com" value={$auth.user?.email || ''} disabled />
      </div>
      
      <div class="form-group">
        <label>Current Plan</label>
        <div class="plan-badge">
          {$auth.user?.plan || 'Free'} Plan
        </div>
      </div>
    </div>
    
    <!-- Default Values -->
    <div class="settings-card">
      <div class="card-header">
        <div class="card-icon blue">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2C13.97 2 18 6.03 18 11C18 15.97 13.97 20 9 20H2V13C2 8.03 6.03 4 11 4H18V11C18 6.03 13.97 2 10 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Default Values</h2>
          <p class="card-subtitle">Pre-fill forms with these values</p>
        </div>
      </div>
      
      <div class="form-group">
        <label>Default MPG</label>
        <input 
          type="number" 
          bind:value={settings.defaultMPG}
          placeholder="25"
          min="1"
          step="0.1"
        />
      </div>
      
      <div class="form-group">
        <label>Default Gas Price</label>
        <div class="input-prefix">
          <span class="prefix">$</span>
          <input 
            type="number" 
            bind:value={settings.defaultGasPrice}
            placeholder="3.50"
            min="0"
            step="0.01"
          />
        </div>
      </div>
      
      <div class="form-group">
        <label>Default Start Address</label>
        <input 
          type="text" 
          bind:value={settings.defaultStartAddress}
          placeholder="123 Main St, City, State"
        />
      </div>
      
      <div class="form-group">
        <label>Default End Address</label>
        <input 
          type="text" 
          bind:value={settings.defaultEndAddress}
          placeholder="456 Oak Ave, City, State"
        />
      </div>
      
      <button class="btn-primary" on:click={saveSettings}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M16.6 5L7.5 14L3.4 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Save Default Values
      </button>
    </div>
    
    <!-- Preferences -->
    <div class="settings-card">
      <div class="card-header">
        <div class="card-icon green">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 12C11.1046 12 12 11.1046 12 10C12 8.89543 11.1046 8 10 8C8.89543 8 8 8.89543 8 10C8 11.1046 8.89543 12 10 12Z" stroke="currentColor" stroke-width="2"/>
            <path d="M16.2 12C16.1 12.5 16.3 13 16.7 13.3L16.8 13.4C17.1 13.7 17.3 14.1 17.3 14.5C17.3 14.9 17.1 15.3 16.8 15.6C16.5 15.9 16.1 16.1 15.7 16.1C15.3 16.1 14.9 15.9 14.6 15.6L14.5 15.5C14.2 15.1 13.7 14.9 13.2 15C12.7 15.1 12.4 15.5 12.3 16V16.2C12.3 17.1 11.6 17.8 10.7 17.8C9.8 17.8 9.1 17.1 9.1 16.2V16.1C9 15.5 8.6 15.1 8 15C7.5 15 7 15.2 6.7 15.6L6.6 15.7C6.3 16 5.9 16.2 5.5 16.2C5.1 16.2 4.7 16 4.4 15.7C4.1 15.4 3.9 15 3.9 14.6C3.9 14.2 4.1 13.8 4.4 13.5L4.5 13.4C4.9 13.1 5.1 12.6 5 12.1C4.9 11.6 4.5 11.3 4 11.2H3.8C2.9 11.2 2.2 10.5 2.2 9.6C2.2 8.7 2.9 8 3.8 8H3.9C4.5 7.9 4.9 7.5 5 6.9C5 6.4 4.8 5.9 4.4 5.6L4.3 5.5C4 5.2 3.8 4.8 3.8 4.4C3.8 4 4 3.6 4.3 3.3C4.6 3 5 2.8 5.4 2.8C5.8 2.8 6.2 3 6.5 3.3L6.6 3.4C7 3.8 7.5 4 8 3.9C8.5 3.9 8.8 3.5 8.9 3V2.8C8.9 1.9 9.6 1.2 10.5 1.2C11.4 1.2 12.1 1.9 12.1 2.8V2.9C12.1 3.5 12.5 3.9 13.1 4C13.6 4.1 14.1 3.9 14.4 3.5L14.5 3.4C14.8 3.1 15.2 2.9 15.6 2.9C16 2.9 16.4 3.1 16.7 3.4C17 3.7 17.2 4.1 17.2 4.5C17.2 4.9 17 5.3 16.7 5.6L16.6 5.7C16.2 6 16 6.5 16.1 7C16.2 7.5 16.6 7.8 17.1 7.9H17.3C18.2 7.9 18.9 8.6 18.9 9.5C18.9 10.4 18.2 11.1 17.3 11.1H17.2C16.6 11.2 16.2 11.6 16.1 12.2L16.2 12Z" stroke="currentColor" stroke-width="2"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Preferences</h2>
          <p class="card-subtitle">Customize your experience</p>
        </div>
      </div>
      
      <div class="form-group">
        <label>Distance Unit</label>
        <select bind:value={settings.distanceUnit}>
          <option value="miles">Miles</option>
          <option value="km">Kilometers</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>Currency</label>
        <select bind:value={settings.currency}>
          <option value="USD">USD ($)</option>
          <option value="EUR">EUR (€)</option>
          <option value="GBP">GBP (£)</option>
          <option value="JPY">JPY (¥)</option>
        </select>
      </div>
      
      <button class="btn-primary" on:click={saveSettings}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M16.6 5L7.5 14L3.4 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Save Preferences
      </button>
    </div>
    
    <!-- Security -->
    <div class="settings-card">
      <div class="card-header">
        <div class="card-icon purple">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M15 7H14V5C14 3.67392 13.4732 2.40215 12.5355 1.46447C11.5979 0.526784 10.3261 0 9 0C7.67392 0 6.40215 0.526784 5.46447 1.46447C4.52678 2.40215 4 3.67392 4 5V7H3C2.46957 7 1.96086 7.21071 1.58579 7.58579C1.21071 7.96086 1 8.46957 1 9V17C1 17.5304 1.21071 18.0391 1.58579 18.4142C1.96086 18.7893 2.46957 19 3 19H15C15.5304 19 16.0391 18.7893 16.4142 18.4142C16.7893 18.0391 17 17.5304 17 17V9C17 8.46957 16.7893 7.96086 16.4142 7.58579C16.0391 7.21071 15.5304 7 15 7ZM6 5C6 4.20435 6.31607 3.44129 6.87868 2.87868C7.44129 2.31607 8.20435 2 9 2C9.79565 2 10.5587 2.31607 11.1213 2.87868C11.6839 3.44129 12 4.20435 12 5V7H6V5Z" fill="currentColor"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Security</h2>
          <p class="card-subtitle">Password and authentication</p>
        </div>
      </div>
      
      {#if !showPasswordChange}
        <button class="btn-secondary" on:click={() => showPasswordChange = true}>
          Change Password
        </button>
      {:else}
        <div class="password-change">
          {#if passwordError}
            <div class="alert error">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 0C4.48 0 0 4.48 0 10C0 15.52 4.48 20 10 20C15.52 20 20 15.52 20 10C20 4.48 15.52 0 10 0ZM11 15H9V13H11V15ZM11 11H9V5H11V11Z" fill="currentColor"/>
              </svg>
              {passwordError}
            </div>
          {/if}
          
          <div class="form-group">
            <label>Current Password</label>
            <input 
              type="password" 
              bind:value={passwordData.current}
              placeholder="Enter current password"
            />
          </div>
          
          <div class="form-group">
            <label>New Password</label>
            <input 
              type="password" 
              bind:value={passwordData.new}
              placeholder="Enter new password"
            />
          </div>
          
          <div class="form-group">
            <label>Confirm New Password</label>
            <input 
              type="password" 
              bind:value={passwordData.confirm}
              placeholder="Confirm new password"
            />
          </div>
          
          <div class="button-group">
            <button class="btn-primary" on:click={changePassword}>
              Update Password
            </button>
            <button class="btn-secondary" on:click={() => {
              showPasswordChange = false;
              passwordData = { current: '', new: '', confirm: '' };
              passwordError = '';
            }}>
              Cancel
            </button>
          </div>
        </div>
      {/if}
    </div>
    
    <!-- Data Management -->
    <div class="settings-card">
      <div class="card-header">
        <div class="card-icon navy">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M17 2H3C2.46957 2 1.96086 2.21071 1.58579 2.58579C1.21071 2.96086 1 3.46957 1 4V16C1 16.5304 1.21071 17.0391 1.58579 17.4142C1.96086 17.7893 2.46957 18 3 18H17C17.5304 18 18.0391 17.7893 18.4142 17.4142C18.7893 17.0391 19 16.5304 19 16V4C19 3.46957 18.7893 2.96086 18.4142 2.58579C18.0391 2.21071 17.5304 2 17 2Z" stroke="currentColor" stroke-width="2"/>
            <path d="M1 8H19M6 1V3M14 1V3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Data Management</h2>
          <p class="card-subtitle">Export, import, or delete your data</p>
        </div>
      </div>
      
      <div class="data-actions">
        <button class="action-btn" on:click={exportData}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M16 11V15C16 15.5304 15.7893 16.0391 15.4142 16.4142C15.0391 16.7893 14.5304 17 14 17H4C3.46957 17 2.96086 16.7893 2.58579 16.4142C2.21071 16.0391 2 15.5304 2 15V11M5 7L9 3M9 3L13 7M9 3V13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div>
            <div class="action-title">Export Data</div>
            <div class="action-subtitle">Download backup as JSON</div>
          </div>
        </button>
        
        <button class="action-btn" on:click={importData}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M16 11V15C16 15.5304 15.7893 16.0391 15.4142 16.4142C15.0391 16.7893 14.5304 17 14 17H4C3.46957 17 2.96086 16.7893 2.58579 16.4142C2.21071 16.0391 2 15.5304 2 15V11M13 7L9 11M9 11L5 7M9 11V1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div>
            <div class="action-title">Import Data</div>
            <div class="action-subtitle">Restore from backup</div>
          </div>
        </button>
        
        <button class="action-btn danger" on:click={clearAllData}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M2 5H4H18M17 5V17C17 17.5304 16.7893 18.0391 16.4142 18.4142C16.0391 18.7893 15.5304 19 15 19H5C4.46957 19 3.96086 18.7893 3.58579 18.4142C3.21071 18.0391 3 17.5304 3 17V5M6 5V3C6 2.46957 6.21071 1.96086 6.58579 1.58579C6.96086 1.21071 7.46957 1 8 1H12C12.5304 1 13.0391 1.21071 13.4142 1.58579C13.7893 1.96086 14 2.46957 14 3V5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div>
            <div class="action-title">Clear All Data</div>
            <div class="action-subtitle">Permanently delete everything</div>
          </div>
        </button>
      </div>
    </div>
    
    <!-- Account Actions -->
    <div class="settings-card danger-card">
      <div class="card-header">
        <div class="card-icon red">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M7 17H3C2.46957 17 1.96086 16.7893 1.58579 16.4142C1.21071 16.0391 1 15.5304 1 15V3C1 2.46957 1.21071 1.96086 1.58579 1.58579C1.96086 1.21071 2.46957 1 3 1H7M13 13L17 9M17 9L13 5M17 9H7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Account Actions</h2>
          <p class="card-subtitle">Sign out or delete account</p>
        </div>
      </div>
      
      <div class="danger-actions">
        <button class="btn-logout" on:click={handleLogout}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M7 17H3C2.46957 17 1.96086 16.7893 1.58579 16.4142C1.21071 16.0391 1 15.5304 1 15V3C1 2.46957 1.21071 1.96086 1.58579 1.58579C1.96086 1.21071 2.46957 1 3 1H7M13 13L17 9M17 9L13 5M17 9H7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Logout
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .settings {
    max-width: 1200px;
  }
  
  .page-header {
    margin-bottom: 32px;
  }
  
  .page-title {
    font-size: 32px;
    font-weight: 800;
    color: #111827;
    margin-bottom: 4px;
  }
  
  .page-subtitle {
    font-size: 16px;
    color: #6B7280;
  }
  
  .alert {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 24px;
  }
  
  .alert.success {
    background: #F0FDF4;
    color: #166534;
    border: 1px solid #BBF7D0;
  }
  
  .alert.error {
    background: #FEF2F2;
    color: #991B1B;
    border: 1px solid #FECACA;
  }
  
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 24px;
  }
  
  .settings-card {
    background: white;
    border: 1px solid #E5E7EB;
    border-radius: 16px;
    padding: 24px;
  }
  
  .settings-card.danger-card {
    border-color: #FEE2E2;
    background: #FEF2F2;
  }
  
  .card-header {
    display: flex;
    gap: 16px;
    margin-bottom: 24px;
    padding-bottom: 20px;
    border-bottom: 1px solid #E5E7EB;
  }
  
  .card-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    flex-shrink: 0;
  }
  
  .card-icon.orange {
    background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%);
  }
  
  .card-icon.blue {
    background: linear-gradient(135deg, var(--blue) 0%, #1E9BCF 100%);
  }
  
  .card-icon.green {
    background: linear-gradient(135deg, var(--green) 0%, #7AB82E 100%);
  }
  
  .card-icon.purple {
    background: linear-gradient(135deg, var(--purple) 0%, #764a89 100%);
  }
  
  .card-icon.navy {
    background: linear-gradient(135deg, var(--navy) 0%, #1a3a5c 100%);
  }
  
  .card-icon.red {
    background: linear-gradient(135deg, #DC2626 0%, #B91C1C 100%);
  }
  
  .card-title {
    font-size: 18px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 4px;
  }
  
  .card-subtitle {
    font-size: 14px;
    color: #6B7280;
  }
  
  .form-group {
    margin-bottom: 20px;
  }
  
  .form-group label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
    margin-bottom: 8px;
  }
  
  .form-group input,
  .form-group select {
    width: 100%;
    padding: 12px 16px;
    border: 2px solid #E5E7EB;
    border-radius: 10px;
    font-size: 15px;
    font-family: inherit;
    background: white;
    transition: all 0.2s;
  }
  
  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: var(--orange);
    box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1);
  }
  
  .form-group input:disabled {
    background: #F9FAFB;
    color: #9CA3AF;
    cursor: not-allowed;
  }
  
  .input-prefix {
    position: relative;
  }
  
  .input-prefix .prefix {
    position: absolute;
    left: 16px;
    top: 50%;
    transform: translateY(-50%);
    color: #6B7280;
    font-weight: 600;
  }
  
  .input-prefix input {
    padding-left: 36px;
  }
  
  .plan-badge {
    display: inline-block;
    padding: 8px 16px;
    background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%);
    color: white;
    border-radius: 8px;
    font-weight: 600;
    font-size: 14px;
  }
  
  .btn-primary {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 24px;
    background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%);
    color: white;
    border: none;
    border-radius: 10px;
    font-weight: 600;
    font-size: 15px;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
  }
  
  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 16px rgba(255, 127, 80, 0.3);
  }
  
  .btn-secondary {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 24px;
    background: white;
    color: #374151;
    border: 2px solid #E5E7EB;
    border-radius: 10px;
    font-weight: 600;
    font-size: 15px;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
  }
  
  .btn-secondary:hover {
    border-color: var(--orange);
    color: var(--orange);
  }
  
  .password-change {
    margin-top: 16px;
  }
  
  .button-group {
    display: flex;
    gap: 12px;
  }
  
  .button-group .btn-primary,
  .button-group .btn-secondary {
    flex: 1;
  }
  
  .data-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .action-btn {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    background: #F9FAFB;
    border: 2px solid #E5E7EB;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
    text-align: left;
    width: 100%;
  }
  
  .action-btn:hover {
    border-color: var(--orange);
    background: white;
  }
  
  .action-btn.danger:hover {
    border-color: #DC2626;
    background: white;
  }
  
  .action-btn svg {
    color: #6B7280;
    flex-shrink: 0;
  }
  
  .action-btn.danger svg {
    color: #DC2626;
  }
  
  .action-title {
    font-size: 15px;
    font-weight: 600;
    color: #111827;
    margin-bottom: 2px;
  }
  
  .action-subtitle {
    font-size: 13px;
    color: #6B7280;
  }
  
  .danger-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .btn-logout {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 24px;
    background: white;
    color: #DC2626;
    border: 2px solid #FEE2E2;
    border-radius: 10px;
    font-weight: 600;
    font-size: 15px;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
  }
  
  .btn-logout:hover {
    background: #FEF2F2;
    border-color: #FCA5A5;
  }
  
  @media (max-width: 1024px) {
    .settings-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
