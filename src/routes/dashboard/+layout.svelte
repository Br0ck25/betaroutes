<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { auth, user } from '$lib/stores/auth';
  import { goto } from '$app/navigation';
  import { trips } from '$lib/stores/trips';
  import { expenses } from '$lib/stores/expenses';
  import { trash } from '$lib/stores/trash';
  import { syncManager } from '$lib/sync/syncManager';
  import SyncIndicator from '$lib/components/SyncIndicator.svelte';
  import type { LayoutData } from './$types';

  export let data: LayoutData;

  $: if (data?.user) {
    auth.hydrate(data.user);
  }

  let sidebarOpen = false;
  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
  }
  
  function closeSidebar() {
    sidebarOpen = false;
  }

  function handleOverlayKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeSidebar();
  }
  
  async function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
      await fetch('/api/logout', { method: 'POST' });
      auth.logout();
      trips.clear();
      expenses.clear();
      trash.clear();
      goto('/login');
    }
  }
  
  const navItems = [
    { 
      href: '/dashboard', 
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 9L10 2L17 9V17C17 17.5304 16.7893 18.0391 16.4142 18.4142C16.0391 18.7893 15.5304 18 15 18H5C4.46957 18 3.96086 17.7893 3.58579 17.4142C3.21071 17.0391 3 16.5304 3 16V9Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      label: 'Home', 
      exact: true 
    },
    { 
      href: '/dashboard/expenses', 
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 1V23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 5H9.5C8.57174 5 7.6815 5.36875 7.02513 6.02513C6.36875 6.6815 6 7.57174 6 8.5C6 9.42826 6.36875 10.3185 7.02513 10.9749C7.6815 11.6313 8.57174 12 9.5 12H14.5C15.4283 12 16.3185 12.3688 16.9749 13.0251C17.6313 13.6815 18 14.5717 18 15.5C18 16.4283 17.6313 17.3185 16.9749 17.9749C16.3185 18.6313 15.4283 19 14.5 19H6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      label: 'Expenses' 
    },
    { 
      href: '/dashboard/trips', 
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 2C13.97 2 18 6.03 18 11C18 15.97 13.97 20 9 20H2V13C2 8.03 6.03 4 11 4H18V11C18 6.03 13.97 2 9 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      label: 'Trips',
      exclude: ['/dashboard/trips/new']
    },
    { 
      href: '/dashboard/settings', 
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.4 15C20.4 14.3 21 13.2 21 12C21 10.8 20.4 9.7 19.4 9L20 8C20.5 7.2 20.2 6.1 19.4 5.6L18.4 5C17.6 4.5 16.6 4.8 16.1 5.6L15.5 6.6C14.5 5.9 13.3 5.5 12 5.5C10.7 5.5 9.5 5.9 8.5 6.6L7.9 5.6C7.4 4.8 6.4 4.5 5.6 5L4.6 5.6C3.8 6.1 3.5 7.2 4 8L4.6 9C3.6 9.7 3 10.8 3 12C3 13.2 3.6 14.3 4.6 15L4 16C3.5 16.8 3.8 17.9 4.6 18.4L5.6 19C6.4 19.5 7.4 19.2 7.9 18.4L8.5 17.4C9.5 18.1 10.7 18.5 12 18.5C13.3 18.5 14.5 18.1 15.5 17.4L16.1 18.4C16.6 19.2 17.6 19.5 18.4 19L19.4 18.4C20.2 17.9 20.5 16.8 20 16L19.4 15Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      label: 'Settings' 
    },
  ];

  function isActive(href: string, exact = false, exclude: string[] = []): boolean {
    const path = $page.url.pathname;
    
    if (exclude.length > 0) {
      if (exclude.some(e => path.startsWith(e))) {
        return false;
      }
    }

    if (exact) {
      return path === href;
    }

    return path.startsWith(href);
  }
  
  function getInitial(name: string): string {
    return name ? name.charAt(0).toUpperCase() : 'U';
  }

  onMount(async () => {
    console.log('[DASHBOARD LAYOUT] Initializing...');
    
    const apiKey = data.googleMapsApiKey; 
    
    let userId = data?.user?.name || $user?.name || data?.user?.token || $user?.token;

    if (!userId) {
        userId = localStorage.getItem('offline_user_id');
        if (userId) {
            console.log('[DASHBOARD LAYOUT] Using Offline ID:', userId);
        }
    }

    if (userId) {
      try {
        console.log('[DASHBOARD LAYOUT] Loading data for:', userId);
        
        await syncManager.initialize(apiKey);
        
        // Load all data
        await Promise.all([
            trips.load(userId),
            expenses.load(userId),
            trash.load(userId)
        ]);

        // Sync background
        trips.syncFromCloud(userId);
        expenses.syncFromCloud(userId);
        
        console.log('[DASHBOARD LAYOUT] ✅ Data loaded successfully!');
      } catch (err) {
        console.error('[DASHBOARD LAYOUT] ❌ Failed to load data:', err);
      }
    } else {
      await auth.init();
    }
  });
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</svelte:head>

