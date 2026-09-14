import { test, expect } from '@playwright/test';

test.describe('Leave Management End-to-End Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[name="username"], input[type="text"]').first().fill('admin');
    await page.locator('input[name="password"], input[type="password"]').first().fill('Pixous@123');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/.*dashboard|.*home|.*\//, { timeout: 10000 });
  });

  test('should navigate to leave page and load leave balances', async ({ page }) => {
    await page.goto('/leave');
    await expect(page.locator('body')).toBeVisible();

    // Verify leave section headings or buttons
    await expect(page.locator('text=/leave|balance|apply|request/i').first()).toBeVisible({ timeout: 10000 });
  });
});
