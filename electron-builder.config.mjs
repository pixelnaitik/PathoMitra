/**
 * electron-builder configuration — Windows first.
 *
 * Default artifact: a single self-contained **.msi** — double-click, one UAC
 * "Yes", and PathoMitra is installed for every account on the machine with a
 * Desktop and Start Menu shortcut. It is also the format lab IT can push with
 * GPO/SCCM (`msiexec /i PathoMitra-<version>.msi /qn`), and Windows Installer
 * never touches %APPDATA%\PathoMitra on uninstall, so the encrypted database
 * and the exported reports survive an upgrade or a removal.
 *
 * Choose another target with PM_WIN_TARGETS: `nsis` (per-user setup exe, no
 * elevation) or `appx`.
 *
 * msix is deliberately absent: electron-builder 26.15.3 has no msix target at
 * all (out/winPackager.js knows nsis/portable/nsis-web/squirrel/appx/msi/
 * msiwrapped — the last attempt died with "Unknown target: msix", see
 * .tmp/electron-builder.log), and MSIX is the wrong container for this app
 * because it redirects %APPDATA%\PathoMitra into the package LocalCache, which
 * Windows deletes on uninstall/repair.
 *
 * Corrected 2026-10-16 by the Store review (docs/ms-store-review-2026-10-16.md):
 * "the Store needs MSIX" was never quite true either. The Store ingests
 * .appx/.appxbundle/.appxupload as well as .msix*, and 26.15.3 does implement
 * the `appx` target below — `makeappx.exe` is installed on this machine. So the
 * Store route is a choice (submit the .msi under Policy 10.2.9, or build .appx),
 * not a toolchain blockage. The LocalCache argument against the *container* still
 * stands, and it is why the MSI route is the recommended one.
 *
 * `buildResources` is NOT the default `build/` because the root .gitignore
 * pattern `build/` matches at any depth — default would make the tile
 * logos silently un-committable.
 */
