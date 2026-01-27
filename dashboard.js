/* eslint-disable @typescript-eslint/no-unused-vars */
// dashboard.js - FIXED VERSION
// Handles rendering and interactions for the dashboard page

let allTrips = [];
let currentPeriod = 7; // default to 7 days
const charts = {}; // store chart instances

// Initialize on page load
window.toggleViewAll = function () {
	const button = document.getElementById('view-all-trips-button');
	// Redirect to index.html log section
	window.location.href = '/index.html#log';
};

// Change time period
window.changePeriod = function (days) {
	currentPeriod = days;

	// Update button states
	const buttons = document.querySelectorAll('.period-btn');
	buttons.forEach((btn) => {
		btn.classList.remove('active');
		if (btn.textContent.includes(days.toString())) {
			btn.classList.add('active');
		}
	});

	renderDashboard();
};

// Helper: Format date for display
function formatLocalDate(dateString) {
	const date = new Date(dateString + 'T00:00:00');
	return date.toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
}

// Helper: Format hours and minutes
function formatHoursAndMinutes(decimal = 0) {
	if (isNaN(decimal) || decimal <= 0) return '0 minutes';

	const totalMinutes = Math.round(decimal * 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;

	const parts = [];
	if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
	if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);

	return parts.join(' ') || '0 minutes';
}

// Load trips data
async function loadTripsData() {
	const token = localStorage.getItem('token');

	if (!token) {
		console.warn('⚠ No token found - redirecting to index');
		window.location.href = '/index.html';
		return;
	}

	try {
		// Try to load from cloud first
		const response = await fetch('https://logs.gorouteyourself.com/logs', {
			headers: { Authorization: token }
		});

		if (response.ok) {
			allTrips = await response.json();
			console.log(`📦 Loaded ${allTrips.length} trips from cloud`);
		} else {
			// Fall back to local storage
			allTrips = JSON.parse(localStorage.getItem('trips') || '[]');
			console.log(`📦 Loaded ${allTrips.length} trips from local storage`);
		}

		renderDashboard();
	} catch (error) {
		console.error('Error loading trips:', error);
		// Fall back to local storage
		allTrips = JSON.parse(localStorage.getItem('trips') || '[]');
		renderDashboard();
	}
}

// Main render function
function renderDashboard() {
	const trips = getFilteredTrips(currentPeriod);

	if (trips.length === 0) {
		showEmptyState();
		return;
	}

	hideEmptyState();
	renderStats(trips);
	renderCharts(trips);
	renderRecentTrips(trips);
}