<div class="layout">
  <header class="mobile-header">
    <img src="/logo.png" alt="Go Route Yourself" class="mobile-logo" />
    
    <div class="mobile-actions">
      <SyncIndicator />
      {#if $user}
        <a href="/dashboard/settings" class="mobile-user" aria-label="Profile Settings">
          <div class="user-avatar small">
            {getInitial($user.name || $user.email || '')}
          </div>
        </a>
      {/if}
    </div>
  </header>
  
  <aside class="sidebar" class:open={sidebarOpen}>
    <div class="sidebar-header">
      <img src="/logo.png" alt="Go Route Yourself" class="sidebar-logo" />
      <button class="close-btn" on:click={closeSidebar} aria-label="Close menu">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    
    <div class="sidebar-sync">
      <SyncIndicator />
    </div>
    
    <nav class="nav">
      {#each navItems as item}
        <a 
          href={item.href} 
          class="nav-item" 
          class:active={isActive(item.href, item.exact, item.exclude)}
          on:click={closeSidebar}
        >
          <span class="nav-icon">{@html item.icon}</span>
          <span class="nav-label">{item.label}</span>
        </a>
      {/each}
    </nav>
    
    <div class="sidebar-footer">
      {#if $user}
        <a href="/dashboard/settings" class="user-card" on:click={closeSidebar}>
          <div class="user-avatar">
            {getInitial($user.name || $user.email || '')}
          </div>
          <div class="user-info">
            <div class="user-name">{$user.name || 'User'}</div>
            <div class="user-plan">{$user.plan || 'Free'} Plan</div>
          </div>
        </a>
        
        <button class="logout-btn" on:click={handleLogout}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M7 17H3C2.46957 17 1.96086 16.7893 1.58579 16.4142C1.21071 16.0391 1 15.5304 1 15V3C1 2.46957 1.21071 1.96086 1.58579 1.58579C1.96086 1.21071 2.46957 1 3 1H7M13 13L17 9M17 9L13 5M17 9H7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>Logout</span>
        </button>
      {/if}
    </div>
  </aside>
  
  {#if sidebarOpen}
    <div 
      class="overlay" 
      role="button" 
      tabindex="0"
      on:click={closeSidebar} 
      on:keydown={handleOverlayKeydown}
    ></div>
  {/if}
  
  <main class="main-content">
    <slot />
  </main>

  <nav class="bottom-nav">
    {#each navItems as item}
      <a 
        href={item.href} 
        class="bottom-nav-item" 
        class:active={isActive(item.href, item.exact, item.exclude)}
      >
        <span class="bottom-nav-icon">{@html item.icon}</span>
        <span class="bottom-nav-label">{item.label}</span>
      </a>
    {/each}
  </nav>
</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  :root {
    --orange: #FF7F50;
    --blue: #29ABE2;
    --navy: #2C4A6E;
    --green: #8DC63F;
    --purple: #8B5A9E;
    --sidebar-width: 280px;
  }
  
  :global(body) {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  
  .layout {
    display: flex;
    min-height: 100vh;
    background: #F9FAFB;
  }
  
  /* --- Mobile Header --- */
  .mobile-header {
    display: flex; /* Default to visible for mobile */
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 60px;
    background: white;
    border-bottom: 1px solid #E5E7EB;
    padding: 0 16px;
    align-items: center;
    justify-content: space-between;
    z-index: 100;
  }
  
  .mobile-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  .mobile-logo {
    height: 32px;
  }
  
  .mobile-user {
    display: flex;
    align-items: center;
    text-decoration: none;
    color: inherit;
    cursor: pointer;
  }
  
  /* --- Sidebar (Hidden by default on mobile) --- */
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: var(--sidebar-width);
    background: white;
    border-right: 1px solid #E5E7EB;
    display: flex;
    flex-direction: column;
    z-index: 200;
    transform: translateX(-100%); /* Hidden on mobile */
    transition: transform 0.3s ease;
  }
  
  .sidebar.open {
    transform: translateX(0);
  }

  .sidebar-header {
    padding: 24px 20px;
    border-bottom: 1px solid #E5E7EB;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  
  .sidebar-logo {
    height: 40px;
  }
  
  /* Sync Indicator in Sidebar */
  .sidebar-sync {
    padding: 16px 20px;
    border-bottom: 1px solid #E5E7EB;
  }
  
  .nav {
    flex: 1;
    padding: 24px 16px;
    overflow-y: auto;
  }
  
  .nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 10px;
    text-decoration: none;
    color: #6B7280;
    font-weight: 500;
    font-size: 15px;
    margin-bottom: 4px;
    transition: all 0.2s;
    position: relative;
  }
  
  .nav-item:hover {
    background: #F9FAFB;
    color: #111827;
  }
  
  .nav-item.active {
    background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%);
    color: white;
    box-shadow: 0 4px 12px rgba(255, 127, 80, 0.3);
  }
  
  .nav-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .nav-label {
    font-size: 15px;
  }
  
  .sidebar-footer {
    padding: 20px;
    border-top: 1px solid #E5E7EB;
  }
  
  .user-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: #F9FAFB;
    border-radius: 12px;
    margin-bottom: 12px;
    text-decoration: none;
    color: inherit;
    transition: background-color 0.2s ease;
  }

  .user-card:hover {
    background: #F3F4F6;
  }
  
  .user-avatar {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: linear-gradient(135deg, var(--navy) 0%, var(--blue) 100%);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 18px;
    flex-shrink: 0;
  }
  
  .user-avatar.small {
    width: 32px;
    height: 32px;
    font-size: 14px;
  }
  
  .user-info {
    flex: 1;
    min-width: 0;
  }
  
  .user-name {
    font-weight: 600;
    font-size: 14px;
    color: #111827;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .user-plan {
    font-size: 12px;
    color: #6B7280;
    text-transform: capitalize;
  }
  
  .logout-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px;
    background: white;
    color: #6B7280;
    border: 1px solid #E5E7EB;
    border-radius: 10px;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
  }
  
  /* --- Main Content --- */
  .main-content {
    margin-left: 0; /* Default 0 for mobile */
    padding: 80px 16px 100px 16px; /* Top padding for header, Bottom for nav bar */
    flex: 1;
    min-height: 100vh;
  }
  
  .overlay {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 150;
    backdrop-filter: blur(4px);
  }

  .close-btn {
    background: none;
    border: none;
    padding: 8px;
    cursor: pointer;
    color: #374151;
  }

  /* --- Bottom Navigation (Mobile) --- */
  .bottom-nav {
    display: flex;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: white;
    border-top: 1px solid #E5E7EB;
    /* Respect iPhone Home Indicator area */
    padding-bottom: env(safe-area-inset-bottom, 20px); 
    height: calc(60px + env(safe-area-inset-bottom, 20px));
    z-index: 900;
    justify-content: space-around;
    align-items: flex-start;
    padding-top: 8px;
    box-shadow: 0 -2px 10px rgba(0,0,0,0.03);
  }

  .bottom-nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    color: #9CA3AF;
    font-size: 10px;
    font-weight: 500;
    width: 100%;
    gap: 4px;
  }

  .bottom-nav-item.active {
    color: var(--orange);
  }

  .bottom-nav-icon :global(svg) {
    width: 24px;
    height: 24px;
  }
  
  /* --- Desktop Overrides --- */
  @media (min-width: 1024px) {
    .mobile-header {
      display: none;
    }
    
    .sidebar {
      transform: translateX(0); /* Always visible */
    }
    
    .main-content {
      margin-left: var(--sidebar-width);
      padding: 32px;
    }
    
    .bottom-nav {
      display: none;
    }
    
    .close-btn {
      display: none;
    }
    
    .overlay {
      display: none;
    }
  }
</style>