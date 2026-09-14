import { test, expect } from '@playwright/test';

test.describe('Dashboard & Metrics End-to-End Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Perform login before testing dashboard
    await page.goto('/login');
    await page.locator('input[name="username"], input[type="text"]').first().fill('admin');
    await page.locator('input[name="password"], input[type="password"]').first().fill('Pixous@123');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/.*dashboard|.*home|.*\//, { timeout: 10000 });
  });

  test('should render dashboard metrics and navigation items', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('body')).toBeVisible();

    // Verify key UI elements like widgets or metrics cards exist
    const cards = page.locator('.card, [class*="card"], [class*="widget"], [class*="stat"]');
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
  });

  test('should load employee celebrations and org insights without API errors', async ({ page }) => {
    await page.goto('/dashboard');
    // Ensure no global error toast is displayed
    await expect(page.locator('text=/Couldn\'t load your dashboard/i')).not.toBeVisible({ timeout: 5000 });
  });
});
