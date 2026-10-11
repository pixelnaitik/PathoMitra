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
import { app, BrowserWindow, net, protocol, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerIpc } from './ipc';

/**
 * Serve the bundle over a privileged custom scheme — the same posture the APK
 * gets from Capacitor's `https://localhost` and for the same reasons:
 *   - secure context → WebCrypto (PBKDF2) and WebAuthn/Windows Hello work;
 *   - a real origin + path namespace → `history.replaceState('/auth')` and
 *     BrowserRouter behave exactly as on web (under file:// they do not);
 *   - unknown paths fall back to index.html, so client routes survive reloads.
 */
const SCHEME = 'pathomitra';
// `dist/` is the Vite desktop build (`base: './'`), resolved against the
// bundle location (`dist-electron/main.js` sits next to `dist/`).
const WEB_ROOT = path.join(import.meta.dirname, '../dist');
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

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

  // Served through the privileged scheme handler registered in whenReady.
  void win.loadURL(`${SCHEME}://app/index.html`);

  win.webContents.setWindowOpenHandler(({ url }) => {
    // No in-app popups; anything trying to open a window goes to the default
    // browser, which for an offline lab app means nothing we ship.
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, async request => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname);
    // Path-traversal guard: only anything under webRoot may be read.
    const target = path.normalize(path.join(WEB_ROOT, rel === '/' ? 'index.html' : rel));
    if (!target.startsWith(WEB_ROOT + path.sep) && target !== WEB_ROOT) {
      return new Response('Forbidden', { status: 403 });
    }
    const file =
      fs.existsSync(target) && fs.statSync(target).isFile()
        ? target
        : path.join(WEB_ROOT, 'index.html');
    return net.fetch(pathToFileURL(file).toString());
  });

  registerIpc();

  // Runtime enforcement of the offline guarantee. The renderer has no reason
  // to reach the network — same posture as the APK shipping without the
  // INTERNET permission — so every non-file request is refused rather than
  // trusted to "we simply don't call anything". Checked on the webContents so
  // subresources, fetch and websockets are all covered.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    // Custom-scheme and local-UI traffic stays; anything truly remote is refused.
    const allow = app.isPackaged
      ? false
      : /^pathomitra:|^file:|^devtools:|^data:|^blob:/i.test(details.url);
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
