/* eslint-disable @typescript-eslint/no-unused-vars, no-redeclare, no-unreachable */

document.addEventListener('DOMContentLoaded', () => {
	if (typeof updateAuthUI === 'function') {
		updateAuthUI();
	}
});

function clearTripForm() {
	// Reset date to today
	const today = new Date().toLocaleDateString('en-CA'); // format: YYYY-MM-DD in local time

	document.getElementById('log-date').value = today;

	//  Clear only optional fields
	document.getElementById('start-time').value = '';
	document.getElementById('end-time').value = '';
	document.getElementById('total-hours').value = '';
	document.getElementById('log-notes').value = '';

	// Clear all maintenance and supply items
	document.getElementById('maintenance-container').innerHTML = '';
	document.getElementById('supplies-container').innerHTML = '';

	//  Keep start, end, mpg, and gas-price

	// Reset destinations
	const container = document.getElementById('destinations-container');
	container.innerHTML = '';

	// Add one fresh destination block
	const div = document.createElement('div');
	div.classList.add('destination');
	div.innerHTML = `
    <label for="destination-1">Destination 1</label>
    <input type="text" id="destination-1" list="recent-destinations" placeholder="Enter destination address" required>
    <label for="earnings-1">Earnings for Destination 1</label>
    <input type="number" id="earnings-1" placeholder="Enter earnings for destination" required>
    <div class="destination-actions">
      <button class="delete-btn" onclick="deleteDestination(this)">Delete</button>
      <button class="move-btn" onclick="moveDestinationUp(this)">Move Up</button>
      <button class="move-btn" onclick="moveDestinationDown(this)">Move Down</button>
    </div>
  `;
	container.appendChild(div);
	initAutocompleteDestination(div.querySelector('input[type="text"]'));

	// Hide results and reset UI
	document.getElementById('results').classList.add('hidden');
	document.getElementById('map').classList.add('hidden');
	document.getElementById('detailed-results').innerHTML = '';
	document.getElementById('mileage-display').textContent = '';
	document.getElementById('optimized-mileage-display').textContent = '';
}

// Maintenance categories management
let maintenanceItemCounter = 0;

function getDefaultMaintenanceCategories() {
	return ['Oil Change', 'Tire Rotation', 'Brake Service', 'Battery'];
}

function getAllMaintenanceCategories() {
	const saved = localStorage.getItem('maintenanceCategories');
	if (saved) {
		return JSON.parse(saved);
	}
	// Return defaults if nothing saved yet
	return getDefaultMaintenanceCategories();
}

function saveMaintenanceCategory(typeName) {
	if (!typeName || typeName.trim() === '') return;

	const allCategories = getAllMaintenanceCategories();
	const trimmed = typeName.trim();

	if (allCategories.includes(trimmed)) {
		return; // Already exists
	}

	allCategories.push(trimmed);
	localStorage.setItem('maintenanceCategories', JSON.stringify(allCategories));

	syncCustomCategoriesToCloud();
}

function deleteMaintenanceCategory(typeName) {
	const allCategories = getAllMaintenanceCategories();
	const filtered = allCategories.filter((t) => t !== typeName);

	// Always allow deletion - even if it results in empty list
	localStorage.setItem('maintenanceCategories', JSON.stringify(filtered));

	syncCustomCategoriesToCloud();
}

function getCustomMaintenanceTypes() {
	const saved = localStorage.getItem('customMaintenanceTypes');
	return saved ? JSON.parse(saved) : [];
}

function saveCustomMaintenanceType(typeName) {
	if (!typeName || typeName.trim() === '') return;

	const customTypes = getCustomMaintenanceTypes();
	const trimmed = typeName.trim();

	const presetTypes = ['Oil Change', 'Tire Rotation', 'Brake Service', 'Battery'];
	if (presetTypes.includes(trimmed) || customTypes.includes(trimmed)) {
		return;
	}

	customTypes.push(trimmed);
	localStorage.setItem('customMaintenanceTypes', JSON.stringify(customTypes));

	syncCustomCategoriesToCloud();
}

function deleteCustomMaintenanceType(typeName) {
	const customTypes = getCustomMaintenanceTypes();
	const filtered = customTypes.filter((t) => t !== typeName);
	localStorage.setItem('customMaintenanceTypes', JSON.stringify(filtered));

	syncCustomCategoriesToCloud();
}

function getCustomSupplyTypes() {
	const saved = localStorage.getItem('customSupplyTypes');
	return saved ? JSON.parse(saved) : [];
}

function saveCustomSupplyType(typeName) {
	if (!typeName || typeName.trim() === '') return;

	const customTypes = getCustomSupplyTypes();
	const trimmed = typeName.trim();

	// Don't save if it's a preset type or already exists
	const presetTypes = ['Poles', 'Concrete', 'Cable'];
	if (presetTypes.includes(trimmed) || customTypes.includes(trimmed)) {
		return;
	}

	customTypes.push(trimmed);
	localStorage.setItem('customSupplyTypes', JSON.stringify(customTypes));

	// Sync to cloud if signed in
	syncCustomCategoriesToCloud();
}

function deleteCustomSupplyType(typeName) {
	const customTypes = getCustomSupplyTypes();
	const filtered = customTypes.filter((t) => t !== typeName);
	localStorage.setItem('customSupplyTypes', JSON.stringify(filtered));

	// Sync to cloud if signed in
	syncCustomCategoriesToCloud();
}

// Sync custom categories to/from cloud
async function syncCustomCategoriesToCloud() {
	const token = localStorage.getItem('token');
	if (!token) return; // Not signed in

	const categories = {
		maintenance: getCustomMaintenanceTypes(),
		supplies: getCustomSupplyTypes()
	};

	try {
		await fetch('https://logs.gorouteyourself.com/categories', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: token
			},
			body: JSON.stringify(categories)
		});
	} catch (err) {
		console.error('Failed to sync categories:', err);
	}
}

async function loadCustomCategoriesFromCloud() {
	const token = localStorage.getItem('token');
	if (!token) return; // Not signed in

	try {
		const response = await fetch('https://logs.gorouteyourself.com/categories', {
			headers: { Authorization: token }
		});

		if (response.ok) {
			const categories = await response.json();

			if (categories.maintenance) {
				localStorage.setItem('customMaintenanceTypes', JSON.stringify(categories.maintenance));
			}
			if (categories.supplies) {
				localStorage.setItem('customSupplyTypes', JSON.stringify(categories.supplies));
			}
		}
	} catch (err) {
		console.error('Failed to load categories:', err);
	}
}

function addMaintenanceItem() {
	maintenanceItemCounter++;
	const container = document.getElementById('maintenance-container');
	const itemDiv = document.createElement('div');
	itemDiv.classList.add('maintenance-item');
	itemDiv.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px; align-items: center;';

	// Get ALL categories (presets + custom)
	const allCategories = getAllMaintenanceCategories();
	const categoryOptions = allCategories
		.map((type) => `<option value="${type}">${type}</option>`)
		.join('');

	itemDiv.innerHTML = `
    <select class="maintenance-type" style="flex: 1; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 5px;">
      ${categoryOptions}
      <option value="Custom">+ Add Custom</option>
      <option value="__MANAGE__" style="color: #007bff; font-weight: bold;">⚙ Manage Categories</option>
    </select>
    <input type="text" class="maintenance-custom-name" placeholder="Enter item name" style="flex: 1; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 5px; display: none;">
    <input type="number" class="maintenance-cost" placeholder="Cost" style="width: 120px; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 5px;" step="0.01">
    <button type="button" onclick="removeMaintenanceItem(this)" style="background-color: #dc3545; color: white; padding: 10px 15px; border: none; border-radius: 5px; cursor: pointer;">Delete</button>
  `;

	container.appendChild(itemDiv);

	const select = itemDiv.querySelector('.maintenance-type');
	const customInput = itemDiv.querySelector('.maintenance-custom-name');

	select.addEventListener('change', function () {
		if (this.value === 'Custom') {
			customInput.style.display = 'block';
			customInput.required = true;
			customInput.focus();
		} else if (this.value === '__MANAGE__') {
			openManageMaintenanceModal();
			this.selectedIndex = 0;
		} else {
			customInput.style.display = 'none';
			customInput.required = false;
			customInput.value = '';
		}
	});

	customInput.addEventListener('blur', function () {
		if (this.value.trim()) {
			const newType = this.value.trim();
			saveMaintenanceCategory(newType);

			const option = document.createElement('option');
			option.value = newType;
			option.textContent = newType;
			option.selected = true;

			const customOption = select.querySelector('option[value="Custom"]');
			select.insertBefore(option, customOption);

			customInput.style.display = 'none';
			customInput.value = '';
		}
	});
}

function openManageMaintenanceModal() {
	const allCategories = getAllMaintenanceCategories();

	if (allCategories.length === 0) {
		showAlertModal(
			"You don't have any maintenance categories. Click '+ Add Custom' to create one!"
		);
		return;
	}

	const categoryList = allCategories
		.map(
			(type) =>
				`<div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #eee;">
      <span style="flex: 1;">${type}</span>
      <button onclick="deleteMaintenanceCategoryFromModal('${type.replace(/'/g, "\\'")}'); event.stopPropagation();" style="background-color: #dc3545; color: white; padding: 5px 15px; border: none; border-radius: 5px; cursor: pointer;">Delete</button>
    </div>`
		)
		.join('');

	showAlertModal(`
    <h3 style="margin-top: 0;">Manage Maintenance Categories</h3>
    <div style="max-height: 400px; overflow-y: auto; margin: 20px 0;">
      ${categoryList}
    </div>
    <p style="font-size: 14px; color: #666; margin-top: 20px;">
      You can delete any category. Changes sync across all your devices if you're signed in.
    </p>
  `);
}

function deleteMaintenanceCategoryFromModal(typeName) {
	deleteMaintenanceCategory(typeName);
	closeUniversalModal();

	// Refresh all maintenance dropdowns
	document.querySelectorAll('.maintenance-type').forEach((select) => {
		const currentValue = select.value;
		const allCategories = getAllMaintenanceCategories();
		const categoryOptions = allCategories
			.map((type) => `<option value="${type}">${type}</option>`)
			.join('');

		// Rebuild options
		select.innerHTML = `
      ${categoryOptions}
      <option value="Custom">+ Add Custom</option>
      <option value="__MANAGE__" style="color: #007bff; font-weight: bold;">⚙ Manage Categories</option>
    `;

		// Restore selection if still valid
		if (currentValue && currentValue !== typeName && currentValue !== '__MANAGE__') {
			select.value = currentValue;
		}
	});

	showConfirmationMessage(`Deleted "${typeName}" from maintenance categories`);
}

function openManageSuppliesModal() {
	const allCategories = getAllSupplyCategories();

	if (allCategories.length === 0) {
		showAlertModal("You don't have any supply categories. Click '+ Add Custom' to create one!");
		return;
	}

	const categoryList = allCategories
		.map(
			(type) =>
				`<div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #eee;">
      <span style="flex: 1;">${type}</span>
      <button onclick="deleteSupplyCategoryFromModal('${type.replace(/'/g, "\\'")}'); event.stopPropagation();" style="background-color: #dc3545; color: white; padding: 5px 15px; border: none; border-radius: 5px; cursor: pointer;">Delete</button>
    </div>`
		)
		.join('');

	showAlertModal(`
    <h3 style="margin-top: 0;">Manage Supply Categories</h3>
    <div style="max-height: 400px; overflow-y: auto; margin: 20px 0;">
      ${categoryList}
    </div>
    <p style="font-size: 14px; color: #666; margin-top: 20px;">
      You can delete any category. Changes sync across all your devices if you're signed in.
    </p>
  `);
}

function deleteSupplyCategoryFromModal(typeName) {
	deleteSupplyCategory(typeName);
	closeUniversalModal();

	// Refresh all supply dropdowns
	document.querySelectorAll('.supply-type').forEach((select) => {
		const currentValue = select.value;
		const allCategories = getAllSupplyCategories();
		const categoryOptions = allCategories
			.map((type) => `<option value="${type}">${type}</option>`)
			.join('');

		// Rebuild options
		select.innerHTML = `
      ${categoryOptions}
      <option value="Custom">+ Add Custom</option>
      <option value="__MANAGE__" style="color: #007bff; font-weight: bold;">⚙ Manage Categories</option>
    `;

		// Restore selection if still valid
		if (currentValue && currentValue !== typeName && currentValue !== '__MANAGE__') {
			select.value = currentValue;
		}
	});

	showConfirmationMessage(`Deleted "${typeName}" from supply categories`);
}

function removeMaintenanceItem(button) {
	button.closest('.maintenance-item').remove();
}

function getMaintenanceData() {
	const maintenance = [];
	const maintenanceItems = document.querySelectorAll('#maintenance-container .maintenance-item');

	maintenanceItems.forEach((item) => {
		const typeSelect = item.querySelector('.maintenance-type');
		const customInput = item.querySelector('.maintenance-custom-name');
		const costInput = item.querySelector('.maintenance-cost');

		const type = typeSelect.value === 'Custom' ? customInput.value : typeSelect.value;
		const cost = parseFloat(costInput.value) || 0;

		if (type && cost > 0) {
			maintenance.push({ type, cost });
		}
	});

	return maintenance;
}

function getTotalMaintenanceCost() {
	const maintenance = getMaintenanceData();
	return maintenance.reduce((sum, item) => sum + item.cost, 0);
}

// Supply items management
let supplyItemCounter = 0;

function getDefaultSupplyCategories() {
	return ['Poles', 'Concrete', 'Cable'];
}

function getAllSupplyCategories() {
	const saved = localStorage.getItem('supplyCategories');
	if (saved) {
		return JSON.parse(saved);
	}
	return getDefaultSupplyCategories();
}

function saveSupplyCategory(typeName) {
	if (!typeName || typeName.trim() === '') return;

	const allCategories = getAllSupplyCategories();
	const trimmed = typeName.trim();

	if (allCategories.includes(trimmed)) {
		return;
	}

	allCategories.push(trimmed);
	localStorage.setItem('supplyCategories', JSON.stringify(allCategories));

	syncCustomCategoriesToCloud();
}

function deleteSupplyCategory(typeName) {
	const allCategories = getAllSupplyCategories();
	const filtered = allCategories.filter((t) => t !== typeName);

	localStorage.setItem('supplyCategories', JSON.stringify(filtered));

	syncCustomCategoriesToCloud();
}

function getCustomSupplyTypes() {
	const saved = localStorage.getItem('customSupplyTypes');
	return saved ? JSON.parse(saved) : [];
}

function saveCustomSupplyType(typeName) {
	if (!typeName || typeName.trim() === '') return;

	const customTypes = getCustomSupplyTypes();
	const trimmed = typeName.trim();

	const presetTypes = ['Poles', 'Concrete', 'Cable'];
	if (presetTypes.includes(trimmed) || customTypes.includes(trimmed)) {
		return;
	}

	customTypes.push(trimmed);
	localStorage.setItem('customSupplyTypes', JSON.stringify(customTypes));
}

function addSupplyItem() {
	supplyItemCounter++;
	const container = document.getElementById('supplies-container');
	const itemDiv = document.createElement('div');
	itemDiv.classList.add('supply-item');
	itemDiv.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px; align-items: center;';

	// Get ALL categories (presets + custom)
	const allCategories = getAllSupplyCategories();
	const categoryOptions = allCategories
		.map((type) => `<option value="${type}">${type}</option>`)
		.join('');

	itemDiv.innerHTML = `
    <select class="supply-type" style="flex: 1; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 5px;">
      ${categoryOptions}
      <option value="Custom">+ Add Custom</option>
      <option value="__MANAGE__" style="color: #007bff; font-weight: bold;">⚙ Manage Categories</option>
    </select>
    <input type="text" class="supply-custom-name" placeholder="Enter item name" style="flex: 1; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 5px; display: none;">
    <input type="number" class="supply-cost" placeholder="Cost" style="width: 120px; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 5px;" step="0.01">
    <button type="button" onclick="removeSupplyItem(this)" style="background-color: #dc3545; color: white; padding: 10px 15px; border: none; border-radius: 5px; cursor: pointer;">Delete</button>
  `;

	container.appendChild(itemDiv);

	const select = itemDiv.querySelector('.supply-type');
	const customInput = itemDiv.querySelector('.supply-custom-name');

	select.addEventListener('change', function () {
		if (this.value === 'Custom') {
			customInput.style.display = 'block';
			customInput.required = true;
			customInput.focus();
		} else if (this.value === '__MANAGE__') {
			openManageSuppliesModal();
			this.selectedIndex = 0;
		} else {
			customInput.style.display = 'none';
			customInput.required = false;
			customInput.value = '';
		}
	});

	customInput.addEventListener('blur', function () {
		if (this.value.trim()) {
			const newType = this.value.trim();
			saveSupplyCategory(newType);

			const option = document.createElement('option');
			option.value = newType;
			option.textContent = newType;
			option.selected = true;

			const customOption = select.querySelector('option[value="Custom"]');
			select.insertBefore(option, customOption);

			customInput.style.display = 'none';
			customInput.value = '';
		}
	});
}

function removeSupplyItem(button) {
	button.closest('.supply-item').remove();
}

function addEditSupplyItem() {
	const container = document.getElementById('edit-supplies-container');
	const itemDiv = document.createElement('div');
	itemDiv.classList.add('supply-item');
	itemDiv.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px; align-items: center;';

	// Build options with custom types
	const customTypes = getCustomSupplyTypes();
	const customOptions = customTypes
		.map((type) => `<option value="${type}">${type}</option>`)
		.join('');

	itemDiv.innerHTML = `
    <select class="supply-type" style="flex: 1; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 5px;">
      <option value="Poles">Poles</option>
      <option value="Concrete">Concrete</option>
      <option value="Cable">Cable</option>
      ${customOptions}
      <option value="Custom">+ Add Custom</option>
    </select>
    <input type="text" class="supply-custom-name" placeholder="Enter item name" style="flex: 1; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 5px; display: none;">
    <input type="number" class="supply-cost" placeholder="Cost" style="width: 120px; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 5px;" step="0.01">
    <button type="button" onclick="removeEditSupplyItem(this)" style="background-color: #dc3545; color: white; padding: 10px 15px; border: none; border-radius: 5px; cursor: pointer;">Delete</button>
  `;

	container.appendChild(itemDiv);

	const select = itemDiv.querySelector('.supply-type');
	const customInput = itemDiv.querySelector('.supply-custom-name');

	select.addEventListener('change', function () {
		if (this.value === 'Custom') {
			customInput.style.display = 'block';
			customInput.required = true;
			customInput.focus();
		} else {
			customInput.style.display = 'none';
			customInput.required = false;
			customInput.value = '';
		}
	});

	// Save custom type when user enters it
	customInput.addEventListener('blur', function () {
		if (this.value.trim()) {
			const newType = this.value.trim();
			saveCustomSupplyType(newType);

			// Update the dropdown
			const option = document.createElement('option');
			option.value = newType;
			option.textContent = newType;
			option.selected = true;

			const customOption = select.querySelector('option[value="Custom"]');
			select.insertBefore(option, customOption);

			customInput.style.display = 'none';
			customInput.value = '';
		}
	});
}

