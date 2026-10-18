import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the Android APK build.
 *
 * The web layer is the Vite production bundle in `dist/` — run `npm run build`
 * before `npx cap sync android` so the native project receives fresh assets.
 */
const config: CapacitorConfig = {
  appId: 'com.pathomitra.app',
  // Launcher label + the app-name line the OS shows in the biometric / print
  // sheets. Kept identical to the in-app brand ("PathoMitra"); the `appId` is
  // left as-is because changing it would orphan existing installs on upgrade.
  appName: 'PathoMitra',
  webDir: 'dist',
  backgroundColor: '#f5f5f7',
  server: {
    // Serve the bundled app over https://localhost so the WebView is a secure
    // context — required for Web Crypto (PBKDF2 password hashing). No network.
    androidScheme: 'https',
  },
  plugins: {
    SystemBars: {
      // index.html ships `viewport-fit=cover`, so the WebView can go edge-to-edge
      // and the header has to pad itself clear of the status bar. Declaring the
      // expected value up-front stops the bar from jumping into place once the
      // native side reads the meta tag after page commit.
      //
      // Which of the two paths a handset takes is decided by the *Android System
      // WebView* major version, not by this app (SystemBars.java:194): at 140+ the
      // insets pass through and `env(safe-area-inset-*)` is real; below that the
      // native side pads the decor view and hands CSS zeros. src/index.css takes
      // `max(env(), var(--safe-area-inset-*))`, which is correct on both — and it
      // is why the same APK laid out differently on two handsets before the
      // content clearance started composing `--safe-bottom` as well.
      initialViewportFitValueHint: 'cover',
      // `css` (the default) additionally mirrors the insets into the
      // --safe-area-inset-* custom properties that src/index.css falls back to.
      insetsHandling: 'css',
    },
    Keyboard: {
      // No `resizeOnFullScreen` here, deliberately. Keyboard.java returns from its
      // own resize workaround the moment `com.getcapacitor.plugin.SystemBars` is
      // on the classpath — and in Capacitor 8 that class ships inside core — so
      // the flag has no effect on this app, while SystemBars logs an explicit
      // warning against combining it with `insetsHandling: 'css'`. The IME is
      // already handled: SystemBars pads the decor view by `imeInsets.bottom`.
      // (Nothing in src/ imports @capacitor/keyboard either — no `show()` /
      // `setResizeMode()` call to preserve.)
    },
    CapacitorSQLite: {
      // Enables SQLCipher encryption of the on-device clinical database. The
      // plugin defaults this to true, but it is set explicitly so a config
      // change elsewhere can never silently produce a plaintext database.
      androidIsEncryption: true,
      iosIsEncryption: true,
    },
  },
};

export default config;
