<script lang="ts">
  import { trips } from '$lib/stores/trips';
  
  // Single-pass calculation function to prevent main-thread blocking
  function calculateDashboardStats(allTrips: any[]) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    
    // Setup 30-day window
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    // Pre-fill map to ensure empty days show up in chart
    const dailyDataMap = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      dailyDataMap.set(d.toISOString().split('T')[0], 0);
    }

    // Accumulators
    let totalProfit = 0;
    let totalMiles = 0;
    let fuel = 0;
    let maintenance = 0;
    let supplies = 0;
    let currentMonthProfit = 0;
    let lastMonthProfit = 0;

    // --- ONE LOOP TO RULE THEM ALL ---
    for (let i = 0; i < allTrips.length; i++) {
      const trip = allTrips[i];
      
      // 1. Basic Stats
      const earnings = trip.stops?.reduce((s: number, stop: any) => s + (Number(stop.earnings) || 0), 0) || 0;
      const tCosts = (Number(trip.fuelCost) || 0) + (Number(trip.maintenanceCost) || 0) + (Number(trip.suppliesCost) || 0);
      const profit = earnings - tCosts;
      
      totalProfit += profit;
      totalMiles += (Number(trip.totalMiles) || 0);
      fuel += (Number(trip.fuelCost) || 0);
      maintenance += (Number(trip.maintenanceCost) || 0);
      supplies += (Number(trip.suppliesCost) || 0);

      // 2. Date-based Stats
      if (trip.date) {
        const d = new Date(trip.date);
        const tripTime = d.getTime();

        // Chart Data (Last 30 Days)
        if (tripTime >= thirtyDaysAgo.getTime() && tripTime <= now.getTime()) {
           const key = d.toISOString().split('T')[0];
           // We use the map we pre-filled, so no need to check 'has' unless bounds are weird
           const currentVal = dailyDataMap.get(key) || 0;
           dailyDataMap.set(key, currentVal + profit);
        }

        // Month Comparison
        const tMonth = d.getMonth();
        const tYear = d.getFullYear();
        
        if (tMonth === currentMonth && tYear === currentYear) {
            currentMonthProfit += profit;
        } else if (tMonth === lastMonth && tYear === lastMonthYear) {
            lastMonthProfit += profit;
        }
      }
    }

    // --- Final Data Shaping ---
    
    // Chart Array
    const last30DaysData = Array.from(dailyDataMap.entries()).map(([date, profit]) => ({ date, profit }));
    
    // Cost Breakdown
    const totalCost = fuel + maintenance + supplies;
    const costBreakdown = {
        fuel: { amount: fuel, percentage: totalCost > 0 ? (fuel / totalCost) * 100 : 0, color: '#FF7F50' },
        maintenance: { amount: maintenance, percentage: totalCost > 0 ? (maintenance / totalCost) * 100 : 0, color: '#29ABE2' },
        supplies: { amount: supplies, percentage: totalCost > 0 ? (supplies / totalCost) * 100 : 0, color: '#8DC63F' }
    };

    // Month Comparison
    const change = lastMonthProfit > 0 ? ((currentMonthProfit - lastMonthProfit) / lastMonthProfit) * 100 : 0;
    const monthComparison = {
        current: currentMonthProfit,
        last: lastMonthProfit,
        change: change,
        isPositive: change >= 0
    };

    return {
        recentTrips: allTrips.slice(0, 5),
        totalTrips: allTrips.length,
        totalProfit,
        totalMiles,
        avgProfitPerTrip: allTrips.length > 0 ? totalProfit / allTrips.length : 0,
        last30DaysData,
        costBreakdown,
        monthComparison
    };
  }

  // Reactive assignment - runs once whenever $trips updates
  $: stats = calculateDashboardStats($trips);

  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
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
</script>

<svelte:head>
  <title>Dashboard - Go Route Yourself</title>
</svelte:head>