function removeEditSupplyItem(button) {
	button.closest('.supply-item').remove();
}

function getEditSuppliesData() {
	const supplies = [];
	const supplyItems = document.querySelectorAll('#edit-supplies-container .supply-item');

	supplyItems.forEach((item) => {
		const typeSelect = item.querySelector('.supply-type');
		const customInput = item.querySelector('.supply-custom-name');
		const costInput = item.querySelector('.supply-cost');

		const type = typeSelect.value === 'Custom' ? customInput.value : typeSelect.value;
		const cost = parseFloat(costInput.value) || 0;

		if (type && cost > 0) {
			supplies.push({ type, cost });
		}
	});

	return supplies;
}

function getTotalEditSuppliesCost() {
	const supplies = getEditSuppliesData();
	return supplies.reduce((sum, item) => sum + item.cost, 0);
}

// Edit form maintenance functions
function addEditMaintenanceItem() {
	const container = document.getElementById('edit-maintenance-container');
	const itemDiv = document.createElement('div');
	itemDiv.classList.add('maintenance-item');
	itemDiv.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px; align-items: center;';

	const customTypes = getCustomMaintenanceTypes();
	const customOptions = customTypes
		.map((type) => `<option value="${type}">${type}</option>`)
		.join('');

	itemDiv.innerHTML = `
    <select class="maintenance-type" style="flex: 1; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 5px;">
      <option value="Oil Change">Oil Change</option>
      <option value="Tire Rotation">Tire Rotation</option>
      <option value="Brake Service">Brake Service</option>
      <option value="Battery">Battery</option>
      ${customOptions}
      <option value="Custom">+ Add Custom</option>
    </select>
    <input type="text" class="maintenance-custom-name" placeholder="Enter item name" style="flex: 1; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 5px; display: none;">
    <input type="number" class="maintenance-cost" placeholder="Cost" style="width: 120px; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 5px;" step="0.01">
    <button type="button" onclick="removeEditMaintenanceItem(this)" style="background-color: #dc3545; color: white; padding: 10px 15px; border: none; border-radius: 5px; cursor: pointer;">Delete</button>
  `;

	container.appendChild(itemDiv);

	const select = itemDiv.querySelector('.maintenance-type');
	const customInput = itemDiv.querySelector('.maintenance-custom-name');

	select.addEventListener('change', function () {
		if (this.value === 'Custom') {
			customInput.style.display = 'block';
			customInput.required = true;
			customInput.focus();
		} else {
			customInput.style.display = 'none';
			customInput.required = false;
			customInput.value = '';
		}
	});

	customInput.addEventListener('blur', function () {
		if (this.value.trim()) {
			const newType = this.value.trim();
			saveCustomMaintenanceType(newType);

			const option = document.createElement('option');
			option.value = newType;
			option.textContent = newType;
			option.selected = true;

			const customOption = select.querySelector('option[value="Custom"]');
			select.insertBefore(option, customOption);

			customInput.style.display = 'none';
			customInput.value = '';
		}
	});
}

function removeEditMaintenanceItem(button) {
	button.closest('.maintenance-item').remove();
}

function getEditMaintenanceData() {
	const maintenance = [];
	const maintenanceItems = document.querySelectorAll(
		'#edit-maintenance-container .maintenance-item'
	);

	maintenanceItems.forEach((item) => {
		const typeSelect = item.querySelector('.maintenance-type');
		const customInput = item.querySelector('.maintenance-custom-name');
		const costInput = item.querySelector('.maintenance-cost');

		const type = typeSelect.value === 'Custom' ? customInput.value : typeSelect.value;
		const cost = parseFloat(costInput.value) || 0;

		if (type && cost > 0) {
			maintenance.push({ type, cost });
		}
	});

	return maintenance;
}

function getTotalEditMaintenanceCost() {
	const maintenance = getEditMaintenanceData();
	return maintenance.reduce((sum, item) => sum + item.cost, 0);
}

function getSuppliesData() {
	const supplies = [];
	const supplyItems = document.querySelectorAll('#supplies-container .supply-item');

	supplyItems.forEach((item) => {
		const typeSelect = item.querySelector('.supply-type');
		const customInput = item.querySelector('.supply-custom-name');
		const costInput = item.querySelector('.supply-cost');

		const type = typeSelect.value === 'Custom' ? customInput.value : typeSelect.value;
		const cost = parseFloat(costInput.value) || 0;

		if (type && cost > 0) {
			supplies.push({ type, cost });
		}
	});

	return supplies;
}

function getTotalSuppliesCost() {
	const supplies = getSuppliesData();
	return supplies.reduce((sum, item) => sum + item.cost, 0);
}

let disableAutoSave = false;

function scrollToTop() {
	window.scrollTo({ top: 0, behavior: 'smooth' });
}

let map;
let directionsService;
let directionsRenderer;
let autocompleteStart, autocompleteEnd;
let editingIndex = -1;
let originalMileage = null;
let logEntries = [];
let currentFilterFn = null;
let currentPage = 1;
let skipNextSync = false;

const logsPerPage = 10;

function getRecentDestinations() {
	return JSON.parse(localStorage.getItem('recentDestinations') || '[]');
}

function saveRecentDestinations(newDestinations) {
	const current = getRecentDestinations();
	const combined = [...new Set([...newDestinations, ...current])].slice(0, 10);
	localStorage.setItem('recentDestinations', JSON.stringify(combined));
}

function updateDatalistSuggestions() {
	const datalist = document.getElementById('recent-destinations');
	if (!datalist) return;
	const recent = getRecentDestinations();
	datalist.innerHTML = recent.map((dest) => `<option value="${dest}">`).join('');
}

function onStartDateChange() {
	filterLogs(); // existing filter logic

	// Automatically open the end date calendar
	const endDateInput = document.getElementById('filter-end-date');
	if (endDateInput) {
		endDateInput.focus();
		endDateInput.showPicker?.(); // works in most modern browsers
	}
}

function isIos() {
	return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode() {
	return 'standalone' in window.navigator && window.navigator.standalone;
}

document.addEventListener('DOMContentLoaded', () => {
	const installBtn = document.getElementById('install-button');

	if (isIos()) {
		//  Hide the install button on iOS
		if (installBtn) installBtn.style.display = 'none';

		//  Only show iOS prompt if not installed
		if (!isInStandaloneMode()) {
			const prompt = document.createElement('div');
			prompt.id = 'ios-install-prompt'; //  Needed for auto-hide
			prompt.innerHTML = `
        <div style="
          background-color: #fffae6;
          color: #333;
          padding: 15px;
          text-align: center;
          font-size: 16px;
          border: 1px solid #ffd700;
          border-radius: 6px;
          margin: 20px auto 0 auto;
          max-width: 600px;
        ">
           To install this app on your iPhone, tap the
          <strong>Share</strong> button
          <br>then choose <strong>Add to Home Screen</strong>.
        </div>
      `;

			//  Insert below the log container
			const manageLog = document.getElementById('manage-log-container');
			if (manageLog) {
				manageLog.insertAdjacentElement('afterend', prompt);
			} else {
				document.body.appendChild(prompt);
			}

			//  Auto-hide if user installs manually while the app is open
			const checkInterval = setInterval(() => {
				if (isInStandaloneMode()) {
					const iosPrompt = document.getElementById('ios-install-prompt');
					if (iosPrompt) iosPrompt.remove();
					clearInterval(checkInterval);
				}
			}, 2000); // every 2 seconds
		}
	}
});

function resumeDraftTrip() {
	document.getElementById('resume-modal').style.display = 'none';

	//  Restore logs first (only if logged in)
	const cached = localStorage.getItem('cachedLogs');
	const token = localStorage.getItem('token');

	if (cached && token) {
		try {
			logEntries = JSON.parse(cached);
		} catch (e) {
			console.error(' Failed to parse cachedLogs while resuming draft:', e);
		}
	}

	const data = window.__pendingDraftTrip;
	if (!data) return;

	//  Restore form values
	document.getElementById('log-date').value = data.date || '';
	document.getElementById('start-address').value = data.start || '';
	document.getElementById('end-address').value = data.end || '';
	document.getElementById('mpg').value = data.mpg || '';
	document.getElementById('gas-price').value = data.gas || '';
	document.getElementById('start-time').value = data.startTime || '';
	document.getElementById('end-time').value = data.endTime || '';
	document.getElementById('total-hours').value = formatHoursAndMinutes(data.hoursWorked || 0);

	// Restore maintenance items
	const maintenanceContainer = document.getElementById('maintenance-container');
	maintenanceContainer.innerHTML = '';
	if (data.maintenance && Array.isArray(data.maintenance)) {
		data.maintenance.forEach((item) => {
			addMaintenanceItem();
			const lastItem = maintenanceContainer.lastElementChild;
			const typeSelect = lastItem.querySelector('.maintenance-type');
			const customInput = lastItem.querySelector('.maintenance-custom-name');
			const costInput = lastItem.querySelector('.maintenance-cost');

			const presetTypes = ['Oil Change', 'Tire Rotation', 'Brake Service', 'Battery'];
			if (presetTypes.includes(item.type)) {
				typeSelect.value = item.type;
			} else {
				typeSelect.value = 'Custom';
				customInput.style.display = 'block';
				customInput.value = item.type;
			}
			costInput.value = item.cost;
		});
	}

	// Restore supplies items
	const suppliesContainer = document.getElementById('supplies-container');
	suppliesContainer.innerHTML = '';
	if (data.supplies && Array.isArray(data.supplies)) {
		data.supplies.forEach((item) => {
			addSupplyItem();
			const lastItem = suppliesContainer.lastElementChild;
			const typeSelect = lastItem.querySelector('.supply-type');
			const customInput = lastItem.querySelector('.supply-custom-name');
			const costInput = lastItem.querySelector('.supply-cost');

			// Check if it's a preset type
			const presetTypes = ['Poles', 'Concrete', 'Cable'];
			if (presetTypes.includes(item.type)) {
				typeSelect.value = item.type;
			} else {
				typeSelect.value = 'Custom';
				customInput.style.display = 'block';
				customInput.value = item.type;
			}
			costInput.value = item.cost;
		});
	}

	document.getElementById('log-notes').value = data.notes || '';

	const container = document.getElementById('destinations-container');
	container.innerHTML = '';

	data.destinations.forEach((d, i) => {
		const div = document.createElement('div');
		div.classList.add('destination');
		div.innerHTML = `
      <label for="destination-${i + 1}">Destination ${i + 1}</label>
      <input type="text" id="destination-${i + 1}" list="recent-destinations" value="${d.address || ''}">
      <label for="earnings-${i + 1}">Earnings for Destination ${i + 1}</label>
      <input type="number" id="earnings-${i + 1}" value="${d.earnings || ''}">
      <div class="destination-actions">
        <button class="delete-btn" onclick="deleteDestination(this)">Delete</button>
        <button class="move-btn" onclick="moveDestinationUp(this)">Move Up</button>
        <button class="move-btn" onclick="moveDestinationDown(this)">Move Down</button>
      </div>
    `;
		container.appendChild(div);
		initAutocompleteDestination(div.querySelector('input[type="text"]'));
	});

	//  Display restored logs at the end
	displayLog();
}

function discardDraftTrip() {
	document.getElementById('resume-modal').style.display = 'none';
	localStorage.removeItem('draftTrip');

	const today = new Date().toLocaleDateString('en-CA');
	const dateInput = document.getElementById('log-date');
	if (dateInput) dateInput.value = today;

	const cached = localStorage.getItem('cachedLogs');
	const token = localStorage.getItem('token');

	//  Only load cached logs if user is logged in
	if (cached && token) {
		try {
			logEntries = JSON.parse(cached);
			displayLog();
		} catch (e) {
			console.error(' Failed to parse cachedLogs:', e);
		}
	}

	skipNextSync = true;
}

function showAlertModal(message, onClose) {
	const modal = document.getElementById('universal-modal');
	const msg = document.getElementById('universal-modal-message');
	const buttons = document.getElementById('universal-modal-buttons');

	msg.innerHTML = message;

	// Save callback if provided, or null
	window._universalCallback = typeof onClose === 'function' ? onClose : null;

	buttons.innerHTML = `
    <button onclick="closeUniversalModal(); if (typeof window._universalCallback === 'function') window._universalCallback();">OK</button>
  `;

	modal.style.display = 'flex';
}

function showConfirmModal(message, onConfirm, onCancel) {
	const modal = document.getElementById('universal-modal');
	const msg = document.getElementById('universal-modal-message');
	const buttons = document.getElementById('universal-modal-buttons');

	msg.innerHTML = message;
	buttons.innerHTML = `
    <button onclick="closeUniversalModal(); window._universalConfirmCallback()">Yes</button>
    <button onclick="closeUniversalModal(); ${onCancel ? 'window._universalCancelCallback();' : ''}">No</button>
  `;

	window._universalConfirmCallback = onConfirm;
	if (onCancel) window._universalCancelCallback = onCancel;

	modal.style.display = 'flex';
}

function closeUniversalModal() {
	const modal = document.getElementById('universal-modal');
	modal.style.display = 'none';
	window._universalCallback = null; // clean up
}

function toggleHamburgerManageLogMenu() {
	const menu = document.getElementById('hamburger-manage-log-menu');
	const arrow = document.getElementById('hamburger-manage-arrow');
	if (!menu || !arrow) return;

	const isOpen = menu.style.maxHeight && menu.style.maxHeight !== '0px';

	if (isOpen) {
		menu.style.maxHeight = '0';
		arrow.style.transform = 'rotate(0deg)';
	} else {
		menu.style.maxHeight = menu.scrollHeight + 'px';
		arrow.style.transform = 'rotate(180deg)';
	}
}
function toggleHamburgerManageAccountMenu() {
	const menu = document.getElementById('hamburger-manage-account-menu');
	const arrow = document.getElementById('hamburger-manage-account-arrow');
	if (!menu || !arrow) return;

	const isOpen = menu.style.maxHeight && menu.style.maxHeight !== '0px';

	if (isOpen) {
		menu.style.maxHeight = '0';
		arrow.style.transform = 'rotate(0deg)';
	} else {
		menu.style.maxHeight = menu.scrollHeight + 'px';
		arrow.style.transform = 'rotate(180deg)';
	}
}

function isDuplicateEntry(entry, existingLog) {
	return existingLog.some(
		(e) =>
			e.date === entry.date &&
			e.startClock === entry.startClock &&
			e.endClock === entry.endClock &&
			e.startTime === entry.startTime &&
			e.endTime === entry.endTime &&
			parseFloat(e.totalMileage) === parseFloat(entry.totalMileage)
	);
}

function saveUserInputsToLocalStorage({ mpg, gasPrice, startAddress, endAddress }) {
	localStorage.setItem('mpg', mpg);
	localStorage.setItem('gasPrice', gasPrice);
	localStorage.setItem('startAddress', startAddress);
	localStorage.setItem('endAddress', endAddress);
}

document.addEventListener('click', function (event) {
	const menu = document.getElementById('account-menu');
	const button = event.target.closest('button');
	const hamburgerButton = document.getElementById('hamburger-button');

	// Check if click is on hamburger button or its children (including the icon)
	const isHamburgerClick =
		hamburgerButton && (event.target === hamburgerButton || hamburgerButton.contains(event.target));

	// Don't close if clicking inside menu or on hamburger button
	if (menu && !menu.contains(event.target) && !isHamburgerClick) {
		closeMenu();
	}
});

function closeMenu() {
	const menu = document.getElementById('account-menu');
	if (menu) {
		menu.classList.remove('show');
	}
}

function closeAuthModal() {
	document.getElementById('auth-modal').style.display = 'none';
}

async function saveLog() {
	//  ALWAYS save to localStorage first (local-first design)
	console.log(' Saving to localStorage...');
	console.log(` logEntries has ${logEntries.length} trips before save`);
	localStorage.setItem('trips', JSON.stringify(logEntries));
	console.log(' Saved to localStorage');

	//  If user is authenticated, also sync to cloud
	const token = localStorage.getItem('token');

	if (!token) {
		console.log(' No token - saved locally only');
		return; // Local save successful, no cloud sync needed
	}

	//  If offline, save to pending queue for later sync
	if (!navigator.onLine) {
		console.warn(' Offline: Saved locally, will sync when back online.');
		localStorage.setItem('pendingLogs', JSON.stringify(logEntries));
		return;
	}

	//  Try to sync to cloud
	console.log(` Syncing ${logEntries.length} trips to cloud...`);
	console.log(
		' Sending to cloud:',
		logEntries.map((e) => `${e.date} (${e.destinations?.length || 0} stops)`)
	);

	try {
		const response = await fetch('https://logs.gorouteyourself.com/logs', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: token
			},
			body: JSON.stringify(logEntries)
		});

		if (!response.ok) {
			throw new Error(await response.text());
		}

		console.log(' Synced to cloud');
		console.log(` logEntries still has ${logEntries.length} trips after cloud sync`);

		//  DON'T reload after every save - causes race condition
		// await syncAndReloadLogs();
	} catch (err) {
		console.error(' Cloud sync failed (but local save succeeded):', err);
		localStorage.setItem('pendingLogs', JSON.stringify(logEntries));
		// Don't show error - local save succeeded, cloud sync can happen later
	}
}

