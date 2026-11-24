import { expect, test } from '@playwright/test';

test('onboarding, recovery-key acknowledgement, dashboard, and accessible search', async ({ page }) => {
  await page.goto('/auth');
  await page.getByRole('button', { name: /I understand/i }).click();
  await page.getByLabel('Lab name').fill('E2E Clinical Lab');
  await page.getByLabel('Passcode', { exact: true }).fill('4417');
  await page.locator('#confirm-passcode').fill('4417');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: 'Save your recovery key' })).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue to PathoMitra' }).click();
  await expect(page.getByText('Recent patients', { exact: true })).toBeVisible();

  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Global search' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Search query' })).toBeFocused();
  await expect(page.locator('#main-content')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