<div class="dashboard">
  <div class="page-header">
    <div>
      <h1 class="page-title">Dashboard</h1>
      <p class="page-subtitle">Welcome back! Here's your overview</p>
    </div>
    <a href="/dashboard/trips/new" class="btn-primary">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      New Trip
    </a>
  </div>
  
  <div class="stats-grid">
    <div class="stat-card featured">
      <div class="stat-header">
        <div class="stat-icon orange">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <span class="stat-label">Total Profit</span>
      </div>
      <div class="stat-value">{formatCurrency(stats.totalProfit)}</div>
      <div class="stat-change" class:positive={stats.monthComparison.isPositive} class:negative={!stats.monthComparison.isPositive}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          {#if stats.monthComparison.isPositive}
            <path d="M8 12V4M8 4L4 8M8 4L12 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          {:else}
            <path d="M8 4V12M8 12L4 8M8 12L12 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          {/if}
        </svg>
        {Math.abs(stats.monthComparison.change).toFixed(1)}% from last month
      </div>
    </div>
    
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-icon blue">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M21 10C21 17 12 23 12 23C12 23 3 17 3 10C3 7.61305 3.94821 5.32387 5.63604 3.63604C7.32387 1.94821 9.61305 1 12 1C14.3869 1 16.6761 1.94821 18.364 3.63604C20.0518 5.32387 21 7.61305 21 10Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M12 13C13.6569 13 15 11.6569 15 10C15 8.34315 13.6569 7 12 7C10.3431 7 9 8.34315 9 10C9 11.6569 10.3431 13 12 13Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <span class="stat-label">Total Trips</span>
      </div>
      <div class="stat-value">{stats.totalTrips}</div>
      <div class="stat-info">All time</div>
    </div>
    
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-icon green">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <span class="stat-label">Avg Profit/Trip</span>
      </div>
      <div class="stat-value">{formatCurrency(stats.avgProfitPerTrip)}</div>
      <div class="stat-info">Per completed trip</div>
    </div>
    
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-icon purple">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 12H22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <span class="stat-label">Total Miles</span>
      </div>
      <div class="stat-value">{stats.totalMiles.toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
      <div class="stat-info">Miles driven</div>
    </div>
  </div>
  
  <div class="charts-grid">
    <div class="chart-card">
      <div class="chart-header">
        <div>
          <h3 class="chart-title">Profit Trend</h3>
          <p class="chart-subtitle">Last 30 days</p>
        </div>
        <div class="chart-legend">
          <div class="legend-item">
            <div class="legend-dot orange"></div>
            <span>Daily Profit</span>
          </div>
        </div>
      </div>
      
      <div class="chart-container">
        {#if stats.last30DaysData.some(d => d.profit > 0)}
          {@const maxProfit = Math.max(...stats.last30DaysData.map(d => d.profit), 1)}
          <div class="bar-chart">
            {#each stats.last30DaysData as day}
              {@const height = (day.profit / maxProfit) * 100}
              <div class="bar-wrapper">
                <div 
                  class="bar" 
                  style="height: {height}%"
                  title="{formatDate(day.date)}: {formatCurrency(day.profit)}"
                ></div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path d="M8 36V12M16 36V20M24 36V24M32 36V16M40 36V28" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <p>No data yet</p>
          </div>
        {/if}
      </div>
    </div>
    
    <div class="chart-card">
      <div class="chart-header">
        <div>
          <h3 class="chart-title">Cost Breakdown</h3>
          <p class="chart-subtitle">Total expenses</p>
        </div>
      </div>
      
      <div class="chart-container">
        {#if stats.costBreakdown.fuel.amount + stats.costBreakdown.maintenance.amount + stats.costBreakdown.supplies.amount > 0}
          {#key stats.costBreakdown}
            {@const radius = 70}
            {@const circumference = 2 * Math.PI * radius}
            {@const fuelLength = (stats.costBreakdown.fuel.percentage / 100) * circumference}
            {@const maintenanceLength = (stats.costBreakdown.maintenance.percentage / 100) * circumference}
            {@const suppliesLength = (stats.costBreakdown.supplies.percentage / 100) * circumference}
            {@const maintenanceOffset = fuelLength}
            {@const suppliesOffset = maintenanceOffset + maintenanceLength}
            
            <div class="donut-chart">
              <svg viewBox="0 0 200 200">
                <circle
                  cx="100"
                  cy="100"
                  r={radius}
                  fill="none"
                  stroke={stats.costBreakdown.fuel.color}
                  stroke-width="30"
                  stroke-dasharray="{fuelLength} {circumference}"
                  stroke-dashoffset="0"
                  transform="rotate(-90 100 100)"
                />
                
                <circle
                  cx="100"
                  cy="100"
                  r={radius}
                  fill="none"
                  stroke={stats.costBreakdown.maintenance.color}
                  stroke-width="30"
                  stroke-dasharray="{maintenanceLength} {circumference}"
                  stroke-dashoffset={-maintenanceOffset}
                  transform="rotate(-90 100 100)"
                />
                
                <circle
                  cx="100"
                  cy="100"
                  r={radius}
                  fill="none"
                  stroke={stats.costBreakdown.supplies.color}
                  stroke-width="30"
                  stroke-dasharray="{suppliesLength} {circumference}"
                  stroke-dashoffset={-suppliesOffset}
                  transform="rotate(-90 100 100)"
                />
                </svg>
              
              <div class="donut-legend">
                <div class="legend-item">
                  <div class="legend-dot" style="background: {stats.costBreakdown.fuel.color}"></div>
                  <div class="legend-text">
                    <span class="legend-label">Fuel</span>
                    <span class="legend-value">{formatCurrency(stats.costBreakdown.fuel.amount)}</span>
                  </div>
                </div>
                <div class="legend-item">
                  <div class="legend-dot" style="background: {stats.costBreakdown.maintenance.color}"></div>
                  <div class="legend-text">
                    <span class="legend-label">Maintenance</span>
                    <span class="legend-value">{formatCurrency(stats.costBreakdown.maintenance.amount)}</span>
                  </div>
                </div>
                <div class="legend-item">
                  <div class="legend-dot" style="background: {stats.costBreakdown.supplies.color}"></div>
                  <div class="legend-text">
                    <span class="legend-label">Supplies</span>
                    <span class="legend-value">{formatCurrency(stats.costBreakdown.supplies.amount)}</span>
                  </div>
                </div>
              </div>
            </div>
          {/key}
        {:else}
          <div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2"/>
              <path d="M24 14V24L30 30" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <p>No expenses yet</p>
          </div>
        {/if}
      </div>
    </div>
  </div>
  
  <div class="section-card">
    <div class="section-header">
      <div>
        <h3 class="section-title">Recent Trips</h3>
        <p class="section-subtitle">Your latest activities</p>
      </div>
      <a href="/dashboard/trips" class="btn-secondary">
        View All
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M6 12L10 8L6 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </a>
    </div>
    
    {#if stats.recentTrips.length > 0}
      <div class="trips-list">
        {#each stats.recentTrips as trip}
          {@const earnings = trip.stops?.reduce((s: number, stop: any) => s + (Number(stop.earnings) || 0), 0) || 0}
          {@const costs = (Number(trip.fuelCost) || 0) + (Number(trip.maintenanceCost) || 0) + (Number(trip.suppliesCost) || 0)}
          {@const profit = earnings - costs}
          
          <a href="/dashboard/trips?id={trip.id}" class="trip-item">
            <div class="trip-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M17 9L9 2L1 9V17C1 17.5304 1.21071 18.0391 1.58579 18.4142C1.96086 18.7893 2.46957 19 3 19H15C15.5304 19 16.0391 18.7893 16.4142 18.4142C16.7893 18.0391 17 17.5304 17 17V9Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            
            <div class="trip-info">
              <div class="trip-route">
                <span class="trip-start">{trip.startAddress?.split(',')[0] || 'Unknown'}</span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6 12L10 8L6 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span class="trip-destination">
                  {trip.stops && trip.stops.length > 0 
                    ? trip.stops[trip.stops.length - 1].address?.split(',')[0] || 'Multiple stops'
                    : 'No stops'}
                </span>
              </div>
              <div class="trip-meta">
                <span>{formatDate(trip.date || '')}</span>
                <span>•</span>
                <span>{(Number(trip.totalMiles) || 0).toFixed(1)} mi</span>
                {#if trip.stops && trip.stops.length > 0}
                  <span>•</span>
                  <span>{trip.stops.length} stops</span>
                {/if}
              </div>
            </div>
            
            <div class="trip-profit" class:positive={profit >= 0} class:negative={profit < 0}>
              {formatCurrency(profit)}
            </div>
          </a>
        {/each}
      </div>
    {:else}
      <div class="empty-state-large">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <path d="M8 24L32 8L56 24V48C56 49.0609 55.5786 50.0783 54.8284 50.8284C54.0783 51.5786 53.0609 52 52 52H12C10.9391 52 9.92172 51.5786 9.17157 50.8284C8.42143 50.0783 8 49.0609 8 48V24Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M24 52V32H40V52" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h4>No trips yet</h4>
        <p>Start by creating your first trip</p>
        <a href="/dashboard/trips/new" class="btn-primary">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Create Trip
        </a>
      </div>
    {/if}
  </div>
</div>

<style>
  .dashboard {
    max-width: 1400px;
    margin: 0 auto;
    padding: 16px;
  }
  
  /* --- MOBILE FIRST DEFAULT STYLES --- */

  /* Header - Row layout (Beside each other) */
  .page-header {
    display: flex;
    flex-direction: row; /* Aligned horizontally */
    justify-content: space-between; /* Pushed to edges */
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
  }
  
  .page-title {
    font-size: 24px; /* Slightly smaller to fit */
    font-weight: 800;
    color: #111827;
    margin-bottom: 4px;
    margin-top: 0;
  }
  
  .page-subtitle {
    font-size: 14px;
    color: #6B7280;
    margin: 0;
  }
  
  .btn-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 16px; /* Reduced padding slightly */
    background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%);
    color: white;
    border: none;
    border-radius: 10px;
    font-weight: 600;
    font-size: 14px;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 4px 12px rgba(255, 127, 80, 0.3);
    width: fit-content; /* Only as wide as needed */
    white-space: nowrap; /* Prevent text wrapping */
  }
  
  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 16px rgba(255, 127, 80, 0.4);
  }
  
  .btn-secondary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: white;
    color: #6B7280;
    border: 1px solid #E5E7EB;
    border-radius: 8px;
    font-weight: 600;
    font-size: 14px;
    text-decoration: none;
    transition: all 0.2s;
  }
  
  .btn-secondary:hover {
    border-color: var(--orange);
    color: var(--orange);
  }
  
  /* Stats Grid - 1 Column on Mobile */
  .stats-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
    margin-bottom: 24px;
  }
  
  .stat-card {
    background: white;
    border: 1px solid #E5E7EB;
    border-radius: 16px;
    padding: 20px;
    transition: all 0.2s;
  }
  
  .stat-card:hover {
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
    transform: translateY(-2px);
  }
  
  .stat-card.featured {
    background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%);
    color: white;
    border: none;
    box-shadow: 0 8px 24px rgba(255, 127, 80, 0.3);
  }
  
  .stat-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  
  .stat-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }
  
  .stat-icon.orange { background: rgba(255, 127, 80, 0.2); }
  .stat-icon.blue { background: linear-gradient(135deg, var(--blue) 0%, #1E9BCF 100%); }
  .stat-icon.green { background: linear-gradient(135deg, var(--green) 0%, #7AB82E 100%); }
  .stat-icon.purple { background: linear-gradient(135deg, var(--purple) 0%, #764a89 100%); }
  
  .stat-card.featured .stat-icon { background: rgba(255, 255, 255, 0.2); }
  
  .stat-label {
    font-size: 14px;
    font-weight: 600;
    color: #6B7280;
  }
  
  .stat-card.featured .stat-label { color: rgba(255, 255, 255, 0.9); }
  
  .stat-value {
    font-size: 28px;
    font-weight: 800;
    color: #111827;
    margin-bottom: 4px;
  }
  
  .stat-card.featured .stat-value { color: white; }
  
  .stat-change {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
  }
  
  .stat-change.positive { color: rgba(255, 255, 255, 0.9); }
  .stat-change.negative { color: rgba(255, 255, 255, 0.8); }
  
  .stat-info { font-size: 13px; color: #9CA3AF; }
  
  /* Charts Grid - 1 Column on Mobile */
  .charts-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
    margin-bottom: 32px;
  }
  
  .chart-card {
    background: white;
    border: 1px solid #E5E7EB;
    border-radius: 16px;
    padding: 20px;
  }
  
  .chart-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 20px;
    flex-wrap: wrap; /* Allow wrapping on very small screens */
    gap: 12px;
  }
  
  .chart-title {
    font-size: 18px;
    font-weight: 700;
    color: #111827;
    margin: 0 0 4px 0;
  }
  
  .chart-subtitle {
    font-size: 14px;
    color: #6B7280;
    margin: 0;
  }
  
  .chart-legend { display: flex; gap: 16px; }
  
  .legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #6B7280;
  }
  
  .legend-dot { width: 12px; height: 12px; border-radius: 50%; }
  .legend-dot.orange { background: var(--orange); }
  
  .chart-container {
    height: 240px;
    position: relative;
  }
  
  /* Bar Chart */
  .bar-chart {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 100%;
    padding: 12px 0;
  }
  
  .bar-wrapper {
    flex: 1;
    height: 100%;
    display: flex;
    align-items: flex-end;
  }
  
  .bar {
    width: 100%;
    background: linear-gradient(180deg, var(--orange) 0%, #FF6A3D 100%);
    border-radius: 4px 4px 0 0;
    min-height: 4px;
    transition: all 0.2s;
    cursor: pointer;
  }
  
  .bar:hover { opacity: 0.8; }
  
  /* Donut Chart - Stacked on Mobile */
  .donut-chart {
    display: flex;
    flex-direction: column; /* Stacked by default */
    gap: 24px;
    align-items: center;
    height: 100%;
    justify-content: center;
  }
  
  .donut-chart svg {
    width: 180px;
    height: 180px;
  }
  
  .donut-legend {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .donut-legend .legend-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
  }
  
  .donut-legend .legend-dot {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  
  .legend-text {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }
  
  .legend-label { font-size: 14px; color: #6B7280; }
  .legend-value { font-size: 16px; font-weight: 700; color: #111827; }
  
  /* Section Card */
  .section-card {
    background: white;
    border: 1px solid #E5E7EB;
    border-radius: 16px;
    padding: 20px;
  }
  
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }
  
  .section-title {
    font-size: 18px;
    font-weight: 700;
    color: #111827;
    margin: 0 0 4px 0;
  }
  
  .section-subtitle {
    font-size: 14px;
    color: #6B7280;
    margin: 0;
  }
  
  /* Trips List */
  .trips-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .trip-item {
    display: flex;
    flex-direction: column; /* Stacked on mobile */
    gap: 12px;
    padding: 16px;
    background: #F9FAFB;
    border: 1px solid #E5E7EB;
    border-radius: 12px;
    text-decoration: none;
    transition: all 0.2s;
  }
  
  .trip-item:hover {
    border-color: var(--orange);
    background: white;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  }
  
  .trip-icon {
    width: 40px;
    height: 40px;
    background: white;
    border: 1px solid #E5E7EB;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--orange);
    flex-shrink: 0;
    align-self: flex-start; /* Align top on mobile */
  }
  
  .trip-info {
    flex: 1;
    min-width: 0;
    width: 100%;
  }
  
  .trip-route {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: #111827;
    margin-bottom: 4px;
    flex-wrap: wrap; /* Handle long addresses */
  }
  
  .trip-route svg { color: #9CA3AF; flex-shrink: 0; }
  
  .trip-start,
  .trip-destination {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  
  .trip-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #6B7280;
  }
  
  .trip-profit {
    font-size: 18px;
    font-weight: 700;
    flex-shrink: 0;
    align-self: flex-end; /* Right align on mobile */
  }
  
  .trip-profit.positive { color: var(--green); }
  .trip-profit.negative { color: #DC2626; }
  
  /* Empty States */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #9CA3AF;
    text-align: center;
  }
  
  .empty-state svg { margin-bottom: 12px; color: #D1D5DB; }
  .empty-state p { font-size: 14px; color: #6B7280; }
  
  .empty-state-large { padding: 48px 24px; text-align: center; }
  .empty-state-large svg { color: #D1D5DB; margin: 0 auto 24px; }
  .empty-state-large h4 { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 8px; }
  .empty-state-large p { font-size: 15px; color: #6B7280; margin-bottom: 24px; }
  
  /* --- RESPONSIVE BREAKPOINTS --- */

  /* Tablet */
  @media (min-width: 640px) {
    .page-title { font-size: 32px; }
    .page-subtitle { font-size: 16px; }
    .btn-primary { padding: 12px 24px; font-size: 15px; }

    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    
    .trip-item {
      flex-direction: row;
      align-items: center;
    }
    
    .trip-icon { align-self: center; }
    .trip-profit { align-self: center; }
  }
  
  /* Desktop */
  @media (min-width: 1024px) {
    .stats-grid {
      grid-template-columns: repeat(4, 1fr);
    }
    
    .charts-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    
    .donut-chart {
      flex-direction: row;
      justify-content: flex-start;
    }
    
    .donut-chart svg {
      width: 200px;
      height: 200px;
    }
    
    .legend-text {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>