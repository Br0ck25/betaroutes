/**
 * Go Route Yourself - UI Interactions
 * This file handles all UI interactions, modals, and user input
 */

// ============================================================================
// MODAL MANAGEMENT
// ============================================================================

// Show auth modal
function showAuthModal(mode = 'login') {
  const modal = document.getElementById('auth-modal');
  const title = document.getElementById('auth-title');
  const submitBtn = document.getElementById('auth-submit-btn');
  const toggleText = document.getElementById('auth-toggle-text');
  const toggleLink = document.getElementById('auth-toggle-link');
  const usernameField = document.getElementById('auth-username-container');

  if (mode === 'signup') {
    title.textContent = 'Create Account';
    submitBtn.textContent = 'Sign Up';
    toggleText.textContent = 'Already have an account?';
    toggleLink.textContent = 'Sign In';
    if (usernameField) usernameField.style.display = 'block';
  } else {
    title.textContent = 'Sign In';
    submitBtn.textContent = 'Sign In';
    toggleText.textContent = "Don't have an account?";
    toggleLink.textContent = 'Sign Up';
    if (usernameField) usernameField.style.display = 'none';
  }

  modal.style.display = 'flex';
  modal.dataset.mode = mode;
}

// Close auth modal
function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  modal.style.display = 'none';
  
  // Clear form
  document.getElementById('auth-email').value = '';
  document.getElementById('auth-password').value = '';
  if (document.getElementById('auth-username')) {
    document.getElementById('auth-username').value = '';
  }
}

// Toggle between login and signup
function toggleAuthMode() {
  const modal = document.getElementById('auth-modal');
  const currentMode = modal.dataset.mode;
  const newMode = currentMode === 'login' ? 'signup' : 'login';
  closeAuthModal();
  showAuthModal(newMode);
}

// Handle auth form submission
async function handleAuthSubmit(event) {
  event.preventDefault();
  
  const modal = document.getElementById('auth-modal');
  const mode = modal.dataset.mode;
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const username = document.getElementById('auth-username')?.value.trim();

  // Basic validation
  if (!email || !password) {
    showNotification('Please fill in all fields', 'error');
    return;
  }

  if (mode === 'signup' && !username) {
    showNotification('Please enter a username', 'error');
    return;
  }

  // Show loading state
  const submitBtn = document.getElementById('auth-submit-btn');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Please wait...';
  submitBtn.disabled = true;

  let result;
  if (mode === 'signup') {
    result = await AuthManager.signup(email, password, username);
  } else {
    result = await AuthManager.login(email, password);
  }

  // Reset button
  submitBtn.textContent = originalText;
  submitBtn.disabled = false;

  if (result.success) {
    closeAuthModal();
    showNotification(result.message, 'success');
    
    // Refresh the logs display
    displayLogs();
  } else {
    showNotification(result.message, 'error');
  }
}

// Handle Google Sign-In
async function handleGoogleSignIn(response) {
  const credential = response.credential;
  
  const result = await AuthManager.googleSignIn(credential);
  
  if (result.success) {
    showNotification(result.message, 'success');
    displayLogs();
  } else {
    showNotification(result.message, 'error');
  }
}

// Handle logout
function handleLogout() {
  if (confirm('Are you sure you want to log out? Your data will remain saved locally.')) {
    appState.logout();
    displayLogs();
  }
}

// ============================================================================
// LOG DISPLAY AND MANAGEMENT
// ============================================================================

