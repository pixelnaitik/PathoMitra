# Changelog

All notable changes to this project are documented in this file and are generated automatically from [Conventional Commits](https://www.conventionalcommits.org/) by `npm run release`.

## 2.9.0 (2026-11-25)

### Native, release and accessibility fixes

- Fixed Capacitor 8 backup-destination and report-signing plugins, including activity-result callbacks and `JSObject` results.
- Corrected Android instrumentation dependencies and removed duplicate Kotlin stdlib artifacts across all modules.
- Added fail-closed Android signature/alignment verification and Desktop installer signature inventories to provenance manifests.
- Fixed first-install PWA reload behavior, made update notices non-blocking at 360 px, and kept generated privacy HTML formatted.
- Expanded Android emulator instrumentation, isolated Electron, accessibility, PDF visual, PWA and performance CI gates.

## 2.8.9 (2026-11-24)

### Security, privacy and release readiness

- Added a source-grounded P0/P1/P2 remediation programme and baseline commit provenance.
- Replaced placeholder support/privacy identity with the monitored project contact and canonical hosted policy.
- Corrected public claims and privacy text for multiple operators, Windows Hello, production web clinical disablement, protected issued records, and encrypted off-device backup choices.
- Bound every mutation to an authenticated operator and action permission, with append-only audit history and trusted native/Desktop enforcement.
- Made issued reports, versions, payments, invoices, payouts, sample custody, and audit events immutable or amendment-only in storage.
- Added device-backed report signing and verification, issuance snapshots, reviewer separation, clock-source disclosure, and stable report manifests.
- Hardened Desktop navigation, IPC, file containment, payload budgets, print staging, and CSP; production Web remains marketing-only.
- Fixed transactional persistence, cache ordering, corruption fail-closed behavior, atomic erase, and encrypted off-device backup/restore safety.
- Added scheduled encrypted local backups, verified destination copies, durable pre-restore snapshots, and measured RPO/RTO restore drills.
- Integrated order, sample, report, and invoice workflows; made financial commands idempotent and shift-aware.
- Strengthened patient, doctor, result, draft, settings, safe-mode, dashboard, search, notification, and diagnostics behavior.
- Removed legacy browser PHI, bounded PWA caching, added update prompts, and kept clinical records out of production Web storage.
- Added indexed/delta repository reads, document-level Desktop operations, lazy PDF assets, and enforceable bundle/query budgets.
- Closed modal inertness, chart/table alternatives, custom-control semantics, keyboard flows, contrast, 360 px, 200% zoom, and reduced-motion automated gates.
- Embedded subsetted Noto fonts for Indic, Arabic, Hebrew, Greek, Cyrillic, currency, and math output; unsupported or irreconcilable mixed-script fields fail closed.
- Added orphan-safe report pagination, platform-neutral PDF visual fixtures, streamed Electron print pages, aligned copy limits, detached preview windows, and uid/destination/outcome output audits.
- Added fail-closed signed-release workflows and source/artifact manifests. Real signing still requires owner-provided Windows and Android credentials; no signed artifact is claimed by this changelog.

## 2.1.2 (2026-10-11)

First public release of the offline, local-first PathLab OS.

### ✨ Features

- Encrypted on-device clinical database — SQLCipher (AES-256) with the key held in the Android hardware keystore
- Local operator authentication — PBKDF2-hashed passcode, optional biometric / screen-lock unlock, rising lockout, and auto re-lock on background or idle
- Patient, doctor, report, invoice and analytics management with a multi-range calendar and derived Notification Center alerts
- PDF report generation (jsPDF) with four templates, custom tests and profiles, and age/sex reference-range flagging
- Draft → issue workflow with amendment history (`version`, `updatedBy`, `updatedAt`) and the issuing operator printed on the report
- Operator-owned JSON backups and in-app data erase — the app requests no `INTERNET` permission and ships no analytics, ads or crash reporting
- Android build pipeline (Capacitor 8) with release signing from git-ignored files or CI secrets, R8 minification, and asset guards that keep web-deploy artifacts out of the APK

### ⚡ Performance

- Bounded, paginated list reads so a growing lab history never turns a screen into a full table scan
- Cache-first service worker and pre-paint theme bootstrap for the web build

### 🔧 Build & CI

- GitHub Actions: PR checks, Cloudflare Pages deploy with a privacy-site artifact, signed AAB releases with 16 KB page-alignment verification, and AAB/APK build artifacts
- Quality gates: TypeScript strict, ESLint warning ratchet, Vitest coverage gate, husky pre-commit, standard-version releases
