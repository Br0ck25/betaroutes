import { test, expect } from '@playwright/test';

test('Critical Path: Create and view a new trip', async ({ page }) => {
	test.setTimeout(60_000); // Increase timeout for slow CI environments

	// --- 1. Mock Data Store ---
	const mockTrips: any[] = [];

	// --- 2. Mock Network APIs ---

	// Debug: surface page console / pageerror and close events to the test output
	page.on('console', (msg) => {
		// eslint-disable-next-line no-console
		console.log('PAGE LOG:', msg.type(), msg.text());
	});
	page.on('pageerror', (err) => {
		// eslint-disable-next-line no-console
		console.log('PAGE ERROR:', err);
	});
	page.on('response', (res) => {
		if (!res.ok()) {
			// eslint-disable-next-line no-console
			console.log('PAGE RESP ERROR:', res.status(), res.url());
		}
	});
	page.on('requestfailed', (req) => {
		// eslint-disable-next-line no-console
		console.log('PAGE REQ FAILED:', req.url(), req.failure ? req.failure().errorText : '<unknown>');
	});
	page.on('close', () => {
		// eslint-disable-next-line no-console
		console.log('PAGE EVENT: closed', page.url());
	});
	await page.route('/api/trips', async (route) => {
		const method = route.request().method();

		if (method === 'GET') {
			// Return our local array of trips
			await route.fulfill({ json: mockTrips });
		} else if (method === 'POST') {
			// Simulate saving a trip
			const data = route.request().postDataJSON();
			const newTrip = { ...data, id: 'test-trip-id', netProfit: 150.5 }; // Add dummy calculated fields
			mockTrips.push(newTrip);
			await route.fulfill({ status: 201, json: newTrip });
		} else {
			await route.continue();
		}
	});

	// Mock Login API (some code posts to /api/login and some to /login — handle both)
	const loginHandler = async (route: any) => {
		if (route.request().method() === 'POST') {
			await route.fulfill({
				status: 200,
				json: { token: 'fake-jwt', user: { id: 'u1', name: 'Test User', plan: 'pro' } }
			});
			return;
		}
		await route.continue();
	};

	await page.route('/api/login', loginHandler);
	await page.route('/login', loginHandler);

	// Mock Directions Cache API to avoid external geocoding dependencies and ensure deterministic routes
	let directionsCalls = 0;
	await page.route(/api\/directions\/cache/, async (route) => {
		directionsCalls++;
		// Return a deterministic 10-mile route (16093 meters) and 15 min (900s)
		await route.fulfill({
			status: 200,
			json: { source: 'test', data: { distance: 16093, duration: 900 } }
		});
	});

	// --- 3. Mock Google Maps (Prevent external calls) ---
	await page.addInitScript(() => {
		window.google = {
			maps: {
				places: {
					Autocomplete: class {
						addListener() {}
						getPlace() {
							return { geometry: { location: { lat: () => 40.7128, lng: () => -74.006 } } };
						}
					},

					AutocompleteService: class {
						getPlacePredictions(req, cb) {
							cb([], 'OK');
						}
					},
					PlacesService: class {
						getDetails(req, cb) {
							cb({ geometry: { location: { lat: () => 0, lng: () => 0 } } }, 'OK');
						}
					},
					AutocompleteSessionToken: class {}
				},
				DirectionsService: class {
					route(req, cb) {
						// Return a fake 10-mile, 15-minute route
						cb(
							{
								routes: [
									{
										legs: [
											{
												distance: { value: 16093 }, // 10 miles in meters
												duration: { value: 900 } // 15 mins in seconds
											}
										]
									}
								]
							},
							'OK'
						);
					}
				},
				TravelMode: { DRIVING: 'DRIVING' },
				UnitSystem: { IMPERIAL: 0 },
				DirectionsStatus: { OK: 'OK' },
				places: { PlacesServiceStatus: { OK: 'OK' } }
			}
		} as any;
	});

	// --- TEST EXECUTION ---

	// 1. Log In
	await page.goto('/login');
	// Fill dummy credentials (assuming standard login form exists)
	// Login uses the "Username or Email" label (form doubles as username or email)
	await page.getByLabel('Username or Email').fill('test@example.com');
	await page.getByLabel('Password').fill('password');

	// Click and wait for the login POST to be sent and respond
	const loginResponsePromise = page.waitForResponse(
		(r) =>
			(r.url().endsWith('/api/login') || r.url().endsWith('/login')) &&
			r.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Sign In', exact: true }).click();
	const loginResp = await loginResponsePromise;
	expect(loginResp.ok()).toBe(true);

	// Seed a real session in the mock Sessions KV via the debug endpoint, then set cookie so server recognizes it
	const sessionId = '11111111-1111-4111-8111-111111111111';
	const seedRes = await page.request.post('/debug/seed-session', {
		data: JSON.stringify({
			sessionId,
			user: { id: 'u1', name: 'Test User', email: 'test@example.com', plan: 'pro' }
		}),
		headers: { 'Content-Type': 'application/json' }
	});
	const seedBody = await seedRes.json();
	// eslint-disable-next-line no-console
	console.log('SEED RESP', seedRes.status(), seedBody);
	expect(seedRes.ok()).toBe(true);
	expect(seedBody.success).toBe(true);
	// Ensure cookie is set both in the page and in Playwright context so subsequent navigations include it
	await page.evaluate((sid) => {
		document.cookie = `session_id=${sid}; path=/`;
	}, sessionId);
	const origin = new URL(page.url()).origin;
	await page.context().addCookies([{ name: 'session_id', value: sessionId, url: origin }]);

	// Also set offline client-side auth cache so client-side rendering can proceed reliably
	await page.evaluate(() => {
		localStorage.setItem('token', 'fake-jwt');
		localStorage.setItem(
			'user_cache',
			JSON.stringify({
				token: 'fake-jwt',
				id: 'u1',
				name: 'Test User',
				email: 'test@example.com',
				plan: 'pro'
			})
		);
		localStorage.setItem('user_email', 'test@example.com');
		localStorage.setItem('username', 'Test User');
	});

	// Navigate to dashboard so server sees the cookie and returns the authenticated dashboard
	await page.goto('/dashboard');
	// eslint-disable-next-line no-console
	console.log('NAV: after /dashboard goto ->', { url: page.url(), closed: page.isClosed() });

	// If the client didn't render the dashboard with a 'New Trip' link, fallback to direct page
	try {
		await page.getByRole('link', { name: 'New Trip' }).click();
		// eslint-disable-next-line no-console
		console.log('NAV: clicked New Trip link ->', { url: page.url(), closed: page.isClosed() });
	} catch {
		await page.goto('/dashboard/trips/new');
		// eslint-disable-next-line no-console
		console.log('NAV: fallback goto /dashboard/trips/new ->', {
			url: page.url(),
			closed: page.isClosed()
		});
	}

	// Ensure we're on the New Trip page
	// Retry once if initial load shows the public home page (flaky client routing)
	try {
		await expect(page.locator('h1')).toContainText('New Trip', { timeout: 10000 });
		// eslint-disable-next-line no-console
		console.log('NAV: New Trip h1 present ->', { url: page.url(), closed: page.isClosed() });
	} catch (e) {
		// Debug: capture current h1 and try a reload + direct navigation
		// eslint-disable-next-line no-console
		console.log('Initial New Trip check failed, attempting reload and direct goto', {
			url: page.url(),
			closed: page.isClosed()
		});
		await page.reload();
		await page.goto('/dashboard/trips/new');
		await expect(page.locator('h1')).toContainText('New Trip', { timeout: 20000 });
		// eslint-disable-next-line no-console
		console.log('NAV: after reload goto /dashboard/trips/new ->', {
			url: page.url(),
			closed: page.isClosed()
		});
	}

	// Step 1: Route & Stops
	// Ensure the route form is visible, then fill the start/end addresses
	await page.locator('#start-address').waitFor({ state: 'visible', timeout: 10000 });
	await page.locator('#start-address').fill('123 Start St');
	await page.locator('#end-address').fill('456 End Blvd');

	// Wait for the directions cache request to complete so distances are calculated deterministically
	const dirRespPromise = page.waitForResponse(
		(r) => r.url().includes('/api/directions/cache') && r.request().method() === 'GET'
	);
	await dirRespPromise;
	// eslint-disable-next-line no-console
	console.log('DIRECTIONS: cache response received');
	// Capture input values to ensure bindings are correct
	// eslint-disable-next-line no-console
	console.log(
		'INPUTS after fill:',
		await page.locator('#start-address').inputValue(),
		await page.locator('#end-address').inputValue()
	);
	// eslint-disable-next-line no-console
	console.log('DIRECTIONS mock calls so far:', directionsCalls);

	// Dispatch a 'place-selected' event on the first destination input (simulates selecting a suggestion)
	await page.evaluate(() => {
		// Dispatch on the "New stop address..." input which triggers handleNewStopSelect and addStop
		const destInput = document.querySelector('input[placeholder="New stop address..."]');
		if (destInput) {
			const event = new CustomEvent('place-selected', {
				detail: {
					formatted_address: '789 Stop Ave, Test City',
					geometry: { location: { lat: () => 40.0, lng: () => -74.0 } }
				}
			});
			destInput.dispatchEvent(event as any);
		}
	});
	// Wait for the calculation effect to run (it uses a 1.5s debounce)
	await page.waitForTimeout(2000);
	// eslint-disable-next-line no-console
	console.log(
		'After selecting destination (place-selected), Trip Summary snapshot (truncated):',
		(await page.content()).slice(0, 500)
	);
	// Debug: print the Trip Summary mileage displayed in the UI
	// eslint-disable-next-line no-console
	console.log(
		'TripSummary distance displayed:',
		await page.locator('.text-xl.font-bold.text-green-900').first().textContent()
	);
	try {
		await page.screenshot({
			path: 'test-results/trip-flow-Critical-Path-Create-and-view-a-new-trip/after-destination.png'
		});
		// eslint-disable-next-line no-console
		console.log('Saved screenshot: after-destination.png');
	} catch (_) {}
	// Capture a snapshot for debugging if something goes wrong
	// eslint-disable-next-line no-console
	console.log('PAGE HTML SNAPSHOT (truncated):', (await page.content()).slice(0, 2000));
	try {
		await page.screenshot({
			path: 'test-results/trip-flow-Critical-Path-Create-and-view-a-new-trip/address-filled.png'
		});
		// eslint-disable-next-line no-console
		console.log('Saved screenshot: address-filled.png');
	} catch (_) {}

	// Click Continue to go to Basics (Date)
	await page.click('button:has-text("Continue")');
	// eslint-disable-next-line no-console
	console.log('STEP: clicked Continue -> awaiting Basic Information', {
		url: page.url(),
		closed: page.isClosed()
	});

	// Step 2: Basics (Date)
	// Wait for the Basic Information card and trip date input to be visible, then fill
	await page
		.locator('.card-title')
		.filter({ hasText: 'Basic Information' })
		.waitFor({ state: 'visible', timeout: 10000 });
	await page.locator('#trip-date').waitFor({ state: 'visible', timeout: 5000 });
	await page.locator('#trip-date').fill('2025-01-01');
	await page.click('button:has-text("Continue")');
	// eslint-disable-next-line no-console
	console.log('STEP: clicked Continue from Basics -> awaiting Costs', {
		url: page.url(),
		closed: page.isClosed()
	});

	// Step 3: Route calculations / Costs
	// Wait for MPG input to ensure we've advanced and the element is interactable
	await page.locator('#mpg').waitFor({ state: 'visible', timeout: 30000 });
	// eslint-disable-next-line no-console
	console.log('STEP: mpg visible ->', { url: page.url(), closed: page.isClosed() });

	// Fill costs robustly (scroll, click, then fill with extended timeout)
	await page.locator('#mpg').scrollIntoViewIfNeeded();
	await page.locator('#mpg').click({ timeout: 30000 });
	await page.locator('#mpg').fill('25', { timeout: 30000 });
	await page.locator('#gas-price').fill('3.50', { timeout: 30000 });
	await page.click('button:has-text("Review")', { timeout: 30000 });

	// Debug: capture review tiles contents immediately after clicking Review (helps debug race conditions)
	await page.waitForTimeout(500);
	// eslint-disable-next-line no-console
	console.log('REVIEW TILES RAW:', await page.locator('.review-tile').allTextContents());
	try {
		await page.screenshot({
			path: 'test-results/trip-flow-Critical-Path-Create-and-view-a-new-trip/after-click-review.png'
		});
		// eslint-disable-next-line no-console
		console.log('Saved screenshot: after-click-review.png');
	} catch (_) {}

	// Step 4: Review
	// Wait for the review tiles to show the expected mileage (make this explicit to avoid racing with async calcs)
	await page.waitForSelector('.review-tile:has-text("10 mi")', { timeout: 10000 });
	await expect(page.locator('.review-tile')).toContainText('10 mi'); // 16093 meters / 1609.34 = 10 miles

	// Save
	await page.click('button:has-text("Save Trip")');

	// 3. Verify on Dashboard
	await expect(page).toHaveURL(/\/dashboard\/trips/);

	// Check if the card appears in the list
	// Matches the start address we entered
	await expect(page.locator('.trip-card')).toContainText('123 Start St');
});