async function syncPendingLogs() {
	const pending = localStorage.getItem('pendingLogs');
	if (!pending) return;

	const token = localStorage.getItem('token');
	if (!token) return;

	try {
		const response = await fetch('https://logs.gorouteyourself.com/logs', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: token
			},
			body: pending
		});

		if (response.ok) {
			console.log(' Pending logs synced successfully!');
			localStorage.removeItem('pendingLogs');

			//  Important: Update cachedLogs after successful sync
			const freshLogs = await loadLog();
			localStorage.setItem('cachedLogs', JSON.stringify(freshLogs));
			displayLog();
		} else {
			console.error(' Failed to sync pending logs:', await response.text());
		}
	} catch (err) {
		console.error(' Error syncing pending logs:', err);
	}
}

async function loadLog() {
	const token = localStorage.getItem('token');

	//  First, always load local trips
	const localTrips = JSON.parse(localStorage.getItem('trips') || '[]');
	console.log(` Found ${localTrips.length} local trips`);

	if (!token) {
		// No token = return local trips only
		console.log(' No token - returning local trips only');
		return localTrips;
	}

	//  User is authenticated - load cloud data first, then merge
	try {
		console.log(' Loading trips from cloud...');
		const response = await fetch('https://logs.gorouteyourself.com/logs', {
			headers: { Authorization: token }
		});

		if (!response.ok) {
			throw new Error(await response.text());
		}

		const cloudLogs = await response.json();
		console.log(` Loaded ${cloudLogs.length} trips from cloud`);

		//  Merge local trips with cloud trips
		const merged = [...cloudLogs]; // Start with cloud data

		// Add local trips that aren't already in cloud
		let addedCount = 0;
		localTrips.forEach((localTrip) => {
			const existsInCloud = cloudLogs.some(
				(cloudTrip) =>
					cloudTrip.date === localTrip.date &&
					cloudTrip.startAddress === localTrip.startAddress &&
					JSON.stringify(cloudTrip.destinations) === JSON.stringify(localTrip.destinations)
			);

			if (!existsInCloud) {
				merged.push(localTrip);
				addedCount++;
			}
		});

		console.log(
			` Merge complete: ${cloudLogs.length} from cloud + ${addedCount} new local = ${merged.length} total`
		);

		//  If we added any local trips, sync the merged data back to cloud
		if (addedCount > 0) {
			console.log(` Syncing ${addedCount} new local trips to cloud...`);
			try {
				await fetch('https://logs.gorouteyourself.com/logs', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: token
					},
					body: JSON.stringify(merged) // Send ALL trips, not just local
				});
				console.log(' Sync complete');
			} catch (err) {
				console.warn(' Failed to sync to cloud (but local data preserved):', err);
			}
		}

		//  Save merged result to both localStorage keys
		localStorage.setItem('trips', JSON.stringify(merged));
		localStorage.setItem('cachedLogs', JSON.stringify(merged));

		return merged;
	} catch (err) {
		console.warn(' Offline or failed to load from cloud. Using local trips.', err);
		// Failed to load from cloud, return local trips
		localStorage.setItem('cachedLogs', JSON.stringify(localTrips));
		return localTrips;
	}
}

function updateOfflineBanner() {
	const banner = document.getElementById('offline-banner');

	if (navigator.onLine) {
		banner.style.display = 'none'; //  Online
		syncAndReloadLogs(); //  Force refresh logs!
	} else {
		banner.style.display = 'block'; //  Offline
	}
}

async function syncAndReloadLogs() {
	if (skipNextSync) {
		console.log(' Skipping sync due to Cancel selection');
		skipNextSync = false; // reset it after skipping once
		return;
	}

	try {
		console.log(' Online detected: syncing and reloading logs...');

		await syncPendingLogs();
		logEntries = await loadLog();
		displayLog();

		console.log(' Logs refreshed after reconnecting!');
		showConfirmationMessage(' Logs refreshed after reconnecting!');
	} catch (error) {
		console.error(' Error refreshing logs:', error);
	}
}

function saveDraftTrip() {
	if (disableAutoSave) return;

	const startTime = document.getElementById('start-time')?.value.trim();
	const endTime = document.getElementById('end-time')?.value.trim();
	const hoursWorked = document.getElementById('total-hours')?.value.trim();

	const maintenance = getMaintenanceData();
	const supplies = getSuppliesData();
	const notes = document.getElementById('log-notes')?.value.trim(); //  add this

	const destinations = Array.from(document.querySelectorAll('#destinations-container .destination'))
		.map((div) => ({
			address: div.querySelector('input[id^="destination-"]')?.value.trim() || '',
			earnings: div.querySelector('input[id^="earnings-"]')?.value.trim() || ''
		}))
		.filter((d) => d.address || d.earnings);

	const hasMeaningfulData =
		destinations.length > 0 ||
		startTime ||
		endTime ||
		hoursWorked ||
		maintenance.length > 0 ||
		supplies.length > 0 ||
		notes; //  now considers notes too

	if (!hasMeaningfulData) {
		localStorage.removeItem('draftTrip');
		return;
	}

	const draft = {
		date: document.getElementById('log-date')?.value,
		start: document.getElementById('start-address')?.value,
		end: document.getElementById('end-address')?.value,
		mpg: document.getElementById('mpg')?.value,
		gas: document.getElementById('gas-price')?.value,
		startTime,
		endTime,
		hoursWorked,
		maintenance,
		supplies,
		notes, //  save notes to draft
		destinations
	};

	localStorage.setItem('draftTrip', JSON.stringify(draft));
}

setInterval(saveDraftTrip, 5000); // Auto-save every 5 seconds

document.addEventListener('DOMContentLoaded', async () => {
	const draft = localStorage.getItem('draftTrip');
	updateAuthUI();

	if (draft) {
		try {
			const data = JSON.parse(draft);

			const destinations = Array.isArray(data.destinations)
				? data.destinations.filter((d) => d.address || d.earnings)
				: [];

			const hasMeaningfulData =
				destinations.length > 0 ||
				(data.startTime && data.startTime.trim()) ||
				(data.endTime && data.endTime.trim()) ||
				(data.hoursWorked && parseFloat(data.hoursWorked) > 0) ||
				(data.maintenance && parseFloat(data.maintenance) > 0) ||
				(data.supplies && parseFloat(data.supplies) > 0);

			if (!hasMeaningfulData) {
				localStorage.removeItem('draftTrip');
				return;
			}

			const cached = localStorage.getItem('cachedLogs');
			const token = localStorage.getItem('token');

			//  Only load cached logs if user is logged in
			// This prevents showing previous user's data after logout
			if (cached && token) {
				try {
					logEntries = JSON.parse(cached);
					displayLog();
				} catch (e) {
					console.error(' Failed to parse cachedLogs while showing resume modal:', e);
				}
			}

			// Show custom modal instead of confirm()
			window.__pendingDraftTrip = data;
			document.getElementById('resume-modal').style.display = 'flex';
			return;

			//  Restore draft data
			document.getElementById('log-date').value = data.date || '';
			document.getElementById('start-address').value = data.start || '';
			document.getElementById('end-address').value = data.end || '';
			document.getElementById('mpg').value = data.mpg || '';
			document.getElementById('gas-price').value = data.gas || '';
			document.getElementById('start-time').value = data.startTime || '';
			document.getElementById('end-time').value = data.endTime || '';
			document.getElementById('hours-worked').value = data.hoursWorked || '';

			// Restore maintenance items in DOMContentLoaded
			const maintenanceContainer = document.getElementById('maintenance-container');
			maintenanceContainer.innerHTML = '';
			if (data.maintenance && Array.isArray(data.maintenance)) {
				data.maintenance.forEach((item) => {
					addMaintenanceItem();
					const lastItem = maintenanceContainer.lastElementChild;
					const typeSelect = lastItem.querySelector('.maintenance-type');
					const customInput = lastItem.querySelector('.maintenance-custom-name');
					const costInput = lastItem.querySelector('.maintenance-cost');

					const presetTypes = ['Oil Change', 'Tire Rotation', 'Brake Service', 'Battery'];
					if (presetTypes.includes(item.type)) {
						typeSelect.value = item.type;
					} else {
						typeSelect.value = 'Custom';
						customInput.style.display = 'block';
						customInput.value = item.type;
					}
					costInput.value = item.cost;
				});
			}

			// Restore supplies items in DOMContentLoaded
			const suppliesContainer = document.getElementById('supplies-container');
			suppliesContainer.innerHTML = '';
			if (data.supplies && Array.isArray(data.supplies)) {
				data.supplies.forEach((item) => {
					addSupplyItem();
					const lastItem = suppliesContainer.lastElementChild;
					const typeSelect = lastItem.querySelector('.supply-type');
					const customInput = lastItem.querySelector('.supply-custom-name');
					const costInput = lastItem.querySelector('.supply-cost');

					const presetTypes = ['Poles', 'Concrete', 'Cable'];
					if (presetTypes.includes(item.type)) {
						typeSelect.value = item.type;
					} else {
						typeSelect.value = 'Custom';
						customInput.style.display = 'block';
						customInput.value = item.type;
					}
					costInput.value = item.cost;
				});
			}

			const container = document.getElementById('destinations-container');
			container.innerHTML = '';

			destinations.forEach((d, i) => {
				const div = document.createElement('div');
				div.classList.add('destination');
				div.innerHTML = `
          <label for="destination-${i + 1}">Destination ${i + 1}</label>
          <input type="text" id="destination-${i + 1}" list="recent-destinations" value="${d.address || ''}">
          <label for="earnings-${i + 1}">Earnings for Destination ${i + 1}</label>
          <input type="number" id="earnings-${i + 1}" value="${d.earnings || ''}">
          <div class="destination-actions">
            <button class="delete-btn" onclick="deleteDestination(this)">Delete</button>
            <button class="move-btn" onclick="moveDestinationUp(this)">Move Up</button>
            <button class="move-btn" onclick="moveDestinationDown(this)">Move Down</button>
          </div>
        `;
				container.appendChild(div);
				initAutocompleteDestination(div.querySelector('input[type="text"]'));
			});
		} catch (err) {
			console.error(' Failed to parse draftTrip:', err);
			localStorage.removeItem('draftTrip');
		}
	}

	// Set today's date
	const dateInput = document.getElementById('log-date');
	if (dateInput) {
		const today = new Date().toLocaleDateString('en-CA'); // format: yyyy-mm-dd
		dateInput.value = today; //  set only the date
	}

	await syncPendingLogs();

	updateAuthUI();

	logEntries = await loadLog();
	displayLog();
	initOfflineListeners();

	document.getElementById('total-hours').addEventListener('input', () => {
		const hoursWorked = parseFloat(document.getElementById('total-hours').value) || 0;

		const driveTimeInHours = convertTimeToHours(document.getElementById('total-time').textContent);

		const workedMinutes = Math.round(hoursWorked * 60);
		const driveMinutes = Math.round(driveTimeInHours * 60);
		const totalWorkedMinutes = workedMinutes + driveMinutes;

		const totalHoursDecimal = totalWorkedMinutes / 60;

		document.getElementById('total-hours').textContent = formatHoursAndMinutes(totalHoursDecimal);
	});

	//  After selecting start time, auto-focus end time after slight delay
	document.getElementById('start-time').addEventListener('change', () => {
		setTimeout(() => document.getElementById('end-time')?.focus(), 200);
	});

	updateDatalistSuggestions();
});

//  After selecting start time, auto-focus end time after slight delay
document.getElementById('start-time').addEventListener('change', () => {
	setTimeout(() => document.getElementById('end-time')?.focus(), 200);
});

function updateOfflineBanner() {
	const banner = document.getElementById('offline-banner');

	if (navigator.onLine) {
		banner.style.display = 'none'; //  Online
		syncAndReloadLogs(); //  Force refresh logs!
	} else {
		banner.style.display = 'block'; //  Offline
	}
}

async function syncAndReloadLogs() {
	try {
		console.log(' Online detected: syncing and reloading logs...');

		// First, sync any pending logs if needed
		await syncPendingLogs();

		logEntries = await loadLog();

		//  Ensure all logs have lastModified timestamp
		logEntries = logEntries.map((entry) => ({
			...entry,
			lastModified: entry.lastModified || new Date().toISOString()
		}));

		displayLog();

		console.log(' Logs refreshed after reconnecting!');
	} catch (error) {
		console.error(' Error refreshing logs:', error);
	}
}

// Call once on page load too
document.addEventListener('DOMContentLoaded', () => {});

function showConfirmationMessage(message) {
	const confirmation = document.getElementById('confirmation-message');
	if (!confirmation) return;

	confirmation.textContent = message;
	confirmation.style.display = 'block';
	setTimeout(() => {
		confirmation.style.display = 'none';
	}, 3000);
}

function initMap() {
	window.googleMapsReady = true;
	map = new google.maps.Map(document.getElementById('map'), {
		zoom: 10,
		center: { lat: 37.7749, lng: -122.4194 },
		mapTypeControl: false,
		streetViewControl: false
	});

	directionsService = new google.maps.DirectionsService();
	directionsRenderer = new google.maps.DirectionsRenderer({
		map: map,
		suppressMarkers: false
	});

	autocompleteStart = new google.maps.places.Autocomplete(
		document.getElementById('start-address'),
		{ types: ['geocode'] }
	);
	autocompleteEnd = new google.maps.places.Autocomplete(document.getElementById('end-address'), {
		types: ['geocode']
	});
	document.getElementById('start-address').addEventListener('change', resetOriginalMileageDisplay);
	document.getElementById('end-address').addEventListener('change', resetOriginalMileageDisplay);
	document.getElementById('start-time').addEventListener('change', handleTimeChange);
	document.getElementById('end-time').addEventListener('change', handleTimeChange);

	autocompleteStart.addListener('place_changed', function () {
		const place = autocompleteStart.getPlace();
		if (place.geometry) {
			document.getElementById('end-address').value = document.getElementById('start-address').value;
		} else {
			document.getElementById('start-address').value = '';
		}
	});

	const savedMpg = parseFloat(localStorage.getItem('mpg'));
	const savedGasPrice = parseFloat(localStorage.getItem('gasPrice'));
	const savedStartAddress = localStorage.getItem('startAddress');
	const savedEndAddress = localStorage.getItem('endAddress');

	if (!isNaN(savedMpg)) {
		document.getElementById('mpg').value = savedMpg;
	}

	if (!isNaN(savedGasPrice)) {
		document.getElementById('gas-price').value = savedGasPrice;
	}

	if (savedStartAddress && typeof savedStartAddress === 'string') {
		document.getElementById('start-address').value = savedStartAddress;
	}

	if (savedEndAddress && typeof savedEndAddress === 'string') {
		document.getElementById('end-address').value = savedEndAddress;
	}

	// Initialize autocomplete for the initial destination
	document
		.querySelectorAll('#destinations-container .destination input[type="text"]')
		.forEach(initAutocompleteDestination);

	displayLog();
}

window.initMap = initMap;

function initAutocompleteDestination(inputElement) {
	const autocomplete = new google.maps.places.Autocomplete(inputElement, {
		types: ['geocode']
	});
}

async function calculateRoute() {
	const destinationInputs = document.querySelectorAll('input[id^="destination-"]');
	const filledDestinations = Array.from(destinationInputs).filter(
		(input) => input.value.trim() !== ''
	);
	if (filledDestinations.length === 0) {
		showAlertModal(' Please enter at least one destination before calculating your route.');
		return;
	}

	const calculationResult = await calculateRouteData();
	if (calculationResult) {
		updateUI(calculationResult);
		showConfirmationMessage(' Route calculated successfully!');

		//  Scroll to map
		document.getElementById('map')?.scrollIntoView({ behavior: 'smooth' });
	}
}

async function calculateRouteData() {
	const container = document.getElementById('destinations-container');
	const allDestinations = container.querySelectorAll('.destination');

	allDestinations.forEach((div) => {
		const addressInput = div.querySelector('input[id^="destination-"]');
		if (!addressInput || addressInput.value.trim() === '') {
			div.remove();
		}
	});
	renumberMainDestinations();

	const startAddress = document.getElementById('start-address').value;
	const endAddress = document.getElementById('end-address').value;
	const mpg = parseFloat(document.getElementById('mpg').value);
	const gasPrice = parseFloat(document.getElementById('gas-price').value);
	const startTimeInput = document.getElementById('start-time').value;
	const endTimeInput = document.getElementById('end-time').value;

	let hoursWorked = 0;

	if (startTimeInput && endTimeInput) {
		const [startHours, startMinutes] = startTimeInput.split(':').map(Number);
		const [endHours, endMinutes] = endTimeInput.split(':').map(Number);

		let startTotalMinutes = startHours * 60 + startMinutes;
		let endTotalMinutes = endHours * 60 + endMinutes;
		if (endTotalMinutes < startTotalMinutes) endTotalMinutes += 24 * 60;

		const totalWorkedMinutes = endTotalMinutes - startTotalMinutes;
		hoursWorked = totalWorkedMinutes / 60;

		document.getElementById('total-hours').value = formatHoursAndMinutes(hoursWorked);
	}

	const maintenanceCost = getTotalMaintenanceCost();
	const suppliesCost = getTotalSuppliesCost();

	saveUserInputsToLocalStorage({ mpg, gasPrice, startAddress, endAddress });

	const destInputs = document.querySelectorAll('input[id^="destination-"]');
	const earningsInputs = document.querySelectorAll('input[id^="earnings-"]');
	const destinations = Array.from(destInputs).map((input) => ({
		location: input.value,
		stopover: true
	}));
	saveRecentDestinations(destinations.map((d) => d.location));
	updateDatalistSuggestions();

	const earnings = Array.from(earningsInputs).map((input) => parseFloat(input.value) || 0);
	const totalEarnings = earnings.reduce((sum, val) => sum + val, 0);

	const request = {
		origin: startAddress,
		destination: endAddress || destinations[destinations.length - 1]?.location || startAddress,
		waypoints: destinations,
		travelMode: 'DRIVING'
	};

	const logDateInput = document.getElementById('log-date').value;
	const selectedDate = logDateInput || new Date().toISOString().split('T')[0];

	if (!navigator.onLine) {
		showAlertModal(" You're offline. Route calculation is unavailable until you're reconnected.");
		return Promise.resolve(null);
	}

	return new Promise((resolve, reject) => {
		directionsService.route(request, (response, status) => {
			if (status === 'OK') {
				directionsRenderer.setDirections(response);
				document.getElementById('map').classList.remove('hidden');

				let totalMileage = 0;
				let totalDuration = 0;

				response.routes[0].legs.forEach((leg) => {
					totalMileage += leg.distance.value / 1609.34;
					totalDuration += leg.duration.value;
				});

				const fuelCost = mpg && gasPrice ? (totalMileage / mpg) * gasPrice : 0;
				const netProfitBeforeOptional = totalEarnings - fuelCost;
				const netProfit = netProfitBeforeOptional - maintenanceCost - suppliesCost;
				const totalHoursSpent = hoursWorked;
				const profitPerHour = totalHoursSpent > 0 ? netProfit / totalHoursSpent : 0;

				resolve({
					date: selectedDate,
					startTime: startAddress,
					endTime: endAddress,
					startClock: startTimeInput,
					endClock: endTimeInput,
					destinations: destinations.map((d) => d.location),
					earnings: earnings,
					totalMileage: totalMileage.toFixed(2),
					totalTime: formatDuration(totalDuration),
					totalEarnings: totalEarnings.toFixed(2),
					fuelCost: fuelCost.toFixed(2),
					maintenanceCost: maintenanceCost.toFixed(2),
					suppliesCost: suppliesCost.toFixed(2),
					netProfit: netProfit.toFixed(2),
					profitPerHour: profitPerHour.toFixed(2),
					hoursWorked: hoursWorked
				});
			} else {
				showAlertModal(' Directions request failed due to: ' + status);
				document.getElementById('map').classList.add('hidden');
				document.getElementById('results').classList.add('hidden');
				resolve(null);
			}
		});
	});
}

