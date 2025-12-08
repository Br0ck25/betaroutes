<script lang="ts">
  import { trips } from '$lib/stores/trips';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/auth';
  import { page } from '$app/stores';

  let searchQuery = '';
  let sortBy = 'date';
  let sortOrder = 'desc';
  let filterProfit = 'all'; // all, positive, negative
  
  // Filter and sort trips
  $: filteredTrips = $trips
    .filter(trip => {
      // Search filter
      const query = searchQuery.toLowerCase();
      const matchesSearch = !query || 
        trip.startAddress?.toLowerCase().includes(query) ||
        trip.stops?.some(stop => stop.address?.toLowerCase().includes(query)) ||
        trip.notes?.toLowerCase().includes(query);
      
      if (!matchesSearch) 
        return false;
      
      // Profit filter
      if (filterProfit !== 'all') {
        const earnings = trip.stops?.reduce((sum, stop) => sum + (stop.earnings || 0), 0) || 0;
        const costs = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
        const profit = earnings - costs;
        
        if (filterProfit === 'positive' 
&& profit <= 0) return false;
        if (filterProfit === 'negative' && profit >= 0) return false;
      }
      
      return true;
    })
    .sort((a, b) => {
      let aVal, bVal;
      
      switch (sortBy) {
        case 'date':
          aVal = new Date(a.date ||
0).getTime();
          bVal = new Date(b.date || 0).getTime();
          break;
        case 'profit':
          const aEarnings = a.stops?.reduce((sum, stop) => sum + (stop.earnings || 0), 0) ||
0;
          const aCosts = (a.fuelCost || 0) + (a.maintenanceCost || 0) + (a.suppliesCost || 0);
          const bEarnings = b.stops?.reduce((sum, stop) => sum + (stop.earnings || 0), 0) || 0;
          const bCosts = (b.fuelCost || 0) + (b.maintenanceCost || 0) + (b.suppliesCost || 0);
          aVal = aEarnings - bCosts;
          bVal = bEarnings - bCosts;
          break;
        case 'miles':
          aVal = a.totalMiles ||
0;
          bVal = b.totalMiles || 0;
          break;
        default:
          return 0;
      }
      
      return sortOrder === 'asc' ?
aVal - bVal : bVal - aVal;
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
        // SMART ID SELECTION:
        // Find the trip object to see which ID it expects
        const trip = $trips.find(t => t.id === id);
        const currentUser = $page.data.user || $user;
        
        let userId = '';
        if (trip && currentUser) {
            // Check if the trip belongs to the user's name OR token
            if (trip.userId === currentUser.name) {
                userId = currentUser.name;
            } else if (trip.userId === currentUser.token) {
                userId = currentUser.token;
            }
        }

        // Fallback: If we couldn't match or find the trip, try standard order
        if (!userId) {
            userId = currentUser?.name ||
currentUser?.token || 
                     localStorage.getItem('offline_user_id') || '';
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
  
  function calculateHourlyPay(trip: any): number {
    const earnings = trip.stops?.reduce((s: number, stop: any) => s + (stop.earnings || 0), 0) ||
0;
    const costs = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
    const profit = earnings - costs;
    const hours = trip.hoursWorked || 0;
    return hours > 0 ?
profit / hours : 0;
  }
  
  function toggleSort(field: string) {
    if (sortBy === field) {
      sortOrder = sortOrder === 'asc' ?
'desc' : 'asc';
    } else {
      sortBy = field;
      sortOrder = 'desc';
    }
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
  
  <div class="filters-bar">
   
    <div class="search-box">
      <svg class="search-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M9 17C13.4183 17 17 13.4183 17 9C17 4.58172 13.4183 1 9 1C4.58172 1 1 4.58172 1 9C1 13.4183 4.58172 17 9 17Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M19 19L14.65 14.65" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <input 
        type="text" 
        placeholder="Search trips by address or 
notes..."
        bind:value={searchQuery}
      />
    </div>
    
    <div class="filter-group">
      <select bind:value={filterProfit} class="filter-select">
        <option value="all">All Trips</option>
        <option value="positive">Profitable Only</option>
        <option value="negative">Losses Only</option>
      </select>
      
      <select bind:value={sortBy} class="filter-select">
        <option value="date">Sort by Date</option>
    
        <option value="profit">Sort by Profit</option>
        <option value="miles">Sort by Miles</option>
      </select>
      
      <button class="sort-btn" on:click={() => sortOrder = sortOrder === 'asc' ?
'desc' : 'asc'}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          {#if sortOrder === 'desc'}
            <path d="M10 3V17M10 17L4 11M10 17L16 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          {:else}
            <path d="M10 17V3M10 3L4 9M10 3L16 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          {/if}
      
        </svg>
      </button>
    </div>
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
          const earnings = trip.stops?.reduce((s, stop) => s + (stop.earnings ||
0), 0) || 0;
          const costs = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
          return sum + (earnings - costs);
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
  
  {#if filteredTrips.length > 0}
    <div class="table-container">
      <table class="trips-table">
        <thead>
          <tr>
      
            <th>
              <button class="th-btn" on:click={() => toggleSort('date')}>
                Date
                {#if sortBy === 'date'}
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                
                    {#if sortOrder === 'desc'}
                      <path d="M8 3V13M8 13L4 9M8 13L12 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    {:else}
                      <path d="M8 13V3M8 3L4 7M8 3L12 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
           
                    {/if}
                  </svg>
                {/if}
              </button>
            </th>
            <th>Route</th>
            <th>Stops</th>
       
            <th>
              <button class="th-btn" on:click={() => toggleSort('miles')}>
                Miles
                {#if sortBy === 'miles'}
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                 
                    {#if sortOrder === 'desc'}
                      <path d="M8 3V13M8 13L4 9M8 13L12 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    {:else}
                      <path d="M8 13V3M8 3L4 7M8 3L12 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            
                    {/if}
                  </svg>
                {/if}
              </button>
            </th>
            <th>Hours</th>
            <th>
        
              <button class="th-btn" on:click={() => toggleSort('profit')}>
                Profit
                {#if sortBy === 'profit'}
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    {#if sortOrder === 'desc'}
       
                       <path d="M8 3V13M8 13L4 9M8 13L12 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    {:else}
                      <path d="M8 13V3M8 3L4 7M8 3L12 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    {/if}
     
              </svg>
                {/if}
              </button>
            </th>
            <th>$/Hour</th>
            <th class="actions-col">Actions</th>
          </tr>
        </thead>
  
        <tbody>
          {#each filteredTrips as trip}
            {@const earnings = trip.stops?.reduce((s, stop) => s + (stop.earnings ||
0), 0) || 0}
            {@const costs = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0)}
            {@const profit = earnings - costs}
            {@const hourlyPay = calculateHourlyPay(trip)}
            {@const isExpanded = expandedTrips.has(trip.id)}
            
            <tr 
              class="trip-row">
              <td class="date-col">
                <div class="date-display">{formatDate(trip.date || '')}</div>
              </td>
              <td class="route-col">
                <button class="route-display" on:click={() => toggleExpand(trip.id)} type="button">
                
                  <div class="route-summary">
                    <div class="route-start">{trip.startAddress?.split(',')[0] ||
'Unknown'}</div>
                    {#if trip.stops && trip.stops.length > 0}
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M6 12L10 8L6 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
               
                      </svg>
                      <div class="route-end">
                        {trip.stops[trip.stops.length - 1].address?.split(',')[0] ||
'Multiple'}
                      </div>
                    {/if}
                  </div>
                  {#if isExpanded}
                    <div 
                      class="route-details">
                      <div class="route-address">桃 Start: {trip.startAddress}</div>
                      {#each trip.stops as stop, i}
                        <div class="route-address">尅 Stop {i + 1}: {stop.address}</div>
                   
                      {/each}
                      {#if trip.endAddress && trip.endAddress !== trip.startAddress}
                        <div class="route-address">潤 End: {trip.endAddress}</div>
                      {/if}
                    </div>
 
                  {/if}
                </button>
              </td>
              <td class="stops-col">
                <div class="stops-badge">{trip.stops?.length ||
0}</div>
              </td>
              <td class="miles-col">
                <div class="miles-display">{trip.totalMiles?.toFixed(1) ||
'0.0'} mi</div>
              </td>
              <td class="hours-col">
                <div class="hours-display">{trip.hoursWorked?.toFixed(1) ||
'-'} hrs</div>
              </td>
              <td class="profit-col">
                <div class="profit-display" class:positive={profit >= 0} class:negative={profit < 0}>
                  {formatCurrency(profit)}
                </div>
             
              </td>
              <td class="hourly-col">
                <div class="hourly-display">
                  {trip.hoursWorked > 0 ?
formatCurrency(hourlyPay) + '/hr' : 'N/A'}
                </div>
              </td>
              <td class="actions-col">
                <div class="action-buttons">
                  <button class="action-btn edit" on:click={() => editTrip(trip.id)} title="Edit trip" type="button">
        
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M11 2L14 5L5 14H2V11L11 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
            
                  <button class="action-btn delete" on:click={() => deleteTrip(trip.id)} title="Delete trip" type="button">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M2 4H14M12 4V13C12 13.5304 11.7893 14.0391 11.4142 14.4142C11.0391 14.7893 10.5304 15 10 15H6C5.46957 15 4.96086 14.7893 4.58579 14.4142C4.21071 14.0391 4 13.5304 4 13V4M5 4V3C5 2.46957 5.21071 1.96086 5.58579 1.58579C5.96086 1.21071 6.46957 1 7 1H9C9.53043 1 10.0391 
1.21071 10.4142 1.58579C10.7893 1.96086 11 2.46957 11 3V4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
         
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="empty-state">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <path d="M32 56C45.2548 56 56 45.2548 56 32C56 18.7452 45.2548 8 32 8C18.7452 8 8 18.7452 8 32C8 45.2548 18.7452 56 32 56Z" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M8 32H56M32 8C37.5 16 40 24 40 32C40 40 37.5 48 32 56C26.5 48 24 40 24 32C24 
24 26.5 16 32 8Z" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <h3>No trips found</h3>
      <p>
        {searchQuery ||
filterProfit !== 'all' 
          ?
'Try adjusting your filters' 
          : 'Start by creating your first trip'}
      </p>
      {#if !searchQuery && filterProfit === 'all'}
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
  .trip-history { max-width: 1400px;
  }
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
  .page-title { font-size: 32px; font-weight: 800;
  color: #111827; margin-bottom: 4px; }
  .page-subtitle { font-size: 16px; color: #6B7280; }
  
  .btn-primary { display: inline-flex;
  align-items: center; gap: 8px; padding: 12px 24px; background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%); color: white; border: none; border-radius: 10px;
  font-weight: 600; font-size: 15px; text-decoration: none; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(255, 127, 80, 0.3);
  }
  .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(255, 127, 80, 0.4);
  }
  
  .filters-bar { display: flex; gap: 16px; margin-bottom: 24px; }
  .search-box { position: relative; flex: 1;
  max-width: 400px; }
  .search-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #9CA3AF; pointer-events: none;
  }
  .search-box input { width: 100%; padding: 14px 16px 14px 48px; border: 2px solid #E5E7EB; border-radius: 12px; font-size: 15px;
  font-family: inherit; background: white; transition: all 0.2s; }
  .search-box input:focus { outline: none; border-color: var(--orange);
  box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1); }
  
  .filter-group { display: flex; gap: 12px;
  }
  .filter-select { padding: 14px 16px; border: 2px solid #E5E7EB; border-radius: 12px; font-size: 15px; font-family: inherit; background: white;
  cursor: pointer; transition: all 0.2s; }
  .filter-select:focus { outline: none; border-color: var(--orange);
  box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1); }
  
  .sort-btn { padding: 14px;
  border: 2px solid #E5E7EB; border-radius: 12px; background: white; color: #6B7280; cursor: pointer; transition: all 0.2s; display: flex; align-items: center;
  justify-content: center; }
  .sort-btn:hover { border-color: var(--orange); color: var(--orange); }
  
  .stats-summary { display: grid;
  grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
  .summary-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px;
  padding: 20px; text-align: center; }
  .summary-label { font-size: 14px; color: #6B7280; margin-bottom: 8px; }
  .summary-value { font-size: 28px;
  font-weight: 800; color: #111827; }
  
  .table-container { background: white; border: 1px solid #E5E7EB; border-radius: 16px; overflow: hidden;
  }
  .trips-table { width: 100%; border-collapse: collapse; }
  .trips-table thead { background: #F9FAFB; border-bottom: 1px solid #E5E7EB;
  }
  .trips-table th { padding: 16px 20px; text-align: left; font-size: 13px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;
  }
  
  .th-btn { display: flex; align-items: center; gap: 6px; background: none; border: none; color: inherit; font: inherit;
  cursor: pointer; transition: color 0.2s; }
  .th-btn:hover { color: var(--orange); }
  
  .trips-table td { padding: 20px;
  border-bottom: 1px solid #F3F4F6; }
  .trip-row:hover { background: #F9FAFB; }
  
  .date-display { font-size: 14px; font-weight: 600;
  color: #374151; }
  .route-display { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; width: 100%; background: none; border: none;
  padding: 0; text-align: left; cursor: pointer; transition: all 0.2s; }
  .route-display:hover .route-summary { color: var(--orange);
  }
  
  .route-summary { display: flex; align-items: center; gap: 8px; transition: color 0.2s;
  }
  .route-display svg { color: #9CA3AF; flex-shrink: 0; }
  
  .route-details { display: flex; flex-direction: column;
  gap: 6px; margin-top: 8px; padding: 12px; background: #F9FAFB; border-radius: 8px; width: 100%; }
  .route-address { font-size: 13px; color: #6B7280;
  line-height: 1.5; }
  .route-start, .route-end { font-size: 14px; color: #374151; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  
  .stops-badge { display: inline-block; padding: 4px 12px; background: #F3F4F6; color: #6B7280; border-radius: 6px; font-size: 13px;
  font-weight: 600; }
  .miles-display { font-size: 14px; font-weight: 600; color: #374151; }
  .hours-display { font-size: 14px; font-weight: 600;
  color: #6B7280; }
  
  .profit-display { font-size: 16px; font-weight: 700; }
  .profit-display.positive { color: var(--green);
  }
  .profit-display.negative { color: #DC2626; }
  .hourly-display { font-size: 14px; font-weight: 600; color: #059669;
  }
  
  .actions-col { width: 120px; }
  .action-buttons { display: flex; gap: 8px; justify-content: flex-end;
  }
  .action-btn { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: 1px solid #E5E7EB; border-radius: 8px;
  background: white; cursor: pointer; transition: all 0.2s; }
  
  .action-btn.edit { color: var(--blue);
  }
  .action-btn.edit:hover { background: #EFF6FF; border-color: var(--blue); }
  .action-btn.delete { color: #DC2626; }
  .action-btn.delete:hover { background: #FEF2F2;
  border-color: #DC2626; }
  
  .empty-state { padding: 80px 32px; text-align: center; background: white; border: 1px solid #E5E7EB;
  border-radius: 16px; }
  .empty-state svg { color: #D1D5DB; margin: 0 auto 24px; }
  .empty-state h3 { font-size: 20px;
  font-weight: 700; color: #111827; margin-bottom: 8px; }
  .empty-state p { font-size: 15px; color: #6B7280; margin-bottom: 24px;
  }
  
  /* Media Queries for Responsiveness */
  @media (max-width: 1024px) {
    /* Stack search box over filter group */
    .filters-bar { 
        flex-direction: column;
        gap: 16px;
    }
    .search-box { 
        max-width: 100%; 
        flex: none;
    }

    /* Force the filter group to stack vertically to prevent horizontal overflow */
    .filter-group { 
        flex-direction: column; 
        width: 100%;
        gap: 8px;
    }

    /* Force filter elements to take 100% width when stacked */
    .filter-select, .sort-btn {
        width: 100%;
        max-width: 100%;
    }

    /* General Layout Fixes */
    .stats-summary { grid-template-columns: repeat(2, 1fr); }
    .table-container { overflow-x: auto; }
    .trips-table { min-width: 800px; }
  }
  
  @media (max-width: 640px) {
    /* Ensure header and stats stack aggressively on small screens */
    .page-header { flex-direction: column; align-items: flex-start; gap: 16px; }
    .stats-summary { grid-template-columns: 1fr; }
  }
</style>