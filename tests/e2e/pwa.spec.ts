import { expect, test } from '@playwright/test';

test('service worker caches only the public static allowlist and never API-like data', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /Precision pathology/i })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await fetch('/api/synthetic-patients.json');
    await fetch('/backups/synthetic-backup.json');
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  const cachedUrls = await page.evaluate(async () => {
    const keys = await caches.keys();
    const entries = await Promise.all(
      keys.map(async key => (await (await caches.open(key)).keys()).map(request => request.url)),
    );
    return entries.flat();
  });
  expect(
    cachedUrls.some(url => /\/api\/|\/backups\/|patient|auth/i.test(new URL(url).pathname)),
  ).toBe(false);
  for (const url of cachedUrls) {
    const pathname = new URL(url).pathname;
    expect(
      pathname === '/' ||
        pathname === '/index.html' ||
        pathname === '/manifest.json' ||
        pathname.startsWith('/assets/') ||
        pathname.startsWith('/favicon') ||
        pathname.startsWith('/android-chrome-') ||
        pathname === '/apple-touch-icon.png',
    ).toBe(true);
  }

  await context.setOffline(true);
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response?.ok()).toBe(true);
  expect(await page.locator('body').innerText()).toContain('PathoMitra');
  await context.setOffline(false);
});