function updateUI(data) {
	if (data) {
		document.getElementById('total-mileage').textContent = data.totalMileage;
		document.getElementById('total-time').textContent = data.totalTime;
		document.getElementById('total-earnings').textContent = data.totalEarnings;
		document.getElementById('fuel-cost').textContent = data.fuelCost;
		document.getElementById('maintenance-cost-result').textContent = data.maintenanceCost;
		document.getElementById('supplies-cost-result').textContent = data.suppliesCost;
		document.getElementById('net-profit').textContent = data.netProfit;
		document.getElementById('profit-per-hour').textContent = data.profitPerHour;
		document.getElementById('results').classList.remove('hidden');
		const start = data.startClock;
		const end = data.endClock;

		let totalMinutes = 0;
		if (start && end && start.includes(':') && end.includes(':')) {
			const [sh, sm] = start.split(':').map(Number);
			const [eh, em] = end.split(':').map(Number);
			let startMin = sh * 60 + sm;
			let endMin = eh * 60 + em;
			if (endMin < startMin) endMin += 24 * 60;
			totalMinutes = endMin - startMin;
		}

		const totalH = Math.floor(totalMinutes / 60);
		const totalM = totalMinutes % 60;
		const hourText = `${totalH} hour${totalH !== 1 ? 's' : ''}`;
		const minuteText = totalM > 0 ? ` ${totalM} minute${totalM !== 1 ? 's' : ''}` : '';
		document.getElementById('total-hours').textContent = `${hourText}${minuteText}`;

		if (originalMileage === null) {
			originalMileage = data.totalMileage;
		}
		document.getElementById('mileage-display').textContent =
			'Original Route: ' + originalMileage + ' miles';

		//  Add the new detailed display below the map
		const detailedResultsHTML = `
  <h3>Route Details</h3>
  <p><strong>Date:</strong> ${data.date}</p>
  <p><strong>Start Address:</strong> ${data.startTime}</p>
  <p><strong>Destinations:</strong><br>${data.destinations.map((d) => `- ${d}`).join('<br>')}</p>
  <p><strong>End Address:</strong> ${data.endTime}</p>
  <p><strong>Earnings per Stop:</strong> ${data.earnings.map((e) => `$${parseFloat(e).toFixed(2)}`).join(', ')}</p>
  <p><strong>Mileage:</strong> ${data.totalMileage} miles</p>
  <p><strong>Drive Time:</strong> ${data.totalTime}</p>
  <p><strong>Total Earnings:</strong> $${data.totalEarnings}</p>
  <p><strong>Fuel Cost:</strong> $${data.fuelCost}</p>
  <p><strong>Maintenance:</strong> $${data.maintenanceCost}</p>
  <p><strong>Supplies:</strong> $${data.suppliesCost}</p>
  <p><strong>Hours Worked:</strong> ${(() => {
		const totalClockMinutes = (() => {
			const start = data.startClock;
			const end = data.endClock;
			if (!start || !end) return 0;
			const [sh, sm] = start.split(':').map(Number);
			const [eh, em] = end.split(':').map(Number);
			let startMin = sh * 60 + sm;
			let endMin = eh * 60 + em;
			if (endMin < startMin) endMin += 24 * 60;
			return endMin - startMin;
		})();

		const driveMinutes = convertTimeToMinutes(data.totalTime || '');
		const workedMinutes = Math.max(totalClockMinutes - driveMinutes, 0);
		return formatHoursAndMinutesFromMinutes(workedMinutes);
	})()}</p>

<p><strong>Total Hours:</strong> ${(() => {
			const start = data.startClock;
			const end = data.endClock;
			let totalMinutes = 0;
			if (start && end && start.includes(':') && end.includes(':')) {
				const [sh, sm] = start.split(':').map(Number);
				const [eh, em] = end.split(':').map(Number);
				let startMin = sh * 60 + sm;
				let endMin = eh * 60 + em;
				if (endMin < startMin) endMin += 24 * 60;
				totalMinutes = endMin - startMin;
			}
			return formatHoursAndMinutesFromMinutes(totalMinutes);
		})()}</p>


  <p><strong>Net Profit:</strong> $${data.netProfit}</p>
  <p><strong>Profit per Hour:</strong> $${data.profitPerHour}</p>
`;

		document.getElementById('detailed-results').innerHTML = detailedResultsHTML;
	}
}

function openInGoogleMaps() {
	const start = encodeURIComponent(document.getElementById('start-address').value.trim());
	const endAddressInput = document.getElementById('end-address').value.trim();

	const allDestinations = Array.from(document.querySelectorAll('input[id^="destination-"]'))
		.map((input) => input.value.trim())
		.filter((dest) => dest.length > 0);

	const end = encodeURIComponent(
		endAddressInput || allDestinations[allDestinations.length - 1] || start
	);

	//  Don't duplicate end address inside destinations
	const destinations = allDestinations.filter((dest) => dest !== endAddressInput);

	//  Now build the URL
	let url = `https://www.google.com/maps/dir/?api=1&origin=${start}&destination=${end}`;

	if (destinations.length > 0) {
		url += `&waypoints=${destinations.map(encodeURIComponent).join('|')}`;
	}

	window.open(url, '_blank');
}

function resetOriginalMileageDisplay() {
	if (originalMileage === null) return; // Already reset  no need to do anything

	originalMileage = null;
	document.getElementById('mileage-display').textContent = '';
	document.getElementById('optimized-mileage-display').textContent = '';
}
async function logResults() {
	//  Check for at least one destination
	const destinationInputs = document.querySelectorAll('input[id^="destination-"]');
	const filledDestinations = Array.from(destinationInputs).filter(
		(input) => input.value.trim() !== ''
	);
	if (filledDestinations.length === 0) {
		showAlertModal(' Please enter at least one destination before logging your route.');
		return;
	}

	//  Get calculation result
	const calculationResult = await calculateRouteData();
	if (calculationResult) {
		currentPage = 1;
		logEntry(calculationResult);
		displayLog();
		updateUI(calculationResult);
		clearTripForm(); //  Reset the form
		showConfirmationMessage(' Route logged successfully!');
	}
}

async function optimizeRoute() {
	const destInputs = document.querySelectorAll(
		'#destinations-container .destination input[type="text"]'
	);
	const currentDestinations = Array.from(destInputs)
		.map((input) => input.value.trim())
		.filter((value) => value !== '');

	if (currentDestinations.length < 2) {
		showAlertModal(' Please add at least two destinations to optimize the route.');
		return;
	}

	if (originalMileage === null) {
		const result = await calculateRouteData();
		if (result && result.totalMileage) {
			originalMileage = parseFloat(result.totalMileage);
			document.getElementById('mileage-display').textContent =
				'Original Route: ' + originalMileage.toFixed(2) + ' miles';
		}
	}

	if (originalMileage === null) {
		await calculateRouteData();
	}

	const startAddress = document.getElementById('start-address').value;
	const endAddress = document.getElementById('end-address').value;

	const waypoints = currentDestinations.map((location) => ({
		location,
		stopover: true
	}));

	const request = {
		origin: startAddress,
		destination: endAddress,
		waypoints,
		travelMode: 'DRIVING',
		optimizeWaypoints: true
	};

	directionsService.route(request, (response, status) => {
		if (status === 'OK' && response.routes[0].waypoint_order) {
			const optimizedOrder = response.routes[0].waypoint_order;
			const newDestinationsContainer = document.createElement('div');
			newDestinationsContainer.id = 'destinations-container';

			optimizedOrder.forEach((index, i) => {
				const originalDiv = destInputs[index].closest('.destination');
				const clone = originalDiv.cloneNode(true);

				const destInput = clone.querySelector('input[id^="destination-"]');
				const earningsInput = clone.querySelector('input[id^="earnings-"]');
				const destLabel = clone.querySelector('label[for^="destination-"]');
				const earningsLabel = clone.querySelector('label[for^="earnings-"]');
				const newIndex = i + 1;

				if (destLabel) destLabel.setAttribute('for', `destination-${newIndex}`);
				if (destInput) destInput.id = `destination-${newIndex}`;
				if (earningsLabel) earningsLabel.setAttribute('for', `earnings-${newIndex}`);
				if (earningsInput) earningsInput.id = `earnings-${newIndex}`;

				newDestinationsContainer.appendChild(clone);
			});

			const oldContainer = document.getElementById('destinations-container');
			oldContainer.parentNode.replaceChild(newDestinationsContainer, oldContainer);

			document
				.querySelectorAll('#destinations-container .destination input[type="text"]')
				.forEach(initAutocompleteDestination);
			directionsRenderer.setDirections(response);

			let optimizedMileage = 0;
			let totalDuration = 0;
			response.routes[0].legs.forEach((leg) => {
				optimizedMileage += leg.distance.value / 1609.34;
				totalDuration += leg.duration.value;
			});

			document.getElementById('optimized-mileage-display').textContent =
				'Optimized Route: ' + optimizedMileage.toFixed(2) + ' miles';
			document.getElementById('total-time').textContent = formatDuration(totalDuration);

			//  CALCULATE hoursWorked from start/end minus drive time
			const startClock = document.getElementById('start-time').value;
			const endClock = document.getElementById('end-time').value;
			let hoursWorked = 0;

			if (startClock && endClock && startClock.includes(':') && endClock.includes(':')) {
				const [sh, sm] = startClock.split(':').map(Number);
				const [eh, em] = endClock.split(':').map(Number);
				let startMin = sh * 60 + sm;
				let endMin = eh * 60 + em;
				if (endMin < startMin) endMin += 1440;

				const totalMinutes = endMin - startMin;
				const driveMinutes = totalDuration / 60;
				const workedMinutes = Math.max(totalMinutes - driveMinutes, 0);
				hoursWorked = workedMinutes / 60;
				document.getElementById('total-hours').value = formatHoursAndMinutes(hoursWorked);
			}

			const earnings = Array.from(document.querySelectorAll('input[id^="earnings-"]')).map(
				(i) => parseFloat(i.value) || 0
			);
			const totalEarnings = earnings.reduce((a, b) => a + b, 0);
			const mpg = parseFloat(document.getElementById('mpg').value || 1);
			const gasPrice = parseFloat(document.getElementById('gas-price').value || 0);
			const maintenance = parseFloat(document.getElementById('maintenance-cost').value || 0);
			const supplies = parseFloat(document.getElementById('supplies-cost').value || 0);

			const fuelCost = (optimizedMileage / mpg) * gasPrice;
			const netProfit = totalEarnings - fuelCost - maintenance - supplies;
			const totalHours = hoursWorked;
			const profitPerHour = totalHours > 0 ? netProfit / totalHours : 0;

			const optimizedData = {
				date: document.getElementById('log-date').value || new Date().toISOString().split('T')[0],
				startTime: startAddress,
				endTime: endAddress,
				startClock,
				endClock,
				destinations: Array.from(document.querySelectorAll('input[id^="destination-"]')).map(
					(input) => input.value
				),
				earnings,
				totalMileage: optimizedMileage.toFixed(2),
				totalTime: formatDuration(totalDuration),
				totalEarnings: totalEarnings.toFixed(2),
				fuelCost: fuelCost.toFixed(2),
				maintenanceCost: maintenance.toFixed(2),
				suppliesCost: supplies.toFixed(2),
				hoursWorked: hoursWorked,
				netProfit: netProfit.toFixed(2),
				profitPerHour: profitPerHour.toFixed(2)
			};

			updateUI(optimizedData);
			showConfirmationMessage(' Route optimized successfully!');

			//  Scroll to map after optimization
			document.getElementById('map')?.scrollIntoView({ behavior: 'smooth' });
		} else if (status === 'OK') {
			directionsRenderer.setDirections(response);
		} else {
			showAlertModal(' Could not optimize route due to: ' + status);
		}
	});
}

