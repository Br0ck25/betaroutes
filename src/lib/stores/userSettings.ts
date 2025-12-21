// src/lib/stores/userSettings.ts
import { writable } from 'svelte/store';
import { storage } from '$lib/utils/storage';
import { browser } from '$app/environment';

// Align defaults with API schema
const defaultSettings = {
  startLocation: '',
  endLocation: '',
  defaultMPG: 25,
  defaultGasPrice: 3.50,
  distanceUnit: 'mi',
  timeFormat: '12h',
  expenseCategories: ['maintenance', 'insurance', 'supplies', 'other'],
  maintenanceCategories: ['oil change', 'tire rotation', 'repair', 'inspection', 'wash'],
  supplyCategories: ['water', 'snacks', 'cleaning', 'office', 'equipment'],
  
  // Business Information
  companyName: '',
  companyAddress: '',
  companyPhone: '',
  companyEmail: '',
  companyLogo: '', // base64 image data
  
  // Vehicle Information (for tax purposes)
  vehicleMake: '',
  vehicleModel: '',
  vehicleYear: '',
  vehicleOdometerStart: 0,
  businessUsePercentage: 100,
  
  // Service Types (for revenue tracking)
  serviceTypes: ['HughesNet', 'Starlink', 'Dish', 'Security Camera', 'Other'],
  
  // Export Customization
  pdfPrimaryColor: '#FF7F50', // Orange
  pdfSecondaryColor: '#34C759', // Green
  includeCharts: true,
  includeAnalytics: true,
  
  // Automation Settings
  autoExportEnabled: false,
  autoExportFrequency: 'monthly', // 'weekly', 'monthly', 'quarterly'
  autoExportEmail: '',
  autoExportTypes: ['tax-bundle'] // which exports to auto-generate
};

// 1. Start with defaults (Server matches Client initially)
export const userSettings = writable(defaultSettings);

// 2. Hydrate from Storage ONLY in the browser
if (browser) {
    try {
        const saved = storage.getSettings(); 
        // Merge defaults with saved to ensure integrity
        userSettings.set({ ...defaultSettings, ...saved });

        // 3. Auto-save changes
        userSettings.subscribe((value) => {
            storage.saveSettings(value);
        });
    } catch (e) {
        console.error('Failed to hydrate settings', e);
    }
}