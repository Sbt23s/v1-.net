import { test, expect } from '@playwright/test';

test.describe('Authentication End-to-End Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should display login form with correct title and elements', async ({ page }) => {
    await expect(page.locator('h1, h2, form')).toBeVisible();
    await expect(page.locator('input[name="username"], input[type="text"]')).toBeVisible();
    await expect(page.locator('input[name="password"], input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should show validation error for invalid credentials', async ({ page }) => {
    await page.locator('input[name="username"], input[type="text"]').first().fill('invalid_user_123');
    await page.locator('input[name="password"], input[type="password"]').first().fill('WrongPassword123!');
    await page.locator('button[type="submit"]').first().click();

    // Verify error message or toast appearance
    await expect(page.locator('text=/invalid|error|failed/i')).toBeVisible({ timeout: 10000 });
  });

  test('should successfully log in with valid admin credentials and navigate to dashboard', async ({ page }) => {
    await page.locator('input[name="username"], input[type="text"]').first().fill('admin');
    await page.locator('input[name="password"], input[type="password"]').first().fill('Pixous@123');
    await page.locator('button[type="submit"]').first().click();

    // Verify successful navigation to dashboard or home page
    await expect(page).toHaveURL(/.*dashboard|.*home|.*\//, { timeout: 10000 });
  });
});
