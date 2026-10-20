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
 *
 * (d) holds the production posture the shared web bundle cannot give itself: no
 * application menu, no DevTools, a Content-Security-Policy on every served
 * response, one permission at most, and a recovery path when a process dies.
 * Microsoft's certification requirements ask for exactly that (Store Policies
 * 10.2 security, 10.4.2 "must continue to run and remain responsive") and a
 * lab console full of patient records asks for it independently.
 */
import {
  Menu,
  app,
  BrowserWindow,
  dialog,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} from 'electron';
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

/**
 * Content Security Policy for the packaged shell, defined once and applied in
 * two places (see `protocol.handle` and `onHeadersReceived` in whenReady).
 *
 * The web deploy gets its CSP from `public/_headers` at Cloudflare Pages, and the
 * APK has no network at all — but nothing had ever set a policy here, so the
 * desktop renderer (which holds the SQLCipher key in memory and owns the whole
 * IPC bridge) would execute any injected markup with the full rights of the page.
 *
 * `'unsafe-inline'` for script/style is required, not lazy: index.html carries the
 * pre-paint theme bootstrap, the splash logo swap and the splash bar animation as
 * inline scripts. Everything else is locked down, and `frame-ancestors 'none'` is
 * what makes the IPC sender check in ipc.ts hard to defeat rather than merely
 * careful. `object-src 'none'` denies plugin content outright.
 *
 * `img-src`/`connect-src`/`worker-src` must keep `data:` and `blob:`: uploaded
 * brand logos are data: URLs (lib/brand-logo.ts), generated PDFs are blob: URLs
 * (lib/pdf-preview.ts), and pdfjs pulls its worker that way too.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
// `dist/` is the Vite desktop build (`base: './'`), resolved against the
// bundle location (`dist-electron/main.js` sits next to `dist/`).
const WEB_ROOT = path.join(import.meta.dirname, '../dist');
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/**
 * The permissions the renderer may ever hold — exactly one.
 *
 * Without a handler Chromium decides for itself, and it auto-grants some request
 * types (store review S-2). The console needs banners and nothing else: no
 * clipboard, no media, no geolocation, no external protocol, no MIDI.
 */
const ALLOWED_PERMISSIONS = new Set<string>(['notifications']);

/** Follow the Windows "Choose your mode" setting for the first paint. */
nativeTheme.themeSource = 'system';

/** Single-window app: a second launch just focuses the first. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Windows keys the taskbar entry off the AppUserModelID: without ours set,
// the window rides Electron's generic identity and the taskbar shows the
// blue Electron atom no matter what icon the window itself carries.
app.setAppUserModelId('com.pathomitra.desktop');

/**
 * Keep a dead process from becoming a dead window (store review MS-W2).
 *
 * Policy 10.4.2 expects a product to stay responsive and to handle exceptions
 * raised by system APIs. Before this, a crashed renderer left a permanently
 * blank frame with no menu and no reload route — the only way out was Task
 * Manager, in a console holding patient records on screen.
 */
