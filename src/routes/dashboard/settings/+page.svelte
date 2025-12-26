<script lang="ts">
  import { userSettings } from '$lib/stores/userSettings';
  import { auth, user } from '$lib/stores/auth';
  import { trips } from '$lib/stores/trips';
  import { expenses } from '$lib/stores/expenses';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { autocomplete } from '$lib/utils/autocomplete';
  import { currentUser } from '$lib/stores/currentUser';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { jsPDF } from 'jspdf';
  import autoTable from 'jspdf-autotable';
  // [!code ++] Import WebAuthn registration helper
  import { startRegistration } from '@simplewebauthn/browser';
  

  export let data; 
  $: API_KEY = data.googleMapsApiKey;
   
  // --- REMOTE SYNC LOGIC START ---
  let settings = { ...$userSettings };
  $: if (data.remoteSettings?.settings) {
    const merged = { ...$userSettings, ...data.remoteSettings.settings };
    userSettings.set(merged);
    settings = merged;
  }

  let profile = { name: '', email: '' };
  $: if ($user || data.remoteSettings?.profile) {
    const remote = data.remoteSettings?.profile || {};
    if (!profile.name) profile.name = remote.name || $user?.name || '';
    if (!profile.email) profile.email = remote.email || $user?.email || '';
  }

  async function syncToCloud(type: 'settings' | 'profile', payload: any) {
      try {
          const res = await fetch('/api/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [type]: payload })
           });
          if (!res.ok) console.error('Failed to sync settings to cloud');
      } catch (e) {
          console.error('Sync error:', e);
      }
  }
  // --- REMOTE SYNC LOGIC END ---

  $: monthlyUsage = $trips.filter(t => {
      if (!t.date) return false;
      const tripDate = new Date(t.date);
      const now = new Date();
      return tripDate.getMonth() === now.getMonth() && tripDate.getFullYear() === now.getFullYear();
  }).length;

  let showSuccess = false;
  let successMessage = '';
   
  let showPasswordChange = false;
  let passwordData = { current: '', new: '', confirm: '' };
  let passwordError = '';

  let showDeleteConfirm = false;
  let deletePassword = '';
  let deleteError = '';
  let isDeleting = false;
  let registering = false; // State for passkey registration
  // Passkeys list UI state
  let passkeys: Array<{ credentialID: string; name?: string | null; transports?: string[]; createdAt?: string | null }> = [];
  let loadingPasskeys = false;
  let passkeyError = '';
  let renamingId: string | null = null;
  let renameDraft: Record<string, string> = {};
   
  // Pro Plan Check & Modal State
  $: isPro = ['pro', 'business', 'premium', 'enterprise'].includes($auth.user?.plan || '');
   
  let isUpgradeModalOpen = false;
  let upgradeSource: 'generic' | 'export' | 'advanced-export' = 'generic';
  let isCheckingOut = false;
  let isOpeningPortal = false;

  // Advanced Export State
  let showAdvancedExport = false;
  let exportDataType: 'trips' | 'expenses' | 'tax-bundle' = 'trips';
  let exportFormat: 'csv' | 'pdf' = 'csv';
  let exportDateFrom = '';
  let exportDateTo = '';
  let exportIncludeSummary = true;

  // Filter trips/expenses by date for export
  $: filteredTrips = $trips.filter(trip => {
    if (!trip.date) return false;
    const tripDate = new Date(trip.date);
    if (exportDateFrom && tripDate < new Date(exportDateFrom)) return false;
    if (exportDateTo && tripDate > new Date(exportDateTo)) return false;
    return true;
  });

  $: filteredExpenses = $expenses.filter(expense => {
    if (!expense.date) return false;
    const expenseDate = new Date(expense.date);
    if (exportDateFrom && expenseDate < new Date(exportDateFrom)) return false;
    if (exportDateTo && expenseDate > new Date(exportDateTo)) return false;
    return true;
  });

  function handleAddressSelect(field: 'start' | 'end', e: CustomEvent) {
    const val = e.detail.formatted_address || e.detail.name;
    if (field === 'start') settings.defaultStartAddress = val;
    if (field === 'end') settings.defaultEndAddress = val;
  }

  async function saveProfile() {
    auth.updateProfile({
        name: profile.name,
        email: profile.email
    });
    try {
        const res = await fetch('/api/user', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: profile.name,
                email: profile.email
            })
        });
        if (res.ok) {
            showSuccessMsg('Profile updated successfully!');
        } else {
            console.error('Failed to save profile to server');
            showSuccessMsg('Saved locally (Server error)');
        }
    } catch (e) {
        console.error('Save error:', e);
        showSuccessMsg('Saved locally (Network error)');
    }
  }
   
  function showSuccessMsg(msg: string) {
    successMessage = msg;
    showSuccess = true;
    setTimeout(() => showSuccess = false, 3000);
  }
   
  async function handleCheckout() {
    if (isCheckingOut) return;
    isCheckingOut = true;
    try {
        const res = await fetch('/api/stripe/checkout', { method: 'POST' });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.message || 'Checkout failed');
        
        if (data.url) {
            window.location.href = data.url;
        }
    } catch (e) {
        console.error('Checkout error:', e);
        alert('Failed to start checkout. Please try again.');
        isCheckingOut = false;
    }
  }

  async function handlePortal() {
      if (isOpeningPortal) return;
      isOpeningPortal = true;
      try {
          const res = await fetch('/api/stripe/portal', { method: 'POST' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || 'Failed to open portal');
          if (data.url) window.location.href = data.url;
      } catch (e) {
          console.error(e);
          alert('Could not open billing portal. If you recently upgraded, try refreshing the page.');
          isOpeningPortal = false;
      }
  }

  async function changePassword() {
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

  // [!code ++] Passkey Registration Handler
  function base64UrlToBuffer(base64url: any): Uint8Array {
    if (!base64url) return new Uint8Array();
    if (base64url instanceof ArrayBuffer) return new Uint8Array(base64url);
    if (ArrayBuffer.isView(base64url)) return new Uint8Array((base64url as any).buffer, (base64url as any).byteOffset || 0, (base64url as any).byteLength || (base64url as any).length);
    if (typeof base64url !== 'string') base64url = String(base64url);
    const pad = '=='.slice(0, (4 - (base64url.length % 4)) % 4);
    const b64 = (base64url.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function registerPasskey() {
    registering = true;
    
    try {
      // 🔧 STEP 1: Get registration options from server
      console.log('[Passkey] Fetching registration options...');
      
      const optionsRes = await fetch('/api/auth/webauthn?type=register');
      const rawText = await optionsRes.text();
      let optionsJson: any;
      try {
        optionsJson = JSON.parse(rawText);
      } catch (e) {
        console.error('[Passkey] Failed to parse registration options JSON:', rawText);
        throw new Error('Invalid registration options response');
      }

      if (!optionsRes.ok) {
        console.error('[Passkey] Registration options request failed:', optionsRes.status, optionsJson);
        throw new Error(optionsJson?.error || 'Failed to get registration options');
      }

      const options: any = optionsJson;
      console.log('[Passkey] Options received (raw):', rawText);

      // Validate options shape
      if (!options || typeof options !== 'object') {
        console.error('[Passkey] Invalid options payload from server:', optionsJson);
        throw new Error('Invalid registration options from server');
      }

      // Defensive checks: ensure challenge exists and is a base64url string
      if (!options.challenge) {
        console.error('[Passkey] Missing challenge in registration options:', options);
        throw new Error('Registration options missing challenge');
      }

      // The browser helper expects base64url strings for challenge/user.id. Don't convert to ArrayBuffer here.
      if (typeof options.challenge !== 'string') {
        console.warn('[Passkey] Unexpected challenge type; converting to base64url string');
        const bytes = options.challenge instanceof Uint8Array ? options.challenge : new Uint8Array(options.challenge);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(Number(bytes[i] ?? 0));
        options.challenge = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }

      if (options.user && options.user.id && typeof options.user.id !== 'string') {
        console.warn('[Passkey] Unexpected user.id type; converting to base64url string');
        const bytes = options.user.id instanceof Uint8Array ? options.user.id : new Uint8Array(options.user.id);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(Number(bytes[i] ?? 0));
        options.user.id = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }

      // excludeCredentials should be base64url strings for ids; server now sends strings, so no conversion is necessary.
      if (Array.isArray(options.excludeCredentials)) {
        options.excludeCredentials = options.excludeCredentials.map((c: any) => ({ ...c, id: String(c.id) }));
      }

      // 🔧 STEP 2: Prompt user to create passkey
      console.log('[Passkey] Starting registration ceremony...');
      
      const credential = await startRegistration({ optionsJSON: options as any });
      console.log('[Passkey] Credential created:', credential);
      console.log('[Passkey] Credential.response exists?', !!credential.response);
      console.log('[Passkey] Credential structure:', JSON.stringify(credential, null, 2));
      console.log('[Passkey] Credential created:', credential);

      // 🔧 STEP 3: Send credential to server for verification
      console.log('[Passkey] Verifying with server...');

      // Refresh passkey list after successful registration
      try {
        await fetchPasskeys();
      } catch (err) {
        console.warn('[Passkey] Failed to refresh passkey list after registration', err);
      }
      
      function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array) {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(Number(bytes[i] ?? 0));
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }

      const normalised: any = { ...credential } as any;
      if (normalised.rawId && (normalised.rawId instanceof ArrayBuffer || ArrayBuffer.isView(normalised.rawId))) {
        normalised.rawId = bufferToBase64Url(normalised.rawId as ArrayBuffer);
      }
      const resp = normalised.response || {};
      if (resp.attestationObject && (resp.attestationObject instanceof ArrayBuffer || ArrayBuffer.isView(resp.attestationObject))) resp.attestationObject = bufferToBase64Url(resp.attestationObject);
      if (resp.clientDataJSON && (resp.clientDataJSON instanceof ArrayBuffer || ArrayBuffer.isView(resp.clientDataJSON))) resp.clientDataJSON = bufferToBase64Url(resp.clientDataJSON);

      function getDeviceName() {
        const uaData = (navigator as any).userAgentData;
        if (uaData && uaData.platform) {
          const brand = (uaData.brands && uaData.brands[0] && uaData.brands[0].brand) || 'Browser';
          return `${brand} on ${uaData.platform}`;
        }
        const ua = navigator.userAgent || '';
        if (/Android/i.test(ua)) return 'Android device';
        if (/Windows/i.test(ua)) return 'Windows device';
        if (/Mac|Macintosh/i.test(ua)) return 'Mac device';
        if (/iPhone|iPad/i.test(ua)) return 'iOS device';
        return 'Unknown device';
      }

      const deviceName = getDeviceName();

      const verifyRes = await fetch('/api/auth/webauthn?type=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: normalised, deviceName })
      });

      const verifyResult: any = await verifyRes.json();

      if (!verifyRes.ok) {
        throw new Error(verifyResult.error || 'Registration failed');
      }

      // Refresh passkeys list (if the UI is open)
      try { await fetchPasskeys(); } catch (e) { console.warn('Failed to refresh passkeys after registration', e); }

      console.log('[Passkey] Registration successful!');
      showSuccessMsg('Passkey registered successfully! You can now sign in with your fingerprint or face.');
      // update UI
      await fetchPasskeys();

    } catch (error: any) {
      console.error('[Passkey] Registration error:', error);
      
      // User-friendly error messages
      let message = 'Failed to register passkey';
      
      if (error.name === 'NotAllowedError') {
        message = 'Registration was cancelled or timed out';
      } else if (error.name === 'NotSupportedError') {
        message = 'Your device does not support passkeys';
      } else if (error.message) {
        message = error.message;
      }
      
      alert(message); // Using alert instead of toasts since toasts isn't imported
    } finally {
      registering = false;
    }
  }

  // Fetch the user's passkeys for settings UI
  async function fetchPasskeys() {
    loadingPasskeys = true;
    passkeyError = '';
    try {
      const res = await fetch('/api/auth/webauthn/list');
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Failed to fetch passkeys');
      }
      const j = await res.json();
      passkeys = j.authenticators || [];
      // initialize rename drafts
      renameDraft = {};
      passkeys.forEach(p => { if (p.name) renameDraft[p.credentialID] = p.name; });
    } catch (e: any) {
      console.error('[Passkey] Fetch error:', e);
      passkeyError = e?.message || 'Failed to load passkeys';
    } finally {
      loadingPasskeys = false;
    }
  }

  async function savePasskeyName(credentialID: string) {
    const name = renameDraft[credentialID] || '';
    try {
      const res = await fetch('/api/auth/webauthn/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialID, name })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Rename failed');
      await fetchPasskeys();
      showSuccessMsg('Passkey renamed');
    } catch (e: any) {
      console.error('Rename failed', e);
      alert(e?.message || 'Failed to rename passkey');
    }
  }

  async function deletePasskey(credentialID: string) {
    if (!confirm('Remove this passkey from your account permanently?')) return;
    try {
      const res = await fetch('/api/auth/webauthn/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialID })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Delete failed');
      await fetchPasskeys();
      showSuccessMsg('Passkey removed');
    } catch (e: any) {
      console.error('Delete failed', e);
      alert(e?.message || 'Failed to delete passkey');
    }
  }

  // Load passkeys on mount (settings page)
  onMount(() => {
    fetchPasskeys();
  });

  function formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString();
  }

  function formatCurrency(amount: number): string {
    return `$${amount.toFixed(2)}`;
  }

  // Helper functions for duration
  function formatDuration(minutes: number): string {
    if (!minutes) return '0m';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function parseDuration(durationStr: string): number {
    if (!durationStr) return 0;
    let minutes = 0;
    const hoursMatch = durationStr.match(/(\d+)h/);
    const minsMatch = durationStr.match(/(\d+)m/);
    
    if (hoursMatch) minutes += parseInt(hoursMatch[1]) * 60;
    if (minsMatch) minutes += parseInt(minsMatch[1]);
    if (!hoursMatch && !minsMatch && !isNaN(parseInt(durationStr))) {
        minutes = parseInt(durationStr);
    }
    return minutes;
  }

  function parseItemString(str: string): any[] {
    if (!str || !str.trim()) return [];
    return str.split('|').map(part => {
        const [name, costStr] = part.split(':');
        return {
            id: crypto.randomUUID(),
            type: name ? name.trim() : 'Unknown',
            cost: parseFloat(costStr) || 0
        };
    }).filter(i => i.type && i.cost >= 0);
  }

  // ===== ADVANCED EXPORT FUNCTIONS =====
  
  function openAdvancedExport() {
    if (!isPro) {
      upgradeSource = 'advanced-export';
      isUpgradeModalOpen = true;
      return;
    }
    showAdvancedExport = true;
    exportDataType = 'trips';
    exportFormat = 'csv';
    exportDateFrom = '';
    exportDateTo = '';
  }

  function exportTripsCSV(): string | null {
    const data = filteredTrips;
    if (data.length === 0) return null;

    const headers = [
      'Date', 'Start Address', 'Intermediate Stops', 'End Address',
      'Total Miles', 'Drive Time', 'Hours Worked', 'Hourly Pay ($/hr)',
      'Total Revenue', 'Fuel Cost', 
      'Maintenance Cost', 'Maintenance Items',
      'Supply Cost', 'Supply Items',
      'Total Expenses', 'Net Profit', 'Notes'
    ];

    const rows = data.map(trip => {
      const date = trip.date ? new Date(trip.date).toLocaleDateString() : '';
      const start = `"${(trip.startAddress || '').replace(/"/g, '""')}"`;
      
      // Intermediate stops (all stops except possibly the last one if it matches end address)
      const intermediateStops = trip.stops && trip.stops.length > 0
        ? trip.stops.map((s: any) => `${s.address} ($${(s.earnings || 0).toFixed(2)})`).join(' | ')
        : '';
      const stopsStr = `"${intermediateStops.replace(/"/g, '""')}"`;

      // End address - use endAddress if set, otherwise use last stop, otherwise use start
      const rawEnd = trip.endAddress || 
                     (trip.stops && trip.stops.length > 0 ? trip.stops[trip.stops.length - 1].address : '') ||
                     trip.startAddress;
      const end = `"${(rawEnd || '').replace(/"/g, '""')}"`;

      const miles = (trip.totalMiles || 0).toFixed(1);
      const driveTime = `"${formatDuration(trip.estimatedTime || 0)}"`;
      const hoursWorked = (trip.hoursWorked || 0).toFixed(1);

      const revenue = trip.stops?.reduce((sum: number, stop: any) => sum + (stop.earnings || 0), 0) || 0;
      const fuel = trip.fuelCost || 0;
      
      const maint = trip.maintenanceCost || 0;
      const maintItemsStr = trip.maintenanceItems 
        ? `"${trip.maintenanceItems.map((i: any) => `${i.type}:${i.cost}`).join(' | ')}"` 
        : '""';

      const supplies = trip.suppliesCost || 0;
      const sItems = trip.suppliesItems || trip.supplyItems;
      const supplyItemsStr = sItems
        ? `"${sItems.map((i: any) => `${i.type}:${i.cost}`).join(' | ')}"`
        : '""';
        
      const totalExpenses = fuel + maint + supplies;
      const netProfit = revenue - totalExpenses;
      const hourlyPay = trip.hoursWorked > 0 ? (netProfit / trip.hoursWorked) : 0;
      const notes = `"${(trip.notes || '').replace(/"/g, '""')}"`;

      return [
        date, start, stopsStr, end, miles, driveTime, hoursWorked, 
        hourlyPay.toFixed(2), revenue.toFixed(2), fuel.toFixed(2), 
        maint.toFixed(2), maintItemsStr, 
        supplies.toFixed(2), supplyItemsStr, 
        totalExpenses.toFixed(2), netProfit.toFixed(2), notes
      ].join(',');
    });

    if (exportIncludeSummary) {
      const totalMiles = data.reduce((sum, t) => sum + (t.totalMiles || 0), 0);
      const totalRevenue = data.reduce((sum, t) => 
        sum + (t.stops?.reduce((s: number, stop: any) => s + (stop.earnings || 0), 0) || 0), 0);
      const totalExpenses = data.reduce((sum, t) => 
        sum + (t.fuelCost || 0) + (t.maintenanceCost || 0) + (t.suppliesCost || 0), 0);
      const netProfit = totalRevenue - totalExpenses;

      rows.push('');
      rows.push([
        'TOTALS', '', '', '', totalMiles.toFixed(1), '', '', '', 
        totalRevenue.toFixed(2), '', '', '', '', '', 
        totalExpenses.toFixed(2), netProfit.toFixed(2), ''
      ].join(','));
    }

    return [headers.join(','), ...rows].join('\n');
  }

  function exportExpensesCSV(): string | null {
    // Merge trip-level expenses with standalone expenses from expense store
    const allExpenses: Array<{
      date: string;
      category: string;
      amount: number;
      description: string;
    }> = [];

    // 1. Add expenses from expense store
    filteredExpenses.forEach(expense => {
      allExpenses.push({
        date: expense.date,
        category: expense.category,
        amount: expense.amount,
        description: expense.description || ''
      });
    });

    // 2. Add trip-level expenses
    filteredTrips.forEach(trip => {
      // Fuel expenses
      if (trip.fuelCost && trip.fuelCost > 0) {
        allExpenses.push({
          date: trip.date || '',
          category: 'Fuel',
          amount: trip.fuelCost,
          description: 'From trip'
        });
      }

      // Maintenance expenses
      if (trip.maintenanceItems && trip.maintenanceItems.length > 0) {
        trip.maintenanceItems.forEach((item: any) => {
          allExpenses.push({
            date: trip.date || '',
            category: 'Maintenance',
            amount: item.cost,
            description: item.type
          });
        });
      } else if (trip.maintenanceCost && trip.maintenanceCost > 0) {
        allExpenses.push({
          date: trip.date || '',
          category: 'Maintenance',
          amount: trip.maintenanceCost,
          description: 'From trip'
        });
      }

      // Supply expenses
      const sItems = trip.suppliesItems || trip.supplyItems;
      if (sItems && sItems.length > 0) {
        sItems.forEach((item: any) => {
          allExpenses.push({
            date: trip.date || '',
            category: 'Supplies',
            amount: item.cost,
            description: item.type
          });
        });
      } else if (trip.suppliesCost && trip.suppliesCost > 0) {
        allExpenses.push({
          date: trip.date || '',
          category: 'Supplies',
          amount: trip.suppliesCost,
          description: 'From trip'
        });
      }
    });

    if (allExpenses.length === 0) return null;

    // Sort by date
    allExpenses.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // HORIZONTAL LAYOUT - Group by date, categories as columns
    const expensesByDate: Record<string, Record<string, number>> = {};
    const categories = new Set<string>();
    
    allExpenses.forEach(exp => {
      const dateKey = exp.date ? formatDate(exp.date) : 'Unknown';
      if (!expensesByDate[dateKey]) {
        expensesByDate[dateKey] = {};
      }
      categories.add(exp.category);
      
      if (!expensesByDate[dateKey][exp.category]) {
        expensesByDate[dateKey][exp.category] = 0;
      }
      expensesByDate[dateKey][exp.category] += exp.amount;
    });

    // Sort categories alphabetically for consistent columns
    const categoryList = Array.from(categories).sort();
    
    // Build CSV headers: Date, Category1, Category2, ..., Daily Total
    let csv = 'Date,' + categoryList.join(',') + ',Daily Total\n';
    
    // Track totals for each category
    const categoryTotals: Record<string, number> = {};
    categoryList.forEach(cat => categoryTotals[cat] = 0);
    let grandTotal = 0;

    // Add data rows - one row per date
    Object.entries(expensesByDate).forEach(([date, cats]) => {
      const row: string[] = [date];
      let dailyTotal = 0;
      
      categoryList.forEach(category => {
        const amount = cats[category] || 0;
        row.push(amount.toFixed(2));
        categoryTotals[category] += amount;
        dailyTotal += amount;
      });
      
      row.push(dailyTotal.toFixed(2));
      grandTotal += dailyTotal;
      csv += row.join(',') + '\n';
    });

    if (exportIncludeSummary) {
      csv += '\n';
      const totalRow = [
        'TOTALS',
        ...categoryList.map(cat => categoryTotals[cat].toFixed(2)),
        grandTotal.toFixed(2)
      ];
      csv += totalRow.join(',') + '\n';
    }

    return csv;
  }

  function exportTaxBundle() {
    const tripsToExport = filteredTrips;
    const expensesToExport: Array<{
      date: string;
      category: string;
      amount: number;
      description: string;
    }> = [];

    // Collect all expenses (from store + from trips)
    filteredExpenses.forEach(exp => {
      expensesToExport.push({
        date: exp.date,
        category: exp.category,
        amount: exp.amount,
        description: exp.description || ''
      });
    });

    filteredTrips.forEach(trip => {
      if (trip.fuelCost && trip.fuelCost > 0) {
        expensesToExport.push({
          date: trip.date || '',
          category: 'Fuel',
          amount: trip.fuelCost,
          description: 'From trip'
        });
      }

      if (trip.maintenanceItems && trip.maintenanceItems.length > 0) {
        trip.maintenanceItems.forEach((item: any) => {
          expensesToExport.push({
            date: trip.date || '',
            category: 'Maintenance',
            amount: item.cost,
            description: item.type
          });
        });
      } else if (trip.maintenanceCost && trip.maintenanceCost > 0) {
        expensesToExport.push({
          date: trip.date || '',
          category: 'Maintenance',
          amount: trip.maintenanceCost,
          description: 'From trip'
        });
      }

      const sItems = trip.suppliesItems || trip.supplyItems;
      if (sItems && sItems.length > 0) {
        sItems.forEach((item: any) => {
          expensesToExport.push({
            date: trip.date || '',
            category: 'Supplies',
            amount: item.cost,
            description: item.type
          });
        });
      } else if (trip.suppliesCost && trip.suppliesCost > 0) {
        expensesToExport.push({
          date: trip.date || '',
          category: 'Supplies',
          amount: trip.suppliesCost,
          description: 'From trip'
        });
      }
    });

    if (tripsToExport.length === 0 && expensesToExport.length === 0) {
      alert('No data available in the selected date range');
      return;
    }
    
    // 1. Mileage Log CSV
    let mileageCSV = 'Date,Start Time,End Time,Start Address,Intermediate Stops,End Address,Purpose,Miles,Notes\n';
    let totalMiles = 0;
    
    tripsToExport.forEach(trip => {
      const intermediateStops = trip.stops && trip.stops.length > 0
        ? trip.stops.map((s: any) => s.address).join(' | ')
        : '';
      
      const destination = trip.endAddress || 
                         (trip.stops && trip.stops.length > 0 ? trip.stops[trip.stops.length - 1].address : '') ||
                         trip.startAddress || '';
      
      mileageCSV += [
        formatDate(trip.date || ''),
        trip.startTime || '',
        trip.endTime || '',
        `"${trip.startAddress || ''}"`,
        `"${intermediateStops}"`,
        `"${destination}"`,
        'Business',
        trip.totalMiles?.toFixed(2) || '0.00',
        `"${trip.notes || ''}"`
      ].join(',') + '\n';
      
      totalMiles += trip.totalMiles || 0;
    });
    
    // 2. Expense Log CSV - HORIZONTAL LAYOUT
    expensesToExport.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Group by date and category
    const expensesByDate: Record<string, Record<string, number>> = {};
    const categories = new Set<string>();
    let totalByCategory: Record<string, number> = {};
    let grandTotal = 0;
    
    expensesToExport.forEach(expense => {
      const dateKey = formatDate(expense.date);
      if (!expensesByDate[dateKey]) {
        expensesByDate[dateKey] = {};
      }
      categories.add(expense.category);
      
      if (!expensesByDate[dateKey][expense.category]) {
        expensesByDate[dateKey][expense.category] = 0;
      }
      expensesByDate[dateKey][expense.category] += expense.amount;
      
      // Track totals
      if (!totalByCategory[expense.category]) totalByCategory[expense.category] = 0;
      totalByCategory[expense.category] += expense.amount;
      grandTotal += expense.amount;
    });
    
    // Sort categories alphabetically
    const categoryList = Array.from(categories).sort();
    
    // Build horizontal CSV: Date, Category1, Category2, ..., Daily Total
    let expenseCSV = 'Date,' + categoryList.join(',') + ',Daily Total\n';
    
    // Add data rows
    Object.entries(expensesByDate).forEach(([date, cats]) => {
      const row: string[] = [date];
      let dailyTotal = 0;
      
      categoryList.forEach(category => {
        const amount = cats[category] || 0;
        row.push(amount.toFixed(2));
        dailyTotal += amount;
      });
      
      row.push(dailyTotal.toFixed(2));
      expenseCSV += row.join(',') + '\n';
    });
    
    // Add totals row
    expenseCSV += '\nTOTALS,';
    expenseCSV += categoryList.map(cat => totalByCategory[cat].toFixed(2)).join(',');
    expenseCSV += ',' + grandTotal.toFixed(2) + '\n';
    
    // 3. Tax Summary Text
    const period = exportDateFrom && exportDateTo 
      ? `${formatDate(exportDateFrom)} to ${formatDate(exportDateTo)}`
      : exportDateFrom 
        ? `From ${formatDate(exportDateFrom)}`
        : exportDateTo 
          ? `Through ${formatDate(exportDateTo)}`
          : 'All Records';
    
    let summary = `TAX SUMMARY REPORT
Generated: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
Period: ${period}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MILEAGE DEDUCTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total Business Miles: ${totalMiles.toFixed(2)} miles
Number of Trips: ${tripsToExport.length}

Standard Mileage Rate (2024): $0.67/mile
Estimated Deduction: ${formatCurrency(totalMiles * 0.67)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BUSINESS EXPENSES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
    
    if (Object.keys(totalByCategory).length > 0) {
      Object.entries(totalByCategory).forEach(([category, total]) => {
        summary += `${category.padEnd(30)} ${formatCurrency(total).padStart(12)}\n`;
      });
      summary += `\n${'Total Expenses'.padEnd(30)} ${formatCurrency(grandTotal).padStart(12)}\n`;
    } else {
      summary += 'No expenses recorded for this period\n';
    }
    
    summary += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOTAL TAX DEDUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Mileage Deduction:   ${formatCurrency(totalMiles * 0.67).padStart(12)}
Business Expenses:   ${formatCurrency(grandTotal).padStart(12)}
                     ${'─'.repeat(12)}
Total Deductions:    ${formatCurrency((totalMiles * 0.67) + grandTotal).padStart(12)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  IMPORTANT IRS NOTICE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IF YOU USE THE STANDARD MILEAGE DEDUCTION, YOU CANNOT 
ALSO DEDUCT ACTUAL VEHICLE EXPENSES!

You must choose ONE method:

Option 1: Standard Mileage Rate ($0.67/mile for 2024)
  ✓ Deduct: Mileage only
  ✗ Cannot deduct: Fuel, oil changes, repairs, maintenance

Option 2: Actual Expenses Method
  ✓ Deduct: Fuel, maintenance, repairs, insurance, etc.
  ✗ Cannot deduct: Standard mileage rate

This report shows BOTH for informational purposes only.
Consult your tax professional to determine which method
is more beneficial for your specific situation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NOTES:
• This report is for informational purposes only
• Consult with a tax professional for specific advice
• Keep all receipts and documentation for 7 years
• Standard mileage rate may change annually

Generated by Go Route Yourself - Professional Route Tracking
`;
    
    // Download all three files
    const timestamp = Date.now();
    
    const mileageBlob = new Blob([mileageCSV], { type: 'text/csv' });
    const mileageUrl = URL.createObjectURL(mileageBlob);
    const mileageLink = document.createElement('a');
    mileageLink.href = mileageUrl;
    mileageLink.download = `mileage-log-${timestamp}.csv`;
    mileageLink.click();
    URL.revokeObjectURL(mileageUrl);
    
    setTimeout(() => {
      const expenseBlob = new Blob([expenseCSV], { type: 'text/csv' });
      const expenseUrl = URL.createObjectURL(expenseBlob);
      const expenseLink = document.createElement('a');
      expenseLink.href = expenseUrl;
      expenseLink.download = `expense-log-${timestamp}.csv`;
      expenseLink.click();
      URL.revokeObjectURL(expenseUrl);
    }, 100);
    
    setTimeout(() => {
      const summaryBlob = new Blob([summary], { type: 'text/plain' });
      const summaryUrl = URL.createObjectURL(summaryBlob);
      const summaryLink = document.createElement('a');
      summaryLink.href = summaryUrl;
      summaryLink.download = `tax-summary-${timestamp}.txt`;
      summaryLink.click();
      URL.revokeObjectURL(summaryUrl);
    }, 200);

    showSuccessMsg('Tax bundle exported successfully!');
    showAdvancedExport = false;
  }

  async function exportToPDF() {
    if (exportDataType === 'trips') {
      await exportTripsPDF();
    } else if (exportDataType === 'expenses') {
      await exportExpensesPDF();
    } else {
      await exportTaxBundlePDF();
    }
  }

  // --- LOGO HELPER ---
  async function getLogoDataUrl(): Promise<string | null> {
    try {
        const response = await fetch('/logo.png');
        if (!response.ok) return null;
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn("Could not load logo for PDF", e);
        return null;
    }
  }

  async function exportTripsPDF() {
    const doc = new jsPDF();
    const logoData = await getLogoDataUrl();
    const timestamp = Date.now();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Header with logo area and title
    doc.setFillColor(255, 127, 80); // Orange
    doc.rect(0, 0, pageWidth, 35, 'F');

    // Add logo if available
    if (logoData) {
        doc.addImage(logoData, 'PNG', 10, 5, 25, 25);
    }
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.text('Trip Report', pageWidth / 2, 15, { align: 'center' });
    
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text('Go Route Yourself - Professional Route Tracking', pageWidth / 2, 23, { align: 'center' });
    
    // Report metadata
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    const dateRange = exportDateFrom && exportDateTo 
      ? `${formatDate(exportDateFrom)} - ${formatDate(exportDateTo)}`
      : exportDateFrom 
        ? `From ${formatDate(exportDateFrom)}`
        : exportDateTo 
          ? `Through ${formatDate(exportDateTo)}`
          : 'All Records';
    doc.text(`Period: ${dateRange}`, 14, 42);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 47);
    doc.text(`Total Trips: ${filteredTrips.length}`, pageWidth - 14, 42, { align: 'right' });
    
    // Summary statistics box
    const totalMiles = filteredTrips.reduce((sum, t) => sum + (t.totalMiles || 0), 0);
    const totalRevenue = filteredTrips.reduce((sum, t) => 
      sum + (t.stops?.reduce((s: number, stop: any) => s + (stop.earnings || 0), 0) || 0), 0);
    const totalExpenses = filteredTrips.reduce((sum, t) => 
      sum + (t.fuelCost || 0) + (t.maintenanceCost || 0) + (t.suppliesCost || 0), 0);
    const netProfit = totalRevenue - totalExpenses;
    
    doc.setFillColor(248, 250, 252); // Light gray background
    doc.roundedRect(14, 52, pageWidth - 28, 28, 3, 3, 'FD');
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    const statY = 60;
    const colWidth = (pageWidth - 28) / 4;
    
    doc.text('Total Miles', 14 + colWidth * 0.5, statY, { align: 'center' });
    doc.text('Total Revenue', 14 + colWidth * 1.5, statY, { align: 'center' });
    doc.text('Total Expenses', 14 + colWidth * 2.5, statY, { align: 'center' });
    doc.text('Net Profit', 14 + colWidth * 3.5, statY, { align: 'center' });
    
    doc.setFontSize(14);
    doc.setTextColor(255, 127, 80);
    doc.text(totalMiles.toFixed(1), 14 + colWidth * 0.5, statY + 10, { align: 'center' });
    doc.setTextColor(34, 197, 94); // Green
    doc.text(formatCurrency(totalRevenue), 14 + colWidth * 1.5, statY + 10, { align: 'center' });
    doc.setTextColor(239, 68, 68); // Red
    doc.text(formatCurrency(totalExpenses), 14 + colWidth * 2.5, statY + 10, { align: 'center' });
    doc.setTextColor(netProfit >= 0 ? 34 : 239, netProfit >= 0 ? 197 : 68, netProfit >= 0 ? 94 : 68);
    doc.text(formatCurrency(netProfit), 14 + colWidth * 3.5, statY + 10, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);
    
    // Detailed trip table
    const tableData = filteredTrips.map(trip => {
      const intermediateStops = trip.stops && trip.stops.length > 0
        ? trip.stops.map((s: any) => s.address).join('\n')
        : 'None';
      
      const endAddr = trip.endAddress || 
                      (trip.stops && trip.stops.length > 0 ? trip.stops[trip.stops.length - 1].address : '') ||
                      trip.startAddress || '';
      
      const revenue = trip.stops?.reduce((sum: number, stop: any) => sum + (stop.earnings || 0), 0) || 0;
      const expenses = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
      const profit = revenue - expenses;
      
      return [
        formatDate(trip.date || ''),
        trip.startAddress || '',
        intermediateStops,
        endAddr,
        (trip.totalMiles || 0).toFixed(1) + ' mi',
        formatDuration(trip.estimatedTime || 0),
        (trip.hoursWorked || 0).toFixed(1) + ' hr',
        formatCurrency(revenue),
        formatCurrency(expenses),
        formatCurrency(profit)
      ];
    });

    autoTable(doc, {
      startY: 85,
      head: [['Date', 'Start', 'Stops', 'End', 'Miles', 'Drive Time', 'Hours', 'Revenue', 'Expenses', 'Profit']],
      body: tableData,
      theme: 'striped',
      headStyles: { 
        fillColor: [255, 127, 80],
        textColor: [255, 255, 255],
        fontSize: 9,
        fontStyle: 'bold',
        halign: 'center'
      },
      styles: {
        fontSize: 8,
        cellPadding: 3,
        overflow: 'linebreak',
        lineColor: [229, 231, 235],
        lineWidth: 0.1
      },
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 30 },
        2: { cellWidth: 30 },
        3: { cellWidth: 30 },
        4: { halign: 'right', cellWidth: 15 },
        5: { halign: 'center', cellWidth: 18 },
        6: { halign: 'right', cellWidth: 15 },
        7: { halign: 'right', cellWidth: 20, textColor: [34, 197, 94] },
        8: { halign: 'right', cellWidth: 20, textColor: [239, 68, 68] },
        9: { halign: 'right', cellWidth: 20, fontStyle: 'bold' }
      },
      alternateRowStyles: {
        fillColor: [249, 250, 251]
      },
      margin: { left: 14, right: 14 },
      didDrawPage: function(data: any) {
        // Footer on each page
        const pageCount = doc.internal.pages.length - 1;
        doc.setFontSize(8);
        doc.setTextColor(128, 128, 128);
        doc.text(
          `Page ${data.pageNumber} of ${pageCount}`,
          pageWidth / 2,
          doc.internal.pageSize.getHeight() - 10,
          { align: 'center' }
        );
        doc.text(
          'Go Route Yourself - Professional Route Tracking',
          pageWidth - 14,
          doc.internal.pageSize.getHeight() - 10,
          { align: 'right' }
        );
      }
    });

    doc.save(`trips-report-${timestamp}.pdf`);
    showSuccessMsg('PDF exported successfully!');
    showAdvancedExport = false;
  }

  async function exportExpensesPDF() {
    const doc = new jsPDF();
    const logoData = await getLogoDataUrl();
    const timestamp = Date.now();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Collect all expenses
    const allExpenses: Array<any> = [];
    
    // From expense store
    filteredExpenses.forEach(exp => allExpenses.push({
      date: exp.date,
      category: exp.category,
      amount: exp.amount,
      description: exp.description || '',
      source: 'Expense Log'
    }));
    
    // From trips
    filteredTrips.forEach(trip => {
      if (trip.fuelCost && trip.fuelCost > 0) {
        allExpenses.push({
          date: trip.date || '',
          category: 'Fuel',
          amount: trip.fuelCost,
          description: 'From trip',
          source: 'Trip'
        });
      }
      
      if (trip.maintenanceItems && trip.maintenanceItems.length > 0) {
        trip.maintenanceItems.forEach((item: any) => {
          allExpenses.push({
            date: trip.date || '',
            category: 'Maintenance',
            amount: item.cost,
            description: item.type,
            source: 'Trip'
          });
        });
      } else if (trip.maintenanceCost && trip.maintenanceCost > 0) {
        allExpenses.push({
          date: trip.date || '',
          category: 'Maintenance',
          amount: trip.maintenanceCost,
          description: 'From trip',
          source: 'Trip'
        });
      }
      
      const sItems = trip.suppliesItems || trip.supplyItems;
      if (sItems && sItems.length > 0) {
        sItems.forEach((item: any) => {
          allExpenses.push({
            date: trip.date || '',
            category: 'Supplies',
            amount: item.cost,
            description: item.type,
            source: 'Trip'
          });
        });
      } else if (trip.suppliesCost && trip.suppliesCost > 0) {
        allExpenses.push({
          date: trip.date || '',
          category: 'Supplies',
          amount: trip.suppliesCost,
          description: 'From trip',
          source: 'Trip'
        });
      }
    });
    
    // Sort by date
    allExpenses.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Header
    doc.setFillColor(255, 127, 80);
    doc.rect(0, 0, pageWidth, 35, 'F');

    // Add logo if available
    if (logoData) {
        doc.addImage(logoData, 'PNG', 10, 5, 25, 25);
    }
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.text('Expense Report', pageWidth / 2, 15, { align: 'center' });
    
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text('Go Route Yourself - Professional Route Tracking', pageWidth / 2, 23, { align: 'center' });
    
    // Report metadata
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    const dateRange = exportDateFrom && exportDateTo 
      ? `${formatDate(exportDateFrom)} - ${formatDate(exportDateTo)}`
      : exportDateFrom 
        ? `From ${formatDate(exportDateFrom)}`
        : exportDateTo 
          ? `Through ${formatDate(exportDateTo)}`
          : 'All Records';
    doc.text(`Period: ${dateRange}`, 14, 42);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 47);
    doc.text(`Total Expenses: ${allExpenses.length}`, pageWidth - 14, 42, { align: 'right' });
    
    // Calculate category totals
    const categoryTotals: Record<string, number> = {};
    let grandTotal = 0;
    
    allExpenses.forEach(exp => {
      if (!categoryTotals[exp.category]) categoryTotals[exp.category] = 0;
      categoryTotals[exp.category] += exp.amount;
      grandTotal += exp.amount;
    });
    
    // Summary by category
    doc.setFillColor(248, 250, 252);
    const categoryCount = Object.keys(categoryTotals).length;
    const boxHeight = 12 + (categoryCount * 6) + 8;
    doc.roundedRect(14, 52, pageWidth - 28, boxHeight, 3, 3, 'FD');
    
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Summary by Category', 20, 60);
    
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    let yPos = 68;
    
    Object.entries(categoryTotals).forEach(([category, total]) => {
      doc.text(category, 20, yPos);
      doc.text(formatCurrency(total), pageWidth - 20, yPos, { align: 'right' });
      yPos += 6;
    });
    
    // Grand total line
    doc.setDrawColor(229, 231, 235);
    doc.line(20, yPos, pageWidth - 20, yPos);
    yPos += 6;
    
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10);
    doc.text('Total Expenses', 20, yPos);
    doc.setTextColor(239, 68, 68);
    doc.text(formatCurrency(grandTotal), pageWidth - 20, yPos, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    
    // Detailed expense table
    const tableData = allExpenses.map(exp => {
      const label = exp.description 
        ? `${exp.category} - ${exp.description}`
        : exp.category;
      
      return [
        formatDate(exp.date),
        label,
        formatCurrency(exp.amount),
        exp.source
      ];
    
    });

    autoTable(doc, {
      startY: 52 + boxHeight + 8,
      head: [['Date', 'Expense', 'Amount', 'Source']],
      body: tableData,
      theme: 'striped',
      headStyles: { 
        fillColor: [255, 127, 80],
        textColor: [255, 255, 255],
        fontSize: 9,
        fontStyle: 'bold',
        halign: 'center'
      
      },
      styles: {
        fontSize: 9,
        cellPadding: 3,
        overflow: 'linebreak',
        lineColor: [229, 231, 235],
        lineWidth: 0.1
      },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 90 },
        2: { halign: 'right', cellWidth: 30, textColor: [239, 68, 68], fontStyle: 'bold' },
        3: { halign: 'center', cellWidth: 30 }
      },
      alternateRowStyles: {
        fillColor: [249, 250, 251]
      },
      margin: { left: 14, right: 14 },
      didDrawPage: function(data: any) {
        const pageCount = doc.internal.pages.length - 1;
        doc.setFontSize(8);
        doc.setTextColor(128, 128, 128);
        doc.text(
          `Page ${data.pageNumber} of ${pageCount}`,
          pageWidth / 2,
          doc.internal.pageSize.getHeight() - 10,
          { align: 'center' }
        );
        doc.text(
          'Go Route Yourself - Professional Route Tracking',
          pageWidth - 14,
          doc.internal.pageSize.getHeight() - 10,
          { align: 'right' }
        );
      }
    });

    doc.save(`expenses-report-${timestamp}.pdf`);
    showSuccessMsg('PDF exported successfully!');
    showAdvancedExport = false;
  }

  async function exportTaxBundlePDF() {
    // First generate the CSV files
    exportTaxBundle();
    
    // Then create a comprehensive PDF summary
    const doc = new jsPDF();
    const logoData = await getLogoDataUrl();
    const timestamp = Date.now();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Calculate all totals
    const totalMiles = filteredTrips.reduce((sum, t) => sum + (t.totalMiles || 0), 0);
    const mileageDeduction = totalMiles * 0.67;
    
    // Collect expenses
    const allExpenses: Array<any> = [];
    filteredExpenses.forEach(exp => allExpenses.push(exp));
    filteredTrips.forEach(trip => {
      if (trip.fuelCost && trip.fuelCost > 0) {
        allExpenses.push({ category: 'Fuel', amount: trip.fuelCost });
      }
      if (trip.maintenanceItems && trip.maintenanceItems.length > 0) {
        trip.maintenanceItems.forEach((item: any) => {
          allExpenses.push({ category: 'Maintenance', amount: item.cost });
        });
      } else if (trip.maintenanceCost && trip.maintenanceCost > 0) {
        allExpenses.push({ category: 'Maintenance', amount: trip.maintenanceCost });
      }
      const sItems = trip.suppliesItems || trip.supplyItems;
      if (sItems && sItems.length > 0) {
        sItems.forEach((item: any) => {
          allExpenses.push({ category: 'Supplies', amount: item.cost });
        });
      } else if (trip.suppliesCost && trip.suppliesCost > 0) {
        allExpenses.push({ category: 'Supplies', amount: trip.suppliesCost });
      }
    });
    
    const categoryTotals: Record<string, number> = {};
    let totalExpenses = 0;
    allExpenses.forEach(exp => {
      if (!categoryTotals[exp.category]) categoryTotals[exp.category] = 0;
      categoryTotals[exp.category] += exp.amount;
      totalExpenses += exp.amount;
    });
    
    const totalDeductions = mileageDeduction + totalExpenses;
    
    // Page 1: Cover Page
    doc.setFillColor(255, 127, 80);
    doc.rect(0, 0, pageWidth, 100, 'F');
    
    if (logoData) {
       // Center logo on cover page
       doc.addImage(logoData, 'PNG', (pageWidth/2) - 15, 10, 30, 30);
    }

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(32);
    doc.setFont(undefined, 'bold');
    doc.text('TAX SUMMARY', pageWidth / 2, 50, { align: 'center' }); // Shifted down slightly
    doc.text('REPORT', pageWidth / 2, 65, { align: 'center' });
    
    doc.setFontSize(14);
    doc.setFont(undefined, 'normal');
    doc.text('Go Route Yourself', pageWidth / 2, 80, { align: 'center' });
    doc.text('Professional Route Tracking', pageWidth / 2, 90, { align: 'center' });
    
    // Report info box
    doc.setTextColor(0, 0, 0);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(30, 110, pageWidth - 60, 60, 3, 3, 'FD');
    
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Report Information', 40, 122);
    
    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    
    const dateRange = exportDateFrom && exportDateTo 
      ? `${formatDate(exportDateFrom)} - ${formatDate(exportDateTo)}`
      : exportDateFrom 
        ? `From ${formatDate(exportDateFrom)}`
        : exportDateTo 
          ? `Through ${formatDate(exportDateTo)}`
          : 'All Records';
    
    doc.text('Tax Period:', 40, 135);
    doc.text(dateRange, 80, 135);
    
    doc.text('Generated:', 40, 145);
    doc.text(new Date().toLocaleString(), 80, 145);
    
    doc.text('Total Trips:', 40, 155);
    doc.text(filteredTrips.length.toString(), 80, 155);
    
    doc.text('Total Expenses:', 40, 165);
    doc.text(allExpenses.length.toString(), 80, 165);
    
    // Total deductions (without box - cleaner design)
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('TOTAL TAX DEDUCTIONS', pageWidth / 2, 185, { align: 'center' });
    
    doc.setFontSize(32);
    doc.setTextColor(34, 197, 94);
    doc.text(formatCurrency(totalDeductions), pageWidth / 2, 205, { align: 'center' });
    
    // IRS Warning Box - PROMINENT
    doc.setTextColor(0, 0, 0);
    doc.setFillColor(255, 243, 205); // Light orange/yellow warning color
    doc.setDrawColor(255, 127, 80); // Orange border
    doc.setLineWidth(1);
    doc.roundedRect(20, 220, pageWidth - 40, 55, 3, 3, 'FD');
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(239, 68, 68); // Red for warning
    doc.text('IRS NOTICE: CHOOSE ONE METHOD ONLY', pageWidth / 2, 232, { align: 'center' });
    
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(0, 0, 0);
    const warning1 = 'Standard Mileage Rate OR Actual Expenses - You cannot claim both!';
    const warning2 = 'If using standard mileage ($0.67/mi), you CANNOT deduct fuel, maintenance, or repairs.';
    const warning3 = 'This report shows both for comparison. Consult your tax professional.';
    doc.text(warning1, pageWidth / 2, 244, { align: 'center', maxWidth: pageWidth - 50 });
    doc.text(warning2, pageWidth / 2, 254, { align: 'center', maxWidth: pageWidth - 50 });
    doc.text(warning3, pageWidth / 2, 264, { align: 'center', maxWidth: pageWidth - 50 });
    
    // Disclaimer
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(7);
    doc.setFont(undefined, 'italic');
    const disclaimer = 'This report is for informational purposes only. Consult with a tax professional for specific advice.';
    doc.text(disclaimer, pageWidth / 2, 280, { align: 'center', maxWidth: pageWidth - 60 });
    
    // Page 2: Mileage Details
    doc.addPage();
    doc.setTextColor(0, 0, 0);
    
    // Section header
    doc.setFillColor(255, 127, 80);
    doc.rect(0, 0, pageWidth, 25, 'F');
    if (logoData) {
        doc.addImage(logoData, 'PNG', 14, 2, 20, 20);
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('MILEAGE DEDUCTION', pageWidth / 2, 15, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);
    
    // Mileage summary boxes
    const boxY = 35;
    const boxWidth = (pageWidth - 40) / 3;
    
    // Total Miles Box
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, boxY, boxWidth - 4, 35, 3, 3, 'FD');
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text('Total Business Miles', 14 + (boxWidth - 4) / 2, boxY + 12, { align: 'center' });
    doc.setFontSize(16);
    doc.setTextColor(255, 127, 80);
    doc.text(totalMiles.toFixed(2), 14 + (boxWidth - 4) / 2, boxY + 26, { align: 'center' });
    
    // Rate Box
    doc.setTextColor(0, 0, 0);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14 + boxWidth, boxY, boxWidth - 4, 35, 3, 3, 'FD');
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text('2024 IRS Rate', 14 + boxWidth + (boxWidth - 4) / 2, boxY + 12, { align: 'center' });
    doc.setFontSize(16);
    doc.setTextColor(255, 127, 80);
    doc.text('$0.67/mile', 14 + boxWidth + (boxWidth - 4) / 2, boxY + 26, { align: 'center' });
    
    // Deduction Box
    doc.setTextColor(0, 0, 0);
    doc.setFillColor(248, 250, 252); // Light gray like the others
    doc.roundedRect(14 + boxWidth * 2, boxY, boxWidth - 4, 35, 3, 3, 'FD');
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text('Mileage Deduction', 14 + boxWidth * 2 + (boxWidth - 4) / 2, boxY + 12, { align: 'center' });
    doc.setFontSize(16);
    doc.setTextColor(34, 197, 94); // Green
    doc.text(formatCurrency(mileageDeduction), 14 + boxWidth * 2 + (boxWidth - 4) / 2, boxY + 26, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);
    
    // Trip breakdown table
    const tripData = filteredTrips.map(trip => {
      const intermediateStops = trip.stops && trip.stops.length > 0
        ? trip.stops.map((s: any) => s.address).join(', ')
        : 'None';
      
      const endAddr = trip.endAddress || 
                      (trip.stops && trip.stops.length > 0 ? trip.stops[trip.stops.length - 1].address : '') ||
                      trip.startAddress || '';
      
      return [
        formatDate(trip.date || ''),
        trip.startAddress || '',
        intermediateStops,
        endAddr,
        (trip.totalMiles || 0).toFixed(2),
        formatCurrency((trip.totalMiles || 0) * 0.67)
      ];
    });
    
    autoTable(doc, {
      startY: 80,
      head: [['Date', 'Start', 'Stops', 'End', 'Miles', 'Deduction']],
      body: tripData,
      theme: 'striped',
      headStyles: { 
        fillColor: [255, 127, 80],
        textColor: [255, 255, 255],
        fontSize: 9,
        fontStyle: 'bold'
      },
      styles: {
        fontSize: 8,
        cellPadding: 2
      },
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 40 },
        2: { cellWidth: 40 },
        3: { cellWidth: 40 },
        4: { halign: 'right', cellWidth: 20 },
        5: { halign: 'right', cellWidth: 28, textColor: [34, 197, 94] }
      }
    });
    
    // Page 3: Expense Details
    doc.addPage();
    
    // Section header
    doc.setFillColor(255, 127, 80);
    doc.rect(0, 0, pageWidth, 25, 'F');
    if (logoData) {
        doc.addImage(logoData, 'PNG', 14, 2, 20, 20);
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('BUSINESS EXPENSES', pageWidth / 2, 15, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);
    
    // Category breakdown chart
    let chartY = 35;
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('Expense Summary by Category', 14, chartY);
    
    chartY += 10;
    const maxBarWidth = pageWidth - 100;
    
    Object.entries(categoryTotals).forEach(([category, amount]) => {
      const percentage = (amount / totalExpenses) * 100;
      const barWidth = (amount / totalExpenses) * maxBarWidth;
      
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text(category, 14, chartY);
      
      // Bar
      doc.setFillColor(255, 127, 80);
      doc.rect(70, chartY - 5, barWidth, 8, 'F');
      
      // Amount
      doc.setFont(undefined, 'bold');
      doc.text(formatCurrency(amount), 70 + maxBarWidth + 5, chartY);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);
      doc.text(`(${percentage.toFixed(1)}%)`, 70 + maxBarWidth + 35, chartY);
      
      chartY += 12;
    });
    
    // Total line
    chartY += 5;
    doc.setDrawColor(229, 231, 235);
    doc.line(14, chartY, pageWidth - 14, chartY);
    chartY += 8;
    
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('Total Business Expenses', 14, chartY);
    doc.setTextColor(239, 68, 68);
    doc.text(formatCurrency(totalExpenses), pageWidth - 14, chartY, { align: 'right' });
    
    doc.setTextColor(0, 0, 0);
    
    // Page 4: Summary & Notes
    doc.addPage();
    
    // Section header
    doc.setFillColor(255, 127, 80);
    doc.rect(0, 0, pageWidth, 25, 'F');
    if (logoData) {
        doc.addImage(logoData, 'PNG', 14, 2, 20, 20);
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('DEDUCTION SUMMARY', pageWidth / 2, 15, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);
    
    // Final summary table
    const summaryY = 40;
    
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Component', 30, summaryY);
    doc.text('Amount', pageWidth - 30, summaryY, { align: 'right' });
    
    doc.setDrawColor(229, 231, 235);
    doc.line(30, summaryY + 2, pageWidth - 30, summaryY + 2);
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    
    let summaryRowY = summaryY + 12;
    
    doc.text('Mileage Deduction', 30, summaryRowY);
    doc.setTextColor(34, 197, 94);
    doc.text(formatCurrency(mileageDeduction), pageWidth - 30, summaryRowY, { align: 'right' });
    summaryRowY += 10;
    
    doc.setTextColor(0, 0, 0);
    doc.text('Business Expenses', 30, summaryRowY);
    doc.setTextColor(239, 68, 68);
    doc.text(formatCurrency(totalExpenses), pageWidth - 30, summaryRowY, { align: 'right' });
    summaryRowY += 10;
    
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(229, 231, 235);
    doc.line(30, summaryRowY, pageWidth - 30, summaryRowY);
    summaryRowY += 10;
    
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('TOTAL DEDUCTIONS', 30, summaryRowY);
    doc.setTextColor(34, 197, 94);
    doc.text(formatCurrency(totalDeductions), pageWidth - 30, summaryRowY, { align: 'right' });
    
    doc.setTextColor(0, 0, 0);
    
    // Important notes section
    const notesY = summaryRowY + 30;
    doc.setFillColor(254, 243, 199); // Light yellow
    doc.roundedRect(20, notesY, pageWidth - 40, 80, 3, 3, 'FD');
    
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('Important Tax Notes:', 30, notesY + 12);
    
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    const notes = [
      '• Keep all receipts and documentation for at least 7 years',
      '• The standard mileage rate may change annually - verify with IRS',
      '• Only business-related expenses are deductible',
      '• Consult with a tax professional for specific advice',
      '• This report is for informational purposes only',
      '• Separate personal and business use of vehicles',
      '• Document the business purpose of each trip'
    ];
    
    let noteY = notesY + 22;
    notes.forEach(note => {
      doc.text(note, 30, noteY, { maxWidth: pageWidth - 60 });
      noteY += 7;
    });
    
    // Footer on all pages
    const pageCount = doc.internal.pages.length - 1;
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(128, 128, 128);
      doc.text(
        `Page ${i} of ${pageCount}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    }
    
    setTimeout(() => {
      doc.save(`tax-summary-${timestamp}.pdf`);
    }, 400);
  }

  function handleAdvancedExport() {
    if (exportFormat === 'pdf') {
      exportToPDF();
    } else {
      // CSV export
      if (exportDataType === 'tax-bundle') {
        exportTaxBundle();
      } else if (exportDataType === 'trips') {
        const csv = exportTripsCSV();
        if (csv) {
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `trips-export-${Date.now()}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          showSuccessMsg('Trips exported successfully!');
          showAdvancedExport = false;
        }
      } else if (exportDataType === 'expenses') {
        const csv = exportExpensesCSV();
        if (csv) {
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `expenses-export-${Date.now()}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          showSuccessMsg('Expenses exported successfully!');
          showAdvancedExport = false;
        }
      }
    }
  }

  // Old export function (kept for backward compatibility but now shows upgrade modal)
  function exportCSV() {
    upgradeSource = 'export';
    isUpgradeModalOpen = true;
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
      reader.onload = async (e: any) => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.settings) {
            userSettings.set(data.settings);
            if ($user) await syncToCloud('settings', data.settings);
          }

          if (data.trips && Array.isArray(data.trips)) {
             if(confirm(`Found ${data.trips.length} trips in backup. Import them now?`)) {
                let userId = $user?.name || $user?.token || localStorage.getItem('offline_user_id') || 'offline';
                let count = 0;
                for (const trip of data.trips) {
                    await trips.create(trip, userId);
                    count++;
                }
                showSuccessMsg(`Successfully imported ${count} trips!`);
             }
          } else {
             showSuccessMsg('Settings imported. No trips found in backup.');
          }

        } catch (err) {
          console.error(err);
          alert('Invalid backup file');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function importCSV() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const lines = text.split(/\r?\n/);
        if (lines.length < 2) throw new Error("Empty CSV");

        const parsed: any[] = [];
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const row = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
          if (!row) continue;
          
          const cleanRow = row.map((c: string) => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
          const stopsStr = cleanRow[2];
          let stops: any[] = [];
          if (stopsStr) {
            stops = stopsStr.split('|').map(s => ({ 
                id: crypto.randomUUID(), 
                address: s.trim(), 
                earnings: 0 
            }));
          }

          const totalRevenue = parseFloat(cleanRow[9]) || 0;
          if (totalRevenue > 0) {
             if (stops.length > 0) stops[0].earnings = totalRevenue;
             else stops.push({ id: crypto.randomUUID(), address: 'Revenue Adjustment', earnings: totalRevenue });
          }

          const estimatedTime = parseDuration(cleanRow[6]);
          const maintenanceCost = parseFloat(cleanRow[11]) || 0;
          const suppliesCost = parseFloat(cleanRow[13]) || 0; 

          let maintenanceItems = parseItemString(cleanRow[12]);
          if (maintenanceItems.length === 0 && maintenanceCost > 0) {
             maintenanceItems.push({ id: crypto.randomUUID(), type: 'Maintenance', cost: maintenanceCost });
          }

          let suppliesItems = parseItemString(cleanRow[14]);
          if (suppliesItems.length === 0 && suppliesCost > 0) {
             suppliesItems.push({ id: crypto.randomUUID(), type: 'Supplies', cost: suppliesCost });
          }

          parsed.push({
            date: cleanRow[0] ? new Date(cleanRow[0]).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            startAddress: cleanRow[1] || 'Unknown Start',
            endAddress: cleanRow[3] || cleanRow[1] || 'Unknown End',
            stops: stops,
            totalMiles: parseFloat(cleanRow[5]) || 0,
            estimatedTime: estimatedTime,
            totalTime: cleanRow[6], 
            hoursWorked: parseFloat(cleanRow[7]) || 0,
            fuelCost: parseFloat(cleanRow[10]) || 0,
            maintenanceCost: maintenanceCost,
            maintenanceItems: maintenanceItems, 
            suppliesCost: suppliesCost,
            suppliesItems: suppliesItems, 
            notes: cleanRow[17] || '',
            startTime: '09:00',
            endTime: '17:00',
            mpg: 25,
            gasPrice: 3.50,
          });
        }

        if (parsed.length > 0) {
            if(confirm(`Found ${parsed.length} trips. Import them now?`)) {
                let userId = $user?.name || $user?.token || localStorage.getItem('offline_user_id') || 'offline';
                for (const trip of parsed) {
                    await trips.create(trip, userId);
                }
                showSuccessMsg(`Successfully imported ${parsed.length} trips from CSV!`);
            }
        } else {
            alert("No valid trips found in CSV.");
        }
      } catch (err) {
        console.error(err);
        alert('Failed to parse CSV file.');
      }
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
        <label for="profile-name">Name</label>
        <input id="profile-name" type="text" bind:value={profile.name} placeholder="Your name" />
      </div>
      
      <div class="form-group">
        <label for="profile-email">Email</label>
        <input id="profile-email" type="email" bind:value={profile.email} placeholder="your@email.com" />
      </div>

      <button class="btn-secondary" on:click={saveProfile}>Save Profile</button>
      
      <div class="divider"></div>

      <div class="plan-section">
        <div class="plan-info">
          <label for="plan-badge">Current Plan</label>
          <div class="plan-row">
            <div id="plan-badge" class="plan-badge" style="text-transform: capitalize;">
              {$auth.user?.plan || 'free'} Plan
            </div>
            
            {#if isPro}
                <button 
                    class="upgrade-link-btn" 
                    on:click={handlePortal}
                    disabled={isOpeningPortal}
                >
                    {isOpeningPortal ? 'Loading...' : 'Manage Subscription'}
                </button>
            {:else}
              <button 
                class="upgrade-link-btn" 
                on:click={() => { 
                  upgradeSource = 'generic'; 
                  isUpgradeModalOpen = true; 
                }} 
                disabled={isCheckingOut}
              >
                {isCheckingOut ? 'Loading...' : 'Upgrade to Pro'}
              </button>
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
       <div class="card-icon navy">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
             <path d="M17 2H3C2.46957 2 1.96086 2.21071 1.58579 2.58579C1.21071 2.96086 1 3.46957 1 4V16C1 16.5304 1.21071 17.0391 1.58579 17.4142C1.96086 17.7893 2.46957 18 3 18H17C17.5304 18 18.0391 17.7893 18.4142 17.4142C18.7893 17.0391 19 16.5304 19 16V4C19 3.46957 18.7893 2.96086 18.4142 2.58579C18.0391 2.21071 17.5304 2 17 2Z" stroke="currentColor" stroke-width="2"/>
            <path d="M1 8H19M6 1V3M14 1V3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Data Management</h2>
          <p class="card-subtitle">Export, import, and manage your data</p>
        </div>
      </div>
      
      <div class="data-actions">
        <button class="action-btn featured" on:click={openAdvancedExport}>
          <div class="featured-badge">PRO</div>
          <div>
            <div class="action-title">
              {!isPro ? '🔒 ' : '⭐ '}Advanced Export
            </div>
            <div class="action-subtitle">
              Export trips, expenses, or tax bundle with date filters & PDF
            </div>
          </div>
        </button>

        <div class="divider"></div>

        <button class="action-btn" on:click={importCSV}>
          <div>
            <div class="action-title">Import CSV</div>
            <div class="action-subtitle">Upload trips from spreadsheet</div>
          </div>
        </button>

        <div class="divider"></div>

        <button class="action-btn" on:click={exportData}>
          <div>
            <div class="action-title">Backup Full Data (JSON)</div>
            <div class="action-subtitle">Save settings and trips backup</div>
          </div>
        </button>
        
        <button class="action-btn" on:click={importData}>
          <div>
            <div class="action-title">Restore Backup (JSON)</div>
            <div class="action-subtitle">Restore from full backup</div>
          </div>
        </button>
        
        <div class="divider"></div>

        <button class="action-btn danger" on:click={clearAllData}>
          <div>
            <div class="action-title">Clear Local Data</div>
            <div class="action-subtitle">Delete local trip history</div>
          </div>
        </button>
      </div>
    </div>

    
    <div class="settings-card">
      <div class="card-header">
        <div class="card-icon green">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
             <path d="M10 12C11.1046 12 12 11.1046 12 10C12 8.89543 11.1046 8 10 8C8.89543 8 8 8.89543 8 10C8 11.1046 8.89543 12 10 12Z" stroke="currentColor" stroke-width="2"/>
             <path d="M16.2 12C16.1 12.5 16.3 13 16.7 13.3L16.8 13.4C17.1 13.7 17.3 14.1 17.3 14.5C17.3 14.9 17.1 15.3 16.8 15.6C16.5 15.9 16.1 16.1 15.7 16.1C15.3 16.1 14.9 15.9 14.6 15.6L14.5 15.5C14.2 15.1 13.7 14.9 13.2 15C12.7 15.1 12.4 15.5 12.3 16V16.2C12.3 17.1 11.6 17.8 10.7 17.8C9.8 17.8 9.1 17.1 9.1 16.2V16.1C9 15.5 8.6 15.1 8 15C7.5 15 7 15.2 6.7 15.6L6.6 15.7C6.3 16 5.9 16.2 5.5 16.2C5.1 16.2 4.7 16 4.4 15.7C4.1 15.4 3.9 15 3.9 14.6C3.9 14.2 4.1 13.8 4.4 13.5L4.5 13.4C4.9 13.1 5.1 12.6 5 12.1C4.9 11.6 4.5 11.3 4 11.2H3.8C2.9 11.2 2.2 10.5 2.2 9.6C2.2 8.7 2.9 8 3.8 8H3.9C4.5 7.9 4.9 7.5 5 6.9C5 6.4 4.8 5.9 4.4 5.6L4.3 5.5C4 5.2 3.8 4.8 3.8 4.4C3.8 4 4 3.6 4.3 3.3C4.6 3 5 2.8 5.4 2.8C5.8 2.8 6.2 3 6.5 3.3L6.6 3.4C7 3.8 7.5 4 8 3.9C8.5 3.9 8.8 3.4 8.9 2.9V2.7C8.9 1.8 9.6 1.1 10.5 1.1C11.4 1.1 12.1 1.8 12.1 2.7V2.8C12.1 3.4 12.5 3.8 13.1 3.9C13.6 4 14.1 3.8 14.4 3.4L14.5 3.3C14.8 3 15.2 2.8 15.6 2.8C16 2.8 16.4 3 16.7 3.3C17 3.6 17.2 4 17.2 4.4C17.2 4.8 17 5.2 16.7 5.5L16.6 5.6C16.2 5.9 16 6.4 16.1 6.9C16.2 7.4 16.6 7.7 17.1 7.8H17.3C18.2 7.8 18.9 8.5 18.9 9.4C18.9 10.3 18.2 11 17.3 11H17.2C16.6 11.1 16.2 11.5 16.1 12.1L16.2 12Z" stroke="currentColor" stroke-width="2"/>
          </svg>
        </div>
        <div>
          <h2 class="card-title">Integrations</h2>
          <p class="card-subtitle">Connect external services</p>
        </div>
      </div>
      
      <div class="data-actions">
        <a href="/dashboard/hughesnet" class="action-btn" style="text-decoration: none; color: inherit;">
          <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
             <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #0D9488;">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M2 12h20"></path>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
             </svg>
             <div>
                <div class="action-title">HughesNet</div>
                <div class="action-subtitle">Configure satellite integration</div>
             </div>
             <div style="margin-left: auto;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
             </div>
          </div>
        </a>
      </div>
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
          <div class="form-group"><label for="curr-pass">Current Password</label><input id="curr-pass" type="password" bind:value={passwordData.current} /></div>
          <div class="form-group"><label for="new-pass">New Password</label><input id="new-pass" type="password" bind:value={passwordData.new} /></div>
          <div class="form-group"><label for="confirm-pass">Confirm New Password</label><input id="confirm-pass" type="password" bind:value={passwordData.confirm} /></div>
          <div class="button-group">
            <button class="btn-primary" on:click={changePassword}>Update</button>
            <button class="btn-secondary" on:click={() => showPasswordChange = false}>Cancel</button>
          </div>
        </div>
      {/if}

      <div class="divider"></div>

      <div class="passkey-section">
        <div>
            <h3 style="font-size: 15px; font-weight: 600; color: #111827; margin-bottom: 4px;">Biometric Login</h3>
            <p style="font-size: 13px; color: #6B7280; margin-bottom: 12px;">Enable Face ID or Touch ID for faster login.</p>
        </div>
        <button class="btn-secondary" on:click={registerPasskey} disabled={registering}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
            {registering ? 'Registering...' : 'Register Device'}
        </button>
      </div>

      <!-- Passkeys List UI -->
      <div class="passkeys-card" style="margin-top:12px;padding:12px;border:1px solid #eaeaea;border-radius:6px;background:#fff">
        <h3 style="margin:0 0 8px 0;font-size:15px">Your Passkeys</h3>
        {#if loadingPasskeys}
          <div>Loading passkeys…</div>
        {:else}
          {#if passkeyError}
            <div class="alert error">{passkeyError}</div>
          {:else}
            {#if passkeys.length === 0}
              <div>No passkeys registered.</div>
            {:else}
              <table style="width:100%;border-collapse:collapse">
                <thead>
                  <tr style="text-align:left;border-bottom:1px solid #e6e6e6">
                    <th style="padding:6px">Name</th>
                    <th style="padding:6px">Transports</th>
                    <th style="padding:6px">Added</th>
                    <th style="padding:6px"></th>
                  </tr>
                </thead>
                <tbody>
                  {#each passkeys as p}
                    <tr style="border-bottom:1px solid #f6f6f6">
                      <td style="padding:8px 6px;vertical-align:middle">
                        <input class="input" style="width:100%;" type="text" bind:value={renameDraft[p.credentialID]} />
                      </td>
                      <td style="padding:8px 6px;vertical-align:middle">{(p.transports || []).join(', ')}</td>
                      <td style="padding:8px 6px;vertical-align:middle">{p.createdAt ? new Date(p.createdAt).toLocaleString() : '—'}</td>
                      <td style="padding:8px 6px;vertical-align:middle;text-align:right">
                        <button class="btn" on:click={() => savePasskeyName(p.credentialID)} style="margin-right:8px">Save</button>
                        <button class="btn btn-outline" on:click={() => deletePasskey(p.credentialID)}>Remove</button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          {/if}
        {/if}
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

<Modal bind:open={showAdvancedExport} title="Advanced Export">
  <div class="export-modal">
    <div class="export-section">
      <label class="export-label">Data Type</label>
      <div class="type-buttons">
        <button 
          class="type-btn" 
          class:active={exportDataType === 'trips'}
          on:click={() => exportDataType = 'trips'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          </svg>
          <span>Trips</span>
        </button>
        
        <button 
          class="type-btn" 
          class:active={exportDataType === 'expenses'}
          on:click={() => exportDataType = 'expenses'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect>
          </svg>
          <span>Expenses</span>
        </button>
        
        <button 
          class="type-btn tax" 
          class:active={exportDataType === 'tax-bundle'}
          on:click={() => exportDataType = 'tax-bundle'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <span>Tax Bundle ⭐</span>
        </button>
      </div>
    </div>

    {#if exportDataType === 'tax-bundle'}
      <div style="background: #FFF3CD; border: 2px solid #FF6B35; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
        <div style="display: flex; align-items: start; gap: 12px;">
          <div style="font-size: 24px; line-height: 1;">⚠️</div>
          <div>
            <div style="font-weight: 700; font-size: 14px; color: #DC2626; margin-bottom: 8px;">
              IMPORTANT IRS RULE
            </div>
            <div style="font-size: 13px; color: #374151; line-height: 1.5;">
              <strong>You must choose ONE deduction method:</strong>
              <br/>
              <span style="color: #059669;">✓ Standard Mileage ($0.67/mile)</span> - Deduct mileage ONLY
              <br/>
              <span style="color: #DC2626;">✗ Cannot also deduct:</span> Fuel, oil changes, repairs, maintenance
              <br/><br/>
              <strong>OR</strong>
              <br/>
              <span style="color: #059669;">✓ Actual Expenses</span> - Deduct fuel, maintenance, repairs
              <br/>
              <span style="color: #DC2626;">✗ Cannot also deduct:</span> Standard mileage rate
              <br/><br/>
              <em style="font-size: 12px; color: #6B7280;">This report shows both for comparison. Consult your tax professional to choose the better option.</em>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <div class="export-section">
      <label class="export-label">Format</label>
      <div class="format-buttons">
        <button 
          class="format-btn" 
          class:active={exportFormat === 'csv'}
          on:click={() => exportFormat = 'csv'}
        >
          CSV
        </button>
        <button 
          class="format-btn" 
          class:active={exportFormat === 'pdf'}
          on:click={() => exportFormat = 'pdf'}
        >
          PDF
        </button>
      </div>
    </div>

    <div class="export-section">
      <label class="export-label">Date Range (Optional)</label>
      <div class="date-range">
        <input type="date" bind:value={exportDateFrom} placeholder="From" />
        <span>to</span>
        <input type="date" bind:value={exportDateTo} placeholder="To" />
      </div>
    </div>

    {#if exportDataType === 'tax-bundle'}
      <div class="export-preview">
        <div class="preview-item">
          <div class="preview-label">Trips</div>
          <div class="preview-value">{filteredTrips.length}</div>
        </div>
        <div class="preview-item">
          <div class="preview-label">Expenses</div>
          <div class="preview-value">{filteredExpenses.length}</div>
        </div>
        <div class="preview-item highlight">
          <div class="preview-label">Estimated Deduction</div>
          <div class="preview-value">
            {formatCurrency(
              (filteredTrips.reduce((sum, t) => sum + (t.totalMiles || 0), 0) * 0.67) +
              filteredExpenses.reduce((sum, e) => sum + e.amount, 0)
            )}
          </div>
        </div>
      </div>
    {:else}
      <div class="export-preview">
        <div class="preview-item">
          <div class="preview-label">
            {exportDataType === 'trips' ? 'Trips' : 'Expenses'} Found
          </div>
          <div class="preview-value">
            {exportDataType === 'trips' ? filteredTrips.length : filteredExpenses.length}
          </div>
        </div>
      </div>
    {/if}

    {#if exportDataType !== 'tax-bundle' && exportFormat === 'csv'}
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={exportIncludeSummary} />
        Include summary totals
      </label>
    {/if}

    <div class="modal-actions">
      <button class="btn-secondary" on:click={() => showAdvancedExport = false}>
        Cancel
      </button>
      <button 
        class="btn-primary" 
        on:click={handleAdvancedExport}
        disabled={exportDataType === 'trips' ? filteredTrips.length === 0 : exportDataType === 'expenses' ? filteredExpenses.length === 0 : (filteredTrips.length === 0 && filteredExpenses.length === 0)}
      >
        {exportDataType === 'tax-bundle' ? `Export Bundle (${exportFormat.toUpperCase()})` : `Export ${exportFormat.toUpperCase()}`}
      </button>
    </div>
  </div>
</Modal>

<Modal bind:open={isUpgradeModalOpen} title="Upgrade to Pro">
  <div class="space-y-6 text-center py-4">
        <div class="mx-auto w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
            <span class="text-3xl">🚀</span>
        </div>
        
        <h3 class="text-xl font-bold text-gray-900">
            {#if upgradeSource === 'export' || upgradeSource === 'advanced-export'}
                Unlock Advanced Exports
            {:else}
                Unlock Pro Features
            {/if}
        </h3>
        
        <p class="text-gray-600 text-base leading-relaxed">
            {#if upgradeSource === 'export' || upgradeSource === 'advanced-export'}
                Advanced export features including tax bundles, PDF exports, and comprehensive expense tracking are Pro features. Upgrade now to unlock professional-grade data exports!
            {:else}
                Take your business to the next level. Get unlimited trips, powerful route optimization, and tax-ready data exports.
            {/if}
        </p>

        <div class="bg-gray-50 p-4 rounded-lg text-left text-sm space-y-2 border border-gray-100">
            <div class="flex items-center gap-2">
                <span class="text-green-500 text-lg">✓</span>
                <span class="text-gray-700">Unlimited Stops per Trip</span>
             </div>
            <div class="flex items-center gap-2">
                <span class="text-green-500 text-lg">✓</span>
                <span class="text-gray-700">One-Click Route Optimization</span>
            </div>
            <div class="flex items-center gap-2">
                 <span class="text-green-500 text-lg">✓</span>
                 <span class="text-gray-700">Unlimited Monthly Trips</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-green-500 text-lg">✓</span>
                <span class="text-gray-700">Advanced Exports (CSV/PDF)</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-green-500 text-lg">✓</span>
                <span class="text-gray-700">Tax Bundle Generation</span>
            </div>
        </div>

        <div class="flex gap-3 justify-center pt-2">
            <Button variant="outline" on:click={() => isUpgradeModalOpen = false}>
                Maybe Later
            </Button>
            <button 
                class="inline-flex items-center justify-center rounded-lg bg-orange-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 transition-all"
                on:click={handleCheckout}
                disabled={isCheckingOut}
            >
                {isCheckingOut ? 'Loading...' : 'Upgrade Now'}
            </button>
        </div>
    </div>
</Modal>

<style>
  .settings { max-width: 1200px; margin: 0 auto; padding: 20px; }
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
  .card-icon.teal { background: linear-gradient(135deg, #14B8A6 0%, #0D9488 100%); }
  
  .card-title { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  .card-subtitle { font-size: 14px; color: #6B7280; }
  
  .form-group { margin-bottom: 20px; }
  .form-group label { display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 8px; }
  
  .form-group input, .form-group select { 
    width: 100%; max-width: 450px; 
    padding: 12px 16px; border: 2px solid #E5E7EB;
    border-radius: 10px; font-size: 16px; font-family: inherit; background: white; transition: all 0.2s;
    display: block; box-sizing: border-box;
  }
  .form-group input:focus, .form-group select:focus { 
    outline: none; border-color: var(--orange);
    box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1); 
  }
  .form-group input:disabled { background: #F9FAFB; color: #9CA3AF; cursor: not-allowed; }
  
  .input-prefix { position: relative; width: 100%; max-width: 450px; box-sizing: border-box; }
  .input-prefix .prefix { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #6B7280; font-weight: 600; }
  .input-prefix input { padding-left: 36px; }

  .divider { height: 1px; background: #E5E7EB; margin: 24px 0; }
  .plan-row { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
  .plan-badge { display: inline-block; padding: 6px 12px; background: #F3F4F6; color: #374151; border-radius: 8px; font-weight: 600; font-size: 14px; }
  
  .upgrade-link-btn { background: none; border: none; color: var(--orange); font-size: 14px; font-weight: 600; cursor: pointer; padding: 0; text-decoration: none; }
  
  @media (hover: hover) {
    .upgrade-link-btn:hover { text-decoration: underline; }
  }
  
  .usage-stats { margin-top: 16px; }
  .usage-header { display: flex; justify-content: space-between; font-size: 13px; color: #6B7280; margin-bottom: 6px; }
  .progress-bar { height: 8px; background: #E5E7EB; border-radius: 4px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--green); border-radius: 4px; transition: width 0.3s; }
  .progress-fill.warning { background: #F59E0B; }
  
  .btn-primary, .btn-secondary, .btn-logout, .btn-delete, .btn-delete-confirm { 
      width: 100%; padding: 14px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 15px;
  }
  .btn-primary { background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%); color: white; border: none; }
  .btn-secondary { background: white; color: #374151; border: 2px solid #E5E7EB; }
  .btn-logout { background: white; color: #DC2626; border: 2px solid #FEE2E2; }
  
  @media (hover: hover) {
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(255, 127, 80, 0.3); }
    .btn-secondary:hover { border-color: var(--orange); color: var(--orange); }
    .btn-logout:hover { background: #FEF2F2; border-color: #FCA5A5; }
    .btn-delete:hover { color: #B91C1C; }
    .btn-delete-confirm:hover { background: #B91C1C; }
    .action-btn:hover { border-color: var(--orange); background: white; }
    .action-btn.danger:hover { border-color: #DC2626; background: white; }
  }
  
  .btn-delete { background: transparent; color: #DC2626; border: none; margin-top: 12px; font-size: 14px; text-decoration: underline; }
  .delete-confirmation { margin-top: 16px; padding: 16px; background: white; border-radius: 10px; border: 1px solid #FECACA; }
  .delete-warning { font-size: 14px; color: #374151; margin-bottom: 12px; font-weight: 500; }
  .delete-input { width: 100%; padding: 10px; border: 1px solid #E5E7EB; border-radius: 8px; margin-bottom: 12px; }
  .error-text { color: #DC2626; font-size: 13px; margin-bottom: 12px; }
  .btn-delete-confirm { background: #DC2626; color: white; border: none; margin-bottom: 8px; }

  .button-group { display: flex; flex-direction: column; gap: 8px; }
  .data-actions { display: flex; flex-direction: column; gap: 12px; }
  .action-btn { display: flex; align-items: center; gap: 16px; padding: 16px; background: #F9FAFB; border: 2px solid #E5E7EB; border-radius: 12px; cursor: pointer; text-align: left; width: 100%; position: relative; }
  .action-btn.featured { background: linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%); border-color: #FB923C; }
  .featured-badge { position: absolute; top: 8px; right: 8px; background: var(--orange); color: white; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 700; }
  .action-title { font-size: 15px; font-weight: 600; color: #111827; }
  .action-subtitle { font-size: 13px; color: #6B7280; }

  /* Export Modal Styles */
  .export-modal { padding: 20px 0; }
  .export-section { margin-bottom: 24px; }
  .export-label { display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 12px; }
  
  .type-buttons, .format-buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .format-buttons { grid-template-columns: repeat(2, 1fr); }
  
  .type-btn, .format-btn { 
    display: flex; flex-direction: column; align-items: center; gap: 8px; 
    padding: 16px; background: white; border: 2px solid #E5E7EB; border-radius: 12px; 
    cursor: pointer; transition: all 0.2s; font-size: 14px; font-weight: 500;
  }
  .type-btn.active, .format-btn.active { background: #FFF7ED; border-color: var(--orange); color: var(--orange); }
  .type-btn.tax.active { background: linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%); }
  
  @media (hover: hover) {
    .type-btn:hover, .format-btn:hover { border-color: var(--orange); }
  }
  
  .date-range { display: flex; align-items: center; gap: 12px; }
  .date-range input { flex: 1; padding: 10px; border: 2px solid #E5E7EB; border-radius: 8px; font-size: 14px; }
  .date-range span { color: #6B7280; font-size: 14px; }
  
  .export-preview { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 16px; background: #F9FAFB; border-radius: 12px; margin-bottom: 20px; }
  .preview-item { text-align: center; }
  .preview-item.highlight { background: #FFF7ED; padding: 12px; border-radius: 8px; }
  .preview-label { font-size: 12px; color: #6B7280; margin-bottom: 4px; }
  .preview-value { font-size: 20px; font-weight: 700; color: #111827; }
  
  .checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #374151; margin-bottom: 20px; }
  .checkbox-label input { width: 18px; height: 18px; cursor: pointer; }
  
  .modal-actions { display: flex; gap: 12px; margin-top: 24px; }
  .modal-actions button { flex: 1; }

  @media (max-width: 1024px) {
    .settings-grid { grid-template-columns: 1fr; }
    .export-preview { grid-template-columns: 1fr; }
    .type-buttons { grid-template-columns: 1fr; }
  }
</style>