function formatDuration(seconds) {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainingSeconds = seconds % 60;
	let formattedString = '';
	if (hours > 0) {
		formattedString += `${hours} hour${hours > 1 ? 's' : ''} `;
	}
	if (minutes > 0) {
		formattedString += `${minutes} minute${minutes > 1 ? 's' : ''} `;
	}
	if (hours === 0 && minutes === 0) {
		formattedString += `${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
	}
	return formattedString.trim();
}

function addDestination() {
	const newDestinationIndex =
		document.querySelectorAll('#destinations-container .destination').length + 1;
	const container = document.getElementById('destinations-container');
	const newDestinationDiv = document.createElement('div');
	newDestinationDiv.classList.add('destination');
	newDestinationDiv.innerHTML = `
    <label for="destination-${newDestinationIndex}">Destination ${newDestinationIndex}</label>
   <input type="text" id="destination-${newDestinationIndex}" list="recent-destinations" placeholder="Enter destination address" required>

    <label for="earnings-${newDestinationIndex}">Earnings for Destination ${newDestinationIndex}</label>
    <input type="number" id="earnings-${newDestinationIndex}" placeholder="Enter earnings for destination" required>
    <div class="destination-actions">
        <button class="delete-btn" onclick="deleteDestination(this)">Delete</button>
        <button class="move-btn" onclick="moveDestinationUp(this)">Move Up</button>
        <button class="move-btn" onclick="moveDestinationDown(this)">Move Down</button>
    </div>
`;
	container.appendChild(newDestinationDiv);
	initAutocompleteDestination(newDestinationDiv.querySelector('input[type="text"]'));
	resetOriginalMileageDisplay();
	renumberMainDestinations();
}

function deleteDestination(button) {
	button.closest('.destination').remove();
	resetOriginalMileageDisplay();
	renumberMainDestinations();
}

function moveDestinationUp(button) {
	const destinationDiv = button.closest('.destination');
	const prevDiv = destinationDiv.previousElementSibling;
	if (prevDiv) {
		destinationDiv.parentNode.insertBefore(destinationDiv, prevDiv);
		resetOriginalMileageDisplay();
		renumberMainDestinations();
	}
}

function moveDestinationDown(button) {
	const destinationDiv = button.closest('.destination');
	const nextDiv = destinationDiv.nextElementSibling;
	if (nextDiv) {
		destinationDiv.parentNode.insertBefore(nextDiv, destinationDiv);
		resetOriginalMileageDisplay();
		renumberMainDestinations();
	}
}

function logEntry(data) {
	disableAutoSave = true;

	data.startClock = document.getElementById('start-time').value || '';
	data.endClock = document.getElementById('end-time').value || '';
	data.hoursWorked = parseFloat(document.getElementById('total-hours').value) || 0;

	data.mpg = parseFloat(document.getElementById('mpg').value) || 0;
	data.gasPrice = parseFloat(document.getElementById('gas-price').value) || 0;
	data.lastModified = new Date().toISOString();
	data.notes = document.getElementById('log-notes')?.value || '';
	data.maintenance = getMaintenanceData();
	data.supplies = getSuppliesData();

	//  Calculate total time from start and end clock times
	const start = document.getElementById('start-time').value;
	const end = document.getElementById('end-time').value;
	let totalHours = 0;

	if (start && end) {
		const [sh, sm] = start.split(':').map(Number);
		const [eh, em] = end.split(':').map(Number);
		let startMin = sh * 60 + sm;
		let endMin = eh * 60 + em;
		if (endMin < startMin) endMin += 24 * 60; // handle overnight
		totalHours = (endMin - startMin) / 60;
	}

	//  Use total session time for profitPerHour
	const netProfitFloat = parseFloat(data.netProfit || 0);
	data.profitPerHour = totalHours > 0 ? (netProfitFloat / totalHours).toFixed(2) : '0.00';

	data.netProfit = netProfitFloat.toFixed(2);

	localStorage.removeItem('draftTrip');
	logEntries.unshift(data);
	saveLog();

	setTimeout(() => {
		disableAutoSave = false;
	}, 1000);
}

function displayLog(filterFn = () => true) {
	const logList = document.getElementById('log-list');
	const organizedLog = organizeLogByDay();
	logList.innerHTML = '';

	const allEntries = [];
	for (const day in organizedLog) {
		allEntries.push(...organizedLog[day]);
	}

	const sortedEntries = allEntries.sort((a, b) => {
		return new Date(b.date) - new Date(a.date);
	});

	const filteredEntries = sortedEntries.filter(
		(entry) => entry?.date && filterFn(entry.date, entry)
	);

	const totalPages = Math.ceil(filteredEntries.length / logsPerPage);

	const start = (currentPage - 1) * logsPerPage;
	const end = start + logsPerPage;
	const pageEntries = filteredEntries.slice(start, end);

	if (pageEntries.length === 0) {
		const emptyMessage = document.createElement('li');
		emptyMessage.textContent = 'No log entries found for selected filter.';
		logList.appendChild(emptyMessage);
	} else {
		pageEntries.forEach((entry, index) => {
			if (entry) {
				const realIndex = logEntries.findIndex((e) => JSON.stringify(e) === JSON.stringify(entry));
				const listItem = document.createElement('li');
				const destinations = Array.isArray(entry.destinations)
					? entry.destinations.map((d) => `- ${d}`).join('<br>')
					: '';

				listItem.innerHTML = `
  <div class="log-item-details" id="log-entry-${realIndex}">
    <div id="summary-${realIndex}">
      <strong>Date:</strong> ${entry.date}<br>
<div><strong>Destinations:</strong><br>
  <div style="margin-left: 20px;">
    ${(entry.destinations || []).map((dest) => `- ${dest}`).join('<br>')}
  </div>
</div>


      <strong>Net Profit:</strong> $${parseFloat(entry.netProfit || 0).toFixed(2)}
    </div>
    <div id="details-${realIndex}" class="hidden" style="margin-top:10px;"></div>
  </div>
  <div class="log-actions">
    <button onclick="toggleLogEntryDetails(${realIndex})" id="toggle-button-${realIndex}">More Details</button>
    <button class="edit-btn" onclick="openEditForm(${realIndex})">Edit</button>
    <button onclick="openLogEntryInGoogleMaps(${realIndex})">Map</button>

    <button onclick="deleteLogEntry(${realIndex})">Delete</button>
    
  </div>
`;

				logList.appendChild(listItem);
			}
		});
	}

	renderPaginationButtons(totalPages);
	updateLogSummary(filterFn);
}

function renderPaginationButtons(totalPages) {
	let paginationContainer = document.getElementById('pagination-controls');
	if (!paginationContainer) {
		paginationContainer = document.createElement('div');
		paginationContainer.id = 'pagination-controls';
		paginationContainer.style.textAlign = 'center';
		paginationContainer.style.marginTop = '20px';
		document.getElementById('log-container').appendChild(paginationContainer);
	}

	paginationContainer.innerHTML = `
    <div style="margin-bottom: 10px; font-size: 18px;">
      Page ${currentPage} of ${totalPages}
    </div>
    <div style="display: flex; justify-content: center; gap: 10px; margin-bottom: 10px;">
      <button onclick="prevPage()" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
      <button onclick="nextPage()" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>
    </div>
    <div style="margin-top: 10px;">
      Go to Page: 
      <input type="number" id="page-input" min="1" max="${totalPages}" value="${currentPage}" style="width: 60px; text-align: center;">
      <button onclick="goToPage(${totalPages})">Go</button>
    </div>
  `;
}

function prevPage() {
	if (currentPage > 1) {
		currentPage--;
		displayLog();
		document.getElementById('log-container').scrollIntoView({ behavior: 'smooth' });
	}
}

function nextPage() {
	const totalPages = Math.ceil(logEntries.length / logsPerPage);
	if (currentPage < totalPages) {
		currentPage++;
		displayLog();
		document.getElementById('log-container').scrollIntoView({ behavior: 'smooth' });
	}
}

function goToPage(totalPages) {
	const input = document.getElementById('page-input');
	const page = parseInt(input.value);

	if (!isNaN(page) && page >= 1 && page <= totalPages) {
		currentPage = page;
		displayLog();
		document.getElementById('log-container').scrollIntoView({ behavior: 'smooth' });
	} else {
		showAlertModal(' Invalid page number.');
	}
}

function deleteLogEntry(index) {
	showConfirmModal('Are you sure you want to delete this log entry?', () => {
		logEntries.splice(index, 1);
		saveLog();
		filterLogs();
	});
}

function organizeLogByDay() {
	const logByDay = {};

	logEntries.forEach((entry) => {
		if (!entry?.date) return;
		if (!logByDay[entry.date]) {
			logByDay[entry.date] = [];
		}
		logByDay[entry.date].push(entry);
	});

	return logByDay;
}

function closeEditForm() {
	console.log('closeEditForm function called');
	document.getElementById('edit-form-container').style.display = 'none';
	document.getElementById('overlay').style.display = 'none';

	// Restore regular bottom bar
	document.getElementById('bottom-bar').style.display = 'flex';
	document.getElementById('edit-bottom-bar').style.display = 'none';

	editingIndex = -1;
}

function updateEditTotalEarnings() {
	let total = 0;
	const editEarningsInputs = document.querySelectorAll(
		'#edit-destinations-container input[id^="edit-earnings-"]'
	);
	editEarningsInputs.forEach((input) => {
		total += parseFloat(input.value) || 0;
	});
	document.getElementById('edit-total-earnings').value = total.toFixed(2);
}

function updateEditFuelCost() {
	const mileage = parseFloat(document.getElementById('edit-total-mileage').value) || 0;
	const mpg = parseFloat(document.getElementById('edit-mpg').value) || 1; // Prevent division by zero
	const gasPrice = parseFloat(document.getElementById('edit-gas-price').value) || 0;
	const fuelCost = (mileage / mpg) * gasPrice;
	document.getElementById('edit-fuel-cost').value = fuelCost.toFixed(2);
}

function recalculateEditMileageAndCosts() {
	const start = document.getElementById('edit-start-address').value.trim();
	const end = document.getElementById('edit-end-address').value.trim();
	const destInputs = document.querySelectorAll(
		'#edit-destinations-container input[id^="edit-destination-"]'
	);

	const destinations = Array.from(destInputs)
		.filter((input) => input.value.trim())
		.map((input) => ({
			location: input.value.trim(),
			stopover: true
		}));

	if (
		!start ||
		!end ||
		destinations.length !== destInputs.length ||
		destinations.some((d) => !d.location)
	) {
		console.warn(
			' Missing or invalid start, end, or destination address  skipping route calculation.'
		);
		return;
	}

	const request = {
		origin: start,
		destination: end,
		waypoints: destinations,
		travelMode: 'DRIVING'
	};

	directionsService.route(request, (response, status) => {
		if (status === 'OK') {
			let totalMileage = 0;
			let totalDuration = 0;
			response.routes[0].legs.forEach((leg) => {
				totalMileage += leg.distance.value / 1609.34;
				totalDuration += leg.duration.value;
			});

			const mileageInput = document.getElementById('edit-total-mileage');
			const timeInput = document.getElementById('edit-total-time');

			console.log('Updating:', {
				mileageInput,
				timeInput,
				totalMileage: totalMileage.toFixed(2),
				formattedTime: formatDuration(totalDuration)
			});

			if (mileageInput) mileageInput.value = totalMileage.toFixed(2);
			if (timeInput) timeInput.value = formatDuration(totalDuration);

			updateEditFuelCost();
		} else if (status === 'ZERO_RESULTS') {
			showAlertModal(
				' No route could be found between the entered locations. Please double-check the addresses.'
			);
		} else {
			console.error('Mileage error:', status);
		}
	});
}

function moveEditDestinationUp(button) {
	const destinationDiv = button.closest('.destination');
	const prevDiv = destinationDiv.previousElementSibling;
	if (prevDiv) {
		destinationDiv.parentNode.insertBefore(destinationDiv, prevDiv);
		resetOriginalMileageDisplay();
		reinitializeEditDestination(destinationDiv);
		renumberEditDestinations();
		recalculateEditMileageAndCosts(); //  added
	}
}

function moveEditDestinationDown(button) {
	const destinationDiv = button.closest('.destination');
	const nextDiv = destinationDiv.nextElementSibling;
	if (nextDiv) {
		destinationDiv.parentNode.insertBefore(nextDiv, destinationDiv);
		resetOriginalMileageDisplay();
		reinitializeEditDestination(destinationDiv);
		renumberEditDestinations();
		recalculateEditMileageAndCosts(); //  added
	}
}

function reinitializeEditDestination(destinationDiv) {
	const addressInput = destinationDiv.querySelector('input[type="text"]');
	if (!addressInput) return;

	//  Recreate autocomplete
	const autocomplete = new google.maps.places.Autocomplete(addressInput, {
		types: ['geocode']
	});

	//  Trigger on selection from dropdown
	autocomplete.addListener('place_changed', recalculateEditMileageAndCosts);

	//  Trigger when user leaves input field
	addressInput.addEventListener('blur', () => {
		// Slight delay to allow autocomplete to trigger first (if applicable)
		setTimeout(recalculateEditMileageAndCosts, 100);
	});

	//  Trigger when Enter is pressed
	addressInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault(); // prevent form submission
			recalculateEditMileageAndCosts();

			const allDestInputs = document.querySelectorAll(
				'#edit-destinations-container input[type="text"]'
			);
			if (addressInput === allDestInputs[allDestInputs.length - 1]) {
				addEditDestination(); // add another one if last
			}
		}
	});
}

function renumberEditDestinations() {
	const destinationDivs = document.querySelectorAll('#edit-destinations-container .destination');

	destinationDivs.forEach((div, index) => {
		const destNum = index + 1;
		const label = div.querySelector('label[for^="edit-destination-"]');
		const earningsLabel = div.querySelector('label[for^="edit-earnings-"]');
		const addressInput = div.querySelector('input[type="text"]');
		const earningsInput = div.querySelector('input[type="number"]');

		if (label) {
			label.textContent = `Destination ${destNum}`;
			label.setAttribute('for', `edit-destination-${destNum}`);
		}

		if (earningsLabel) {
			earningsLabel.textContent = `Earnings ${destNum}`;
			earningsLabel.setAttribute('for', `edit-earnings-${destNum}`);
		}

		if (addressInput) {
			addressInput.id = `edit-destination-${destNum}`;
		}

		if (earningsInput) {
			earningsInput.id = `edit-earnings-${destNum}`;
		}
	});
}

function addEditDestination() {
	const container = document.getElementById('edit-destinations-container');

	const destDiv = document.createElement('div');
	destDiv.classList.add('destination');

	destDiv.innerHTML = `
    <label for="edit-destination-temp">Destination</label>
    <input type="text" id="edit-destination-temp" list="recent-destinations" placeholder="Enter destination address">

    <label for="edit-earnings-temp">Earnings</label>
    <input type="number" id="edit-earnings-temp" placeholder="Enter earnings">

    <div class="destination-actions">
      <button type="button" class="delete-btn" onclick="deleteEditDestination(this)">Delete</button>
      <button type="button" class="move-btn" onclick="moveEditDestinationUp(this)">Move Up</button>
      <button type="button" class="move-btn" onclick="moveEditDestinationDown(this)">Move Down</button>
    </div>
  `;

	container.appendChild(destDiv);

	renumberEditDestinations();
	reinitializeEditDestination(destDiv);

	//  Add listener to update total earnings
	const earningsInput = destDiv.querySelector('input[type="number"]');
	if (earningsInput) {
		earningsInput.addEventListener('input', updateEditTotalEarnings);
	}
}

function deleteEditDestination(button) {
	const destinationDiv = button.closest('.destination');
	if (destinationDiv) {
		destinationDiv.remove();
		renumberEditDestinations(); //  Use shared function
		updateEditTotalEarnings(); //  Optional if you're tracking per stop
		resetOriginalMileageDisplay();
		recalculateEditMileageAndCosts();
	}
}

function openEditForm(index) {
	console.log(' Opening edit for index:', index);
	editingIndex = index;
	const entry = logEntries[index];

	if (!entry) {
		console.error(' No entry found for editing');
		alert('Error: Entry not found');
		return;
	}

	const editFormContainer = document.getElementById('edit-form-container');
	const overlay = document.getElementById('overlay');

	//  Helper to safely set input values
	function setInputValue(id, value) {
		const input = document.getElementById(id);
		if (input) input.value = value ?? '';
	}

	//  Populate all form fields safely
	setInputValue('edit-date', entry.date);
	setInputValue('edit-start-address', entry.startTime);
	setInputValue('edit-end-address', entry.endTime);
	setInputValue('edit-start-time', entry.startClock ?? '');
	setInputValue('edit-end-time', entry.endClock ?? '');
	setInputValue('edit-total-earnings', entry.totalEarnings);
	setInputValue('edit-fuel-cost', entry.fuelCost);

	// Populate maintenance items
	const editMaintenanceContainer = document.getElementById('edit-maintenance-container');
	editMaintenanceContainer.innerHTML = '';
	if (entry.maintenance && Array.isArray(entry.maintenance)) {
		entry.maintenance.forEach((item) => {
			addEditMaintenanceItem();
			const lastItem = editMaintenanceContainer.lastElementChild;
			const typeSelect = lastItem.querySelector('.maintenance-type');
			const customInput = lastItem.querySelector('.maintenance-custom-name');
			const costInput = lastItem.querySelector('.maintenance-cost');

			const presetTypes = ['Oil Change', 'Tire Rotation', 'Brake Service', 'Battery'];
			const customTypes = getCustomMaintenanceTypes();

			if (!presetTypes.includes(item.type) && !customTypes.includes(item.type)) {
				saveCustomMaintenanceType(item.type);
				const option = document.createElement('option');
				option.value = item.type;
				option.textContent = item.type;
				const customOption = typeSelect.querySelector('option[value="Custom"]');
				typeSelect.insertBefore(option, customOption);
			}

			if (
				presetTypes.includes(item.type) ||
				customTypes.includes(item.type) ||
				typeSelect.querySelector(`option[value="${item.type}"]`)
			) {
				typeSelect.value = item.type;
			} else {
				typeSelect.value = 'Custom';
				customInput.style.display = 'block';
				customInput.value = item.type;
			}
			costInput.value = item.cost;
		});
	}

	// Populate supplies items
	const editSuppliesContainer = document.getElementById('edit-supplies-container');
	editSuppliesContainer.innerHTML = '';
	if (entry.supplies && Array.isArray(entry.supplies)) {
		entry.supplies.forEach((item) => {
			addEditSupplyItem();
			const lastItem = editSuppliesContainer.lastElementChild;
			const typeSelect = lastItem.querySelector('.supply-type');
			const customInput = lastItem.querySelector('.supply-custom-name');
			const costInput = lastItem.querySelector('.supply-cost');

			const presetTypes = ['Poles', 'Concrete', 'Cable'];
			const customTypes = getCustomSupplyTypes();

			// If it's not a preset and not in saved custom types, add it
			if (!presetTypes.includes(item.type) && !customTypes.includes(item.type)) {
				saveCustomSupplyType(item.type);
				// Add to this dropdown
				const option = document.createElement('option');
				option.value = item.type;
				option.textContent = item.type;
				const customOption = typeSelect.querySelector('option[value="Custom"]');
				typeSelect.insertBefore(option, customOption);
			}

			// Select the type
			if (
				presetTypes.includes(item.type) ||
				customTypes.includes(item.type) ||
				typeSelect.querySelector(`option[value="${item.type}"]`)
			) {
				typeSelect.value = item.type;
			} else {
				typeSelect.value = 'Custom';
				customInput.style.display = 'block';
				customInput.value = item.type;
			}
			costInput.value = item.cost;
		});
	}

	setInputValue('edit-total-mileage', entry.totalMileage);
	setInputValue('edit-total-time', entry.totalTime);
	setInputValue('edit-hours-worked', entry.hoursWorked ?? 0);
	setInputValue('edit-mpg', entry.mpg);
	setInputValue('edit-gas-price', entry.gasPrice);
	setInputValue('edit-notes', entry.notes || '');

	const destinationsContainer = document.getElementById('edit-destinations-container');
	if (destinationsContainer) {
		destinationsContainer.innerHTML = '';

		entry.destinations.forEach((destination, i) => {
			const destDiv = document.createElement('div');
			destDiv.className = 'destination';
			destDiv.innerHTML = `
        <label for="edit-destination-${i + 1}">Destination ${i + 1}</label>
        <input type="text" id="edit-destination-${i + 1}" list="recent-destinations" value="${destination}">

        <label for="edit-earnings-${i + 1}">Earnings for Destination ${i + 1}</label>
        <input type="number" id="edit-earnings-${i + 1}" value="${entry.earnings[i] || 0}">
        <div class="destination-actions">
          <button type="button" class="delete-btn" onclick="deleteEditDestination(this)">Delete</button>
          <button type="button" class="move-btn" onclick="moveEditDestinationUp(this)">Move Up</button>
          <button type="button" class="move-btn" onclick="moveEditDestinationDown(this)">Move Down</button>
        </div>
      `;
			destinationsContainer.appendChild(destDiv);
			reinitializeEditDestination(destDiv);
			setTimeout(() => {
				document
					.querySelectorAll('#edit-destinations-container input[id^="edit-earnings-"]')
					.forEach((input) => {
						input.addEventListener('input', updateEditTotalEarnings);
					});
			}, 0);
		});
	}

	//  Show Edit form
	if (editFormContainer && overlay) {
		editFormContainer.style.display = 'block';
		overlay.style.display = 'block';

		// Switch bottom bars
		document.getElementById('bottom-bar').style.display = 'none';
		document.getElementById('edit-bottom-bar').style.display = 'flex';

		const startTimeInput = document.getElementById('edit-start-time');
		const endTimeInput = document.getElementById('edit-end-time');

		if (startTimeInput && endTimeInput) {
			startTimeInput.addEventListener('input', recalculateEditHoursWorked);
			endTimeInput.addEventListener('input', recalculateEditHoursWorked);
		}
	}

	//  Setup Autocomplete after a tiny delay
	setTimeout(() => {
		try {
			document
				.querySelectorAll('#edit-destinations-container input[id^="edit-destination-"]')
				.forEach((input) => {
					const autocomplete = new google.maps.places.Autocomplete(input, { types: ['geocode'] });

					initAutocompleteDestination(input);

					autocomplete.addListener('place_changed', () => {
						const place = autocomplete.getPlace();
						if (place && place.geometry) {
							recalculateEditMileageAndCosts();
						} else {
							console.warn('Invalid place selected for destination.');
						}
					});
				});
		} catch (error) {
			console.error('Error setting up autocomplete:', error);
		}
	}, 0);
}

function getNumberValue(id) {
	const el = document.getElementById(id);
	return el ? parseFloat(el.value) || 0 : 0;
}

async function saveEditedLogEntry() {
	if (editingIndex === -1) {
		console.warn('No entry selected for editing.');
		return;
	}

	const entry = logEntries[editingIndex];

	entry.date = document.getElementById('edit-date').value;
	entry.startClock = document.getElementById('edit-start-time')?.value || '';
	entry.endClock = document.getElementById('edit-end-time')?.value || '';
	entry.startTime = document.getElementById('edit-start-address').value;
	entry.endTime = document.getElementById('edit-end-address').value;
	entry.totalTime = document.getElementById('edit-total-time')?.value || '';
	entry.notes = document.getElementById('edit-notes').value.trim();

	entry.destinations = [];
	entry.earnings = [];

	const destInputs = document.querySelectorAll(
		'#edit-destinations-container input[id^="edit-destination-"]'
	);
	const earningsInputs = document.querySelectorAll(
		'#edit-destinations-container input[id^="edit-earnings-"]'
	);

	destInputs.forEach((input) => {
		entry.destinations.push(input.value.trim());
	});

	saveRecentDestinations(entry.destinations);
	updateDatalistSuggestions();

	earningsInputs.forEach((input) => {
		const value = parseFloat(input.value.trim()) || 0;
		entry.earnings.push(value);
	});

	entry.totalEarnings = entry.earnings.reduce((sum, val) => sum + val, 0);
	entry.fuelCost = getNumberValue('edit-fuel-cost');

	// Save maintenance data
	entry.maintenance = getEditMaintenanceData();
	entry.maintenanceCost = getTotalEditMaintenanceCost();

	// Save supplies data
	entry.supplies = getEditSuppliesData();
	entry.suppliesCost = getTotalEditSuppliesCost();

	entry.totalMileage = getNumberValue('edit-total-mileage');
	entry.mpg = getNumberValue('edit-mpg');
	entry.gasPrice = getNumberValue('edit-gas-price');
	entry.hoursWorked = getNumberValue('edit-hours-worked');

	const netProfitFloat =
		entry.totalEarnings - entry.fuelCost - entry.maintenanceCost - entry.suppliesCost;

	const driveTime = convertTimeToHours(entry.totalTime || '');
	//  Use full clock span only (start-end time)
	let sessionMinutes = 0;
	const start = entry.startClock;
	const end = entry.endClock;

	if (start && end && start.includes(':') && end.includes(':')) {
		const [sh, sm] = start.split(':').map(Number);
		const [eh, em] = end.split(':').map(Number);
		let startMin = sh * 60 + sm;
		let endMin = eh * 60 + em;
		if (endMin < startMin) endMin += 1440;
		sessionMinutes = endMin - startMin;
	}

	const sessionHours = sessionMinutes / 60;
	entry.profitPerHour = sessionHours > 0 ? (netProfitFloat / sessionHours).toFixed(2) : '0.00';

	entry.netProfit = netProfitFloat.toFixed(2);
	entry.lastModified = new Date().toISOString();

	await saveLog();
	filterLogs();
	closeEditForm();
	showConfirmationMessage(' Log entry updated!');
}

let fileReaderBusy = false; // global or top-level

async function importLog() {
	if (fileReaderBusy) {
		console.warn(' FileReader is still busy. Try again in a moment.');
		return;
	}

	const token = localStorage.getItem('token');
	if (!token) {
		showAlertModal(' You must be signed in to import a CSV file.', showLogin);
		return;
	}

	const fileInput = document.getElementById('import-file');
	const file = fileInput.files[0];

	if (!file) {
		showAlertModal('Please select a CSV file to import.');
		return;
	}

	fileReaderBusy = true;

	const reader = new FileReader();

	reader.onload = async function (e) {
		try {
			const csvData = e.target.result;
			const lines = csvData.split('\n').slice(1); // Skip header
			const newLogEntries = [];

			const parseFormattedTime = (str) => {
				str = str.replace(/"/g, '').toLowerCase().trim();
				const hourMatch = str.match(/(\d+)\s*hour/);
				const minuteMatch = str.match(/(\d+)\s*minute/);

				const hours = hourMatch ? parseInt(hourMatch[1]) : 0;
				const minutes = minuteMatch ? parseInt(minuteMatch[1]) : 0;

				return (hours * 60 + minutes) / 60;
			};

			let successCount = 0;
			let duplicateCount = 0;

			for (const line of lines) {
				if (!line.trim() || line.startsWith('Totals:')) continue;

				const values = line.match(/("([^"]*)"|[^,]+)/g);
				if (!values || values.length < 17) {
					console.warn(' Skipping line  incorrect column count:', line);
					continue;
				}

				try {
					const destinations = values[4]
						.replace(/^"|"$/g, '')
						.split(';')
						.map((d) => d.trim());

					const earnings = values[6]
						.replace(/^"|"$/g, '')
						.split(';')
						.map((v) => parseFloat(v.trim()) || 0);

					const notes = values[17] ? values[17].replace(/^"|"$/g, '').replace(/""/g, '"') : '';

					const entry = {
						date: values[0],
						startClock: values[1],
						endClock: values[2],
						startTime: values[3]?.replace(/^"|"$/g, '') || '',
						destinations,
						endTime: values[5]?.replace(/^"|"$/g, '') || '',
						earnings,
						totalMileage: parseFloat(values[7]) || 0,
						totalTime: values[8]?.replace(/^"|"$/g, ''),
						totalEarnings: parseFloat(values[9]) || 0,
						fuelCost: parseFloat(values[10]) || 0,
						maintenanceCost: parseFloat(values[11]) || 0,
						suppliesCost: parseFloat(values[12]) || 0,
						hoursWorked: parseFormattedTime(values[13]),
						totalHours: parseFormattedTime(values[14]),
						netProfit: parseFloat(values[15]) || 0,
						profitPerHour: parseFloat(values[16]) || 0,
						notes, //  new!
						mpg: 0,
						gasPrice: 0,
						lastModified: new Date().toISOString()
					};

					if (isDuplicateEntry(entry, logEntries)) {
						duplicateCount++;
						continue;
					}

					newLogEntries.push(entry);
					successCount++;
				} catch (err) {
					console.warn(' Error parsing CSV row:', err, line);
				}
			}

			if (successCount === 0) {
				if (duplicateCount > 0) {
					showAlertModal(' All entries in the file were duplicates and have been skipped.');
				} else {
					showAlertModal(' The file format appears to be invalid or unsupported.');
				}
				return;
			}

			logEntries = [...logEntries, ...newLogEntries];
			await saveLog();
			filterLogs();
			if (successCount > 0) {
				showAlertModal(
					` Imported ${successCount} entr${successCount === 1 ? 'y' : 'ies'} successfully.${duplicateCount > 0 ? `\n Skipped ${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'}.` : ''}`
				);
			} else {
				showAlertModal(' The file format appears to be invalid or unsupported.');
			}
		} catch (err) {
			console.error(' Error processing file:', err);
			showAlertModal(' Failed to process the file.');
		} finally {
			fileInput.value = ''; // reset for next upload
			fileReaderBusy = false;
		}
	};

	reader.onerror = () => {
		fileInput.value = ''; // reset in case of error
		fileReaderBusy = false;
		showAlertModal(' Error reading the file.');
	};

	reader.readAsText(file);
}

let isSignup = false;

function showLogin() {
	isSignup = false;
	document.getElementById('auth-title').textContent = 'Sign In';
	document.getElementById('auth-switch-label').textContent = 'Sign Up';
	document.getElementById('auth-modal').style.display = 'flex';
}

function showSignup() {
	isSignup = true;
	document.getElementById('auth-title').textContent = 'Create Account';
	document.getElementById('auth-switch-label').textContent = 'Sign In';
	document.getElementById('auth-modal').style.display = 'flex';
}

function toggleAuthMode() {
	isSignup = !isSignup;
	if (isSignup) {
		showSignup();
	} else {
		showLogin();
	}
}

async function submitAuth() {
	const username = document.getElementById('auth-username').value.trim();
	const password = document.getElementById('auth-password').value.trim();

	if (!username || !password) {
		showAlertModal(' Username and password required.');
		return;
	}

	const endpoint = isSignup
		? 'https://logs.gorouteyourself.com/api/signup'
		: 'https://logs.gorouteyourself.com/api/login';

	const res = await fetch(endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password })
	});

	if (res.ok) {
		const data = await res.json();
		localStorage.setItem('username', username);
		localStorage.setItem('token', data.token);
		document.getElementById('auth-modal').style.display = 'none';
		showConfirmationMessage(` ${isSignup ? 'Account created' : 'Signed in'} successfully!`);
		updateAuthUI();

		// Load custom categories from cloud
		await loadCustomCategoriesFromCloud();

		if (isSignup && data.resetKey) {
			showAlertModal(
				` Your reset key is:<br><br><code style="font-size: 18px; user-select: all;">${data.resetKey}</code><br><br>Save this key somewhere safe.`,
				() => location.reload()
			);
		} else {
			//  For login or failed signup-then-login, reload to reflect auth state
			location.reload();
		}
	} else {
		let msg = ' An error occurred.';
		try {
			const contentType = res.headers.get('Content-Type') || '';
			if (contentType.includes('application/json')) {
				const data = await res.json();
				msg = ' ' + (data.error || msg);
			} else {
				msg = ' ' + (await res.text());
			}

			if (res.status === 400 && msg.toLowerCase().includes('username')) {
				msg = ' That username is already taken. Please choose another.';
			}

			if (res.status === 404 && msg.toLowerCase().includes('not found')) {
				msg = ' Account not found. Please check your username or sign up.';
			}
		} catch (e) {
			console.error('Error parsing error response:', e);
		}

		showAlertModal(msg);
	}
}

function logout() {
	console.log(' Logging out...');

	//  STEP 1: Clear ALL localStorage (nuclear option)
	localStorage.clear();

	//  STEP 2: Clear in-memory data
	logEntries = [];

	//  STEP 3: Clear UI immediately
	const logList = document.getElementById('log-list');
	if (logList) {
		logList.innerHTML = '';
	}

	//  STEP 4: Hide username and hamburger immediately
	const usernameDisplay = document.getElementById('username-display');
	if (usernameDisplay) usernameDisplay.textContent = '';

	const hamburgerButton = document.getElementById('hamburger-button');
	if (hamburgerButton) hamburgerButton.style.display = 'none';

	//  STEP 5: Update auth messages
	const authMessage = document.getElementById('auth-message');
	const logoutMessage = document.getElementById('logout-message');
	if (authMessage) authMessage.style.display = 'block';
	if (logoutMessage) logoutMessage.style.display = 'none';

	console.log(' Cleared all data');

	//  STEP 6: Force reload to root (clean URL)
	setTimeout(() => {
		window.location.replace(window.location.origin + '/');
	}, 100);
}

function showPasswordModal() {
	document.getElementById('change-password-modal').style.display = 'flex';
}

function closePasswordModal() {
	document.getElementById('change-password-modal').style.display = 'none';
}

async function submitPasswordChange() {
	const current = document.getElementById('current-password').value.trim();
	const next = document.getElementById('new-password').value.trim();
	const confirm = document.getElementById('confirm-password').value.trim();

	if (!current || !next || !confirm) return showAlertModal(' Please fill out all fields.');

	if (next !== confirm) return showAlertModal(' New passwords do not match.');

	const token = localStorage.getItem('token');
	const username = localStorage.getItem('username');

	if (!token || !username) {
		showAlertModal(' You must be signed in.');
		return;
	}

	const res = await fetch('https://logs.gorouteyourself.com/api/change-password', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: token
		},
		body: JSON.stringify({
			username,
			currentPassword: current,
			newPassword: next
		})
	});

	if (res.ok) {
		showAlertModal(' Password changed successfully.');
		closePasswordModal();
	} else {
		const msg = await res.text();
		showAlertModal(' ' + msg);
	}
}

function showResetModal() {
	document.getElementById('reset-password-modal').style.display = 'flex';
}

function closeResetModal() {
	document.getElementById('reset-password-modal').style.display = 'none';
}

async function submitResetPassword() {
	const username = document.getElementById('reset-username').value.trim();
	const resetKey = document.getElementById('reset-key').value.trim();
	const newPassword = document.getElementById('reset-new-password').value.trim();

	if (!username || !resetKey || !newPassword) {
		showAlertModal(' Please fill out all fields.');
		return;
	}

	const res = await fetch('https://logs.gorouteyourself.com/api/reset-password', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, resetKey, newPassword })
	});

	if (res.ok) {
		showAlertModal(' Password reset successfully. You can now sign in.');
		closeResetModal();
	} else {
		const msg = await res.text();
		showAlertModal(' ' + msg);
	}
}

function showDeleteModal() {
	document.getElementById('delete-account-modal').style.display = 'flex';
}

function closeDeleteModal() {
	document.getElementById('delete-account-modal').style.display = 'none';
}

async function submitDeleteAccount() {
	const password = document.getElementById('delete-password').value.trim();
	const username = localStorage.getItem('username');
	const token = localStorage.getItem('token');

	if (!username || !token || !password) {
		showAlertModal(' Missing credentials.');
		return;
	}

	const res = await fetch('https://logs.gorouteyourself.com/api/delete-account', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: token
		},
		body: JSON.stringify({ username, password })
	});

	if (res.ok) {
		// 1. Clear all auth and cached data
		localStorage.removeItem('username');
		localStorage.removeItem('token');
		localStorage.removeItem('cachedLogs');
		localStorage.removeItem('pendingLogs');

		// 2. Close the modal and reset password input
		closeDeleteModal();
		document.getElementById('delete-password').value = '';

		// 3. Clear in-memory logs
		logEntries = [];

		// 4. Clear UI elements
		document.getElementById('log-list').innerHTML = '';
		document.getElementById('log-summary').innerHTML = '';
		document.getElementById('log-container').style.display = 'none';

		const manageLog = document.getElementById('manage-log-container');
		if (manageLog) manageLog.style.display = 'none';

		// 5. Update auth UI and disable key buttons
		updateAuthUI();
		document.querySelectorAll('button').forEach((btn) => {
			if (
				btn.textContent.includes('Log Route') ||
				btn.textContent.includes('Optimize') ||
				btn.textContent.includes('Calculate')
			) {
				btn.disabled = true;
			}
		});

		// 6. Alert and reload
		showAlertModal(' Your account has been deleted.', () => {
			location.reload();
		});
	} else {
		const msg = await res.text();
		showAlertModal(' ' + msg);
	}
}

window.toggleMenu = function () {
	console.log(' toggleMenu() called');

	const menu = document.getElementById('account-menu');
	console.log(' Menu element:', menu);

	if (!menu) {
		console.error(' Menu element not found!');
		return;
	}

	const isShowing = menu.classList.contains('show');
	console.log(' Current state - isShowing:', isShowing);

	if (isShowing) {
		console.log(' Closing menu...');
		menu.classList.remove('show');
	} else {
		console.log(' Opening menu...');
		menu.classList.add('show');
	}

	// Log final state
	setTimeout(() => {
		console.log(' Final menu classes:', menu.className);
		console.log(' Final menu style.left:', window.getComputedStyle(menu).left);
	}, 100);
};

window.closeMenu = function () {
	console.log(' closeMenu() called');
	const menu = document.getElementById('account-menu');
	if (menu) {
		menu.classList.remove('show');
		console.log(' Menu closed');
	} else {
		console.error(' Menu element not found!');
	}
};

function filterLogs() {
	const startDate = document.getElementById('filter-start-date').value;
	const endDate = document.getElementById('filter-end-date').value;
	const searchQuery = document.getElementById('filter-search').value.trim().toLowerCase();

	//  Define the shared filter logic
	currentFilterFn = (entryDate, entry) => {
		let matchesDate = true;
		if (startDate && entryDate < startDate) matchesDate = false;
		if (endDate && entryDate > endDate) matchesDate = false;

		const fieldsToSearch = [
			entry.startTime,
			entry.endTime,
			...(entry.destinations || []),
			(entry.totalEarnings || '').toString(),
			(entry.fuelCost || '').toString(),
			(entry.maintenanceCost || '').toString(),
			(entry.suppliesCost || '').toString(),
			(entry.netProfit || '').toString(),
			(entry.totalMileage || '').toString(),
			(entry.totalTime || '').toString(),
			(entry.profitPerHour || '').toString(),
			(entry.hoursWorked || '').toString()
		]
			.join(' ')
			.toLowerCase();

		const matchesSearch = !searchQuery || fieldsToSearch.includes(searchQuery);

		return matchesDate && matchesSearch;
	};

	//  Use that filter directly in display
	displayLog(currentFilterFn);
}

// Hide Manage Log menu when clicking outside
document.addEventListener('click', function (event) {
	const manageButton = document.querySelector('#manage-log-container button');
	const manageMenu = document.getElementById('manage-log-menu');

	// If click outside both the menu AND the button
	if (manageMenu && !manageMenu.contains(event.target) && !manageButton.contains(event.target)) {
		manageMenu.style.display = 'none';
	}
});

function triggerImportFile() {
	const fileInput = document.getElementById('import-file');
	if (fileInput) {
		fileInput.click(); // Simulate a click to open file picker
	}
}

function openLogEntryInGoogleMaps(index) {
	const entry = logEntries[index];
	if (!entry) {
		console.error('Invalid log entry index');
		return;
	}

	const start = encodeURIComponent(entry.startTime.trim());
	const end = encodeURIComponent(entry.endTime.trim());

	const destinations = Array.isArray(entry.destinations)
		? entry.destinations.map((dest) => encodeURIComponent(dest.trim()))
		: [];

	let url = `https://www.google.com/maps/dir/?api=1&origin=${start}&destination=${end}`;

	if (destinations.length > 0) {
		url += `&waypoints=${destinations.join('|')}`;
	}

	window.open(url, '_blank');
}

function handleTimeChange() {
	const startTimeInput = document.getElementById('start-time').value;
	const endTimeInput = document.getElementById('end-time').value;
	const totalHoursInput = document.getElementById('total-hours');

	//  Auto-open End Time picker after selecting Start Time
	if (startTimeInput && !endTimeInput) {
		document.getElementById('end-time')?.showPicker?.();
	}

	if (startTimeInput && endTimeInput) {
		const [startHours, startMinutes] = startTimeInput.split(':').map(Number);
		const [endHours, endMinutes] = endTimeInput.split(':').map(Number);

		let startTotalMinutes = startHours * 60 + startMinutes;
		let endTotalMinutes = endHours * 60 + endMinutes;

		if (endTotalMinutes < startTotalMinutes) {
			endTotalMinutes += 24 * 60; // Handle overnight shifts
		}

		const totalWorkedMinutes = endTotalMinutes - startTotalMinutes;
		const hoursWorked = totalWorkedMinutes / 60;

		//  Display in input as formatted string like "2 hours 15 minutes"
		totalHoursInput.value = formatHoursAndMinutes(hoursWorked);
	} else {
		totalHoursInput.value = '';
	}
}

function formatCurrency(value) {
	if (isNaN(value)) return '$0.00';
	return `$${parseFloat(value).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	})}`;
}

function updateLogSummary(filterFn) {
	const summaryDiv = document.getElementById('log-summary');

	const filteredEntries = logEntries.filter((entry) => entry?.date && filterFn(entry.date, entry));

	if (filteredEntries.length === 0) {
		summaryDiv.innerHTML = 'No data available for selected filter.';
		return;
	}

	let totalNetProfit = 0;
	let totalMinutes = 0;

	filteredEntries.forEach((entry) => {
		totalNetProfit += parseFloat(entry.netProfit) || 0;

		const start = entry.startClock || '';
		const end = entry.endClock || '';

		if (start && end && start.includes(':') && end.includes(':')) {
			const [sh, sm] = start.split(':').map(Number);
			const [eh, em] = end.split(':').map(Number);
			let startMin = sh * 60 + sm;
			let endMin = eh * 60 + em;
			if (endMin < startMin) endMin += 24 * 60;

			totalMinutes += endMin - startMin;
		}
	});

	const totalHoursDecimal = totalMinutes / 60; // unrounded for profit calculations
	const profitPerHour = totalHoursDecimal > 0 ? totalNetProfit / totalHoursDecimal : 0;

	const fullHours = Math.floor(totalHoursDecimal);
	const fullMinutes = Math.round((totalHoursDecimal % 1) * 60);
	const formattedTime = `${fullHours} hour${fullHours !== 1 ? 's' : ''}${fullMinutes > 0 ? ` ${fullMinutes} minute${fullMinutes !== 1 ? 's' : ''}` : ''}`;

	summaryDiv.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center;">
      <div style="margin-bottom: 8px;">
        Net Profit: <span style="color: green;">$${totalNetProfit.toFixed(2)}</span>
      </div>
      <div style="margin-bottom: 8px;">
        Profit Per Hour: <span style="color: blue;">$${profitPerHour.toFixed(2)}</span>
      </div>
      <div>
        Total Hours: <span style="color: black;">${formattedTime}</span>
      </div>
    </div>
  `;
}

function recalculateEditHoursWorked() {
	const startTime = document.getElementById('edit-start-time')?.value;
	const endTime = document.getElementById('edit-end-time')?.value;
	const hoursWorkedInput = document.getElementById('edit-hours-worked');

	if (!hoursWorkedInput) return;

	hoursWorkedInput.readOnly = true;
	hoursWorkedInput.style.backgroundColor = '#f0f0f0';

	if (!startTime || !endTime) {
		hoursWorkedInput.value = '';
		return;
	}

	const [startHours, startMinutes] = startTime.split(':').map(Number);
	const [endHours, endMinutes] = endTime.split(':').map(Number);

	let start = startHours * 60 + startMinutes;
	let end = endHours * 60 + endMinutes;

	if (end < start) end += 24 * 60; // handle overnight

	const totalWorkedMinutes = end - start;
	hoursWorkedInput.value = formatHoursAndMinutesFromMinutes(totalWorkedMinutes);
}

function formatTimeToAmPm(timeStr) {
	if (!timeStr) return 'N/A';
	const [hours, minutes] = timeStr.split(':').map(Number);
	const ampm = hours >= 12 ? 'PM' : 'AM';
	const displayHours = hours % 12 || 12; // 0 becomes 12
	return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

function toggleLogEntryDetails(index) {
	const entry = logEntries[index];
	const detailsDiv = document.getElementById(`details-${index}`);
	const toggleButton = document.getElementById(`toggle-button-${index}`);
	const summaryDiv = document.getElementById(`summary-${index}`);

	if (!detailsDiv || !entry || !toggleButton || !summaryDiv) return;

	if (detailsDiv.classList.contains('hidden')) {
		// Expand
		const destinations = entry.destinations?.length
			? entry.destinations.map((d) => `- ${d}`).join('<br>')
			: 'None';

		const earnings = Array.isArray(entry.earnings)
			? entry.earnings.map((e) => `$${parseFloat(e).toFixed(2)}`).join(', ')
			: '$0.00';

		const formattedHoursWorked = (() => {
			const start = entry.startClock;
			const end = entry.endClock;
			if (!start || !end || !start.includes(':') || !end.includes(':')) return 'N/A';

			const [sh, sm] = start.split(':').map(Number);
			const [eh, em] = end.split(':').map(Number);
			let startMin = sh * 60 + sm;
			let endMin = eh * 60 + em;
			if (endMin < startMin) endMin += 24 * 60;

			const totalMinutes = endMin - startMin;
			const driveMinutes = convertTimeToMinutes(entry.totalTime || '');
			const workedMinutes = Math.max(totalMinutes - driveMinutes, 0);
			return formatHoursAndMinutesFromMinutes(workedMinutes);
		})();

		detailsDiv.innerHTML = `
  <div><strong>Date:</strong> ${entry.date}</div>
  <div><strong>Start Time:</strong> ${formatTimeToAmPm(entry.startClock)}</div>
  <div><strong>End Time:</strong> ${formatTimeToAmPm(entry.endClock)}</div>
  <div><strong>Start Address:</strong> ${entry.startTime}</div>
  
  <div><strong>Destinations:</strong></div> <!-- first separate div -->
  <div style="margin-left: 15px;">${destinations}</div> <!-- second div for addresses -->

  <div><strong>End Address:</strong> ${entry.endTime}</div>
  <div><strong>Earnings per Stop:</strong> ${earnings}</div>
  <div><strong>Mileage:</strong> ${entry.totalMileage} miles</div>
  <div><strong>Drive Time:</strong> ${entry.totalTime}</div>
  <div><strong>Total Earnings:</strong> $${entry.totalEarnings}</div>
  <div><strong>Fuel Cost:</strong> $${entry.fuelCost}</div>
  <div><strong>Maintenance:</strong> $${entry.maintenanceCost || 0}${entry.maintenance && entry.maintenance.length > 0 ? `<div style="margin-left: 15px; font-size: 14px;">${entry.maintenance.map((m) => `${m.type}: $${m.cost.toFixed(2)}`).join('<br>')}</div>` : ''}</div>
  <div><strong>Supplies:</strong> $${entry.suppliesCost || 0}${entry.supplies && entry.supplies.length > 0 ? `<div style="margin-left: 15px; font-size: 14px;">${entry.supplies.map((s) => `${s.type}: $${s.cost.toFixed(2)}`).join('<br>')}</div>` : ''}</div>
  <div><strong>Hours Worked:</strong> ${formattedHoursWorked}</div>
  <div><strong>Total Hours:</strong> ${calculateTotalHours(entry)}</div>
  <div><strong>Net Profit:</strong> $${entry.netProfit}</div>
  <div><strong>Profit per Hour:</strong> $${entry.profitPerHour}</div>
`;
		if (entry.notes) {
			detailsDiv.innerHTML += `<div><strong>Notes:</strong> ${entry.notes}</div>`;
		}

		detailsDiv.classList.remove('hidden');
		summaryDiv.classList.add('hidden'); //  Hide only the summary
		toggleButton.textContent = 'Less Details';
	} else {
		// Collapse
		detailsDiv.classList.add('hidden');
		summaryDiv.classList.remove('hidden'); //  Show the summary
		toggleButton.textContent = 'More Details';
	}
}

function calculateTotalHours(entry) {
	const start = entry.startClock;
	const end = entry.endClock;
	if (!start || !end || !start.includes(':') || !end.includes(':')) {
		return 'N/A';
	}

	const [sh, sm] = start.split(':').map(Number);
	const [eh, em] = end.split(':').map(Number);
	let startMin = sh * 60 + sm;
	let endMin = eh * 60 + em;
	if (endMin < startMin) endMin += 24 * 60;

	const totalMinutes = endMin - startMin;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	const hourText = `${hours} hour${hours !== 1 ? 's' : ''}`;
	const minuteText = minutes > 0 ? ` ${minutes} minute${minutes !== 1 ? 's' : ''}` : '';
	return formatHoursAndMinutesFromMinutes(totalMinutes);
}

function clearFilters() {
	document.getElementById('filter-start-date').value = '';
	document.getElementById('filter-end-date').value = '';
	document.getElementById('filter-search').value = '';
	filterLogs(); //  Refresh the display
}

function initOfflineListeners() {
	updateOfflineBanner(); // Set initial state
	window.addEventListener('online', updateOfflineBanner);
	window.addEventListener('offline', updateOfflineBanner);
}

function renumberMainDestinations() {
	const destinationDivs = document.querySelectorAll('#destinations-container .destination');

	destinationDivs.forEach((div, index) => {
		const destNum = index + 1;
		const label = div.querySelector('label[for^="destination-"]');
		const earningsLabel = div.querySelector('label[for^="earnings-"]');
		const addressInput = div.querySelector('input[type="text"]');
		const earningsInput = div.querySelector('input[type="number"]');

		if (label) {
			label.textContent = `Destination ${destNum}`;
			label.setAttribute('for', `destination-${destNum}`);
		}

		if (earningsLabel) {
			earningsLabel.textContent = `Earnings for Destination ${destNum}`;
			earningsLabel.setAttribute('for', `earnings-${destNum}`);
		}

		if (addressInput) {
			addressInput.id = `destination-${destNum}`;
		}

		if (earningsInput) {
			earningsInput.id = `earnings-${destNum}`;
		}
	});
}

function calculateTotals(logs) {
	return logs.reduce(
		(totals, entry) => {
			totals.totalEarnings += parseFloat(entry.totalEarnings || 0);
			totals.fuelCost += parseFloat(entry.fuelCost || 0);
			totals.maintenance += parseFloat(entry.maintenanceCost || 0);
			totals.supplies += parseFloat(entry.suppliesCost || 0);
			totals.netProfit += parseFloat(entry.netProfit || 0);
			totals.mileage += parseFloat(entry.totalMileage || 0);
			totals.hoursWorked += parseFloat(entry.hoursWorked || 0);
			totals.driveMinutes += convertTimeToMinutes(entry.totalTime);
			const pph = parseFloat(entry.profitPerHour || 0);
			if (!isNaN(pph)) {
				totals.profitPerHourSum += pph;
				totals.count++;
			}
			return totals;
		},
		{
			totalEarnings: 0,
			fuelCost: 0,
			maintenance: 0,
			supplies: 0,
			netProfit: 0,
			mileage: 0,
			hoursWorked: 0,
			driveMinutes: 0,
			profitPerHourSum: 0,
			count: 0
		}
	);
}

function convertTimeToMinutes(timeStr) {
	if (!timeStr) return 0;

	// Match "X hour(s)" and "Y minute(s)", ignore seconds entirely
	const hourMatch = timeStr.match(/(\d+)\s*hour/);
	const minMatch = timeStr.match(/(\d+)\s*minute/);

	const hours = hourMatch ? parseInt(hourMatch[1]) : 0;
	const minutes = minMatch ? parseInt(minMatch[1]) : 0;

	return hours * 60 + minutes;
}

function exportToCSVWithTotals() {
	const filtered =
		typeof currentFilterFn === 'function'
			? logEntries.filter((entry) => entry?.date && currentFilterFn(entry.date, entry))
			: logEntries;

	if (filtered.length === 0) {
		alert(' No entries to export.');
		return;
	}

	const header =
		'Date,Start Time,End Time,Start Address,Destinations,End Address,Earnings per Stop,Mileage,Drive Time,Total Earnings,Fuel Cost,Maintenance Total,Maintenance Breakdown,Supplies Total,Supplies Breakdown,Hours Worked,Total Hours,Net Profit,Profit Per Hour,Notes\n';

	const csvRows = filtered.map((entry) => {
		const destinationsString = `"${(entry.destinations || []).join(';')}"`;
		const earningsString = `"${(entry.earnings || []).map((e) => `$${parseFloat(e).toFixed(2)}`).join(';')}"`;

		const start = entry.startClock;
		const end = entry.endClock;
		let workedMinutes = 0;
		let sessionMinutes = 0;

		if (start && end && start.includes(':') && end.includes(':')) {
			const [sh, sm] = start.split(':').map(Number);
			const [eh, em] = end.split(':').map(Number);
			let startMin = sh * 60 + sm;
			let endMin = eh * 60 + em;
			if (endMin < startMin) endMin += 24 * 60;

			sessionMinutes = endMin - startMin;
			const driveMinutes = convertTimeToMinutes(entry.totalTime || '');
			workedMinutes = Math.max(sessionMinutes - driveMinutes, 0);
		}

		return [
			entry.date,
			start || '',
			end || '',
			`"${(entry.startTime || '').replace(/"/g, '""')}"`,
			destinationsString,
			`"${(entry.endTime || '').replace(/"/g, '""')}"`,
			earningsString,
			entry.totalMileage,
			entry.totalTime,
			entry.totalEarnings,
			entry.fuelCost,
			entry.maintenanceCost || 0,
			`"${(entry.maintenance || []).map((m) => `${m.type}: $${m.cost.toFixed(2)}`).join('; ')}"`,
			entry.suppliesCost || 0,
			`"${(entry.supplies || []).map((s) => `${s.type}: $${s.cost.toFixed(2)}`).join('; ')}"`,
			`"${formatHoursAndMinutesFromMinutes(workedMinutes)}"`,
			`"${formatHoursAndMinutesFromMinutes(sessionMinutes)}"`,
			entry.netProfit,
			entry.profitPerHour || '',
			`"${(entry.notes || '').replace(/"/g, '""')}"`
		].join(',');
	});

	let totalNetProfit = 0;
	let totalDriveMinutes = 0;
	let totalSessionMinutes = 0;
	let totalEarnings = 0;
	let fuelCost = 0;
	let maintenance = 0;
	let supplies = 0;
	let mileage = 0;

	filtered.forEach((entry) => {
		totalNetProfit += parseFloat(entry.netProfit) || 0;
		totalEarnings += parseFloat(entry.totalEarnings) || 0;
		fuelCost += parseFloat(entry.fuelCost) || 0;
		maintenance += parseFloat(entry.maintenanceCost) || 0;
		supplies += parseFloat(entry.suppliesCost) || 0;
		mileage += parseFloat(entry.totalMileage) || 0;

		totalDriveMinutes += convertTimeToMinutes(entry.totalTime || '');

		const start = entry.startClock || '';
		const end = entry.endClock || '';
		if (start && end && start.includes(':') && end.includes(':')) {
			const [sh, sm] = start.split(':').map(Number);
			const [eh, em] = end.split(':').map(Number);
			let startMin = sh * 60 + sm;
			let endMin = eh * 60 + em;
			if (endMin < startMin) endMin += 24 * 60;
			totalSessionMinutes += endMin - startMin;
		}
	});

	const totalWorkedMinutes = Math.max(totalSessionMinutes - totalDriveMinutes, 0);
	const formattedWorkedTime = formatHoursAndMinutesFromMinutes(totalWorkedMinutes);
	const formattedTotalTime = formatHoursAndMinutesFromMinutes(totalSessionMinutes);
	const profitPerHour = totalSessionMinutes > 0 ? totalNetProfit / (totalSessionMinutes / 60) : 0;
	const formattedDriveTime = `${Math.floor(totalDriveMinutes / 60)} hour${Math.floor(totalDriveMinutes / 60) !== 1 ? 's' : ''} ${totalDriveMinutes % 60} minutes`;

	const totalRow = [
		'Totals:',
		'',
		'',
		'',
		'',
		'',
		'',
		mileage.toFixed(2),
		formattedDriveTime,
		totalEarnings.toFixed(2),
		fuelCost.toFixed(2),
		maintenance.toFixed(2),
		supplies.toFixed(2),
		formattedWorkedTime,
		formattedTotalTime,
		totalNetProfit.toFixed(2),
		profitPerHour.toFixed(2),
		'' // Notes
	].join(',');

	const csvString = header + csvRows.join('\n') + '\n' + totalRow;
	const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
	const link = document.createElement('a');
	const url = URL.createObjectURL(blob);
	link.setAttribute('href', url);
	link.setAttribute('download', 'profit_log_full_export.csv');
	link.style.visibility = 'hidden';
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
}

