import { expect, test, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function launchIsolated() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-electron-e2e-'));
  const app = await electron.launch({
    args: [path.resolve('.'), `--user-data-dir=${userData}`],
  });
  return { app, userData };
}

test('Electron starts with an isolated profile and the complete trusted bridge', async () => {
  const { app, userData } = await launchIsolated();
  try {
    const window = await app.firstWindow();
    await expect(window).toHaveTitle(/^PathoMitra\b/);
    const actualUserData = await app.evaluate(({ app: electronApp }) =>
      electronApp.getPath('userData'),
    );
    expect(path.resolve(actualUserData)).toBe(path.resolve(userData));
    const bridge = await window.evaluate(() => {
      const api = window.pathomitraDesktop;
      return api
        ? {
            kind: api.kind,
            canInit: typeof api.db.init === 'function',
            canListenForLock: typeof api.session.onState === 'function',
            canListPrinters: typeof api.print.printers === 'function',
            canStreamPrint: ['begin', 'page', 'commit', 'cancel'].every(
              name => typeof api.print[name] === 'function',
            ),
          }
        : null;
    });
    expect(bridge).toEqual({
      kind: 'desktop',
      canInit: true,
      canListenForLock: true,
      canListPrinters: true,
      canStreamPrint: true,
    });
  } finally {
    if (app.process()) await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('renderer-initiated remote windows are denied', async () => {
  const { app, userData } = await launchIsolated();
  try {
    const window = await app.firstWindow();
    await expect(window).toHaveTitle(/^PathoMitra\b/);
    const before = app.windows().length;
    const opened = await window.evaluate(() => window.open('https://example.com/', '_blank'));
    expect(opened).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(app.windows()).toHaveLength(before);
  } finally {
    if (app.process()) await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
