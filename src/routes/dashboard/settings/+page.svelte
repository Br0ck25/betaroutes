<script lang="ts">
  import { userSettings } from '$lib/stores/userSettings';
  import { auth, user } from '$lib/stores/auth';
  import { trips } from '$lib/stores/trips';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  export let data; 
  $: API_KEY = data.googleMapsApiKey;

  // --- NEW SYNC LOGIC START ---

  // 1. Initialize local form state
  let settings = { ...$userSettings };

  // 2. If remote settings exist, merge them into the store and local state
  $: if (data.remoteSettings?.settings) {
    // Merge remote settings with local defaults
    const merged = { ...$userSettings, ...data.remoteSettings.settings };
    userSettings.set(merged);
    settings = merged;
  }

  let profile = {
    name: '',
    email: ''
  };

  // 3. Initialize profile from Remote KV or Auth Store
  $: if ($user || data.remoteSettings?.profile) {
    const remote = data.remoteSettings?.profile || {};
    // Prioritize remote saved data, fall back to auth user data
    if (!profile.name) profile.name = remote.name || $user?.name || '';
    if (!profile.email) profile.email = remote.email || $user?.email || '';
  }

  // Helper to sync data to Cloudflare KV
  async function syncToCloud(type: 'settings' | 'profile', payload: any) {
      try {
          await fetch('/api/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [type]: payload })
          });
      } catch (e) {
          console.error('Sync error:', e);
      }
  }

  // --- NEW SYNC LOGIC END ---

  // ... (Keep existing monthlyUsage logic) ...
  $: monthlyUsage = $trips.filter(t => {
      if (!t.date) return false;
      const tripDate = new Date(t.date);
      const now = new Date();
      return tripDate.getMonth() === now.getMonth() && tripDate.getFullYear() === now.getFullYear();
  }).length;
  
  // ... (Keep existing variable declarations) ...
  let showSuccess = false;
  let successMessage = '';
  let showPasswordChange = false;
  let passwordData = { current: '', new: '', confirm: '' };
  let passwordError = '';
  let showDeleteConfirm = false;
  let deletePassword = '';
  let deleteError = '';
  let isDeleting = false;
  let mapLoaded = false;

  // ... (Keep existing onMount map logic) ...
  onMount(() => {
    // Load Google Maps for Autocomplete
    console.log('[SETTINGS] Loading Maps with Key:', API_KEY ? 'Yes' : 'MISSING');

    if (!API_KEY) {
        console.error('❌ Google Maps API Key is missing.');
        return;
    }

    if (!window.google) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=places`;
      script.async = true;
      script.onload = () => { mapLoaded = true; };
      document.head.appendChild(script);
    } else {
      mapLoaded = true;
    }
  });

  // --- UPDATED SAVE FUNCTIONS ---

  async function saveDefaultSettings() {
    // 1. Update Local Store
    userSettings.set(settings);
    
    // 2. Sync to Cloud
    await syncToCloud('settings', settings);

    showSuccessMsg('Default values saved and synced!');
  }

  async function saveProfile() {
    // 1. Update Auth Store
    auth.updateProfile({
        name: profile.name,
        email: profile.email
    });

    // 2. Sync to Cloud
    await syncToCloud('profile', profile);

    showSuccessMsg('Profile updated successfully!');
  }
  
  // ... (Keep the rest of the file exactly as is: changePassword, handleDeleteAccount, etc.) ...
  function showSuccessMsg(msg: string) {
    successMessage = msg;
    showSuccess = true;
    setTimeout(() => showSuccess = false, 3000);
  }

  // ... (Rest of your script and HTML) ...
  async function changePassword() {
    // ... (Keep existing implementation) ...
    if (passwordData.new !== passwordData.confirm) {
      passwordError = 'Passwords do not match';
      return;
    }
    if (passwordData.new.length < 8) {
      passwordError = 'Password must be at least 8 characters';
      return;
    }
    try {
        const response = await fetch('/api/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentPassword: passwordData.current,
                newPassword: passwordData.new
            })
        });
        const result = await response.json();
        if (!response.ok) {
            passwordError = result.message || 'Failed to update password';
            return;
        }
        passwordError = '';
        showPasswordChange = false;
        passwordData = { current: '', new: '', confirm: '' };
        showSuccessMsg('Password changed successfully');
    } catch (e) {
        console.error(e);
        passwordError = 'An unexpected network error occurred.';
    }
  }

  async function handleDeleteAccount() {
     // ... (Keep existing implementation) ...
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
        goto('/');
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
     // ... (Keep existing implementation) ...
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
     // ... (Keep existing implementation) ...
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
      await fetch('/api/logout', { method: 'POST' });
      auth.logout();
      goto('/login');
    }
  }

  // --- Autocomplete Logic (Keep existing) ---
  function initAutocomplete(node: HTMLInputElement) {
      // ... (Keep existing implementation) ...
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
      // ... (Keep existing implementation) ...
    if (input.dataset.autocompleteSetup === 'true') return;
    input.dataset.autocompleteSetup = 'true';
    const autocomplete = new google.maps.places.Autocomplete(input, { types: ['geocode'] });
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (place.formatted_address) {
        input.value = place.formatted_address;
        input.dispatchEvent(new Event('input'));
        input.blur();
        setTimeout(() => {
          const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true });
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

<style>
    /* ... (Keep existing styles) ... */
    .pac-container { z-index: 10000 !important; }
    .settings { max-width: 1200px; }
    /* ... etc ... */
</style>

<div class="settings">
    </div>