function exportToPDFWithTotals() {
	const filtered =
		typeof currentFilterFn === 'function'
			? logEntries.filter((entry) => entry?.date && currentFilterFn(entry.date, entry))
			: logEntries;

	if (filtered.length === 0) {
		alert(' No entries to export.');
		return;
	}

	const { jsPDF } = window.jspdf;
	const pdf = new jsPDF({ orientation: 'landscape' });

	const columns = [
		'Date',
		'Start',
		'Destinations',
		'End',
		'Earnings',
		'Fuel',
		'Maintenance',
		'Supplies',
		'Net Profit',
		'Mileage',
		'Drive Time',
		'Earnings per Stop',
		'Hours Worked',
		'Total Hours',
		'Profit per Hour',
		'Notes'
	];

	const data = filtered.map((entry) => {
		const destinations = (entry.destinations || []).join('\n');
		const earningsPerStop = (entry.earnings || [])
			.map((e) => `$${parseFloat(e).toFixed(2)}`)
			.join(', ');

		const start = entry.startClock;
		const end = entry.endClock;
		let workedMinutes = 0;
		let sessionMinutes = 0;

		if (start && end && start.includes(':') && end.includes(':')) {
			const [sh, sm] = start.split(':').map(Number);
			const [eh, em] = end.split(':').map(Number);
			let startMin = sh * 60 + sm;
			let endMin = eh * 60 + em;
			if (endMin < startMin) endMin += 24 * 60;

			sessionMinutes = endMin - startMin;
			const driveMinutes = convertTimeToMinutes(entry.totalTime || '');
			workedMinutes = Math.max(sessionMinutes - driveMinutes, 0);
		}

		return [
			entry.date,
			entry.startTime,
			destinations,
			entry.endTime,
			`$${entry.totalEarnings}`,
			`$${entry.fuelCost}`,
			`$${entry.maintenanceCost}`,
			`$${entry.suppliesCost}`,
			`$${entry.netProfit}`,
			`${entry.totalMileage} mi`,
			entry.totalTime,
			earningsPerStop,
			formatHoursAndMinutesFromMinutes(workedMinutes),
			formatHoursAndMinutesFromMinutes(sessionMinutes),
			`$${entry.profitPerHour || '0.00'}`,
			entry.notes || ''
		];
	});

	// Totals
	let totalNetProfit = 0;
	let totalDriveMinutes = 0;
	let totalSessionMinutes = 0;
	let totalEarnings = 0;
	let fuelCost = 0;
	let maintenance = 0;
	let supplies = 0;
	let mileage = 0;

	filtered.forEach((entry) => {
		totalNetProfit += parseFloat(entry.netProfit) || 0;
		totalEarnings += parseFloat(entry.totalEarnings) || 0;
		fuelCost += parseFloat(entry.fuelCost) || 0;
		maintenance += parseFloat(entry.maintenanceCost) || 0;
		supplies += parseFloat(entry.suppliesCost) || 0;
		mileage += parseFloat(entry.totalMileage) || 0;
		totalDriveMinutes += convertTimeToMinutes(entry.totalTime || '');

		const start = entry.startClock || '';
		const end = entry.endClock || '';
		if (start && end && start.includes(':') && end.includes(':')) {
			const [sh, sm] = start.split(':').map(Number);
			const [eh, em] = end.split(':').map(Number);
			let startMin = sh * 60 + sm;
			let endMin = eh * 60 + em;
			if (endMin < startMin) endMin += 24 * 60;
			totalSessionMinutes += endMin - startMin;
		}
	});

	const totalWorkedMinutes = Math.max(totalSessionMinutes - totalDriveMinutes, 0);
	const formattedWorkedTime = formatHoursAndMinutesFromMinutes(totalWorkedMinutes);
	const formattedTotalTime = formatHoursAndMinutesFromMinutes(totalSessionMinutes);
	const profitPerHour = totalSessionMinutes > 0 ? totalNetProfit / (totalSessionMinutes / 60) : 0;
	const formattedDriveTime = `${Math.floor(totalDriveMinutes / 60)} hr ${totalDriveMinutes % 60} min`;

	data.push([
		'Totals:',
		'',
		'',
		'',
		`$${totalEarnings.toFixed(2)}`,
		`$${fuelCost.toFixed(2)}`,
		`$${maintenance.toFixed(2)}`,
		`$${supplies.toFixed(2)}`,
		`$${totalNetProfit.toFixed(2)}`,
		`${mileage.toFixed(2)} mi`,
		formattedDriveTime,
		'',
		formattedWorkedTime,
		formattedTotalTime,
		`$${profitPerHour.toFixed(2)}`,
		'' // Notes
	]);

	pdf.autoTable({
		head: [columns],
		body: data,
		styles: {
			fontSize: 7.5,
			cellPadding: 1.5,
			overflow: 'linebreak'
		},
		headStyles: {
			fillColor: [44, 62, 80],
			textColor: 255,
			fontSize: 8
		},
		theme: 'striped',
		startY: 20,
		tableWidth: 'auto',
		didDrawPage: function (data) {
			pdf.setFontSize(9);
			pdf.setTextColor(40);
			pdf.text(
				`Profit Log - Page ${data.pageNumber}`,
				data.settings.margin.left,
				pdf.internal.pageSize.height - 10
			);
		}
	});

	pdf.save('profit_log_with_totals.pdf');
}