// Get trips for selected period
function getFilteredTrips(days) {
	const now = new Date();
	const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

	return allTrips
		.filter((trip) => {
			const tripDate = new Date(trip.date + 'T00:00:00');
			return tripDate >= cutoffDate && tripDate <= now;
		})
		.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Render stat cards
function renderStats(trips) {
	// Calculate totals
	const totalProfit = trips.reduce((sum, t) => sum + parseFloat(t.netProfit || 0), 0);
	const totalFuel = trips.reduce((sum, t) => sum + parseFloat(t.fuelCost || 0), 0);

	// Calculate hours worked
	let totalHoursWorked = 0;
	trips.forEach((trip) => {
		if (trip.hoursWorked) {
			totalHoursWorked += parseFloat(trip.hoursWorked);
		}
	});

	const avgProfitPerHour = totalHoursWorked > 0 ? totalProfit / totalHoursWorked : 0;

	// Update DOM
	document.getElementById('total-profit').textContent = `$${totalProfit.toFixed(2)}`;
	document.getElementById('total-trips').textContent = trips.length;
	document.getElementById('avg-profit-hour').textContent = `$${avgProfitPerHour.toFixed(2)}`;
	document.getElementById('fuel-costs').textContent = `$${totalFuel.toFixed(2)}`;

	// Calculate changes (compare to previous period)
	const prevTrips = getPreviousPeriodTrips(currentPeriod);
	const prevProfit = prevTrips.reduce((sum, t) => sum + parseFloat(t.netProfit || 0), 0);
	const prevFuel = prevTrips.reduce((sum, t) => sum + parseFloat(t.fuelCost || 0), 0);

	updateChange('profit-change', totalProfit, prevProfit);
	updateChange('trips-change', trips.length, prevTrips.length);
	updateChange('fuel-change', totalFuel, prevFuel, true); // true = lower is better
}

// Get previous period trips for comparison
function getPreviousPeriodTrips(days) {
	const now = new Date();
	const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
	const prevCutoffDate = new Date(cutoffDate.getTime() - days * 24 * 60 * 60 * 1000);

	return allTrips.filter((trip) => {
		const tripDate = new Date(trip.date + 'T00:00:00');
		return tripDate >= prevCutoffDate && tripDate < cutoffDate;
	});
}

// Update change indicator
function updateChange(elementId, current, previous, lowerIsBetter = false) {
	const element = document.getElementById(elementId);
	if (!element) return;

	if (previous === 0) {
		element.textContent = '';
		return;
	}

	const change = ((current - previous) / previous) * 100;
	const isPositive = lowerIsBetter ? change < 0 : change > 0;

	element.textContent = `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
	element.className = `stat-change ${isPositive ? 'positive' : 'negative'}`;
}

// Render charts
function renderCharts(trips) {
	renderProfitChart(trips);
	renderCostChart(trips);
}

// Profit trend chart
function renderProfitChart(trips) {
	const ctx = document.getElementById('profit-chart');
	if (!ctx) return;

	// Destroy existing chart
	if (charts.profit) {
		charts.profit.destroy();
	}

	// Prepare data (reverse to show oldest to newest)
	const reversedTrips = [...trips].reverse();
	const labels = reversedTrips.map((t) => formatLocalDate(t.date));
	const data = reversedTrips.map((t) => parseFloat(t.netProfit || 0));

	charts.profit = new Chart(ctx, {
		type: 'line',
		data: {
			labels: labels,
			datasets: [
				{
					label: 'Net Profit',
					data: data,
					borderColor: '#4caf50',
					backgroundColor: 'rgba(76, 175, 80, 0.1)',
					tension: 0.4,
					fill: true
				}
			]
		},
		options: {
			responsive: true,
			maintainAspectRatio: true,
			plugins: {
				legend: {
					display: false
				}
			},
			scales: {
				y: {
					beginAtZero: true,
					ticks: {
						callback: function (value) {
							return '$' + value;
						}
					}
				}
			}
		}
	});
}

// Cost breakdown chart
function renderCostChart(trips) {
	const ctx = document.getElementById('cost-chart');
	if (!ctx) return;

	// Destroy existing chart
	if (charts.cost) {
		charts.cost.destroy();
	}

	// Calculate totals
	const fuelCost = trips.reduce((sum, t) => sum + parseFloat(t.fuelCost || 0), 0);
	const maintenanceCost = trips.reduce((sum, t) => sum + parseFloat(t.maintenanceCost || 0), 0);
	const suppliesCost = trips.reduce((sum, t) => sum + parseFloat(t.suppliesCost || 0), 0);

	charts.cost = new Chart(ctx, {
		type: 'doughnut',
		data: {
			labels: ['Fuel', 'Maintenance', 'Supplies'],
			datasets: [
				{
					data: [fuelCost, maintenanceCost, suppliesCost],
					backgroundColor: ['#f44336', '#2196f3', '#ff9800']
				}
			]
		},
		options: {
			responsive: true,
			maintainAspectRatio: true,
			plugins: {
				legend: {
					position: 'bottom'
				}
			}
		}
	});
}

// Render recent trips table
function renderRecentTrips(trips) {
	const tbody = document.getElementById('recent-trips-table');
	if (!tbody) return;

	const recentTrips = trips.slice(0, 5); // Show last 5

	tbody.innerHTML = recentTrips
		.map((trip) => {
			const route = `${trip.startTime} → ${trip.endTime}`;
			const stops = (trip.destinations || []).length;

			return `
      <tr>
        <td>${formatLocalDate(trip.date)}</td>
        <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${route}">${route}</td>
        <td>${stops}</td>
        <td>${parseFloat(trip.totalMileage || 0).toFixed(1)}</td>
        <td style="font-weight: 600; color: ${parseFloat(trip.netProfit) >= 0 ? '#4caf50' : '#f44336'};">$${parseFloat(trip.netProfit || 0).toFixed(2)}</td>
        <td>
          <button class="btn-view" onclick="viewTripDetails('${trip.date}')">View</button>
          <button class="btn-edit" onclick="editTripOnIndex(${allTrips.indexOf(trip)})">Edit</button>
        </td>
      </tr>
    `;
		})
		.join('');
}

// Show empty state
function showEmptyState() {
	const container = document.querySelector('.dashboard-container');
	const emptyState = document.getElementById('empty-state');

	if (container) container.style.display = 'none';
	if (emptyState) emptyState.style.display = 'block';
}

// Hide empty state
function hideEmptyState() {
	const container = document.querySelector('.dashboard-container');
	const emptyState = document.getElementById('empty-state');

	if (container) container.style.display = 'block';
	if (emptyState) emptyState.style.display = 'none';
}

// View trip details in modal
window.viewTripDetails = function (date) {
	const trip = allTrips.find((t) => t.date === date);
	if (!trip) return;

	const destinations = trip.destinations || [];
	const destList = destinations
		.map((d, i) => `${i + 1}. ${d} - $${parseFloat(trip.earnings[i] || 0).toFixed(2)}`)
		.join('<br>');

	showAlertModal(`
    <h3 style="margin-top: 0;">Trip Details - ${formatLocalDate(date)}</h3>
    <div style="text-align: left; margin: 20px 0; font-size: 14px;">
      <p><strong>Start:</strong> ${trip.startTime}</p>
      <p><strong>Destinations:</strong><br>${destList}</p>
      <p><strong>End:</strong> ${trip.endTime}</p>
      <p><strong>Mileage:</strong> ${trip.totalMileage} miles</p>
      <p><strong>Drive Time:</strong> ${trip.totalTime}</p>
      <p><strong>Hours Worked:</strong> ${formatHoursAndMinutes(trip.hoursWorked || 0)}</p>
      <hr>
      <p><strong>Earnings:</strong> $${trip.totalEarnings}</p>
      <p><strong>Fuel Cost:</strong> $${trip.fuelCost}</p>
      <p><strong>Maintenance:</strong> $${trip.maintenanceCost || 0}</p>
      <p><strong>Supplies:</strong> $${trip.suppliesCost || 0}</p>
      <p style="font-size: 16px; margin-top: 10px;"><strong>Net Profit:</strong> $${trip.netProfit}</p>
      <p><strong>Profit/Hour:</strong> $${trip.profitPerHour}</p>
      ${trip.notes ? `<hr><p><strong>Notes:</strong> ${trip.notes}</p>` : ''}
    </div>
  `);
};

// Edit trip on index.html - FIXED VERSION
window.editTripOnIndex = function (tripIndex) {
	if (tripIndex === -1) return;

	// Store the index for the index.html page to read
	localStorage.setItem('editTripIndex', tripIndex.toString());

	// Redirect to index.html log section
	window.location.href = '/index.html#edit-' + tripIndex;
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
	console.log('📊 Dashboard initializing...');

	// Check authentication
	const token = localStorage.getItem('token');
	if (!token) {
		console.warn('⚠ Not authenticated - redirecting to index');
		window.location.href = '/index.html';
		return;
	}

	await loadTripsData();
});
