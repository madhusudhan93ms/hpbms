// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Login & Core Application Load', () => {
  test('Verify Login Page elements and title', async ({ page }) => {
    // Open login page
    await page.goto('/login');

    // Verify page heading and branding
    await expect(page.getByRole('heading', { name: /Sri Vijaya Lakshmi Hospital/i })).toBeVisible();
    await expect(page.getByText(/Enter your official hospital credentials/i)).toBeVisible();

    // Fill credentials
    await page.getByLabel(/Account Email \/ Staff ID/i).fill('admin@hospital.com');
    await page.getByLabel('Password', { exact: true }).fill('Password123!');

    // Verify Submit Button exists and is enabled
    const submitBtn = page.getByRole('button', { name: /Sign In to Workstation/i });
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeEnabled();
  });
});
