/**
 * electron-builder configuration — Windows first, MSIX as the Store artifact.
 *
 * Two targets on purpose:
 *   msix  — the Microsoft Store deliverable (beta target: version-pinned
 *           electron-builder, re-test after any upgrade — see PROJECT_MEMORY).
 *   nsis  — the mature hedge; if Store certification rejects the MSIX, the
 *           same CI run already produced a signed-ready installer exe.
 *
 * `buildResources` is NOT the default `build/` because the root .gitignore
 * pattern `build/` matches at any depth — default would make the MSIX tile
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
  files: ['dist/**', 'dist-electron/**'],
  // Native modules load from unpacked node_modules — asar cannot host .node files.
  asarUnpack: [
    'node_modules/better-sqlite3-multiple-ciphers/**',
    'node_modules/@napi-rs/keyring/**',
  ],
  win: {
    target: [
      { target: 'msix', arch: ['x64'] },
      { target: 'nsis', arch: ['x64'] },
    ],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    artifactName: 'PathoMitra-${version}-setup.${ext}',
  },
  msix: {
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
    enforcePackageIntegrity: true,
    createMsixbundle: true,
    createMsixupload: true,
    artifactName: 'PathoMitra-${version}.${ext}',
  },
  toolsets: {
    // Modern bundle carries makeappx/makepri; the legacy 2.6.0 one cannot do MSIX.
    winCodeSign: '1.1.0',
  },
  publish: null,
};
