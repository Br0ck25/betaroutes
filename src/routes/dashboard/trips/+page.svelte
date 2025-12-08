<script lang="ts">
  import { trips } from '$lib/stores/trips';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/auth';
  import { page } from '$app/stores';

  let searchQuery = '';
  let sortBy = 'date';
  let sortOrder = 'desc';
  let filterProfit = 'all'; // all, positive, negative
  
  // New Date Filters
  let startDate = '';
  let endDate = '';
  
  // Filter and sort trips
  $: filteredTrips = $trips
    .filter(trip => {
      // 1. Search filter
      const query = searchQuery.toLowerCase();
      const matchesSearch = !query || 
        trip.startAddress?.toLowerCase().includes(query) ||
        trip.stops?.some(stop => stop.address?.toLowerCase().includes(query)) ||
        trip.notes?.toLowerCase().includes(query);
      
      if (!matchesSearch) return false;
      
      // 2. Profit filter
      if (filterProfit !== 'all') {
        const earnings = trip.stops?.reduce((sum, stop) => sum + (stop.earnings || 0), 0) || 0;
        const costs = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
        const profit = earnings - costs;
        
        if (filterProfit === 'positive' && profit <= 0) return false;
        if (filterProfit === 'negative' && profit >= 0) return false;
      }

      // 3. Date Range Filter
      if (trip.date) {
        const tripDate = new Date(trip.date);
        // Reset times to midnight for accurate day comparison
        tripDate.setHours(0, 0, 0, 0);

        if (startDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            if (tripDate < start) return false;
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(0, 0, 0, 0);
            if (tripDate > end) return false;
        }
      }
      
      return true;
    })
    .sort((a, b) => {
      let aVal, bVal;
      
      switch (sortBy) {
        case 'date':
          aVal = new Date(a.date || 0).getTime();
          bVal = new Date(b.date || 0).getTime();
          break;
        case 'profit':
          const aEarnings = a.stops?.reduce((sum, stop) => sum + (stop.earnings || 0), 0) || 0;
          const aCosts = (a.fuelCost || 0) + (a.maintenanceCost || 0) + (a.suppliesCost || 0);
          const bEarnings = b.stops?.reduce((sum, stop) => sum + (stop.earnings || 0), 0) || 0;
          const bCosts = (b.fuelCost || 0) + (b.maintenanceCost || 0) + (b.suppliesCost || 0);
          aVal = aEarnings - aCosts;
          bVal = bEarnings - bCosts;
          break;
        case 'miles':
          aVal = a.totalMiles || 0;
          bVal = b.totalMiles || 0;
          break;
        default:
          return 0;
      }
      
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });
  
  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }
  
  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(date);
  }
  
  async function deleteTrip(id: string) {
    if (confirm('Move trip to trash?')) {
      try {
        const trip = $trips.find(t => t.id === id);
        const currentUser = $page.data.user || $user;
        
        let userId = '';
        if (trip && currentUser) {
            if (trip.userId === currentUser.name) {
                userId = currentUser.name;
            } else if (trip.userId === currentUser.token) {
                userId = currentUser.token;
            }
        }

        if (!userId) {
            userId = currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id') || '';
        }
        
        if (userId) {
            await trips.deleteTrip(id, userId);
        } else {
            alert('User identification error. Please refresh.');
        }
      } catch (err) {
        console.error('Failed to delete trip:', err);
        alert('Failed to delete trip. Please try again.');
      }
    }
  }
  
  function editTrip(id: string) {
    goto(`/dashboard/trips/edit/${id}`);
  }
  
  function calculateNetProfit(trip: any): number {
    const earnings = trip.stops?.reduce((s: number, stop: any) => s + (stop.earnings || 0), 0) || 0;
    const costs = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
    return earnings - costs;
  }

  function calculateHourlyPay(trip: any): number {
    const profit = calculateNetProfit(trip);
    const hours = trip.hoursWorked || 0;
    return hours > 0 ? profit / hours : 0;
  }
  
  let expandedTrips = new Set<string>();
  function toggleExpand(id: string) {
    if (expandedTrips.has(id)) {
      expandedTrips.delete(id);
    } else {
      expandedTrips.add(id);
    }
    expandedTrips = expandedTrips;
  }
</script>

<svelte:head>
  <title>Trip History - Go Route Yourself</title>
</svelte:head>

