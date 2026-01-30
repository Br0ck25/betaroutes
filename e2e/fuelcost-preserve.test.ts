import { expect, Route, test } from '@playwright/test';

test('E2E: Estimated Fuel Cost preserves user value after save+refresh', async ({ page }) => {
  test.setTimeout(60_000);

  // In-memory mock backend state
  const mockTrips: Array<Record<string, unknown>> = [];

  // Surface useful page console logs in test output
  page.on('console', (msg) => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

  // Mock /api/trips to persist and return our in-memory trips
  await page.route('/api/trips', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ status: 200, json: mockTrips });
      return;
    }

    if (method === 'POST') {
      const data = route.request().postDataJSON() as Record<string, unknown>;
      const newTrip = { ...(data || {}), id: 'e2e-trip-id' };
      // Simulate expense auto-create separately (not needed for this test)
      mockTrips.push(newTrip);
      await route.fulfill({ status: 201, json: newTrip });
      return;
    }

    await route.continue();
  });

  // Mock login endpoints
  const loginHandler = async (route: Route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        json: { token: 'fake-jwt', user: { id: 'u1', plan: 'pro' } }
      });
      return;
    }
    await route.continue();
  };
  await page.route('/api/login', loginHandler);
  await page.route('/login', loginHandler);

  // Minimal directions mock to avoid external calls
  await page.route(/api\/directions\/cache/, async (route) => {
    await route.fulfill({
      status: 200,
      json: { source: 'test', data: { distance: 16093, duration: 900 } }
    });
  });

  // Prevent external Google Maps
  await page.addInitScript(() => {
    // Avoid using `any` in tests; use a safe, minimal shape for the global `google` object
    const g = globalThis as unknown as { google?: Record<string, unknown> };
    g.google = g.google || { maps: { places: {} } };
  });

  // 1) Login + seed session (uses existing debug endpoint used by other e2e tests)
  await page.goto('/login');
  await page.getByLabel('Username or Email').fill('test@example.com');
  await page.getByLabel('Password').fill('password');
  const loginResponsePromise = page.waitForResponse(
    (r) =>
      (r.url().endsWith('/api/login') || r.url().endsWith('/login')) &&
      r.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  const loginResp = await loginResponsePromise;
  expect(loginResp.ok()).toBe(true);

  // Set a session cookie and client-side user cache (skip server debug seed when unavailable)
  const sessionId = 'e2e-session-1';
  await page.evaluate((sid) => (document.cookie = `session_id=${sid}; path=/`), sessionId);
  const origin = new URL(page.url()).origin;
  await page.context().addCookies([{ name: 'session_id', value: sessionId, url: origin }]);
  // Also set client-side auth cache so client-side navigation shows authenticated UI
  await page.evaluate(() => {
    localStorage.setItem('token', 'fake-jwt');
    localStorage.setItem(
      'user_cache',
      JSON.stringify({
        token: 'fake-jwt',
        id: 'u1',
        name: 'E2E User',
        email: 'e2e@example.com',
        plan: 'pro'
      })
    );
  });

  // Navigate to dashboard and open New Trip page via client-side navigation
  await page.goto('/dashboard');
  try {
    await page.getByRole('link', { name: 'New Trip' }).click();
  } catch {
    // Fallback: direct client-side navigation if link not present
    await page.goto('/dashboard/trips/new');
  }
  // Ensure we're on the New Trip page (retry if needed)
  try {
    await expect(page.locator('h1')).toContainText('New Trip', { timeout: 10000 });
  } catch {
    // As a last resort reload and check
    await page.reload();
    await expect(page.locator('h1')).toContainText('New Trip', { timeout: 10000 });
  }

  // Fill required fields
  await page.locator('#start-address').fill('100 Main St');
  await page.locator('#end-address').fill('200 Market Ave');
  // Wait for distances/directions to settle
  await page.waitForTimeout(500);

  // Basic
  await page.locator('#trip-date').fill('2025-01-01');
  await page.click('button:has-text("Continue")');

  // Costs: fill mpg/gasPrice and set estimated fuel cost to $15
  await page.locator('#mpg').fill('20');
  await page.locator('#gas-price').fill('0');
  // Ensure fuel cost input is visible and fill
  await page.locator('#fuel-cost').fill('15');
  // Blur to format
  await page.locator('#fuel-cost').press('Tab');

  // Save trip
  await page.click('button:has-text("Save Trip")');

  // Verify we returned to trips list
  await expect(page).toHaveURL(/\/dashboard\/trips/);

  // Navigate to edit page for created trip and refresh to simulate page reload
  await page.goto('/dashboard/trips/edit/e2e-trip-id');
  await page.reload();

  // Check the fuel cost input on edit page preserves the user-entered $15 (formatted to 2 decimals)
  const fuelInput = page.locator('#fuel-cost');
  await fuelInput.waitFor({ state: 'visible' });
  const val = await fuelInput.inputValue();
  expect(val).toBe('15.00');
});