function attachRecovery(win: BrowserWindow): void {
  const fail = (reason: string) => {
    if (win.isDestroyed()) return;
    void dialog
      .showMessageBox(win, {
        type: 'error',
        title: 'PathoMitra',
        message: 'The lab console stopped responding.',
        detail:
          `${reason}\n\nRecords are written to the encrypted database as you work, so reloading ` +
          'will not lose the current one.',
        buttons: ['Reload', 'Restart PathoMitra', 'Keep waiting'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) {
          if (!win.isDestroyed()) win.webContents.reload();
          return;
        }
        if (response === 1) {
          // `relaunch()` only *schedules* the next spawn — it does not stop this
          // process. Without the exit, the crashed instance keeps running, the
          // new one loses the single-instance lock, and "Restart PathoMitra"
          // quietly re-focuses the very window that just died.
          app.relaunch();
          app.exit(0);
        }
      });
  };

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('PathoMitra desktop: renderer gone', details);
    if (details.reason !== 'clean-exit') fail(`The page process ${details.reason}.`);
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    // ERR_ABORTED is normal navigation churn (a reload replacing an in-flight
    // load), not a failure the operator can act on.
    if (errorCode === -3) return;
    console.error('PathoMitra desktop: load failed', errorCode, errorDescription, validatedUrl);
    fail(`${errorDescription} (${errorCode}) loading ${validatedUrl}`);
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    // The first frame is painted before any CSS loads, so it has to already be
    // the right mode — a hardcoded light grey flashed white at every dark-mode
    // launch (store review MS-W3).
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0c' : '#f5f5f7',
    title: 'PathoMitra',
    // Title-bar + taskbar icon: the multi-size favicon.ico (16/32/48 px, built
    // from the P-ribbon logo by scripts/make-favicon-assets.ps1) so Windows
    // picks the crisp size per surface. Missing file → empty image → falls
    // back to the exe icon in a packaged build, which electron-builder paints
    // from desktop-resources/icon.png anyway.
    icon: nativeImage.createFromPath(path.join(WEB_ROOT, 'favicon.ico')),
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // A packaged clinical console has no business offering a JavaScript
      // console over live patient records.
      devTools: !app.isPackaged,
    },
  });

  // Served through the privileged scheme handler registered in whenReady.
  void win.loadURL(`${SCHEME}://app/index.html`);
  attachRecovery(win);

  if (app.isPackaged) {
    // The other door into DevTools: right-click → Inspect Element.
    win.webContents.on('context-menu', event => event.preventDefault());
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    // No in-app popups; anything trying to open a window goes to the default
    // browser, which for an offline lab app means nothing we ship.
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  /* ----------------------------------------------------------------------- */
  /* Store review MS-W1 / Cap-13.                                              */
  /*                                                                          */
  /* Nothing ever replaced Electron's default application menu, so a packaged  */
  /* build shipped View -> Toggle Developer Tools, Reload, Force Reload and    */
  /* Toggle Full Screen sitting over live patient records — a reviewer only    */
  /* had to press Alt to find it. In development the menu stays, because       */
  /* Reload is how the shell is iterated on.                                  */
  /* ----------------------------------------------------------------------- */
  if (app.isPackaged) Menu.setApplicationMenu(null);

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
    const fetched = await net.fetch(pathToFileURL(file).toString());
    // The CSP is attached HERE as well as in `onHeadersReceived`, because a
    // custom-scheme response built by `protocol.handle` is not guaranteed to
    // pass through the webRequest header hooks — and a policy that silently
    // never reaches the document is worse than no policy, since it reads as
    // protection in a review.
    const headers = new Headers(fetched.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return new Response(fetched.body, { status: fetched.status, headers });
  });

  registerIpc();

  /* ----------------------------------------------------------------------- */
  /* The same policy, on every other response the session sees.               */
  /* ----------------------------------------------------------------------- */
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });

  /* ----------------------------------------------------------------------- */
  /* Permission denials by default.                                          */
  /*                                                                          */
  /* Nothing in this app asks for a device capability — there is no camera,   */
  /* microphone, geolocation, notification or external-protocol use in the    */
  /* desktop build — so the safe policy is to deny every request and let one  */
  /* exception through, rather than to rely on nobody ever asking. Chromium     */
  /* grants some permissions implicitly when no handler is installed at all.   */
  /* ----------------------------------------------------------------------- */
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      const granted = ALLOWED_PERMISSIONS.has(permission);
      if (!granted) {
        console.warn(
          `PathoMitra desktop: denied permission "${permission}"` +
            (details?.requestingUrl ? ` requested by ${details.requestingUrl}` : ''),
        );
      }
      callback(granted);
    },
  );
  // Electron 28+ checks this one separately; without it a permission the request
  // handler would allow can still be silently granted by the OS-level check.
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  );

  // Runtime enforcement of the offline guarantee. The renderer has no reason
  // to reach the network — same posture as the APK shipping without the
  // INTERNET permission — so every remote request is refused rather than
  // trusted to "we simply don't call anything". Checked on the webContents so
  // subresources, fetch and websockets are all covered.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    // The app's OWN traffic stays allowed in every build mode: the privileged
    // scheme serves the bundle, `net.fetch(file://…)` answers that scheme
    // handler, and data:/blob: back in-page resources. Refusing them when
    // packaged would blank the window outright — the offline guarantee is
    // about remote schemes (http/https/ws/wss), not local ones, so the allow
    // list is identical in dev and in the installer.
    const allow = app.isPackaged
      ? /^pathomitra:|^file:|^data:|^blob:|^about:/i.test(details.url)
      : /^pathomitra:|^file:|^devtools:|^data:|^blob:|^chrome-extension:|^about:/i.test(
          details.url,
        );
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

// GPU/network/utility crashes degrade but do not blank the window; log them so a
// lab reporting odd behaviour leaves behind something to read. This one is an
// app-level event (Electron puts it on `app`, not on `webContents`).
app.on('child-process-gone', (_event, details) => {
  console.error('PathoMitra desktop: child process gone', details);
});

// Windows convention: closing the last window quits the app.
app.on('window-all-closed', () => app.quit());

/**
 * Last line of defence for the main process (store review MS-W2).
 *
 * An uncaught error in the main process is not like one in the renderer: there is
 * no React boundary above it, and Node's default is to tear the process down —
 * which in a lab console means the window vanishes mid-report. Keep the app up,
 * say what happened, and let the operator decide whether to carry on. The renderer
 * keeps its own handlers (`src/lib/telemetry.ts`); this is the other half.
 */
process.on('uncaughtException', (error: unknown) => {
  console.error('PathoMitra desktop: uncaught exception in the main process', error);
  void dialog.showMessageBox({
    type: 'error',
    title: 'PathoMitra',
    message: 'PathoMitra hit an unexpected error.',
    detail: String((error as Error)?.stack ?? error),
    buttons: ['OK'],
    noLink: true,
  });
});

process.on('unhandledRejection', (reason: unknown) => {
  // Logged, not dialog-ed: a rejected promise with no handler is a bug to fix,
  // not necessarily something the operator can act on.
  console.error('PathoMitra desktop: unhandled rejection in the main process', reason);
});