<div class="trip-history">
  <div class="page-header">
    <div>
      <h1 class="page-title">Trip History</h1>
      <p class="page-subtitle">View and manage all your trips</p>
    </div>
    <a href="/dashboard/trips/new" class="btn-primary">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      New Trip
    </a>
  </div>
  
  <div class="stats-summary">
    <div class="summary-card">
      <div class="summary-label">Total Trips</div>
      <div class="summary-value">{filteredTrips.length}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Total Miles</div>
      <div class="summary-value">
        {filteredTrips.reduce((sum, trip) => sum + (trip.totalMiles || 0), 0).toFixed(1)}
      </div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Total Profit</div>
      <div class="summary-value">
        {formatCurrency(filteredTrips.reduce((sum, trip) => {
          return sum + calculateNetProfit(trip);
        }, 0))}
      </div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Avg $/Hour</div>
      <div class="summary-value">
        {(() => {
          const tripsWithHours = filteredTrips.filter(t => t.hoursWorked > 0);
          if (tripsWithHours.length === 0) return 'N/A';
          const totalHourlyPay = tripsWithHours.reduce((sum, trip) => {
            return sum + calculateHourlyPay(trip);
          }, 0);
          return formatCurrency(totalHourlyPay / tripsWithHours.length) + '/hr';
        })()}
      </div>
    </div>
  </div>

  <div class="filters-bar">
   
    <div class="search-box">
      <svg class="search-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M9 17C13.4183 17 17 13.4183 17 9C17 4.58172 13.4183 1 9 1C4.58172 1 1 4.58172 1 9C1 13.4183 4.58172 17 9 17Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M19 19L14.65 14.65" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <input 
        type="text" 
        placeholder="Search trips..."
        bind:value={searchQuery}
      />
    </div>

    <div class="filter-group date-group">
        <input type="date" bind:value={startDate} class="date-input" placeholder="Start Date" aria-label="Start Date" />
        <span class="date-sep">-</span>
        <input type="date" bind:value={endDate} class="date-input" placeholder="End Date" aria-label="End Date" />
    </div>
    
    <div class="filter-group">
      <select bind:value={filterProfit} class="filter-select">
        <option value="all">All Trips</option>
        <option value="positive">Profitable</option>
        <option value="negative">Losses</option>
      </select>
      
      <select bind:value={sortBy} class="filter-select">
        <option value="date">By Date</option>
        <option value="profit">By Profit</option>
        <option value="miles">By Miles</option>
      </select>
      
      <button class="sort-btn" on:click={() => sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="transform: rotate({sortOrder === 'asc' ? '180deg' : '0deg'})">
            <path d="M10 3V17M10 17L4 11M10 17L16 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
  
  {#if filteredTrips.length > 0}
    <div class="trip-list-cards">
      {#each filteredTrips as trip (trip.id)}
        {@const profit = calculateNetProfit(trip)}
        {@const hourlyPay = calculateHourlyPay(trip)}
        {@const isExpanded = expandedTrips.has(trip.id)}
        {@const totalCosts = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0)}
        
        <div class="trip-card" class:expanded={isExpanded} on:click={() => toggleExpand(trip.id)}>
          
          <div class="card-top">
            <div class="trip-route-date">
              <span class="trip-date-display">{formatDate(trip.date || '')}</span>
              <h3 class="trip-route-title">
                {trip.startAddress?.split(',')[0] || 'Unknown'} 
                {#if trip.stops && trip.stops.length > 0}
                  → {trip.stops[trip.stops.length - 1].address?.split(',')[0] || 'Multiple'}
                {/if}
              </h3>
            </div>
            
            <div class="profit-display-large" class:positive={profit >= 0} class:negative={profit < 0}>
              {formatCurrency(profit)}
            </div>
            
            <svg class="expand-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M6 15L10 11L14 15M14 5L10 9L6 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>

          <div class="quick-stats">
            <div class="stat-item">
              <span class="stat-label">Miles</span>
              <span class="stat-value">{trip.totalMiles?.toFixed(1) || '0.0'} mi</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Stops</span>
              <span class="stat-value">{trip.stops?.length || 0}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Hours</span>
              <span class="stat-value">{trip.hoursWorked?.toFixed(1) || '-'} hrs</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">$/Hour</span>
              <span class="stat-value hourly-pay">{trip.hoursWorked > 0 ? formatCurrency(hourlyPay) + '/hr' : 'N/A'}</span>
            </div>
          </div>
          
          {#if isExpanded}
            <div class="expanded-details">
              <div class="detail-section">
                <h4 class="section-heading">Stops & Addresses</h4>
                <div class="address-list">
                    <p><strong>Start:</strong> {trip.startAddress}</p>
                    {#if trip.stops}
                      {#each trip.stops as stop, i}
                          <p><strong>Stop {i + 1}:</strong> {stop.address}</p>
                      {/each}
                    {/if}
                    {#if trip.endAddress && trip.endAddress !== trip.startAddress}
                        <p><strong>End:</strong> {trip.endAddress}</p>
                    {/if}
                </div>
              </div>

              {#if totalCosts > 0}
                <div class="detail-section">
                  <h4 class="section-heading">Expenses & Costs</h4>
                  <div class="expense-list">
                    {#if trip.fuelCost > 0}
                      <div class="expense-row">
                        <span>Fuel</span>
                        <span>{formatCurrency(trip.fuelCost)}</span>
                      </div>
                    {/if}
                    {#if trip.maintenanceItems}
                      {#each trip.maintenanceItems as item}
                        <div class="expense-row">
                          <span>{item.type}</span>
                          <span>{formatCurrency(item.cost)}</span>
                        </div>
                      {/each}
                    {/if}
                    {#if trip.suppliesItems}
                      {#each trip.suppliesItems as item}
                        <div class="expense-row">
                          <span>{item.type}</span>
                          <span>{formatCurrency(item.cost)}</span>
                        </div>
                      {/each}
                    {/if}
                    <div class="expense-row total">
                      <span>Total Costs</span>
                      <span>{formatCurrency(totalCosts)}</span>
                    </div>
                  </div>
                </div>
              {/if}

              {#if trip.notes}
                <div class="detail-section">
                  <h4 class="section-heading">Notes</h4>
                  <p class="trip-notes">{trip.notes}</p>
                </div>
              {/if}
              
              <div class="action-buttons-footer" on:click|stopPropagation>
                <button class="action-btn-lg edit-btn" on:click={() => editTrip(trip.id)}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11 2L14 5L5 14H2V11L11 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    Edit Trip
                </button>
                <button class="action-btn-lg delete-btn" on:click={() => deleteTrip(trip.id)}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4H14M12 4V13C12 13.5304 11.7893 14.0391 11.4142 14.4142C11.0391 14.7893 10.5304 15 10 15H6C5.46957 15 4.96086 14.7893 4.58579 14.4142C4.21071 14.0391 4 13.5304 4 13V4M5 4V3C5 2.46957 5.21071 1.96086 5.58579 1.58579C5.96086 1.21071 6.46957 1 7 1H9C9.53043 1 10.0391 1.21071 10.4142 1.58579C10.7893 1.96086 11 2.46957 11 3V4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    Move to Trash
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty-state">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <path d="M32 56C45.2548 56 56 45.2548 56 32C56 18.7452 45.2548 8 32 8C18.7452 8 8 18.7452 8 32C8 45.2548 18.7452 56 32 56Z" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M8 32H56M32 8C37.5 16 40 24 40 32C40 40 37.5 48 32 56C26.5 48 24 40 24 32C24 24 26.5 16 32 8Z" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <h3>No trips found</h3>
      <p>
        {searchQuery || filterProfit !== 'all' || startDate || endDate
          ? 'Try adjusting your filters' 
          : 'Start by creating your first trip'}
      </p>
      {#if !searchQuery && filterProfit === 'all' && !startDate && !endDate}
        <a href="/dashboard/trips/new" class="btn-primary">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Create Your First Trip
        </a>
      {/if}
    </div>
  {/if}
</div>

<style>
  .trip-history { max-width: 1400px; margin: 0 auto; padding: 16px; padding-bottom: 80px; }
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .page-title { font-size: 24px; font-weight: 800; color: #111827; margin: 0; }
  .page-subtitle { font-size: 14px; color: #6B7280; margin: 0; }
  
  .btn-primary { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; background: linear-gradient(135deg, #FF7F50 0%, #FF6A3D 100%); color: white; border: none; border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none; box-shadow: 0 2px 8px rgba(255, 127, 80, 0.3); }

  .stats-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
  .summary-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; text-align: center; }
  .summary-label { font-size: 12px; color: #6B7280; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .summary-value { font-size: 20px; font-weight: 800; color: #111827; }

  .filters-bar { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
  .search-box { position: relative; width: 100%; box-sizing: border-box; }
  .search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #9CA3AF; pointer-events: none; }
  .search-box input { width: 100%; padding: 12px 16px 12px 42px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 15px; background: white; box-sizing: border-box; }
  .search-box input:focus { outline: none; border-color: #FF7F50; }

  /* Date Group Styling */
  .date-group { display: flex; gap: 8px; align-items: center; }
  .date-input { flex: 1; padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 14px; background: white; color: #374151; min-width: 0; box-sizing: border-box; }
  .date-sep { color: #9CA3AF; font-weight: bold; }

  .filter-group { display: flex; flex-direction: row; gap: 8px; width: 100%; }
  .filter-select { flex: 1; width: 0; min-width: 0; padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 14px; background: white; color: #374151; }
  .sort-btn { flex: 0 0 48px; display: flex; align-items: center; justify-content: center; border: 1px solid #E5E7EB; border-radius: 10px; background: white; color: #6B7280; }

  .trip-list-cards { display: flex; flex-direction: column; gap: 12px; }
  .trip-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; cursor: pointer; transition: all 0.2s; }
  .trip-card:active { background-color: #F9FAFB; }
  .trip-card.expanded { border-color: #FF7F50; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }

  .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .trip-date { font-size: 12px; font-weight: 600; color: #9CA3AF; display: block; margin-bottom: 2px; }
  .trip-title { font-size: 16px; font-weight: 700; color: #111827; margin: 0; line-height: 1.3; }
  
  .trip-profit-badge { font-size: 16px; font-weight: 800; padding: 4px 8px; border-radius: 6px; background: #F3F4F6; color: #374151; white-space: nowrap; margin-left: 12px; }
  .trip-profit-badge.positive { background: #DCFCE7; color: #166534; }
  .trip-profit-badge.negative { background: #FEE2E2; color: #991B1B; }

  .card-top { display: grid; grid-template-columns: 1fr auto 20px; align-items: center; gap: 12px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid #F3F4F6; }
  .trip-route-date { overflow: hidden; }
  .trip-date-display { display: block; font-size: 12px; font-weight: 600; color: #6B7280; margin-bottom: 4px; }
  .trip-route-title { font-size: 16px; font-weight: 700; color: #111827; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .profit-display-large { font-size: 18px; font-weight: 800; white-space: nowrap; }
  .profit-display-large.positive { color: var(--green); }
  .profit-display-large.negative { color: #DC2626; }
  .expand-icon { color: #9CA3AF; transition: transform 0.2s; }
  .trip-card.expanded .expand-icon { transform: rotate(180deg); }

  .card-stats, .quick-stats { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid #F3F4F6; padding-top: 12px; }
  .stat, .stat-item { display: flex; flex-direction: column; align-items: center; }
  .stat .label, .stat-label { font-size: 11px; color: #9CA3AF; text-transform: uppercase; }
  .stat .val, .stat-value { font-size: 14px; font-weight: 600; color: #4B5563; }
  .stat .val.hourly, .hourly-pay { color: #059669; }

  .expanded-details { display: flex; flex-direction: column; gap: 16px; padding-top: 16px; border-top: 1px dashed #E5E7EB; margin-top: 16px; }
  .detail-section { background: #F9FAFB; padding: 12px; border-radius: 8px; }
  .section-heading { font-size: 13px; font-weight: 700; color: var(--navy); margin-bottom: 8px; border-bottom: 1px solid #E5E7EB; padding-bottom: 6px; }
  .address-list p { font-size: 14px; color: #374151; margin: 4px 0; }
  .expense-list { display: flex; flex-direction: column; gap: 4px; }
  .expense-row { display: flex; justify-content: space-between; font-size: 13px; color: #4B5563; }
  .expense-row.total { border-top: 1px solid #E5E7EB; margin-top: 4px; padding-top: 4px; font-weight: 700; color: #111827; }
  .trip-notes { font-style: italic; font-size: 14px; color: #4B5563; line-height: 1.4; }
  .action-buttons-footer { display: flex; gap: 12px; }
  .action-btn-lg { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; border-radius: 8px; font-weight: 600; font-family: inherit; cursor: pointer; transition: all 0.2s; border: 2px solid; font-size: 14px; }
  .edit-btn { background: #EFF6FF; color: #2563EB; border-color: #2563EB; }
  .delete-btn { background: #FEF2F2; color: #DC2626; border-color: #DC2626; }
  .empty-state { text-align: center; padding: 40px 20px; color: #6B7280; font-size: 15px; }
  .empty-state svg { color: #D1D5DB; margin: 0 auto 24px; }
  .empty-state h3 { font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 8px; }

  @media (min-width: 640px) {
    .filters-bar { flex-direction: row; justify-content: space-between; align-items: center; }
    .search-box { max-width: 300px; }
    .date-group { width: auto; }
    .filter-group { width: auto; flex-wrap: nowrap; }
    .filter-select { width: 140px; flex: none; }
    .stats-summary { grid-template-columns: repeat(2, 1fr); }
  }

  @media (min-width: 1024px) {
    .stats-summary { grid-template-columns: repeat(4, 1fr); }
    .search-box { max-width: 300px; }
  }
</style>
