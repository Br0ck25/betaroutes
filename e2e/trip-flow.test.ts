import { test, expect } from '@playwright/test';

test('Critical Path: Create and view a new trip', async ({ page }) => {
  // --- 1. Mock Data Store ---
  const mockTrips: any[] = [];

  // --- 2. Mock Network APIs ---
  await page.route('/api/trips', async (route) => {
    const method = route.request().method();
    
    if (method === 'GET') {
      // Return our local array of trips
      await route.fulfill({ json: mockTrips });
    } 
    else if (method === 'POST') {
      // Simulate saving a trip
      const data = route.request().postDataJSON();
      const newTrip = { ...data, id: 'test-trip-id', netProfit: 150.50 }; // Add dummy calculated fields
      mockTrips.push(newTrip);
      await route.fulfill({ status: 201, json: newTrip });
    } 
    else {
      await route.continue();
    }
  });

  // Mock Login API (server action at /login and legacy /api/login)
  await page.route('**/login', async (route) => {
    const method = route.request().method();
    if (method === 'POST') {
      await route.fulfill({
        status: 200,
        json: { token: 'fake-jwt', user: { id: 'u1', name: 'Test User', plan: 'pro' } }
      });
    } else {
      await route.continue();
    }
  });

  // Keep legacy api route stub just in case
  await page.route('/api/login', async (route) => {
    await route.fulfill({
      status: 200,
      json: { token: 'fake-jwt', user: { id: 'u1', name: 'Test User', plan: 'pro' } }
    });
  });

  // --- 3. Mock Google Maps (Prevent external calls) ---
  await page.addInitScript(() => {
    // Use bracket-access to avoid TypeScript-only casts inside the serialized script
    window['google'] = {
      maps: {
        places: {
          Autocomplete: class {
            addListener() {}
            getPlace() { return { geometry: { location: { lat: () => 40.7128, lng: () => -74.0060 } } }; }
          },
          AutocompleteService: class {
            getPlacePredictions(req, cb) { cb([], 'OK'); }
          },
          PlacesService: class {
            getDetails(req, cb) { cb({ geometry: { location: { lat: () => 0, lng: () => 0 } } }, 'OK'); }
          },
          AutocompleteSessionToken: class {}
        },
        DirectionsService: class {
          route(req, cb) {
            // Return a fake 10-mile, 15-minute route
            cb({
              routes: [{
                legs: [{
                  distance: { value: 16093 }, // 10 miles in meters
                  duration: { value: 900 }    // 15 mins in seconds
                }]
              }]
            }, 'OK');
          }
        },
        TravelMode: { DRIVING: 'DRIVING' },
        UnitSystem: { IMPERIAL: 0 },
        DirectionsStatus: { OK: 'OK' },
        places: { PlacesServiceStatus: { OK: 'OK' } }
      }
    };
  });

  // --- TEST EXECUTION ---

  // 1. Log In
  await page.goto('/login');
  // Fill dummy credentials (assuming standard login form exists)
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password').fill('password');
  // Submit and wait for navigation
  await Promise.all([
    page.waitForURL(/\/dashboard/),
    page.getByRole('button', { name: 'Sign In', exact: true }).click()
  ]);

  // Verify redirect to dashboard (redundant but explicit)
  await expect(page).toHaveURL(/\/dashboard/);

  // 2. Start New Trip
  await page.getByRole('link', { name: 'New Trip' }).click();
  await expect(page.locator('h1')).toContainText('New Trip');

  // Step 1: Basics
  // Fill date (defaults usually work, but let's be explicit)
  await page.locator('input[type="date"]').fill('2025-01-01');
  await page.click('button:has-text("Continue")');

  // Step 2: Route
  // Inputs found via ID or Placeholder from your Svelte file
  await page.locator('#start-address').fill('123 Start St');
  await page.locator('#end-address').fill('456 End Blvd');
  
  // Wait for "Calculation" (handled by our mock DirectionsService)
  // Click Continue to move to Step 3
  await page.click('button:has-text("Continue")');

  // Step 3: Costs
  await page.locator('#mpg').fill('25');
  await page.locator('#gas-price').fill('3.50');
  await page.click('button:has-text("Review")');

  // Step 4: Review
  // Check if our mock calculations appear
  await expect(page.locator('.review-tile')).toContainText('10 mi'); // 16093 meters / 1609.34 = 10 miles
  
  // Save
  await page.click('button:has-text("Save Trip")');

  // 3. Verify on Dashboard
  await expect(page).toHaveURL(/\/dashboard\/trips/);
  
  // Check if the card appears in the list
  // Matches the start address we entered
  await expect(page.locator('.trip-card')).toContainText('123 Start St');
});