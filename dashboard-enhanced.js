// ============================================
// DASHBOARD-ENHANCED.JS - Advanced Analytics
// ============================================

// Initialize enhanced features on page load
document.addEventListener("DOMContentLoaded", () => {
  console.log("📈 Enhanced analytics initializing...");
  
  // Wait for main dashboard to load first
  setTimeout(() => {
    if (allTrips && allTrips.length > 0) {
      renderEfficiencyMetrics();
      renderTopRoutes();
      renderComparison();
    }
  }, 500);
});

// Render efficiency metrics
function renderEfficiencyMetrics() {
  const trips = getFilteredTrips(currentPeriod);
  
  if (trips.length === 0) {
    return;
  }
  
  const stats = calculateStats(trips);
  
  // Profit per Mile
  const profitPerMile = stats.totalMileage > 0 
    ? stats.totalProfit / stats.totalMileage 
    : 0;
  document.getElementById('profit-per-mile').textContent = 
    `$${profitPerMile.toFixed(2)}`;
  
  // Cost per Mile
  const totalCosts = stats.totalFuelCost + stats.totalMaintenanceCost + stats.totalSuppliesCost;
  const costPerMile = stats.totalMileage > 0 
    ? totalCosts / stats.totalMileage 
    : 0;
  document.getElementById('cost-per-mile').textContent = 
    `$${costPerMile.toFixed(2)}`;
  
  // Average Miles per Trip
  const avgMiles = stats.totalTrips > 0 
    ? stats.totalMileage / stats.totalTrips 
    : 0;
  document.getElementById('avg-miles-trip').textContent = 
    `${avgMiles.toFixed(1)} mi`;
  
  // Average Hours per Trip
  const avgHours = stats.totalTrips > 0 
    ? stats.totalHours / stats.totalTrips 
    : 0;
  document.getElementById('avg-hours-trip').textContent = 
    `${avgHours.toFixed(1)} hrs`;
}

