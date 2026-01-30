// e2e/smoke.spec.ts
//
// Minimal smoke test to ensure the app loads
// Add your real E2E tests here as you build features

import { test, expect } from '@playwright/test';

test('homepage loads successfully', async ({ page }) => {
  await page.goto('/');

  // Check title
  await expect(page).toHaveTitle(/Go Route Yourself/);

  // Check main heading exists
  const heading = page.locator('h1');
  await expect(heading).toBeVisible();
});

test('login page is accessible', async ({ page }) => {
  await page.goto('/login');

  // Should have login form
  const form = page.locator('form');
  await expect(form).toBeVisible();
});

test('register page is accessible', async ({ page }) => {
  await page.goto('/register');

  // Should have registration form
  const form = page.locator('form');
  await expect(form).toBeVisible();
});

test('dashboard redirects to login when not authenticated', async ({ page }) => {
  await page.goto('/dashboard');

  // Should redirect to login
  await expect(page).toHaveURL(/\/login/);
});