// Display logs
function displayLogs(logs = null) {
  const logsContainer = document.getElementById('logs-container');
  if (!logsContainer) return;

  const logsToDisplay = logs || appState.logEntries;

  if (logsToDisplay.length === 0) {
    logsContainer.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #666;">
        <p>No trips logged yet.</p>
        <p>Add your first trip to get started!</p>
      </div>
    `;
    return;
  }

  logsContainer.innerHTML = logsToDisplay.map(log => `
    <div class="log-entry" data-id="${log.id}">
      <h4>${formatDate(log.date)} ${getSyncStatusBadge(log.syncStatus)}</h4>
      <p><strong>Route:</strong> ${log.startAddress} → ${log.endAddress}</p>
      ${log.destinations && log.destinations.length > 0 ? `
        <p><strong>Stops:</strong> ${log.destinations.map(d => d.address).join(', ')}</p>
      ` : ''}
      <p><strong>Distance:</strong> ${log.totalMiles || 0} miles</p>
      <p><strong>Gas Cost:</strong> $${log.gasCost || 0}</p>
      ${log.totalEarnings ? `<p><strong>Earnings:</strong> $${log.totalEarnings}</p>` : ''}
      ${log.hoursWorked ? `<p><strong>Hours Worked:</strong> ${log.hoursWorked}</p>` : ''}
      ${log.notes ? `<p><strong>Notes:</strong> ${log.notes}</p>` : ''}
      
      <div class="log-entry-actions">
        <button class="btn-secondary" onclick="editLog('${log.id}')">Edit</button>
        <button class="btn-danger" onclick="deleteLog('${log.id}')">Delete</button>
        ${log.syncStatus === 'pending' ? `
          <button class="btn-success" onclick="retrySync('${log.id}')">Retry Sync</button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

// Add new log
async function addLog(event) {
  event.preventDefault();

  const logData = {
    date: document.getElementById('log-date').value,
    startAddress: document.getElementById('start-address').value,
    endAddress: document.getElementById('end-address').value,
    mpg: parseFloat(document.getElementById('mpg').value) || 0,
    gasPrice: parseFloat(document.getElementById('gas-price').value) || 0,
    startTime: document.getElementById('start-time')?.value || '',
    endTime: document.getElementById('end-time')?.value || '',
    hoursWorked: document.getElementById('total-hours')?.value || '',
    maintenanceCost: parseFloat(document.getElementById('maintenance-cost')?.value) || 0,
    suppliesCost: parseFloat(document.getElementById('supplies-cost')?.value) || 0,
    notes: document.getElementById('log-notes')?.value || '',
    destinations: getDestinations(),
    totalMiles: calculateTotalMiles(),
    gasCost: calculateGasCost(),
    totalEarnings: calculateTotalEarnings()
  };

  // Validate required fields
  if (!logData.date || !logData.startAddress || !logData.endAddress) {
    showNotification('Please fill in all required fields', 'error');
    return;
  }

  // Save the log
  await appState.saveLog(logData);

  // Show success message
  showNotification('Trip logged successfully!', 'success');

  // Clear form
  clearForm();

  // Refresh display
  displayLogs();
}

// Edit log
function editLog(logId) {
  const log = appState.logEntries.find(l => l.id === logId);
  if (!log) return;

  // Populate form with log data
  document.getElementById('log-date').value = log.date;
  document.getElementById('start-address').value = log.startAddress;
  document.getElementById('end-address').value = log.endAddress;
  document.getElementById('mpg').value = log.mpg;
  document.getElementById('gas-price').value = log.gasPrice;
  
  if (document.getElementById('start-time')) {
    document.getElementById('start-time').value = log.startTime;
  }
  if (document.getElementById('end-time')) {
    document.getElementById('end-time').value = log.endTime;
  }
  if (document.getElementById('total-hours')) {
    document.getElementById('total-hours').value = log.hoursWorked;
  }
  if (document.getElementById('maintenance-cost')) {
    document.getElementById('maintenance-cost').value = log.maintenanceCost;
  }
  if (document.getElementById('supplies-cost')) {
    document.getElementById('supplies-cost').value = log.suppliesCost;
  }
  if (document.getElementById('log-notes')) {
    document.getElementById('log-notes').value = log.notes;
  }

  // Populate destinations
  if (log.destinations && log.destinations.length > 0) {
    const container = document.getElementById('destinations-container');
    container.innerHTML = '';
    log.destinations.forEach((dest, index) => {
      addDestinationField(dest.address, dest.earnings);
    });
  }

  // Mark as editing
  window.editingLogId = logId;
  
  // Update button text
  const submitBtn = document.querySelector('#log-form button[type="submit"]');
  if (submitBtn) {
    submitBtn.textContent = 'Update Trip';
  }

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
  
  showNotification('Editing trip - update the form and save', 'info');
}

// Delete log
async function deleteLog(logId) {
  if (!confirm('Are you sure you want to delete this trip?')) {
    return;
  }

  const deleted = await appState.deleteLog(logId);
  
  if (deleted) {
    showNotification('Trip deleted successfully', 'success');
    displayLogs();
  } else {
    showNotification('Failed to delete trip', 'error');
  }
}

// Retry sync for a pending log
async function retrySync(logId) {
  const log = appState.logEntries.find(l => l.id === logId);
  if (!log) return;

  const success = await appState.saveToCloud(log);
  
  if (success) {
    showNotification('Trip synced successfully!', 'success');
    displayLogs();
  } else {
    showNotification('Failed to sync. Will retry later.', 'error');
  }
}

// Clear form
function clearForm() {
  document.getElementById('log-form').reset();
  
  // Reset destinations container
  const container = document.getElementById('destinations-container');
  if (container) {
    container.innerHTML = '';
  }

  // Reset editing state
  window.editingLogId = null;
  
  // Reset button text
  const submitBtn = document.querySelector('#log-form button[type="submit"]');
  if (submitBtn) {
    submitBtn.textContent = 'Save Trip';
  }

  // Set date to today
  const dateInput = document.getElementById('log-date');
  if (dateInput) {
    dateInput.value = new Date().toLocaleDateString('en-CA');
  }
}

// ============================================================================
// DESTINATION MANAGEMENT
// ============================================================================

// Get destinations from form
function getDestinations() {
  const destinations = [];
  const container = document.getElementById('destinations-container');
  if (!container) return destinations;

  const destDivs = container.querySelectorAll('.destination');
  destDivs.forEach(div => {
    const addressInput = div.querySelector('input[type="text"]');
    const earningsInput = div.querySelector('input[type="number"]');
    
    if (addressInput && addressInput.value.trim()) {
      destinations.push({
        address: addressInput.value.trim(),
        earnings: parseFloat(earningsInput?.value) || 0
      });
    }
  });

  return destinations;
}

// Add destination field
function addDestinationField(address = '', earnings = '') {
  const container = document.getElementById('destinations-container');
  if (!container) return;

  const index = container.children.length + 1;
  const div = document.createElement('div');
  div.className = 'destination';
  div.innerHTML = `
    <label for="destination-${index}">Destination ${index}</label>
    <input type="text" id="destination-${index}" placeholder="Enter address" value="${address}">
    <label for="earnings-${index}">Earnings for Destination ${index}</label>
    <input type="number" id="earnings-${index}" placeholder="0.00" step="0.01" value="${earnings}">
    <div class="destination-actions">
      <button type="button" class="delete-btn" onclick="removeDestination(this)">Remove</button>
    </div>
  `;
  
  container.appendChild(div);
}

// Remove destination field
function removeDestination(button) {
  const destination = button.closest('.destination');
  if (destination) {
    destination.remove();
    updateDestinationNumbers();
  }
}

// Update destination numbering
function updateDestinationNumbers() {
  const container = document.getElementById('destinations-container');
  if (!container) return;

  const destinations = container.querySelectorAll('.destination');
  destinations.forEach((dest, index) => {
    const num = index + 1;
    const labels = dest.querySelectorAll('label');
    if (labels[0]) labels[0].textContent = `Destination ${num}`;
    if (labels[1]) labels[1].textContent = `Earnings for Destination ${num}`;
  });
}

// ============================================================================
// CALCULATION HELPERS
// ============================================================================

// Calculate total miles
function calculateTotalMiles() {
  // This would integrate with your existing route calculation
  // For now, return 0 or get from route calculation result
  const mileageDisplay = document.getElementById('mileage-display');
  if (mileageDisplay && mileageDisplay.textContent) {
    const match = mileageDisplay.textContent.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : 0;
  }
  return 0;
}

// Calculate gas cost
function calculateGasCost() {
  const miles = calculateTotalMiles();
  const mpg = parseFloat(document.getElementById('mpg')?.value) || 0;
  const gasPrice = parseFloat(document.getElementById('gas-price')?.value) || 0;
  
  if (mpg > 0) {
    return ((miles / mpg) * gasPrice).toFixed(2);
  }
  return 0;
}

// Calculate total earnings
function calculateTotalEarnings() {
  const destinations = getDestinations();
  return destinations.reduce((sum, dest) => sum + (dest.earnings || 0), 0).toFixed(2);
}

// ============================================================================
// EXPORT/IMPORT FUNCTIONALITY
// ============================================================================

// Export logs to CSV
function exportLogsToCSV() {
  if (appState.logEntries.length === 0) {
    showNotification('No logs to export', 'info');
    return;
  }

  const headers = ['Date', 'Start', 'End', 'Miles', 'MPG', 'Gas Price', 'Gas Cost', 'Earnings', 'Hours', 'Notes'];
  const rows = appState.logEntries.map(log => [
    log.date,
    log.startAddress,
    log.endAddress,
    log.totalMiles,
    log.mpg,
    log.gasPrice,
    log.gasCost,
    log.totalEarnings,
    log.hoursWorked,
    log.notes
  ]);

  const csv = [headers, ...rows].map(row => row.map(cell => `"${cell || ''}"`).join(',')).join('\n');
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `route-logs-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  showNotification('Logs exported successfully!', 'success');
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Auth button listeners
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => showAuthModal('login'));
  }

  const signupBtn = document.getElementById('signup-btn');
  if (signupBtn) {
    signupBtn.addEventListener('click', () => showAuthModal('signup'));
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }

  // Form submission
  const logForm = document.getElementById('log-form');
  if (logForm) {
    logForm.addEventListener('submit', addLog);
  }

  const authForm = document.getElementById('auth-form');
  if (authForm) {
    authForm.addEventListener('submit', handleAuthSubmit);
  }

  // Export button
  const exportBtn = document.getElementById('export-csv-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportLogsToCSV);
  }

  // Add destination button
  const addDestBtn = document.getElementById('add-destination-btn');
  if (addDestBtn) {
    addDestBtn.addEventListener('click', () => addDestinationField());
  }
});

// Make functions globally available
window.showAuthModal = showAuthModal;
window.closeAuthModal = closeAuthModal;
window.toggleAuthMode = toggleAuthMode;
window.handleGoogleSignIn = handleGoogleSignIn;
window.displayLogs = displayLogs;
window.editLog = editLog;
window.deleteLog = deleteLog;
window.retrySync = retrySync;
window.addDestinationField = addDestinationField;
window.removeDestination = removeDestination;
window.exportLogsToCSV = exportLogsToCSV;