export default {
  appId: 'com.pathomitra.desktop',
  productName: 'PathoMitra',
  copyright: 'Copyright © 2026 Naitik Raj',
  directories: {
    output: 'release-desktop',
    buildResources: 'desktop-resources',
  },
  // Only the built artifacts go into the app payload; src/ stays out.
  //
  // The ignore list is not cosmetic. The 2.7.2 package measured 277 MB of asar
  // payload against a 7.75 MB application, because electron-builder also packs the
  // whole production dependency tree — and this package.json is shared by three
  // platforms, so the Windows build was shipping the Android stack: the Capacitor
  // plugins, @capacitor-community/sqlite → jeep-sqlite → @stencil/core (a compiler
  // toolchain) + sql.js (including asm.js debug builds) + a rollup native binary,
  // and pdfjs-dist's optional Node canvas (26 MB skia + 10 MB ICU data). None of
  // it is reachable from the desktop shell, which uses better-sqlite3-multiple-
  // ciphers and loads the renderer bundle over pathomitra://. Source maps, docs,
  // and the C/C++ build inputs of other packages were riding along too.
  //
  // That costs download time (Store Policies 10.4.4), widens the antivirus
  // heuristic surface (10.2.3), and — the part that actually blocked certification
  // — puts unsigned foreign binaries in front of a reviewer. `node
  // scripts/check-desktop-package.mjs` is what proves this list worked; the globs
  // themselves are not evidence.
  // What the desktop shell can actually load at runtime is three things: the
  // Electron API, `better-sqlite3-multiple-ciphers` and `@napi-rs/keyring`. That
  // is not a judgement — it is what `dist-electron/main.js` resolves, measured by
  // walking every `from`/`require()`/`import()` specifier in the built bundle
  // (2026-10-17, 2.7.7): the only bare specifiers are `electron` and `node:*`,
  // with those two names reached through `createRequire`. Every other production
  // dependency is RENDERER code that Vite already bundled into `/dist` — react,
  // recharts, framer-motion, jspdf, pdfjs-dist, zod — so packing them a second
  // time in `node_modules/` is a copy no process can ever open.
  //
  // The 2.7.7 build with only the Android-stack ignores above still measured a
  // 74.7 MB asar / 11 809 files / 100 packages for a 7.75 MB application, and
  // 12.42 MB of that was `better-sqlite3-multiple-ciphers/deps/sqlite3.c` — the
  // C amalgamation, an input to a compile that already happened. The list below
  // is the renderer-only half of the dependency tree, by name. It is written as
  // named exclusions rather than `!node_modules/**` on purpose: a blanket exclude
  // plus a re-include depends on pattern-order semantics that have not been
  // proven here, and if it silently dropped `bindings`, the app would fail to
  // open its database on the lab's machine instead of failing this build.
  //
  // Adding a dependency therefore needs no change here (it is bundled into /dist
  // by Vite); adding a NATIVE module does — it has to appear in `asarUnpack` too.
  // `scripts/check-desktop-package.mjs` is what proves any of it; the asar header
  // walk plus booting `win-unpacked/PathoMitra.exe` is the accepted evidence.
  files: [
    'dist/**',
    'dist-electron/**',
    '!node_modules/@capacitor/**',
    '!node_modules/@capacitor-community/**',
    '!node_modules/@capgo/**',
    '!node_modules/@aparajita/**',
    '!node_modules/jeep-sqlite/**',
    '!node_modules/sql.js/**',
    '!node_modules/@stencil/**',
    '!node_modules/rollup/**',
    '!node_modules/@rollup/**',
    '!node_modules/@napi-rs/canvas/**',
    '!node_modules/@napi-rs/canvas-*/*',
    '!node_modules/react/**',
    '!node_modules/react-dom/**',
    '!node_modules/react-router/**',
    '!node_modules/react-router-dom/**',
    '!node_modules/scheduler/**',
    '!node_modules/recharts/**',
    '!node_modules/victory-vendor/**',
    '!node_modules/d3-*/**',
    '!node_modules/decimal.js-light/**',
    '!node_modules/framer-motion/**',
    '!node_modules/motion/**',
    '!node_modules/motion-dom/**',
    '!node_modules/motion-utils/**',
    '!node_modules/lucide-react/**',
    '!node_modules/zod/**',
    '!node_modules/@reduxjs/**',
    '!node_modules/redux/**',
    '!node_modules/react-redux/**',
    '!node_modules/reselect/**',
    '!node_modules/immer/**',
    '!node_modules/pdfjs-dist/**',
    '!node_modules/jspdf/**',
    '!node_modules/jspdf-autotable/**',
    '!node_modules/html2canvas/**',
    '!node_modules/canvg/**',
    '!node_modules/svg-pathdata/**',
    '!node_modules/stackblur-canvas/**',
    '!node_modules/dompurify/**',
    '!node_modules/fast-png/**',
    '!node_modules/pako/**',
    '!node_modules/jszip/**',
    '!node_modules/fflate/**',
    '!node_modules/core-js/**',
    '!node_modules/@babel/**',
    '!node_modules/localforage/**',
    '!node_modules/tailwind-merge/**',
    '!node_modules/es-toolkit/**',
    '!node_modules/utrie/**',
    '!node_modules/css-line-break/**',
    '!node_modules/text-segmentation/**',
    '!node_modules/readable-stream/**',
    '!node_modules/better-sqlite3-multiple-ciphers/deps/**',
    '!**/*.map',
    '!**/*.md',
    '!**/prebuilds/darwin-*.node',
    '!**/prebuilds/linux-*.node',
    '!**/prebuilds/linuxmusl-*.node',
    '!**/prebuilds/win32-arm64.node',
  ],
  // Native modules load from unpacked node_modules — asar cannot host .node files.
  asarUnpack: [
    'node_modules/better-sqlite3-multiple-ciphers/**',
    'node_modules/@napi-rs/keyring/**',
  ],
  win: {
    target: (process.env.PM_WIN_TARGETS ?? 'msi')
      .split(',')
      .filter(Boolean)
      .map(name => ({ target: name.trim(), arch: ['x64'] })),
    // Microsoft Store Policies 10.2.9 requires the installer binary *and every
    // Portable Executable file it installs* to be signed by a certificate
    // chaining to a Microsoft Trusted Root CA participant. The 2.7.2 build
    // measured 16 of 18 PEs unsigned, because electron-builder signs only the
    // app executable unless told otherwise — and 26.15.3 has no `signDlls`
    // option (verified against node_modules/app-builder-lib/out/options/
    // winOptions.d.ts:64-70); `signExts` is its replacement. Unknown keys are
    // silently ignored at this version, so this must be the real one.
    signExts: ['.dll', '.node'],
    // The certificate itself comes from the environment, never from this file:
    //   WIN_CSC_LINK / PM_WIN_CSC_LINK          → path to the .pfx, or the
    //                                             string "<your-windows-store-cert>"
    //   WIN_CSC_KEY_PASSWORD / CSC_KEY_PASSWORD → its password
    // Azure Trusted Signing is an alternative: set `azureSignOptions` here instead
    // (the two cannot coexist). With no certificate configured the build still
    // succeeds and ships unsigned, which is exactly why the artifact gate — not
    // this config — is what says whether a build may be submitted.
    signtoolOptions: {
      signingHashAlgorithms: ['sha256'],
      rfc3161TimeStampServer: 'http://timestamp.acs.microsoft.com',
    },
  },
  msi: {
    // Double-click → progress → installed. The wizard only appears if this is
    // set to false (electron-builder then pulls in the WiX UI extension).
    oneClick: true,
    // Program Files, one install shared by every Windows account, shortcut on
    // the public Desktop. Costs a single UAC prompt; this is also the scope
    // GPO/SCCM assignment needs.
    perMachine: true,
    // 'always' re-creates the link on a reinstall even if the operator deleted
    // it — a lab PC's desktop gets tidied by hand.
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'PathoMitra',
    // No "Naitik Raj" submenu: one clinical app, straight into the Start Menu.
    menuCategory: false,
    runAfterFinish: true,
    artifactName: 'PathoMitra-${version}.${ext}',
  },
  nsis: {
    // The per-user alternative (PM_WIN_TARGETS=nsis): no elevation, installs
    // into %LOCALAPPDATA%\Programs, still leaves a Desktop shortcut.
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'PathoMitra',
    runAfterFinish: true,
    // Uninstall must never take the lab's data with it (MSI has no such option
    // — it simply does not touch the app folders).
    deleteAppDataOnUninstall: false,
    uninstallDisplayName: 'PathoMitra',
    artifactName: 'PathoMitra-${version}-setup.${ext}',
  },
  appx: {
    // Reserved for the Store listing; must match the Partner Center reservation.
    identityName: 'PathoMitra.PathoMitra',
    // Only used for sideload signing — the Store re-signs on submission.
    publisher: 'CN=Naitik Raj',
    publisherDisplayName: 'Naitik Raj',
    displayName: 'PathoMitra',
    // Offline app: deliberately nothing beyond the Electron-mandatory capability.
    capabilities: ['runFullTrust'],
    minVersion: '10.0.17763.0', // Windows 10 1809 — Store floor
    maxVersionTested: '10.0.26100.0', // Windows 11 24H2
    artifactName: 'PathoMitra-${version}.${ext}',
  },
  toolsets: {
    // Modern bundle carries makeappx/makepri; the legacy 2.6.0 one cannot do MSIX.
    winCodeSign: '1.1.0',
  },
  publish: null,
};