// Render top routes by profitability
function renderTopRoutes() {
  const trips = getFilteredTrips(currentPeriod);
  const tbody = document.getElementById('top-routes-table-body');
  
  if (!tbody) return;
  
  if (trips.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px; color: #999;">
          No routes in selected period.
        </td>
      </tr>
    `;
    return;
  }
  
  // Group trips by route signature (start → destinations → end)
  const routeGroups = {};
  
  trips.forEach(trip => {
    const destinations = trip.destinations || [];
    const routeKey = `${trip.startTime}|${destinations.join('|')}|${trip.endTime}`;
    
    if (!routeGroups[routeKey]) {
      routeGroups[routeKey] = {
        route: { full: `${trip.startTime} 2192 ${destinations.join(" 2192 ")} 2192 ${trip.endTime}`, preview: `${trip.startTime} 2192 ${destinations.slice(0, 2).join(" 2192 ")}${destinations.length > 2 ? "..." : ""} 2192 ${trip.endTime}` },
        trips: [],
        totalProfit: 0,
        totalMileage: 0,
        totalHours: 0,
      };
    }
    
    routeGroups[routeKey].trips.push(trip);
    routeGroups[routeKey].totalProfit += parseFloat(trip.netProfit || 0);
    routeGroups[routeKey].totalMileage += parseFloat(trip.totalMileage || 0);
    
    // Calculate hours from clock times
    const start = trip.startClock;
    const end = trip.endClock;
    if (start && end && start.includes(":") && end.includes(":")) {
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = end.split(":").map(Number);
      let startMin = sh * 60 + sm;
      let endMin = eh * 60 + em;
      if (endMin < startMin) endMin += 24 * 60;
      routeGroups[routeKey].totalHours += (endMin - startMin) / 60;
    }
  });
  
  // Convert to array and calculate metrics
  const routes = Object.values(routeGroups).map(group => ({
    ...group,
    profitPerMile: group.totalMileage > 0 ? group.totalProfit / group.totalMileage : 0,
    profitPerHour: group.totalHours > 0 ? group.totalProfit / group.totalHours : 0,
    tripCount: group.trips.length,
  }));
  
  // Sort by total profit (descending) and take top 10
  const topRoutes = routes
    .sort((a, b) => b.totalProfit - a.totalProfit)
    .slice(0, 10);
  
  if (topRoutes.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px; color: #999;">
          No routes found.
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = topRoutes.map((route, index) => {
    const profitClass = route.totalProfit >= 0 ? 'profit-positive' : 'profit-negative';
    
    return `
      <tr>
        <td>${index + 1}</td>
        <td class="route-preview" style="cursor: pointer; color: #007bff;" onclick="expandRoute(this)" title="Click to see full route">${route.route.preview}<span style="display:none;" class="full-route">${route.route.full}</span></td>
        <td>${route.tripCount}</td>
        <td class="${profitClass}">$${route.totalProfit.toFixed(2)}</td>
        <td>$${route.profitPerMile.toFixed(2)}</td>
        <td>$${route.profitPerHour.toFixed(2)}</td>
      </tr>
    `;
  }).join('');
}

// Render period comparison
function renderComparison() {
  const currentTrips = getFilteredTrips(currentPeriod);
  
  // Get previous period trips
  const previousTrips = getFilteredTrips(currentPeriod * 2).filter(trip => {
    const tripDate = new Date(trip.date);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - currentPeriod);
    return tripDate < cutoffDate;
  });
  
  const tbody = document.getElementById('comparison-table-body');
  if (!tbody) return;
  
  const currentStats = calculateStats(currentTrips);
  const previousStats = calculateStats(previousTrips);
  
  // Calculate changes
  const comparisons = [
    {
      metric: 'Total Trips',
      previous: previousStats.totalTrips,
      current: currentStats.totalTrips,
      format: 'number'
    },
    {
      metric: 'Total Profit',
      previous: previousStats.totalProfit,
      current: currentStats.totalProfit,
      format: 'currency'
    },
    {
      metric: 'Avg Profit/Hour',
      previous: previousStats.avgProfitPerHour,
      current: currentStats.avgProfitPerHour,
      format: 'currency'
    },
    {
      metric: 'Total Mileage',
      previous: previousStats.totalMileage,
      current: currentStats.totalMileage,
      format: 'miles'
    },
    {
      metric: 'Fuel Costs',
      previous: previousStats.totalFuelCost,
      current: currentStats.totalFuelCost,
      format: 'currency'
    },
    {
      metric: 'Total Hours',
      previous: previousStats.totalHours,
      current: currentStats.totalHours,
      format: 'hours'
    }
  ];
  
  tbody.innerHTML = comparisons.map(item => {
    const change = item.previous > 0 
      ? ((item.current - item.previous) / item.previous) * 100 
      : (item.current > 0 ? 100 : 0);
    
    const changeClass = change >= 0 ? 'profit-positive' : 'profit-negative';
    const changeSymbol = change >= 0 ? '↑' : '↓';
    
    // Format values based on type
    let previousDisplay, currentDisplay;
    
    switch (item.format) {
      case 'currency':
        previousDisplay = `$${item.previous.toFixed(2)}`;
        currentDisplay = `$${item.current.toFixed(2)}`;
        break;
      case 'miles':
        previousDisplay = `${item.previous.toFixed(1)} mi`;
        currentDisplay = `${item.current.toFixed(1)} mi`;
        break;
      case 'hours':
        previousDisplay = `${item.previous.toFixed(1)} hrs`;
        currentDisplay = `${item.current.toFixed(1)} hrs`;
        break;
      default:
        previousDisplay = item.previous;
        currentDisplay = item.current;
    }
    
    return `
      <tr>
        <td><strong>${item.metric}</strong></td>
        <td>${previousDisplay}</td>
        <td>${currentDisplay}</td>
        <td class="${changeClass}">
          ${changeSymbol} ${Math.abs(change).toFixed(1)}%
        </td>
      </tr>
    `;
  }).join('');
}

// Update enhanced features when period changes
// Hook into the existing changePeriod function
const originalChangePeriod = window.changePeriod;
if (typeof originalChangePeriod === 'function') {
  window.changePeriod = function(days) {
    // Call original function
    originalChangePeriod.call(this, days);
    
    // Update enhanced features
    setTimeout(() => {
      renderEfficiencyMetrics();
      renderTopRoutes();
      renderComparison();
    }, 100);
  };
}

// Export enhanced analytics data
// Expand route to show all destinations
function expandRoute(cell) {
  const preview = cell.childNodes[0];
  const fullRouteSpan = cell.querySelector('.full-route');
  if (!fullRouteSpan) return;
  
  const isExpanded = fullRouteSpan.style.display === 'inline';
  
  if (isExpanded) {
    // Collapse
    fullRouteSpan.style.display = 'none';
    cell.childNodes[0].textContent = cell.getAttribute('data-preview');
  } else {
    // Expand
    cell.setAttribute('data-preview', cell.childNodes[0].textContent);
    cell.childNodes[0].textContent = '';
    fullRouteSpan.style.display = 'inline';
  }
}

function exportEnhancedAnalytics() {
  const trips = getFilteredTrips(currentPeriod);
  
  if (trips.length === 0) {
    showAlertModal("⚠️ No data to export in selected period.");
    return;
  }
  
  const stats = calculateStats(trips);
  
  // Efficiency metrics
  const profitPerMile = stats.totalMileage > 0 ? stats.totalProfit / stats.totalMileage : 0;
  const costPerMile = stats.totalMileage > 0 
    ? (stats.totalFuelCost + stats.totalMaintenanceCost + stats.totalSuppliesCost) / stats.totalMileage 
    : 0;
  const avgMiles = stats.totalTrips > 0 ? stats.totalMileage / stats.totalTrips : 0;
  const avgHours = stats.totalTrips > 0 ? stats.totalHours / stats.totalTrips : 0;
  
  // Create comprehensive report
  const report = {
    period: `${currentPeriod} days`,
    generated: new Date().toLocaleString(),
    summary: {
      totalTrips: stats.totalTrips,
      totalProfit: stats.totalProfit,
      totalEarnings: stats.totalEarnings,
      totalCosts: stats.totalFuelCost + stats.totalMaintenanceCost + stats.totalSuppliesCost,
      avgProfitPerHour: stats.avgProfitPerHour,
    },
    efficiency: {
      profitPerMile: profitPerMile,
      costPerMile: costPerMile,
      avgMilesPerTrip: avgMiles,
      avgHoursPerTrip: avgHours,
    },
    trips: trips.map(trip => ({
      date: trip.date,
      route: `${trip.startTime} → ${(trip.destinations || []).join(' → ')} → ${trip.endTime}`,
      profit: parseFloat(trip.netProfit || 0),
      mileage: parseFloat(trip.totalMileage || 0),
      earnings: parseFloat(trip.totalEarnings || 0),
    }))
  };
  
  // Download as JSON
  const blob = new Blob([JSON.stringify(report, null, 2)], { 
    type: 'application/json' 
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `analytics-report-${currentPeriod}days.json`;
  link.click();
  
  showConfirmationMessage(`✅ Exported analytics report`);
}

// Add export button for enhanced analytics
function addEnhancedExportButton() {
  const exportButtons = document.querySelector('.export-buttons');
  if (!exportButtons) return;
  
  const enhancedBtn = document.createElement('button');
  enhancedBtn.className = 'export-btn';
  enhancedBtn.innerHTML = `
    <span class="material-icons">analytics</span>
    Export Analytics Report
  `;
  enhancedBtn.onclick = exportEnhancedAnalytics;
  
  exportButtons.appendChild(enhancedBtn);
}

// Initialize export button after page load
setTimeout(addEnhancedExportButton, 1000);

console.log("✅ Dashboard-enhanced.js loaded");
