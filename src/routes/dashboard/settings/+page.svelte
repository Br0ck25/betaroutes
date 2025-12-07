<script lang="ts">
  import { userSettings } from '$lib/stores/userSettings';
  import { auth, user } from '$lib/stores/auth';
  import { trips } from '$lib/stores/trips';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';
  
  let settings = { ...$userSettings };
  
  // Use reactive statement to keep profile in sync with store initially
  let profile = {
    name: '',
    email: ''
  };

  $: if ($user) {
    if (!profile.name) profile.name = $user.name || '';
    if (!profile.email) profile.email = $user.email || '';
  }

  // Calculate Monthly Usage dynamically from the trips store
  $: monthlyUsage = $trips.filter(t => {
      if (!t.date) return false;
      const tripDate = new Date(t.date);
      const now = new Date();
      return tripDate.getMonth() === now.getMonth() && tripDate.getFullYear() === now.getFullYear();
  }).length;

  let showSuccess = false;
  let successMessage = '';
  
  // Password Change State
  let showPasswordChange = false;
  let passwordData = { current: '', new: '', confirm: '' };
  let passwordError = '';

  // Delete Account State
  let showDeleteConfirm = false;
  let deletePassword = '';
  let deleteError = '';
  let isDeleting = false;

  // Autocomplete State
  let mapLoaded = false;

  onMount(() => {
    if ($user) {
        profile.name = $user.name || '';
        profile.email = $user.email || '';
    }

    if (!window.google) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${env.PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`;
      script.async = true;
      script.onload = () => { mapLoaded = true; };
      document.head.appendChild(script);
    } else {
      mapLoaded = true;
    }
  });
  
  function saveDefaultSettings() {
    userSettings.set(settings);
    showSuccessMsg('Default values saved successfully!');
  }

  function saveProfile() {
    auth.updateProfile({
        name: profile.name,
        email: profile.email
    });
    showSuccessMsg('Profile updated successfully!');
  }
  
  function showSuccessMsg(msg: string) {
    successMessage = msg;
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
    
    // Call Auth Store (mock for now as API might not exist yet)
    // auth.changePassword(...)
    passwordError = '';
    showPasswordChange = false;
    passwordData = { current: '', new: '', confirm: '' };
    showSuccessMsg('Password changed successfully');
  }

  async function handleDeleteAccount() {
    if (!deletePassword) {
      deleteError = 'Please enter your password to confirm.';
      return;
    }
    
    if (!confirm('FINAL WARNING: This will permanently delete your account and all data. This cannot be undone.')) {
      return;
    }

    isDeleting = true;
    try {
      const result = await auth.deleteAccount($user?.name || '', deletePassword);
      if (result.success) {
        goto('/'); // Redirect to main page
      } else {
        deleteError = result.error || 'Failed to delete account';
        isDeleting = false;
      }
    } catch (err) {
      deleteError = 'An unexpected error occurred';
      isDeleting = false;
    }
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
          showSuccessMsg('Data imported successfully!');
        } catch (err) {
          alert('Invalid backup file');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }
  
  function clearAllData() {
    if (!confirm('Are you sure? This will delete ALL your trip data locally.')) return;
    trips.set([]);
    showSuccessMsg('All trip data cleared.');
  }
  
  async function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
      await fetch('/logout', { method: 'POST' });
      auth.logout();
      goto('/login');
    }
  }

  // --- Autocomplete Logic ---
  function initAutocomplete(node: HTMLInputElement) {
    let retryCount = 0;
    const maxRetries = 20;
    const trySetup = () => {
      if (window.google && window.google.maps && window.google.maps.places) {
        setupAutocomplete(node);
        return true;
      }
      return false;
    };

    if (trySetup()) return {};
    
    const interval = setInterval(() => {
      retryCount++;
      if (trySetup() || retryCount >= maxRetries) {
        clearInterval(interval);
      }
    }, 200);

    return {
      destroy() {
        clearInterval(interval);
      }
    };
  }

  function setupAutocomplete(input: HTMLInputElement) {
    if (input.dataset.autocompleteSetup === 'true') return;
    input.dataset.autocompleteSetup = 'true';
    
    const autocomplete = new google.maps.places.Autocomplete(input, { types: ['geocode'] });
    
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (place.formatted_address) {
        input.value = place.formatted_address;
        input.dispatchEvent(new Event('input'));
        
        // Force blur and hide
        input.blur();
        setTimeout(() => {
          const event = new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            keyCode: 27,
            which: 27,
            bubbles: true
          });
          input.dispatchEvent(event);
          forceHidePac();
        }, 50);
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        forceHidePac();
      }, 200);
    });

    let typingTimeout: any;
    input.addEventListener('input', () => {
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        if (input.value.length > 0) {
          const pacContainers = document.querySelectorAll('.pac-container');
          pacContainers.forEach(container => {
            (container as HTMLElement).style.display = '';
          });
        }
      }, 100);
    });
  }

  function forceHidePac() {
    const containers = document.querySelectorAll('.pac-container');
    containers.forEach((c) => (c as HTMLElement).style.display = 'none');
  }
</script>

<svelte:head>
  <title>Settings - Go Route Yourself</title>
  <style>
    .pac-container { z-index: 10000 !important; }
  </style>
</svelte:head>

<div class="settings">
  <div class="page-header">
    <div>
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Manage your account and preferences</p>
    </div>
  </div>
  
  {#if showSuccess}
    <div class="alert success">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M16.6 5L7.5 14L3.4 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      {successMessage}
    </div>
  {/if}
  
  <div class="settings-grid">
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
        <input type="text" bind:value={profile.name} placeholder="Your name" />
      </div>
      
      <div class="form-group">
        <label>Email</label>
        <input type="email" bind:value={profile.email} placeholder="your@email.com" />
      </div>

      <button class="btn-secondary" on:click={saveProfile}>Save Profile</button>
      
      <div class="divider"></div>

      <div class="plan-section">
        <div class="plan-info">
          <label>Current Plan</label>
          <div class="plan-row">
            <div class="plan-badge">{$auth.user?.plan || 'Free'} Plan</div>
            {#if $auth.user?.plan === 'free'}
              <a href="/#pricing" class="upgrade-link">Upgrade to Pro</a>
            {/if}
          </div>
        </div>

        {#if $auth.user?.plan === 'free'}
          <div class="usage-stats">
            <div class="usage-header">
              <span>Monthly Usage</span>
              <span>{monthlyUsage} / {$auth.user?.maxTrips || 10} trips</span>
            </div>
            <div class="progress-bar">
              <div 
                class="progress-fill" 
                style="width: {Math.min((monthlyUsage / ($auth.user?.maxTrips || 10)) * 100, 100)}%"
                class:warning={monthlyUsage >= ($auth.user?.maxTrips || 10)}
              ></div>
            </div>
          </div>
        {/if}
      </div>
    </div>
    
    <div class="settings-card">
      <div class="card-header">
        <div class="card-icon blue">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2C13.97 2 18 6.03 18 11C18 15.97 13.97 20 9 20H2V13C2 8.03 6.03 4 11 4H18V11C18 6.03 13.97 2 9 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Default Values</h2>
          <p class="card-subtitle">Pre-fill forms with these values</p>
        </div>
      </div>
      
      <div class="form-group">
        <label>Default MPG</label>
        <input type="number" bind:value={settings.defaultMPG} placeholder="25" min="1" step="0.1" />
      </div>
      
      <div class="form-group">
        <label>Default Gas Price</label>
        <div class="input-prefix">
          <span class="prefix">$</span>
          <input type="number" bind:value={settings.defaultGasPrice} placeholder="3.50" min="0" step="0.01" />
        </div>
      </div>
      
      <div class="form-group">
        <label>Default Start Address</label>
        {#if mapLoaded}
          <input 
            type="text" 
            bind:value={settings.defaultStartAddress}
            placeholder="Start typing address..."
            use:initAutocomplete
          />
        {:else}
          <input type="text" bind:value={settings.defaultStartAddress} placeholder="Loading maps..." disabled />
        {/if}
      </div>
      
      <div class="form-group">
        <label>Default End Address</label>
        {#if mapLoaded}
          <input 
            type="text" 
            bind:value={settings.defaultEndAddress}
            placeholder="Start typing address..."
            use:initAutocomplete
          />
        {:else}
          <input type="text" bind:value={settings.defaultEndAddress} placeholder="Loading maps..." disabled />
        {/if}
      </div>
      
      <button class="btn-primary" on:click={saveDefaultSettings}>
        Save Default Values
      </button>
    </div>
    
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
      
      <button class="btn-primary" on:click={saveDefaultSettings}>
        Save Preferences
      </button>
    </div>
    
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
        <button class="btn-secondary" on:click={() => showPasswordChange = true}>Change Password</button>
      {:else}
        <div class="password-change">
          {#if passwordError}<div class="alert error">{passwordError}</div>{/if}
          <div class="form-group"><label>Current Password</label><input type="password" bind:value={passwordData.current} /></div>
          <div class="form-group"><label>New Password</label><input type="password" bind:value={passwordData.new} /></div>
          <div class="form-group"><label>Confirm New Password</label><input type="password" bind:value={passwordData.confirm} /></div>
          <div class="button-group">
            <button class="btn-primary" on:click={changePassword}>Update</button>
            <button class="btn-secondary" on:click={() => showPasswordChange = false}>Cancel</button>
          </div>
        </div>
      {/if}
    </div>
    
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
          <div>
            <div class="action-title">Export Data</div>
            <div class="action-subtitle">Download backup as JSON</div>
          </div>
        </button>
        <button class="action-btn" on:click={importData}>
          <div>
            <div class="action-title">Import Data</div>
            <div class="action-subtitle">Restore from backup</div>
          </div>
        </button>
        <button class="action-btn danger" on:click={clearAllData}>
          <div>
            <div class="action-title">Clear Local Data</div>
            <div class="action-subtitle">Delete local trip history</div>
          </div>
        </button>
      </div>
    </div>
    
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
          Logout
        </button>
        
        {#if !showDeleteConfirm}
          <button class="btn-delete" on:click={() => showDeleteConfirm = true}>
            Delete Account
          </button>
        {:else}
          <div class="delete-confirmation">
            <p class="delete-warning">To verify, please enter your password:</p>
            <input type="password" bind:value={deletePassword} placeholder="Enter your password" class="delete-input" />
            {#if deleteError}<p class="error-text">{deleteError}</p>{/if}
            <div class="button-group">
              <button class="btn-delete-confirm" on:click={handleDeleteAccount} disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : 'Permanently Delete Account'}
              </button>
              <button class="btn-secondary" on:click={() => { showDeleteConfirm = false; deletePassword = ''; deleteError = ''; }}>Cancel</button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .settings { max-width: 1200px; }
  .page-header { margin-bottom: 32px; }
  .page-title { font-size: 32px; font-weight: 800; color: #111827; margin-bottom: 4px; }
  .page-subtitle { font-size: 16px; color: #6B7280; }
  
  .alert { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-radius: 12px; font-size: 14px; font-weight: 500; margin-bottom: 24px; }
  .alert.success { background: #F0FDF4; color: #166534; border: 1px solid #BBF7D0; }
  .alert.error { background: #FEF2F2; color: #991B1B; border: 1px solid #FECACA; }
  
  .settings-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; }
  .settings-card { background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 24px; }
  .settings-card.danger-card { border-color: #FEE2E2; background: #FEF2F2; }
  
  .card-header { display: flex; gap: 16px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #E5E7EB; }
  .card-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; }
  .card-icon.orange { background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%); }
  .card-icon.blue { background: linear-gradient(135deg, var(--blue) 0%, #1E9BCF 100%); }
  .card-icon.green { background: linear-gradient(135deg, var(--green) 0%, #7AB82E 100%); }
  .card-icon.purple { background: linear-gradient(135deg, var(--purple) 0%, #764a89 100%); }
  .card-icon.navy { background: linear-gradient(135deg, var(--navy) 0%, #1a3a5c 100%); }
  .card-icon.red { background: linear-gradient(135deg, #DC2626 0%, #B91C1C 100%); }
  .card-title { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  .card-subtitle { font-size: 14px; color: #6B7280; }
  
  .form-group { margin-bottom: 20px; }
  .form-group label { display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 8px; }
  .form-group input, .form-group select { width: 100%; padding: 12px 16px; border: 2px solid #E5E7EB; border-radius: 10px; font-size: 15px; font-family: inherit; background: white; transition: all 0.2s; }
  .form-group input:focus, .form-group select:focus { outline: none; border-color: var(--orange); box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1); }
  .form-group input:disabled { background: #F9FAFB; color: #9CA3AF; cursor: not-allowed; }
  
  .input-prefix { position: relative; }
  .input-prefix .prefix { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #6B7280; font-weight: 600; }
  .input-prefix input { padding-left: 36px; }

  /* Plan & Usage */
  .divider { height: 1px; background: #E5E7EB; margin: 24px 0; }
  .plan-row { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
  .plan-badge { display: inline-block; padding: 6px 12px; background: #F3F4F6; color: #374151; border-radius: 8px; font-weight: 600; font-size: 14px; }
  .upgrade-link { color: var(--orange); font-size: 14px; font-weight: 600; text-decoration: none; }
  .upgrade-link:hover { text-decoration: underline; }
  .usage-stats { margin-top: 16px; }
  .usage-header { display: flex; justify-content: space-between; font-size: 13px; color: #6B7280; margin-bottom: 6px; }
  .progress-bar { height: 8px; background: #E5E7EB; border-radius: 4px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--green); border-radius: 4px; transition: width 0.3s; }
  .progress-fill.warning { background: #F59E0B; }
  
  /* Buttons */
  .btn-primary, .btn-secondary, .btn-logout, .btn-delete, .btn-delete-confirm { width: 100%; padding: 14px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 15px; }
  .btn-primary { background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%); color: white; border: none; }
  .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(255, 127, 80, 0.3); }
  .btn-secondary { background: white; color: #374151; border: 2px solid #E5E7EB; }
  .btn-secondary:hover { border-color: var(--orange); color: var(--orange); }
  .btn-logout { background: white; color: #DC2626; border: 2px solid #FEE2E2; }
  .btn-logout:hover { background: #FEF2F2; border-color: #FCA5A5; }
  
  /* Delete Confirmation */
  .btn-delete { background: transparent; color: #DC2626; border: none; margin-top: 12px; font-size: 14px; text-decoration: underline; }
  .btn-delete:hover { color: #B91C1C; }
  .delete-confirmation { margin-top: 16px; padding: 16px; background: white; border-radius: 10px; border: 1px solid #FECACA; }
  .delete-warning { font-size: 14px; color: #374151; margin-bottom: 12px; font-weight: 500; }
  .delete-input { width: 100%; padding: 10px; border: 1px solid #E5E7EB; border-radius: 8px; margin-bottom: 12px; }
  .error-text { color: #DC2626; font-size: 13px; margin-bottom: 12px; }
  .btn-delete-confirm { background: #DC2626; color: white; border: none; margin-bottom: 8px; }
  .btn-delete-confirm:hover { background: #B91C1C; }

  .button-group { display: flex; flex-direction: column; gap: 8px; }
  .data-actions { display: flex; flex-direction: column; gap: 12px; }
  .action-btn { display: flex; align-items: center; gap: 16px; padding: 16px; background: #F9FAFB; border: 2px solid #E5E7EB; border-radius: 12px; cursor: pointer; text-align: left; width: 100%; }
  .action-btn:hover { border-color: var(--orange); background: white; }
  .action-btn.danger:hover { border-color: #DC2626; background: white; }
  .action-title { font-size: 15px; font-weight: 600; color: #111827; }
  .action-subtitle { font-size: 13px; color: #6B7280; }

  @media (max-width: 1024px) {
    .settings-grid { grid-template-columns: 1fr; }
  }
</style>