/**
 * Electron main process — the Windows shell around the existing web bundle.
 *
 * Kept deliberately thin: every clinical screen, the catalogue and the report
 * engine live in `src/` and run in the renderer exactly as they do in the
 * Android WebView and the browser. This file only (a) opens the window on the
 * desktop build of `dist/`, (b) enforces the same offline guarantee the APK
 * gets from having no INTERNET permission, and (c) registers the IPC surface
 * the preload script exposes as `window.pathomitraDesktop`.
 *
 * Build entry is `dist-electron/main.cjs` (esbuild bundle of this file, set as
 * `main` in package.json). The native modules are loaded from node_modules at
 * runtime — electron-builder rebuilds them for the packaged app.
 */
import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';

/** Single-window app: a second launch just focuses the first. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#f5f5f7', // matches capacitor.config.ts — same first paint
    title: 'PathoMitra',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // The bundle ships with Vite `base: './'`, so absolute /assets URLs resolve
  // relative to dist/index.html under file://. Same secure-context story as
  // the APK's https://localhost scheme: WebCrypto (PBKDF2) and WebAuthn
  // (Windows Hello) are available under file:// in Chromium.
  void win.loadFile(path.join(import.meta.dirname, '../dist/index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    // No in-app popups; anything trying to open a window goes to the default
    // browser, which for an offline lab app means nothing we ship.
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  registerIpc();

  // Runtime enforcement of the offline guarantee. The renderer has no reason
  // to reach the network — same posture as the APK shipping without the
  // INTERNET permission — so every non-file request is refused rather than
  // trusted to "we simply don't call anything". Checked on the webContents so
  // subresources, fetch and websockets are all covered.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const allow = app.isPackaged ? false : /^file:|^devtools:|^data:|^blob:/i.test(details.url);
    callback({ cancel: !allow });
    if (!allow) console.warn(`PathoMitra desktop: blocked network request ${details.url}`);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// Windows convention: closing the last window quits the app.
app.on('window-all-closed', () => app.quit());
