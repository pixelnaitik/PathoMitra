import { expect, test, _electron as electron } from '@playwright/test';
import path from 'node:path';

test('Electron main, preload, protocol, and encrypted repository bridge start together', async () => {
  const app = await electron.launch({ args: [path.resolve('.')] });
  try {
    const window = await app.firstWindow();
    await expect(window).toHaveTitle('PathoMitra');
    const bridge = await window.evaluate(() => {
      const api = window.pathomitraDesktop;
      return api ? {
        kind: api.kind,
        canInit: typeof api.db.init === 'function',
        canListenForLock: typeof api.session.onState === 'function',
        canListPrinters: typeof api.print.printers === 'function',
      } : null;
    });
    expect(bridge).toEqual({ kind: 'desktop', canInit: true, canListenForLock: true, canListPrinters: true });
    await app.close();
  } finally {
    if (app.process()) await app.close();
  }
});
