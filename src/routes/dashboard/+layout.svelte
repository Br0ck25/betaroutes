<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { auth, user } from '$lib/stores/auth';
  import { goto } from '$app/navigation';
  import { trips } from '$lib/stores/trips';
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
      trash.clear();
      goto('/login');
    }
  }
  
  const navItems = [
    { 
      href: '/dashboard', 
      icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 9L10 2L17 9V17C17 17.5304 16.7893 18.0391 16.4142 18.4142C16.0391 18.7893 15.5304 18 15 18H5C4.46957 18 3.96086 17.7893 3.58579 17.4142C3.21071 17.0391 3 16.5304 3 16V9Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      label: 'Dashboard', 
      exact: true 
    },
    { 
      href: '/dashboard/trips/new', 
      icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      label: 'New Trip' 
    },
    { 
      href: '/dashboard/trips', 
      icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M9 2C13.97 2 18 6.03 18 11C18 15.97 13.97 20 9 20H2V13C2 8.03 6.03 4 11 4H18V11C18 6.03 13.97 2 9 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      label: 'Trip History',
      // FIX: Don't highlight history when we are on the "New Trip" page
      exclude: ['/dashboard/trips/new']
    },
    { 
      href: '/dashboard/trash', 
      icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M2 4H18M16 4V16C16 17.1046 15.1046 18 14 18H6C4.89543 18 4 17.1046 4 16V4M7 4V2C7 0.89543 7.89543 0 9 0H11C12.1046 0 13 0.89543 13 2V4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      label: 'Trash'
    },
    { 
      href: '/dashboard/data', 
      icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 10h12m-6-6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      label: 'Data' 
    },
    { 
      href: '/dashboard/settings', 
      icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 12C11.1046 12 12 11.1046 12 10C12 8.89543 11.1046 8 10 8C8.89543 8 8 8.89543 8 10C8 11.1046 8.89543 12 10 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.2 12C16.1 12.5 16.3 13 16.7 13.3L16.8 13.4C17.1 13.7 17.3 14.1 17.3 14.5C17.3 14.9 17.1 15.3 16.8 15.6C16.5 15.9 16.1 16.1 15.7 16.1C15.3 16.1 14.9 15.9 14.6 15.6L14.5 15.5C14.2 15.1 13.7 14.9 13.2 15C12.7 15.1 12.4 15.5 12.3 16V16.2C12.3 17.1 11.6 17.8 10.7 17.8C9.8 17.8 9.1 17.1 9.1 16.2V16.1C9 15.5 8.6 15.1 8 15H7.9C7.4 15 6.9 15.2 6.6 15.6L6.5 15.7C6.2 16 5.8 16.2 5.4 16.2C5 16.2 4.6 16 4.3 15.7C4 15.4 3.8 15 3.8 14.6C3.8 14.2 4 13.8 4.3 13.5L4.4 13.4C4.8 13.1 5 12.6 4.9 12.1C4.8 11.6 4.4 11.3 3.9 11.2H3.7C2.8 11.2 2.1 10.5 2.1 9.6C2.1 8.7 2.8 8 3.7 8H3.8C4.4 7.9 4.8 7.5 4.9 6.9V6.8C4.9 6.3 4.7 5.8 4.3 5.5L4.2 5.4C3.9 5.1 3.7 4.7 3.7 4.3C3.7 3.9 3.9 3.5 4.2 3.2C4.5 2.9 4.9 2.7 5.3 2.7C5.7 2.7 6.1 2.9 6.4 3.2L6.5 3.3C6.8 3.7 7.3 3.9 7.8 3.8H8C8.5 3.8 8.8 3.4 8.9 2.9V2.7C8.9 1.8 9.6 1.1 10.5 1.1C11.4 1.1 12.1 1.8 12.1 2.7V2.8C12.1 3.4 12.5 3.8 13.1 3.9C13.6 4 14.1 3.8 14.4 3.4L14.5 3.3C14.8 3 15.2 2.8 15.6 2.8C16 2.8 16.4 3 16.7 3.3C17 3.6 17.2 4 17.2 4.4C17.2 4.8 17 5.2 16.7 5.5L16.6 5.6C16.2 5.9 16 6.4 16.1 6.9C16.2 7.4 16.6 7.7 17.1 7.8H17.3C18.2 7.8 18.9 8.5 18.9 9.4C18.9 10.3 18.2 11 17.3 11H17.2C16.6 11.1 16.2 11.5 16.1 12.1L16.2 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      label: 'Settings' 
    },
  ];

  // FIX: Added optional 'exclude' parameter to handle overlapping paths
  function isActive(href: string, exact = false, exclude: string[] = []): boolean {
    const path = $page.url.pathname;
    
    // 1. Check exclusions first
    if (exclude.length > 0) {
      if (exclude.some(e => path.startsWith(e))) {
        return false;
      }
    }

    // 2. Check exact match
    if (exact) {
      return path === href;
    }

    // 3. Check partial match (default behavior)
    return path.startsWith(href);
  }
  
  function getInitial(name: string): string {
    return name ? name.charAt(0).toUpperCase() : 'U';
  }

  onMount(async () => {
    console.log('[DASHBOARD LAYOUT] Initializing...');
    
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
        await syncManager.initialize();
        
        await trips.load(userId);
        await trash.load(userId);
        await trips.syncFromCloud(userId);
        
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
    <button class="menu-btn" on:click={toggleSidebar} aria-label="Toggle menu">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M3 12H21M3 6H21M3 18H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </button>
    
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
  
  /* Mobile Header */
  .mobile-header {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 64px;
    background: white;
    border-bottom: 1px solid #E5E7EB;
    padding: 0 20px;
    align-items: center;
    justify-content: space-between;
    z-index: 100;
  }
  
  .mobile-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  .menu-btn,
  .close-btn {
    background: none;
    border: none;
    padding: 8px;
    cursor: pointer;
    color: #374151;
    border-radius: 8px;
    transition: all 0.2s;
  }
  
  .menu-btn:hover,
  .close-btn:hover {
    background: #F3F4F6;
    color: var(--orange);
  }
  
  .mobile-logo {
    height: 36px;
  }
  
  .mobile-user {
    display: flex;
    align-items: center;
    text-decoration: none;
    color: inherit;
    cursor: pointer;
  }
  
  /* Sidebar */
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
    transition: transform 0.3s ease;
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
  
  .close-btn {
    display: none;
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
  
  .nav-item.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 24px;
    background: white;
    border-radius: 0 2px 2px 0;
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
  
  .logout-btn:hover {
    background: #FEF2F2;
    border-color: #FEE2E2;
    color: #DC2626;
  }
  
  /* Main Content */
  .main-content {
    margin-left: var(--sidebar-width);
    flex: 1;
    min-height: 100vh;
    padding: 32px;
  }
  
  /* Overlay */
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
  
  /* Scrollbar */
  .nav::-webkit-scrollbar {
    width: 6px;
  }
  
  .nav::-webkit-scrollbar-track {
    background: transparent;
  }
  
  .nav::-webkit-scrollbar-thumb {
    background: #E5E7EB;
    border-radius: 3px;
  }
  
  .nav::-webkit-scrollbar-thumb:hover {
    background: #D1D5DB;
  }
  
  /* Responsive */
  @media (max-width: 1024px) {
    .mobile-header {
      display: flex;
    }
    
    .sidebar {
      transform: translateX(-100%);
    }
    
    .sidebar.open {
      transform: translateX(0);
    }
    
    .close-btn {
      display: block;
    }
    
    .overlay {
      display: block;
    }
    
    .main-content {
      margin-left: 0;
      padding-top: 96px;
    }
  }
  
  @media (max-width: 640px) {
    .main-content {
      padding: 80px 16px 16px;
    }
  }
</style>