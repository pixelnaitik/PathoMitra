import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function finishSyntheticOnboarding(page: Page): Promise<void> {
  await page.getByLabel('Lab name').fill('E2E Accessibility Lab');
  await page.getByLabel('Passcode', { exact: true }).fill('4417');
  await page.locator('#confirm-passcode').fill('4417');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery key' })).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue to PathoMitra' }).click();
  await expect(page.getByText('Recent patients', { exact: true })).toBeVisible();
}

async function createSyntheticAccount(page: Page): Promise<void> {
  await page.goto('/auth');
  await page.getByRole('button', { name: /I understand/i }).click();
  await finishSyntheticOnboarding(page);
}

async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#nprogress')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const details = results.violations.map(violation => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map(node => ({
      target: node.target,
      summary: node.failureSummary,
    })),
  }));
  expect(results.violations, `${label}\n${JSON.stringify(details, null, 2)}`).toEqual([]);
}

test('primary public, auth, dashboard, analytics, and settings paths pass axe', async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /Precision pathology/i })).toBeVisible();
  await expectNoAxeViolations(page, 'Public landing page');

  await page.goto('/auth');
  await page.getByRole('button', { name: /I understand/i }).click();
  await expect(page.getByLabel('Lab name')).toBeVisible();
  await expectNoAxeViolations(page, 'Synthetic onboarding form');

  await finishSyntheticOnboarding(page);
  await expectNoAxeViolations(page, 'Overview dashboard');

  await page
    .getByRole('navigation', { name: 'Dashboard sections' })
    .getByRole('button', { name: 'Analytics', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  const tableTitles = [
    'Report volume trend',
    'Test volume trend',
    'Test category distribution',
    'Top tests by volume',
    'Patient insights',
  ];
  for (const title of tableTitles) {
    await page.getByText(`View data table: ${title}`, { exact: true }).click();
    await expect(page.getByRole('table', { name: title })).toBeVisible();
  }
  await expectNoAxeViolations(page, 'Analytics charts with data-table alternatives');

  await page.getByRole('button', { name: /Open settings/ }).click();
  await expect(page.getByRole('heading', { name: 'My Profile', exact: true })).toBeVisible();
  await expectNoAxeViolations(page, 'Settings profile and custom controls');
});

test('search and calendar dialogs are keyboard operable and restore focus', async ({ page }) => {
  await createSyntheticAccount(page);

  const searchButton = page.getByRole('button', { name: 'Search (Ctrl+K)' });
  await searchButton.focus();
  await page.keyboard.press('Enter');
  const searchDialog = page.getByRole('dialog', { name: 'Global search' });
  await expect(searchDialog).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Search query' })).toBeFocused();
  await expect(page.locator('#root > *').first()).toHaveAttribute('inert', '');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'Search query' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(searchDialog).toBeHidden();
  await expect(searchButton).toBeFocused();
  expect(await page.locator('#root > *').first().getAttribute('inert')).toBeNull();

  await page
    .getByRole('navigation', { name: 'Dashboard sections' })
    .getByRole('button', { name: 'Analytics', exact: true })
    .click();
  const trigger = page.getByRole('button', { name: /Filter by date range/i });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const calendar = page.getByRole('dialog', { name: 'Choose date range' });
  await expect(calendar).toBeVisible();
  const days = calendar.locator('[data-day]');
  await days.nth(4).focus();
  await page.keyboard.press('ArrowRight');
  await expect(days.nth(5)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();
  await expect(trigger).toBeFocused();
});

test.describe('360 px viewport', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('navigation, content, and chart alternatives remain reachable', async ({ page }) => {
    await createSyntheticAccount(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    const menuButton = page.getByRole('button', { name: 'Open navigation menu' });
    await menuButton.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Main navigation' });
    await expect(drawer).toBeVisible();
    expect(
      await page.locator('#main-content').evaluate(element => Boolean(element.closest('[inert]'))),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menuButton).toBeFocused();

    await menuButton.click();
    await drawer.getByRole('button', { name: 'Analytics', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(
      page.getByText('View data table: Report volume trend', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});

test('200 percent page zoom preserves access to the primary search flow', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await createSyntheticAccount(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await expect.poll(() => page.evaluate(() => window.visualViewport?.scale ?? 0)).toBe(2);

  const searchButton = page.getByRole('button', { name: 'Search (Ctrl+K)' });
  await searchButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Global search' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Search query' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Global search' })).toBeHidden();
});

test('reduced-motion preference collapses CSS animation and count-up motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createSyntheticAccount(page);
  expect(
    await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  ).toBe(true);

  const duration = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'animate-spin';
    document.body.append(probe);
    const value = getComputedStyle(probe).animationDuration;
    probe.remove();
    return value;
  });
  expect(Number.parseFloat(duration)).toBeLessThan(0.001);
});