function formatHoursAndMinutesFromMinutes(totalMinutes) {
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	const hourText = h > 0 ? `${h} hour${h !== 1 ? 's' : ''}` : '';
	const minuteText = m > 0 ? `${m} minute${m !== 1 ? 's' : ''}` : '';
	return [hourText, minuteText].filter(Boolean).join(' ');
}

document.addEventListener('click', function (event) {
	const logMenu = document.getElementById('hamburger-manage-log-menu');
	const logToggle = document.getElementById('hamburger-manage-toggle');

	const accountMenu = document.getElementById('hamburger-manage-account-menu');
	const accountToggle = document.getElementById('hamburger-manage-account-toggle');

	// Ignore clicks on either toggle buttons
	if (logToggle?.contains(event.target) || accountToggle?.contains(event.target)) return;

	// Ignore clicks inside the menus
	if (logMenu?.contains(event.target) || accountMenu?.contains(event.target)) return;

	// Close both dropdowns
	if (logMenu) {
		logMenu.style.maxHeight = '0';
		const arrow = document.getElementById('hamburger-manage-arrow');
		if (arrow) arrow.style.transform = 'rotate(0deg)';
	}

	if (accountMenu) {
		accountMenu.style.maxHeight = '0';
		const arrow = document.getElementById('hamburger-manage-account-arrow');
		if (arrow) arrow.style.transform = 'rotate(0deg)';
	}
});

