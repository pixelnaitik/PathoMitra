# PathoMitra

> An offline-first digital pathology laboratory management system — patient records,
> encrypted reports, billing, and analytics, entirely on-device for Android and Desktop (Windows).

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![CI](https://github.com/pixelnaitik/PathoMitra/actions/workflows/ci.yml/badge.svg)
![Android](https://github.com/pixelnaitik/PathoMitra/actions/workflows/android.yml/badge.svg)
![Release](https://github.com/pixelnaitik/PathoMitra/actions/workflows/release.yml/badge.svg)

**PathoMitra** is built with React 19, Vite, Tailwind CSS, Electron, and Capacitor 8. It runs as a
desktop application on Windows, an Android mobile app, and a web app during development. Every clinical record
lives in an encrypted on-device database. It requests **no `INTERNET` permission** for the clinical app, talks
to no tracking backend, and contains zero third-party analytics or invasive crash reporting — the laboratory
owns and controls its data locally.

---

## Table of Contents

1. [Features](#features)
2. [Privacy & Security Model](#privacy--security-model)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Getting Started (Web)](#getting-started-web)
6. [Desktop Application (Electron)](#desktop-application-electron)
7. [Building for Android](#building-for-android)
8. [Command Reference](#command-reference)
9. [Quality Gates](#quality-gates)
10. [CI/CD & Releases](#cicd--releases)
11. [Versioning](#versioning)
12. [Documentation](#documentation)
13. [Security](#security)
14. [Contributing](#contributing)
15. [License](#license)

---

## Features

- **Multi-Platform Support** — Runs on Android tablets/phones (Capacitor) and Windows Desktop (Electron with native MSI/MSIX installers and DPI-aware printing).
- **Dashboard & Analytics** — Revenue, test volume, new patients and pending-report KPIs with charts, plus exportable CSVs.
- **Patient & Doctor Management** — Registration, quick search, doctor directories, and referral registers with calendar range filtering.
- **Billing & Invoices** — Built-in laboratory pricing management, billing receipts, and referral statement calculations.
- **Pathology Catalogue & Report Generation** — 160+ clinical test definitions (CBC, LFT, Lipid, Thyroid, Renal, Urine, etc.) rendered into clean PDFs with multiple design templates (*Modern*, *Classic*, *Minimalist*, *Pre-printed Letterhead*).
- **Keyboard-First Result Entry** — Rapid data entry designed for clinical lab technicians.
- **Custom Tests & Profiles** — Define custom test parameters, categories, units, and demographic reference ranges.
- **Drafts & Amendment Auditing** — Drafts remain strictly confidential; finalized reports record amendment history and issuing technician metadata.
- **Encrypted On-Device Database** — SQLCipher (AES-256) database with hardware-backed key management (Android Keystore / OS Keychain).
- **Notification Center** — Derives actionable local reminders for pending reports, unissued drafts, and stale bills with no remote push servers.
- **Local Authentication** — Single-operator security with PBKDF2 passcode hashing, rate-limiting lockout backoff, and optional biometric unlock.

There is deliberately **no QR verification service and no external signing endpoint** —
the offline build has no server, so a report states what actually happened (who issued
it, when) rather than asserting a check that cannot be performed. Accreditation or
licence text prints only if the laboratory enters and attests to it in Settings.

---

## Privacy & Security Model

| Control        | Implementation                                                                     |
| -------------- | ---------------------------------------------------------------------------------- |
| Network        | No `INTERNET` permission; no analytics, tracking or remote crash reporting         |
| Database       | SQLCipher (AES-256) via `@capacitor-community/sqlite`; key in the Android Keystore |
| Authentication | Single local operator; PBKDF2-hashed passcode; optional biometric unlock           |
| Sessions       | Re-lock on background / idle; rising lockout after failed unlocks                  |
| Release build  | `debuggable false`, R8 minification + resource shrinking                           |
| Backups        | Operator-created JSON snapshots; the app never transmits them                      |

---

## Tech Stack

- **Frontend:** React 19, React Router 7, Tailwind CSS 4, [Motion](https://motion.dev), Lucide React, Recharts
- **Shell:** Capacitor 8 (Android) with the community SQLCipher SQLite plugin, biometric auth and secure storage plugins
- **Data layer:** Encrypted on-device SQLite (SQLCipher) behind a collection/query façade in `src/data/`; Android Keystore for secrets
- **PDF:** jsPDF + jsPDF-AutoTable
- **Validation:** Zod — stored document shapes are schema-checked at the read boundary (`src/lib/models.ts`)
- **Build:** Vite 6 + esbuild; `VITE_TARGET=native` strips web-deploy assets from the APK
- **Quality:** TypeScript strict, ESLint with a warning ratchet in CI, Prettier, Vitest with a coverage gate, build guards that prove the APK carries no web artifacts and no placeholder privacy contact, husky `pre-commit`

---

## Project Structure

```
.
├── .github/
│   ├── CONTRIBUTING.md          # Contribution guide
│   ├── ISSUE_TEMPLATE/          # Bug / feature forms + security routing
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── dependabot.yml
│   └── workflows/
│       ├── ci.yml               # PR checks (lint, tests, build)
│       ├── deploy.yml           # main → Cloudflare Pages + privacy-site artifact
│       ├── release.yml          # tag → signed AAB + GitHub Release
│       └── android.yml          # tag / manual → AAB + APK artifacts
├── android/                     # Capacitor native project (Gradle wrapper, signing via ignored files)
├── docs/
│   ├── README.md                # Documentation index
│   ├── design/                  # UI design system tokens, typography, palettes
│   └── store/                   # Play Store and Microsoft Store listing and cert packs
├── patches/                     # patch-package fixes (e.g. @capgo/capacitor-printer)
├── public/                      # Static web assets (manifest, robots, sitemap, _headers)
├── scripts/                     # Build guards + privacy-policy site generator
├── src/
│   ├── components/              # Shared UI; components/ui holds the design-system primitives
│   ├── contexts/                # AuthContext (local operator session)
│   ├── data/                    # On-device data layer: collection façade over SQLCipher
│   ├── hooks/                   # useCollectionList, useNotifications, useNetworkStatus, …
│   ├── lib/                     # Framework-free domain logic + unit tests
│   ├── pages/                   # Route-level components (auth/, dashboard/, public)
│   └── test/                    # Vitest setup
├── capacitor.config.ts          # Native shell config (https scheme, SQLCipher on)
├── vite.config.ts / vitest.config.ts / eslint.config.js / tsconfig.json
├── CHANGELOG.md · LICENSE · README.md · SECURITY.md
```

---

## Getting Started (Web)

### Prerequisites

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) **20.19 or newer** (enforced by `engines.node`, used by CI)
- A code editor such as [VS Code](https://code.visualstudio.com/)

No account, backend or API key is required — the app is fully functional with zero
configuration. Optional environment switches are documented in
[`.env.example`](.env.example).

### Setup

```bash
git clone https://github.com/pixelnaitik/PathoMitra.git
cd PathoMitra
npm install
npm run dev
```

Open `http://localhost:3000`. Data persists in browser storage in the web build; the
production product targets are the encrypted Electron Desktop build and Android build below.

---

## Desktop Application (Electron)

PathoMitra runs as a standalone desktop application with encrypted on-device database support (using `better-sqlite3-multiple-ciphers` with hardware keychain integration via `@napi-rs/keyring`).

### Development

```bash
npm run desktop:dev
```

### Packaging Windows Installers

- **MSI Installer**:
  ```bash
  npm run desktop:msi
  ```
- **EXE Installer (NSIS)**:
  ```bash
  npm run desktop:installer
  ```
- **MSIX / AppX Store Package**:
  ```bash
  npm run desktop:msix
  ```

Outputs are generated under `dist-electron/` and `release-desktop/`.

---

## Building for Android

### Prerequisites

- Node.js 20.19+, JDK 21 (Temurin) and an Android SDK with platform 36
  (installed with [Android Studio](https://developer.android.com/studio)); Gradle 9.1 ships
  via the wrapper — no global install needed.
- `android/local.properties` is machine-specific and git-ignored; Android Studio
  generates it, or Gradle derives the SDK path from `ANDROID_HOME`.

### 1. Configure the release identity

`npm run build:android` fails without the two values Google Play requires for a health
app — set them in `.env` (see [`.env.example`](.env.example)):

```bash
VITE_SUPPORT_EMAIL="privacy@your-lab-domain.example"
VITE_PRIVACY_URL="https://policy.your-lab-domain.example/"
```

The guard (`scripts/check-release-config.mjs`) exists because a comment survives a build
while an unreachable contact does not survive Play review.

### 2. Configure signing (optional for local builds)

Copy the template and point `storeFile` at your keystore:

```bash
cp android/keystore.properties.example android/keystore.properties
```

`android/keystore.properties`, `*.jks` and `*.keystore` are **git-ignored** — signing
material must never be committed. CI instead decodes a `KEYSTORE_BASE64` secret and reads
`KEYSTORE_KEY_ALIAS` / `KEYSTORE_KEY_PASSWORD` / `KEYSTORE_STORE_PASSWORD` (see
`android/app/build.gradle`). Without any keystore the build still succeeds and produces
an _unsigned_ artifact, with a loud warning.

### 3. Build

```bash
npm run sync:android     # native-target web build + cap sync + asset guards
npm run android:apk      # android/gradlew.bat assembleRelease  (Windows)
npm run android:aab      # android/gradlew.bat bundleRelease     (Windows)
# macOS / Linux: cd android && ./gradlew assembleRelease
```

Outputs:

- APK → `android/app/build/outputs/apk/release/app-release-<version>.apk` (e.g. `app-release-2.1.0.apk` — every build carries the package.json semver in its name)
- AAB → `android/app/build/outputs/bundle/release/app-release.aab`

### 4. Privacy policy site

The Play listing must link a privacy policy on a domain you control. Render the static
site (plain HTML, rendered from the same source as the in-app text) with:

```bash
npm run build:privacy    # outputs privacy-site/
```

`deploy.yml` builds and uploads it as a CI artifact on every push to `main`.

---

## Command Reference

| Command                           | What it does                                                             |
| --------------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`                     | Vite dev server on port 3000                                             |
| `npm run build`                   | Production web bundle to `dist/`                                         |
| `npm run preview`                 | Serve the built bundle locally                                           |
| `npm run build:android`           | `VITE_TARGET=native` web build + release-config & asset guards           |
| `npm run sync:android`            | `build:android` + `cap sync android` + synced-asset guard                |
| `npm run android:apk`             | Gradle `assembleRelease` (installable APK)                               |
| `npm run android:aab`             | Gradle `bundleRelease` (Play artifact)                                   |
| `npm run verify:android`          | `build:android` + AAB, the native pre-release gauntlet                   |
| `npm run build:privacy`           | Render the static privacy-policy site                                    |
| `npm run typecheck`               | `tsc --noEmit`, strict                                                   |
| `npm run lint`                    | Typecheck + ESLint, uncapped                                             |
| `npm run lint:ci`                 | Same, with `--max-warnings=21` as a ratchet: CI fails if the count rises |
| `npm run format` / `format:check` | Prettier over `src/**/*.{ts,tsx,css}`                                    |
| `npm test` / `test:watch`         | Vitest (jsdom)                                                           |
| `npm run test:coverage`           | Vitest + coverage gate on the data-integrity layer                       |
| `npm run verify`                  | `lint:ci` → `test:coverage` → `build`                                    |
| `npm run release` / `release:dry` | standard-version bump + changelog                                        |
| `npm run clean`                   | Remove `dist/`                                                           |

To debug a production stack trace, build with `SOURCEMAP=true npm run build`; Vite emits
hidden `.map` files — upload them to your error tracker and delete them from `dist/`
before distributing anything.

---

## Quality Gates

- **TypeScript strict** with `noUnusedLocals` / `noUnusedParameters` (`npm run typecheck`).
- **ESLint warning ratchet** — `lint:ci` caps warnings at the count in `package.json`;
  fix warnings and lower the cap in the same change. Never raise the cap for a green check.
- **Vitest coverage gate** — `vitest.config.ts` pins thresholds on the modules whose
  silent failure would corrupt clinical output (document parsing, settings persistence,
  pagination, notification derivation).
- **Build guards** — `scripts/check-native-assets.mjs` proves the APK carries no
  web-deployment artifacts (robots, sitemap, service worker, `_headers`); no placeholders.
- **Pre-commit hook** — husky + lint-staged lint and format staged files; installed by
  `npm install`.

---

## CI/CD & Releases

Four GitHub Actions workflows:

| Workflow      | Trigger           | What it does                                                                                                             |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ci.yml`      | PRs to `main`     | `lint:ci`, `test:coverage`, `build`                                                                                      |
| `deploy.yml`  | push to `main`    | Same gates, then deploys `dist/` to **Cloudflare Pages** (`pathomitra` project) and uploads the `privacy-site/` artifact |
| `release.yml` | `v*` tag          | Builds the signed AAB, verifies 16 KB native page alignment, creates the GitHub Release with the AAB attached            |
| `android.yml` | `v*` tag / manual | Builds the AAB and an installable APK as build artifacts                                                                 |

**Secrets / variables to configure** (Settings → Secrets and variables → Actions):

| Name                                                                     | Type      | Used by                                              |
| ------------------------------------------------------------------------ | --------- | ---------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                          | secrets   | `deploy.yml` (Pages deploy)                          |
| `KEYSTORE_BASE64`                                                        | secret    | `release.yml`, `android.yml` (base64-encoded `.jks`) |
| `KEYSTORE_KEY_ALIAS`, `KEYSTORE_KEY_PASSWORD`, `KEYSTORE_STORE_PASSWORD` | secrets   | release signing                                      |
| `VITE_SUPPORT_EMAIL`, `VITE_PRIVACY_URL`                                 | variables | `deploy.yml` privacy-site build                      |

A run without signing secrets still completes and produces an unsigned artifact — a fork
gets a compilable result instead of a hard failure.

---

## Versioning

Versions follow [Conventional Commits](https://www.conventionalcommits.org/) and are cut
with [standard-version](https://github.com/conventional-changelog/standard-version):

- `npm run release` — bumps `package.json` (`feat` → minor, `fix` → patch,
  `BREAKING CHANGE`/`!` → major), prepends to `CHANGELOG.md`, tags `vX.Y.Z`. The
  Android `versionCode` is derived from it (`major*1_000_000 + minor*1_000 + patch`).
- `npm run release:dry` — preview without touching git.
- Push the tag to publish: `git push && git push --tags` — `release.yml` builds the AAB
  and opens the GitHub Release seeded from the changelog.

---

## Documentation

- [`docs/README.md`](docs/README.md) — Documentation index and guide.
- [`docs/design/design.md`](docs/design/design.md) — UI design system: tokens, typography, palettes.
- [`docs/store/play/play-listing.md`](docs/store/play/play-listing.md) — Google Play listing copy.
- [`docs/store/play/play-console-submission.md`](docs/store/play/play-console-submission.md) — Google Play submission checklist.
- [`docs/store/ms-store/`](docs/store/ms-store/) — Microsoft Store review, listing, and remediation notes.
- [`SECURITY.md`](SECURITY.md) — vulnerability reporting and the offline threat model.

---

## Security

PathoMitra holds patient data. If you find a vulnerability, **do not open a public
issue** — follow the private reporting process in
[SECURITY.md](SECURITY.md). Highlights of the model:

- The client bundle is public JavaScript; nothing enforced only in React is a control.
  Data protection rests on SQLCipher + the Android Keystore, PBKDF2 passcode hashing,
  session re-locking, and the release build hardening described above.
- Never commit `android/keystore.properties`, `*.jks` / `*.keystore`, or `.env` — all are
  git-ignored. A pull request that adds the `INTERNET` permission or a network client
  should be treated as a security event, not a feature.

---

## Contributing

Contributions are welcome! Please read [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md)
before opening a pull request. In short:

1. Fork and branch from `main`.
2. `npm install`, make your change with tests where applicable.
3. Keep `npm run verify` green; the pre-commit hook helps.
4. Open a PR against `main` describing what changed and why. CI must pass to merge.

Never paste real patient data into issues, PRs, or screenshots.

---

## License

This project is licensed under the [MIT License](LICENSE).