async function handleGoogleSignIn(response) {
	const credential = response.credential;

	try {
		const res = await fetch('https://logs.gorouteyourself.com/api/google-login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ credential })
		});

		const data = await res.json();

		if (data.token) {
			localStorage.setItem('token', data.token);
			updateAuthUI?.(); // Optional: refresh UI
			showConfirmationMessage(' Signed in with Google!');
		} else {
			alert('Google sign-in failed.');
		}
	} catch (err) {
		console.error('Google login error:', err);
		alert('Login failed');
	}
}

function updateAuthUI() {
	const token = localStorage.getItem('token');
	const username = localStorage.getItem('username');
	const hamburgerButton = document.getElementById('hamburger-button');

	if (token && username) {
		document.getElementById('auth-message').style.display = 'none';
		document.getElementById('logout-message').style.display = 'block';
		document.getElementById('username-display').textContent = username;
		if (hamburgerButton) hamburgerButton.style.display = 'inline-block';
	} else {
		document.getElementById('auth-message').style.display = 'block';
		document.getElementById('logout-message').style.display = 'none';
		document.getElementById('username-display').textContent = '';
		if (hamburgerButton) hamburgerButton.style.display = 'none';
	}
}

//  Time Helpers
function convertTimeToHours(durationStr = '') {
	const hours = +(durationStr.match(/(\d+)\s*hour/)?.[1] || 0);
	const minutes = +(durationStr.match(/(\d+)\s*minute/)?.[1] || 0);
	return hours + minutes / 60;
}

function formatHoursAndMinutes(decimal = 0) {
	if (isNaN(decimal) || decimal <= 0) return '0 minutes';

	const totalMinutes = Math.round(decimal * 60); //  more accurate
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;

	const parts = [];
	if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
	if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);

	return parts.join(' ');
}

function parseHoursAndMinutes(str = '') {
	const hours = +(str.match(/(\d+)\s*hour/)?.[1] || 0);
	const minutes = +(str.match(/(\d+)\s*minute/)?.[1] || 0);
	return hours + minutes / 60;
}

//  Register the service worker
if ('serviceWorker' in navigator) {
	window.addEventListener('load', function () {
		navigator.serviceWorker.register('/service-worker.js').then(
			function (registration) {
				console.log(' Service Worker registered with scope:', registration.scope);
			},
			function (err) {
				console.error(' Service Worker registration failed:', err);
			}
		);
	});
}

//  Show install button if eligible and not already installed
window.addEventListener('beforeinstallprompt', (e) => {
	e.preventDefault();
	deferredPrompt = e;

	// Only show if not already installed
	if (!window.matchMedia('(display-mode: standalone)').matches) {
		const btn = document.getElementById('install-button');
		if (btn) btn.style.display = 'inline-block';
	}
});

//  Handle click on install button
document.getElementById('install-button')?.addEventListener('click', () => {
	if (deferredPrompt) {
		deferredPrompt.prompt();
		deferredPrompt.userChoice.then((choiceResult) => {
			if (choiceResult.outcome === 'accepted') {
				console.log(' User accepted the install prompt');
			} else {
				console.log(' User dismissed the install prompt');
			}
			deferredPrompt = null;
			document.getElementById('install-button').style.display = 'none';
		});
	}
});

//  Hide the install button if already installed (user is using PWA)
window.addEventListener('DOMContentLoaded', () => {
	const isStandalone =
		window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

	if (isStandalone) {
		const btn = document.getElementById('install-button');
		if (btn) btn.style.display = 'none';
	}
});

let scrollTimeout;
window.addEventListener('scroll', () => {
	clearTimeout(scrollTimeout);
	scrollTimeout = setTimeout(() => {
		const topBar = document.getElementById('top-bar');
		if (!topBar) return;
		topBar.style.boxShadow = window.scrollY > 10 ? '0 2px 6px rgba(0,0,0,0.1)' : 'none';
	}, 50);
});

async function onGoogleLogin(response) {
	try {
		const res = await fetch('/api/google-login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id_token: response.credential })
		});

		if (!res.ok) {
			throw new Error(await res.text());
		}

		const data = await res.json();
		localStorage.setItem('token', data.token);

		// Refresh UI, show welcome, or reload logs
		updateAuthUI?.();
		await syncAndReloadLogs?.();
	} catch (err) {
		alert(' Google login failed: ' + err.message);
	}
}

window.handleGoogleSignIn = async function (response) {
	try {
		if (!response || !response.credential) {
			throw new Error('Missing credential');
		}

		const res = await fetch('https://logs.gorouteyourself.com/api/google-login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id_token: response.credential })
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw new Error(errorText);
		}

		const data = await res.json();
		localStorage.setItem('token', data.token);
		updateAuthUI?.();
		await syncAndReloadLogs?.();
	} catch (err) {
		console.error('Google login error:', err);
		alert(' Google login failed: ' + err.message);
	}
};

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
	e.preventDefault();
	deferredPrompt = e;
});

function installApp() {
	if (deferredPrompt) {
		deferredPrompt.prompt();
		deferredPrompt.userChoice.then((choiceResult) => {
			if (choiceResult.outcome === 'accepted') {
				console.log(' User accepted the install prompt');
			} else {
				console.log(' User dismissed the install prompt');
			}
			deferredPrompt = null;
		});
	} else {
		alert(' Installation is not supported or already installed.');
	}
}

function toggleHamburgerSettingsMenu() {
	const menu = document.getElementById('hamburger-settings-menu');
	const arrow = document.getElementById('hamburger-settings-arrow');
	if (!menu || !arrow) return;

	const isOpen = menu.style.maxHeight && menu.style.maxHeight !== '0px';

	if (isOpen) {
		menu.style.maxHeight = '0';
		arrow.style.transform = 'rotate(0deg)';
	} else {
		menu.style.maxHeight = menu.scrollHeight + 'px';
		arrow.style.transform = 'rotate(180deg)';
	}
}

function blurButtonOnInteraction(e) {
	const btn = e.target.closest('button');
	if (btn) btn.blur();
}

document.addEventListener('click', blurButtonOnInteraction);
document.addEventListener('touchend', blurButtonOnInteraction);

// ==============================================
// SUBSCRIPTION & USAGE TRACKING FUNCTIONS
// Add these to app.js
// ==============================================

// Get current subscription info
async function getSubscriptionInfo() {
	const token = localStorage.getItem('token');
	if (!token) return null;

	try {
		const response = await fetch('https://logs.gorouteyourself.com/api/subscription', {
			headers: { Authorization: token }
		});

		if (response.ok) {
			return await response.json();
		}
	} catch (err) {
		console.error('Failed to get subscription info:', err);
	}

	return null;
}

// Check if user can log more trips
async function canLogTrip() {
	const subscription = await getSubscriptionInfo();
	if (!subscription) return true; // Local-only users can always log

	if (subscription.plan === 'free') {
		return subscription.tripsThisMonth < subscription.maxTrips;
	}

	return true; // Pro/Business have unlimited
}

// Show upgrade modal when limit reached
function showUpgradeModal() {
	const html = `
    <div style="text-align: center;">
      <h3>📊 You've reached your limit!</h3>
      <p style="margin: 20px 0;">You've used all 10 trips this month on the Free plan.</p>
      <p style="margin-bottom: 30px;">Upgrade to <strong>Pro</strong> for unlimited trips, cloud sync, and more!</p>
      
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                  color: white; 
                  padding: 20px; 
                  border-radius: 12px; 
                  margin: 20px 0;">
        <div style="font-size: 14px; opacity: 0.9;">Pro Plan</div>
        <div style="font-size: 36px; font-weight: bold; margin: 10px 0;">$9.99</div>
        <div style="font-size: 14px; opacity: 0.9;">per month</div>
        <ul style="text-align: left; margin: 20px 0; padding-left: 20px;">
          <li>✅ Unlimited trips</li>
          <li>✅ Cloud sync & backup</li>
          <li>✅ Route optimization</li>
          <li>✅ CSV/PDF export</li>
          <li>✅ Analytics dashboard</li>
        </ul>
      </div>
      
      <button onclick="upgradeToPro()" style="
        background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
        color: white;
        padding: 15px 40px;
        font-size: 18px;
        font-weight: 600;
        border: none;
        border-radius: 30px;
        cursor: pointer;
        margin-top: 10px;
      ">Upgrade to Pro</button>
      
      <p style="margin-top: 20px; font-size: 14px; color: #666;">
        Or <a href="#" onclick="closeUniversalModal()" style="color: #4caf50;">continue with Free plan next month</a>
      </p>
    </div>
  `;

	showAlertModal(html);
}

// Upgrade to Pro (mock implementation - replace with Stripe)
async function upgradeToPro() {
	// TODO: Integrate Stripe checkout
	// For now, direct API upgrade
	const token = localStorage.getItem('token');
	if (!token) {
		showAlertModal('⚠️ Please sign in to upgrade.');
		return;
	}

	try {
		const response = await fetch('https://logs.gorouteyourself.com/api/subscription/upgrade', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: token
			},
			body: JSON.stringify({ plan: 'pro' })
		});

		if (response.ok) {
			const data = await response.json();
			closeUniversalModal();
			showAlertModal('🎉 Successfully upgraded to Pro! You now have unlimited trips.', () => {
				location.reload();
			});
		} else {
			const error = await response.text();
			showAlertModal('❌ Upgrade failed: ' + error);
		}
	} catch (err) {
		console.error('Upgrade error:', err);
		showAlertModal('❌ Failed to upgrade. Please try again.');
	}
}

// Show usage stats in UI
async function displayUsageStats() {
	const subscription = await getSubscriptionInfo();
	if (!subscription) return;

	const usernameDisplay = document.getElementById('username-display');
	if (!usernameDisplay) return;

	// Add plan badge
	const planBadge = document.createElement('span');
	planBadge.style.cssText = `
    display: inline-block;
    margin-left: 8px;
    padding: 2px 8px;
    background: ${subscription.plan === 'pro' ? '#7b1fa2' : subscription.plan === 'business' ? '#388e3c' : '#1976d2'};
    color: white;
    font-size: 11px;
    font-weight: 600;
    border-radius: 4px;
    text-transform: uppercase;
  `;
	planBadge.textContent = subscription.plan;

	// Only show for signed-in users
	if (usernameDisplay.textContent) {
		usernameDisplay.appendChild(planBadge);
	}

	// Show trip count for Free users
	if (subscription.plan === 'free') {
		const tripCount = document.createElement('div');
		tripCount.style.cssText = `
      position: absolute;
      top: 45px;
      right: 22px;
      font-size: 12px;
      color: ${subscription.tripsThisMonth >= subscription.maxTrips ? '#f44336' : '#666'};
      font-weight: 500;
    `;
		tripCount.textContent = `${subscription.tripsThisMonth}/${subscription.maxTrips} trips`;
		usernameDisplay.parentElement.appendChild(tripCount);
	}
}

// Update logResults to check limits
async function logResults() {
	const destinationInputs = document.querySelectorAll('input[id^="destination-"]');
	const filledDestinations = Array.from(destinationInputs).filter(
		(input) => input.value.trim() !== ''
	);
	if (filledDestinations.length === 0) {
		showAlertModal('⚠️ Please enter at least one destination before logging your route.');
		return;
	}

	// Check if user can log trip
	const canLog = await canLogTrip();
	if (!canLog) {
		showUpgradeModal();
		return;
	}

	const calculationResult = await calculateRouteData();
	if (calculationResult) {
		currentPage = 1;
		logEntry(calculationResult);
		displayLog();
		updateUI(calculationResult);
		clearTripForm();
		showConfirmationMessage('✓ Route logged successfully!');
	}
}

// Initialize usage tracking on page load
document.addEventListener('DOMContentLoaded', async () => {
	// ... existing code ...

	// Display usage stats if signed in
	await displayUsageStats();
});

// ==============================================
// USAGE IN HAMBURGER MENU
// Add this section to the hamburger menu
// ==============================================

/*
Add this HTML to the hamburger menu in index.html:

<div id="subscription-info" style="
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
  padding: 15px;
  margin: 10px;
  border-radius: 8px;
  text-align: center;
">
  <div id="plan-name" style="font-weight: 600; color: #333; font-size: 16px;">Free Plan</div>
  <div id="plan-details" style="font-size: 13px; color: #666; margin: 8px 0;"></div>
  <button onclick="showUpgradePage()" style="
    background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
    color: white;
    padding: 8px 16px;
    border: none;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    margin-top: 8px;
  ">Upgrade Plan</button>
</div>
*/

// Update subscription info in menu
async function updateSubscriptionInfoInMenu() {
	const subscription = await getSubscriptionInfo();
	if (!subscription) return;

	const planNameEl = document.getElementById('plan-name');
	const planDetailsEl = document.getElementById('plan-details');

	if (planNameEl) {
		planNameEl.textContent =
			subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1) + ' Plan';
	}

	if (planDetailsEl) {
		if (subscription.plan === 'free') {
			planDetailsEl.innerHTML = `
        ${subscription.tripsThisMonth}/${subscription.maxTrips} trips used<br>
        Resets ${new Date(subscription.resetDate).toLocaleDateString()}
      `;
		} else {
			planDetailsEl.textContent = '✓ Unlimited trips';
		}
	}
}

// Show upgrade page
function showUpgradePage() {
	closeMenu();
	showUpgradeModal();
}
