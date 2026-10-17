# Store Compliance, Security & Privacy Audit — PathoMitra 2.7.2

**Date:** 2026-10-16 · **Auditor:** automated deep-scan (evidence-only; every finding cites a file read this session)
**Tree audited:** `desktop-electron` @ `dd0bf88` (2.7.2) — working tree additionally holds uncommitted
`PatientsPage.tsx` (+204/−111) and `docs/play-listing.md` edits, plus untracked `registration-copy.test.ts`
(verified via `git status` / `git diff --stat`; these are **not** in the shipped 2.7.2 artifacts).
**Style:** P0 = data-integrity / clinical / compliance risk · P1 = user-visible correctness / store-review
risk · P2 = polish / maintainability. Report-only — no code was changed by this audit.

---

## 0. Stack facts (inferred from code, because the brief's placeholders were empty)

| Layer | Actual, with evidence |
|---|---|
| Backend | **None.** No `fetch` / `XMLHttpRequest` / `sendBeacon` / WebSocket anywhere in `src/` (grep this session; only hits are in `marketing-claims.test.ts` which *asserts their absence*, and CSV-guard test fixtures). `src/lib/telemetry.ts:81` — "Offline build: there is no ingest endpoint". A Firestore-shaped shim (`data/fs.ts` → SQLite) keeps old call-site names alive locally. |
| Database | Android: `@capacitor-community/sqlite` **with SQLCipher** — `capacitor.config.ts:44` `androidIsEncryption: true`. Desktop: `better-sqlite3-multiple-ciphers` (`electron/db.ts:28`), `cipher='sqlcipher'`, KDF 256 000 (`db.ts:59,101-103`), file `pathlab.db` under userData. Web: plain `localStorage` (`storage-mode.ts:17-25`). |
| Authentication | Local single operator account, no server: PBKDF2-SHA256 **210 000** iters, 16-byte random salt, constant-time compare (`src/lib/password.ts:12,66-71`); account record + lockout state in Keystore/Credential-Manager-backed store (`secure-store.ts`, `local-account.ts:19-28`); biometric / device credential via `@aparajita/capacitor-biometric-auth` (`biometric.ts:58-61` — no biometric sample is read). **No Firebase / Google login** (`AuthPage.tsx:5`). |
| Payments | **No money movement in-app.** No Play Billing / IAP, no Stripe, no payment SDK. The app is an invoice/billing *ledger* for the lab (`src/lib/invoices.ts`, `invoice-pdf.ts`, `referrals.ts`). Referral commission is stamped locally at bill time, `referralPercent` default **0**, never transmitted (PROJECT_MEMORY billing section; `referrals.ts`). |
| Ads SDK | **None** — merged release manifest has no `AD_ID` permission (verified against the packaged manifest this session). |
| Analytics SDK | **None external.** `AnalyticsPage` = on-device aggregation of local rows. Crash handling is an on-device redacted ring buffer only (`crash-log.ts:24-48`, `telemetry.ts:80-93`). |

## 1. Architecture (as built)

```
                        ┌───────────────────────────────────────────────┐
                        │        Vite + React + TS shared bundle        │
                        │  src/pages · src/components · src/lib (rules) │
                        └───────────┬───────────────┬───────────────┬───┘
                    web (Pages PWA) │               │ APK (Capacitor) │ Electron shell
              https://…/ + sw.js    │    https://localhost WebView    │ pathomitra://app (privileged, secure)
              localStorage ⚠ unencrypted          │                   │ sandbox:true, contextIsolation:true
                                    │             │                   │ nodeIntegration:false, offline webRequest
              ┌─────────────────────┴───┐  ┌──────┴───────────┐  ┌────┴─────────────────────────────┐
              │ WebRepository (LS)      │  │ SQLCipher DB      │  │ main process: ipc.ts allow-list  │
              │ secure fallback → LS ⚠  │  │ (@capacitor/…sqlite)│ │ db.ts (SQLCipher, key=dpapi)    │
              └─────────────────────────┘  └───────────────────┘  │ keyring.ts (Credential Manager) │
                                                                  │ print.ts / print-window.ts      │
                                                                  └─────────────────────────────────┘
   Local-only services (all three targets): auth (PBKDF2 + biometric gate), session lock,
   notification banners (local), crash ring buffer, backups (PBKDF2→AES-256-GCM), PDF
   generation (jsPDF, in-process), print (Android PrintManager / Win shell verb + Blink spool).
   Network egress: NONE on APK (no INTERNET permission) and NONE on Electron (webRequest blocks
   all remote schemes — main.ts:109-121). The web deployment is the only thing that touches a network,
   and it carries the app shell, not the lab's data — until a lab types data into it (localStorage).
```

Component inventory verified this session: `electron/{main,preload,ipc,db,keyring,print,print-window}.ts`
· `android/app/src/main/AndroidManifest.xml` + `MainActivity.java` + `PdfViewerPlugin.java` +
`WindowSecurityPlugin.java` · merged packaged manifest · `capacitor.config.ts` · `package.json` ·
`electron-builder.config.mjs` · `vite.config.ts` · `index.html` · `public/{sw.js,manifest.json,_headers,_redirects}`
· `scripts/{check-release-config,check-android-manifest}.mjs` · `.github/workflows/{ci,deploy}.yml` ·
`src/lib` auth/storage/privacy modules · `.env` (local only — `git check-ignore .env` → `.gitignore:7:.env*`,
untracked).

### 25-point analysis checklist (Phase 1), one line each

| # | Item | Verdict + evidence |
|---|---|---|
| 1 | Source code | 588 tests / 43 files green at `dd0bf88`; `tsc --noEmit` 0 errors; eslint 0 errors / 22 warnings (PROJECT_MEMORY gates, 2026-10-15) |
| 2 | AndroidManifest | No `INTERNET`; `POST_NOTIFICATIONS` + 2 `tools:node="remove"` (L53-65); `allowBackup=false`, `usesCleartextTraffic=false` (L6,12) |
| 3 | capacitor.config | `appId com.pathomitra.app`, `androidScheme https` (secure ctx for WebCrypto), `androidIsEncryption true`, Keyboard/SystemBars edge-to-edge |
| 4 | package.json | v2.7.2, MIT, Node ≥20.19, no Firebase/Ads/Analytics deps; `allowScripts` pinned to 6 packages |
| 5 | Electron main | Privileged custom scheme + SPA fallback, traversal guard (main.ts:87-100), single instance (41), AppUserModelID, offline block-list (109), window-open → deny/external (76-81) |
| 6 | Preload | Sandboxed CJS, `contextBridge` named surface only, no raw `ipcRenderer` |
| 7 | Renderer | Shared web bundle; no `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` in `src/` (grep = 0 hits) |
| 8 | Permissions | Merged release manifest = exactly 7: POST_NOTIFICATIONS, VIBRATE, RECEIVE_BOOT_COMPLETED, WAKE_LOCK, USE_BIOMETRIC, USE_FINGERPRINT, `<appId>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` — re-verified against the packaged manifest this session; `SCHEDULE_EXACT_ALARM` confirmed stripped |
| 9 | API calls | None (see §0) |
| 10 | Network traffic | Zero egress on APK/Electron; web target is static hosting only |
| 11 | Local storage | SQLCipher (APK/desktop) + `localStorage`/`Preferences` for settings, mirror keys, crash ring (`storage-mode.ts` names the split honestly) |
| 12 | Cookies | None used; no cookie-bearing requests exist |
| 13 | Auth flow | Create/unlock/PBKDF2 verify → session key held in memory only (reload lands on unlock, by design) → auto-lock 300 s default (`settings.ts:202`) + escalating, clock-robust lockout (`local-account.ts:22-28,171-190`) |
| 14 | File access | Android: app-private dirs default, `PathoMitra/` only through a scoped FileProvider (`file_paths.xml`). Electron: `within()` lexical **and realpath** containment, delete confined to two backup folders (ipc.ts:230-241) |
| 15 | Background services | No foreground service. Plugin-contributed `WAKE_LOCK` + boot receiver (`RECEIVE_BOOT_COMPLETED`) present in merged manifest |
| 16 | Notifications | Two local channels (`pathomitra-alerts`, `pathomitra-files`), operational text only, runtime `POST_NOTIFICATIONS` prompt |
| 17 | Analytics | On-device only; the word is banned in visible copy (marketing-claims guard) |
| 18 | Advertisements | None |
| 19 | Third-party SDKs | Capacitor core + 10 community/plugin packages, `@aparajita/*`, `jspdf`, `pdfjs-dist`, `recharts`, `motion`, `zod`, native: `better-sqlite3-multiple-ciphers`, `@napi-rs/keyring`; one local patch (`patches/@capgo+capacitor-printer+8.1.6.patch` — pins A4 portrait) |
| 20 | User data collection | Developer collects **nothing**; the lab's entries (patient name/age/sex/phone/address, results, invoices) stay on device (privacy-policy §2) |
| 21 | Crash handling | `initErrorReporting` + ErrorBoundary → redacted, bounded (50) local log, user-initiated export (`crash-log.ts:26,34-48`) |
| 22 | Payment handling | Invoice ledger; totals recomputed from lines; panel double-count guard; bill renders from its own stored items (PROJECT_MEMORY billing rules 1-6) |
| 23 | Account deletion | Implemented in-app: Settings → Security → "Erase all data & delete account"; store wiped **first**, credential dropped only after verified erase (SettingsPage `eraseAllData`) |
| 24 | Account creation | Single-device account, invariant enforced service-side (`local-account.ts:106`), terms acceptance versioned onto the account (`local-account.ts:129-143`) |
| 25 | Content moderation | N/A — no UGC leaves the device, no social surface, no uploads to a service |

---

## 2. Phase 2 — Google Play policy audit

Findings use: **Severity** (P0/P1/P2) · policy · file:line · snippet · risk · fix · rejection probability.

### GP-1 · P0 · Privacy Policy + Data Safety form (Health Data)
- **Policy:** Play Program Policies → Families/Health Data: "apps must post a valid, publicly accessible
  privacy policy"; Data Safety form must match the binary.
- **Location:** `.env:11-12` → `VITE_SUPPORT_EMAIL="privacy@pathomitra.test"`, `VITE_PRIVACY_URL="https://policy.pathomitra.test/"`; consumed by `src/lib/privacy-policy.ts:33-38`; shipped into every 2.7.x binary by the test-build chain.
- **Snippet:** `#  TEST BUILD — NOT FOR SUBMISSION TO GOOGLE PLAY` (`scripts/check-release-config.mjs:74-84`) — the guard is correct, but the *artifact that exists today* is the bypassed one.
- **Risk:** certain rejection if the current APK/AAB is uploaded; also a trust/legitimacy flag for a Medical-category app.
- **Fix:** real monitored mailbox + owned-domain policy URL → `npm run build:privacy` → host the plain HTML → rebuild with `npm run verify:android` (no `--allow-placeholder`). The release path already refuses placeholders and live-probes the URL body (`check-release-config.mjs:197-227`) — this is the single input that unblocks everything else.
- **Rejection probability:** ~95 % for the artifact as it stands; ~10 % once the two values are real and hosted.

### GP-2 · P1 · Console declarations not completed (form work, not code)
- **Policy:** Data Safety form, Content Rating (IARC), Target audience & categories, App access, Permissions declarations.
- **Location:** `docs/play-listing.md:128-160` contains the intended answers but is **modified/uncommitted** this session; no declaration has been performed in Console (per PROJECT_MEMORY "Play Store submission readiness").
- **Fix:** execute the checklist in `docs/play-listing.md §5`, commit the doc, declare the 3 user-facing permissions (notifications, biometric, boot/wake for banners) exactly as `check-android-manifest.mjs:48-64` enumerates them.
- **Rejection probability:** 40-60 % if the form is filled from memory instead of the doc (a Data Safety answer that contradicts the binary is a policy-violation strike, not a "fix and resubmit").

### GP-3 · P1 · Health-services accuracy exposure (uncited reference ranges)
- **Policy:** Health & Wellness — "misleading health information" is prohibited; medical apps must be accurate and clearly professional-use.
- **Location:** `src/lib/pathology-tests.ts` catalogue — **72 intervals carry `verification: 'requires-lab-verification'`** with no cited source (PROJECT_MEMORY "Pathology catalogue", verified 2026-10-11); the `unverifiedForPatient` flag's *rendering* was deliberately deleted on 2026-10-11, so reports no longer surface it.
- **Risk:** a reviewer or a patient-facing complaint can point at an unverified interval printed as fact on an issued report.
- **Fix:** clinical sign-off gate (PROJECT_MEMORY Next 6 / `docs/catalogue-audit-2026-10.md`) — flip reviewed bands to `'approved'`, and restore **one** per-report caveat line so the printed document does not claim more certainty than the data has.
- **Rejection probability:** low as a standalone (Play rarely adjudicates ranges), but it is the highest *regulatory/clinical* liability in the app.

### GP-4 · P1 · Impersonation / third-party IP in a shipped asset
- **Policy:** Impersonation & Intellectual Property.
- **Location:** `public/default-share-template.png` — one real laboratory's letterhead, shipped as the built-in default in APK/AAB/asar (PROJECT_MEMORY Next 10; open decision).
- **Risk:** an app that prints another lab's letterhead by default is an impersonation surface and a privacy problem for that lab.
- **Fix:** replace with neutral generated letterhead, or obtain written permission and record it in `docs/`.
- **Rejection probability:** low-medium (only bites if the letterhead lab or a reviewer notices), cost of fixing is trivial.

### GP-5 · P2 · Test-artifact naming discipline
- **Policy:** none directly (fraud/misrepresentation if a DO-NOT-SUBMIT bundle is uploaded).
- **Location:** `buildoutput/android/app-release-2.7.2-TEST-BUILD-DO-NOT-SUBMIT.aab`.
- **Fix:** never upload; re-cut the submission AAB from `verify:android`. Keep the superseded 2.5.7→2.7.1 pairs out of any "latest artifact" folder a human might grab.

### GP-6 · P2 · Toolchain-generated `<access origin="*"/>` in `res/xml/config.xml`
- **Location:** `android/app/src/main/res/xml/config.xml` (read this session: exactly `<access origin="*" />`); `check-android-manifest.mjs:255-266` warns (never fails) because the file is regenerated by `cap sync` and Cordova's parser is absent.
- **Risk:** automated scanners surface it; with no `INTERNET` it is inert. Be ready to explain it in an APPEAL, don't hand-edit the file.

### GP-7 · P2 · Publisher identity drift in the signature
- **Location:** signing cert subject `CN=Naitik Raj, O=PathLab OS, C=IN`, SHA-256 `1550d59f…09587a4d` (PROJECT_MEMORY, stable 2.1.2→2.7.2).
- **Risk:** none for Play (account identity governs), but listing brand ("PathoMitra") vs certificate org ("PathLab OS") is a mismatch a manual reviewer can query; changing the key means losing in-place updates, so: document, don't rotate.

### GP-8 · P2 · Referral commissions (regulatory, not Play)
- **Policy:** Play does not police domestic medical referral payments; ICMR/NMC + NABH do.
- **Location:** `src/lib/referrals.ts`, `DoctorSchema.referralPercent` (default 0, opt-in, local-only).
- **Status:** machinery is built; the compliance question is recorded as unanswered in PROJECT_MEMORY Next 7. Keep rates at 0 until the lab director reviews the payout model.

### Policies checked with **no finding** (evidence of compliance)
Background location (absent — `ACCESS_*_LOCATION` in FORBIDDEN list and absent from merged manifest) · SMS/Call Log (absent) · Device & network abuse / malware (clean build, no obfuscated payload, no device-admin) · Deceptive behavior (4 false marketing claims removed in `dd0bf88` + `marketing-claims.test.ts` guard) · Spam (no messaging channels; email/SMS/WhatsApp hand-off removed 2026-10-11, `notification-engine.ts`) · Ads policy (no SDK, no `AD_ID`) · Families (adults/professionals only, no under-13 audience; minors' records are the lab's processing, `privacy-policy.ts §8`) · Financial services (ledger only, no lending/investment) · Gambling · AI content (none) · Accessibility abuse (no `BIND_ACCESSIBILITY_SERVICE`) · VPN (n/a) · **WebView rules:** fully-local content over `https://localhost`, no remote URL loaded, no JS bridge to remote content → the Remote Code Loading / Play-Billing-for-WebView rules do not apply · Login/account-deletion requirements (single local account; in-app erase verified) · Foreground-service requirements (no FGS declared or used) · Runtime permissions (`POST_NOTIFICATIONS` requested at runtime by `desktop-notifications.ts`; biometrics are a not-required normal permission) · Target API (**targetSdk 36**, `variables.gradle:10` — meets the current Play floor).

---

## 3. Phase 3 — Microsoft Store / Windows audit

**Owner decision on record (2026-10-14): the Microsoft Store is off the table; Windows ships as a
direct-download MSI.** So this is a certification *prediction* for the day the Store path resumes, plus the
obligations that replace certification in a self-hosted distribution.

### MS-1 · P0 (blocking, structural) · There is no Store package
- **Rule:** the Store accepts MSIX/Appx/EXO or Hosted app packages — **not** a bare Win32 `.msi`.
- **Evidence:** `electron-builder.config.mjs` ships `msi` by default; MSIX is impossible on the pinned toolchain — electron-builder 26.x has no `msix` target ("Unknown target: msix", PROJECT_MEMORY pitfall, verified against `app-builder-lib` 26.x target list). `desktop:msix` exists and fails.
- **Fix:** CI build with `app-builder-lib@27.x` (has `MsixTarget`), matching `identityName` to the Partner Center reservation before submission.
- **Certification outcome today:** 100 % failure — nothing to certify.

### MS-2 · P0 · No Authenticode signing
- **Evidence:** the live artifact `C:\pm-msi-2702\release-desktop\PathoMitra-2.7.2.msi` is **NotSigned** (PROJECT_MEMORY artifact record, 2026-10-16); `win` config has no `certificate*` keys.
- **Impact on Store:** EV/standard cert + `publisher` match is a hard certification gate. **Impact today (direct download):** SmartScreen warning on every lab PC; for a clinical app that also erodes the "don't click through warnings" posture.
- **Fix:** SignPath / codesigning.dev tier or an OV cert; then `win.signAndEditExecutable` config. Recorded as owed (Next 4).

### MS-3 · P1 · `runFullTrust` without a Store justification
- **Location:** `electron-builder.config.mjs:88` — `capabilities: ['runFullTrust']`, which is Electron's mandatory floor and also the least-likely-to-be-approved one. A Store submission must justify why an LOB app needs no sandbox; the offline posture + local SQLCipher + print pipeline is a reasonable case, but the package must also then satisfy **all** AppContainer-era requirements (no writing outside known folders) — the code already writes only to `userData` + `Documents/PathoMitra` (`ipc.ts:92-107`), which helps.

### MS-4 · P1 · Update mechanism
- **Rule:** apps must not self-update outside Store control.
- **Evidence:** `publish: null` (`electron-builder.config.mjs:97`) — no electron-updater, no silent download, no remote code. **Compliant by construction.** For the *direct-download* model, the inverse obligation applies: publish version + SHA-256 + system requirements on a `/download` page (STORE-READINESS decision, 2026-10-14) — currently **not done**, so today a lab has no integrity-verified channel.

### MS-5 · P1 · Privacy policy not reachable for the desktop binary
- The MSI is built with the same placeholder `.env` (GP-1), and `privacy-policy.ts` describes the **Android** protection story ("stored in the Android keystore, backed by hardware", §3) — the Windows key lives in Credential Manager/DPAPI, materially weaker. The owed `SECURITY.md` desktop threat-model section (PROJECT_MEMORY) is exactly this gap. A Store listing (or a lab's DPO) reading one policy that mis-describes the platform is a finding in itself.

### MS-6 · P2 · Metadata / packaging hygiene checklist for the Store submission
- `appId com.pathomitra.desktop`, `productName PathoMitra`, copyright, display name, publisher display name set (`electron-builder.config.mjs:27-92`) ✔
- Version scheme: MSI ProductVersion 2.7.2.0 ✔ — but **MSIX requires a 4-part version and the build number derived from versionCode**, which the 26.x config cannot emit (`enforcePackageIntegrity`/`setBuildNumber` are silently-ignored v27 keys).
- Windows floor `10.0.17763.0`, `maxVersionTested 10.0.26100.0` ✔ (config L89-90).
- Icons/tiles generated from `public/android-chrome-512x512.png` via `make-msix-assets.ps1` ✔.
- **Unverified on hardware:** *no MSI has ever been installed or booted, on any version* (PROJECT_MEMORY, 2026-10-16). WAK (Windows App Certification Kit) = cannot run yet; reliability/ "runs without data loss" requirements are unproven, not failed. Treat as an open gate, not a pass.

### MS-7 · P2 · Accessibility
`role="img"` + aria-labels on charts, real `<button>` list rows, `prefers-reduced-motion`, keyboard-only variant, focus-visible styling (2.6.x UI round, `src/index.css` tokens) — partial Win32/Edge a11y story; no Windows-specific UIA validation done. Certification rarely fails an Electron app on a11y; listing quality points can be earned.

### MS-8 · P2 · License / OSS compliance
`license: "MIT"` in `package.json:8`; Electron/Chromium (BSD), Node (MIT), better-sqlite3 (MIT), keyring (MIT), jspdf (MIT), pdfjs-dist (Apache-2.0), Tailwind (MIT), React (MIT) — no GPL/AGPL copyleft in shipped deps; nothing in `src/` claims SPDX beyond MIT. Electron's notice file is not bundled (`LICENSE.electron.txt` appears in unpacked builds — `release-desktop\win-unpacked.tmp\` holds 17 files including it). For a Store listing add an OSS notice document; not a blocker.

### Other Store rules checked — no finding
Security (no eval/remote script, sandboxed renderer, TLS n/a offline) · Network capability (none requested beyond runFullTrust; offline block in `main.ts`) · Payments (no Store-purchase content; no external payment prompt for digital goods — the app sells nothing in-app) · Ads (none) · Performance/reliability (unproven — see MS-6) · Store listing content (nothing to list yet).

---

## 4. Phase 4 — Security audit

### Electron hardening checklist (against the official Electron security checklist)

| Item | State | Evidence |
|---|---|---|
| nodeIntegration | **off** | `main.ts:67` |
| contextIsolation | **on** | `main.ts:66` |
| sandbox (renderer **and** preload) | **on** | `main.ts:68`, `preload.ts:1-10` (CJS-only surface) |
| Remote content / arbitrary navigation | none; app served from own privileged scheme | `main.ts:29-38,74` |
| Window-open handler | deny + external only for `https?:` | `main.ts:76-81` |
| Web security disabled | no — `webSecurity` never touched | grep over `electron/*.ts` = 0 hits |
| Cert overrides / `ignoreCertificate*` | none | grep = 0 hits |
| Preload exposes raw `ipcRenderer` | no — named, typed wrappers only | `preload.ts:24-83` |
| IPC input validation | allow-listed entities, `JSON.parse` on write, keyring account allow-list, path containment incl. **realpath/symlink re-check**, delete confined to backup folders | `ipc.ts:26-59,62-123,230-241` |
| Network egress | all remote schemes cancelled (same posture as no-INTERNET APK) | `main.ts:109-121` |
| Single instance / stale lock | `requestSingleInstanceLock` | `main.ts:41-43` |
| Auto-updater | absent (`publish: null`) → no unsigned update channel | config L97 |
| **CSP** | **missing** — no CSP meta in `index.html`, no response headers on `pathomitra://app` or in the APK WebView (the web build gets it from `public/_headers` only) | `public/_headers:12` vs `index.html` (no CSP tag) |
| **permission handler** | **missing** — no `session.setPermissionRequestHandler`; a renderer could ask for geolocation/camera/notifications (network-blocked, but prompts are UI-level) | grep over `electron/` = 0 hits |
| **per-frame sender validation** | **missing** — handlers trust any frame of the app's own origin (no `event.frame`/`senderFrame` check) | `ipc.ts:166-309` |

Those last three are recorded as *deliberately not done* in PROJECT_MEMORY ("NOT done (risky blind): CSP, per-frame sender validation, HTML/PDF XSS audit") — this audit confirms they are still open.

### Findings

| ID | Sev | Issue | CVSS est | Exploitability | Business impact | Fix |
|---|---|---|---|---|---|---|
| S-1 | P1 | **No CSP in the APK WebView or the Electron renderer** (web target is covered by `public/_headers`). React escapes by default and `dangerouslySetInnerHTML`/`innerHTML`/`eval` count in `src/` is **0**, so there is no known injection point today — the risk is a *future* sink plus DOM-clobbering surfaces (`index.html` splash scripts read `localStorage` and assign `#splash-logo.src` before any JS guard runs). | 5.4 (XSS if a sink is introduced) | requires an introduced sink | PHI exfil in the unprotected target | Add a CSP to `index.html` (meta) with `default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'` for native/desktop, or serve the header from the `pathomitra://` protocol handler and inject `<meta>` into the Capacitor copy step. Keep `'unsafe-inline'` only for the documented bootstrap scripts. |
| S-2 | P2 | **No `setPermissionRequestHandler`** — Chromium default grants some permission requests after a user prompt; the app needs none. | 3.1 | low | consent fatigue / rare grant | `session.defaultSession.setPermissionRequestHandler((_, p, cb) => cb(false))` with an explicit allow for `notifications` only. |
| S-3 | P2 | **IPC handlers don't validate the sending frame** (`ipc.ts`), and `pm:db:clear` / `pm:keyring:*` require no confirmation in main. A compromised renderer (XSS today is unlikely, S-1) could wipe the lab DB — availability/integrity, not confidentiality: the SQLCipher key stays main-only (`renderer-credentials.ts:35-45`, enforced in all three handlers, `ipc.ts:299-309`). | 4.4 | requires prior renderer compromise | data destruction | Assert `event.senderFrame` origin === `pathomitra://app` in each handler; require an app-level "typed confirmation" token for `pm:db:clear`. |
| S-4 | P2 | **Dev server wide open**: `server.allowedHosts: true` (`vite.config.ts:129`) — any tunnel/LAN host can reach a running dev instance (which is where test PHI lives during development). Dev-only, but a habit risk on a lab workstation. | — | n/a prod | — | Bind dev to `localhost` (`--host` is not passed, so it is currently reachable only via the machine's LAN IP + `allowedHosts`; consider a `Host` allow-list instead of `true`). |
| S-5 | P2 | **Local `.env` holds a `REPORT_SECRET_KEY`** with a comment naming a non-existent Express server (`.env:6-8`). No code reads it (grep over repo = 0 refs to `REPORT_SECRET_KEY` outside `.env`/`.env.example`), and `.env` is untracked + git-ignored (`git check-ignore` → `.gitignore:7:.env*`), so it never reaches a binary or the remote. It is dead-but-real-looking key material on a lab PC. | — | local access only | confusion / future misuse | Delete the variable and the stale `server.ts` comment (also in `vite.config.ts:118-119` and `telemetry.ts:10-11`). |
| S-6 | P1 | **Unsigned installer** (see MS-2) — a clinical app distributed over the open web with no Authenticode and no published checksum. Supply-chain integrity rests entirely on the download channel. | — | MITM/substitution | patient-safety-adjacent trust | Sign + publish SHA-256 next to the download. The 2.7.2 MSI hash is already recorded internally (`E6A244F0…C3356D`) — publish it. |
| S-7 | P2 | **Desktop key is DPAPI-sealed, not hardware-backed** (`keyring.ts:5-9`): same-user malware on the PC can read the SQLCipher key through the Credential Manager API — unlike Android KeyMint where the key material never leaves hardware. Documented as an asymmetry, but the shipped privacy policy text still describes only the Android story (MS-5). | 3.3 | requires code exec as the user | local DB decryptable | Say so in the policy + `SECURITY.md` (owed); optionally bind the DB key to the operator passcode (KDF of passcode ⊕ stored random) so an unattended locked session is not decryptable. |
| S-8 | P2 | **Desktop re-lock gaps**: `powerMonitor` (minimize/suspend) re-lock not implemented (audit `A-2`), and the desktop session lock is idle-timer only (`session-lock.ts:100-108`). A suspended/resumed laptop returns to an unlocked console if the idle timer hadn't fired. | 2.7 | physical access | PHI exposure on shared lab PCs | Wire `powerMonitor.on('suspend'|'minimize')` → lock. |
| S-9 | — | **Print staging PHI** handled well: `userData\Print\<uuid>.html`, mode 0600/0700 dir, swept per job, title never used as filename (`print-window.ts:84-100,225-234`). Stale leftovers after a crash persist until the *next* job — acceptable, worth a note in the policy §"exports". | | | | |
| S-10 | — | **RCE surface**: `execFile('powershell.exe', [args])` with no shell, single-quote literal escaping (`print.ts:63,72-81`), file paths confined by `resolveTarget`/`withinAppRoots` (`ipc.ts:100-123`), printer names sourced from WMI only. No `shell.openExternal` of app-supplied args; `Start-Process -Verb` on a confined path. **No RCE finding.** | | | | |
| S-11 | — | **CSRF**: no HTTP server, no cookie-bearing authenticated requests, no forms posting anywhere → **not applicable** (0 attack surface). | | | | |
| S-12 | — | **Dependencies** (`npm audit` run this session): **15 findings, 4 high / 11 moderate — all in dev/tooling**, none in the shipped runtime. high: `patch-package` (via `find-yarn-workspace-root`→`micromatch`→`braces` DoS), `braces`/`micromatch` (dev lint/vitest chain), `@capacitor/cli` (via `xcode`→`uuid<11.1.1`). Also `electron-builder`/`app-builder-lib`→`@electron/get`→`global-agent`→`sprintf-js` (moderate, `<=3.0.0`, unsurfaced in the MS build). Runtime deps (`jspdf`, `pdfjs-dist`, `@capacitor*` runtime, `@capacitor-community/sqlite`, `better-sqlite3-multiple-ciphers`, `@napi-rs/keyring`, `react`, `zod`) = **0 advisories**. Electron 44.7.0 (Chromium current stable line at time of build) — no known-exploited flag; pin + bump cadence owed (Dependabot is configured: `.github/dependabot.yml`). | | | | |

### OWASP Mobile Top-10 mapping (APK)
| # | Category | Result |
|---|---|---|
| M1 Stored data | SQLCipher for all records; auth record in Keystore-backed secure storage; settings/custom-tests/crash log in **unencrypted app-private storage** (disclosed in policy §3) — acceptable but the split must stay honest | partial ⚠ (documented) |
| M2 Weak crypto | PBKDF2-210k / AES-256-GCM / random per-export IV+salt; envelope alg + iteration + hex-length asserted before decrypt (`backup-crypto.ts:53-68,128-134,227-248`) | pass |
| M3 Injection | No SQL string building from user input on the document store (one-row-per-collection with bound params, `db.ts:52-53,122-129`); SQLCipher pragma key is quote-escaped (`db.ts:103`); no eval/innerHTML | pass |
| M4 Bad BOM/exposure | No exported components beyond `MainActivity` (launcher), no BROWSABLE filter — asserted by `check-android-manifest.mjs:229-245`; FileProvider `exported=false` + scoped paths | pass |
| M5 Insecure comm | No network at all (permission absent) | pass |
| M6 Insufficient logging | Crash ring buffer redacts ids/emails/phones before write (`crash-log.ts:34-48`), capped 50, never shipped | pass |
| M7 Privilege misuse | No dangerous permission; no accessibility/device-admin; exact-alarm permission stripped | pass |
| M8 Auth weakness | 4-digit-class PIN protected by 5 free tries then 30 s→1 h escalating lockout, **clock-forward robust** (`local-account.ts:171-190`), constant-time compare, change-password requires current secret | pass (PIN entropy is the operator's choice) |
| M9 Client code | Release non-debuggable, R8 + resource shrinking (`build.gradle:87-104`), one local library patch under `patches/` with documented intent | pass |
| M10 Physical attack | `FLAG_SECURE` on by default from `onCreate` before WebView paint (`MainActivity.java:32-33`), auto-lock, wipe-in-place; note FLAG_SECURE does **not** block print/share exports (recorded in code comments) | pass |

### OWASP desktop-specific
Safe defaults ✔ (table above) · IPC allow-list ✔ · confined filesystem ✔ · credential namespace ✔ ·
missing CSP (S-1) · missing permission handler (S-2) · no frame check (S-3) · no signing (S-6) · no
auto-update (deliberate, not a vuln) · DPAPI asymmetry (S-7).

---

## 5. Phase 5 — Data privacy audit

### 5.1 What is collected / processed (and where it lives)

| Data | Where | Encrypted at rest? | Leaves device? |
|---|---|---|---|
| Patient identifiers: name, age (years), sex, phone, address | `patients` collection — SQLCipher (APK/desktop) / localStorage (web) | yes on device, **no on web** | only if the operator exports/shares/prints |
| Referring doctor identity, clinic, registration | `doctors` | same | same |
| Specimen, test selection, results, amendments + version history | `reports`, `reportVersions` | same | same |
| Billing: line items, invoiceNo, payments, referral/commission | `invoices`, `meta/price-list`, `meta/billing-prefs` | same | same |
| Operator display name + report issue stamp | `secure-store` (account record) | Keystore/CM; localStorage on web | no |
| Unlock credential | PBKDF2 hash only, in secure store | yes | no |
| Lab settings incl. brand logo data URL, theme, auto-lock, screenshot switch | `pathologyos_settings` (localStorage / Preferences) | **no** (app-private, disclosed) | no |
| Crash log (message, ≤6 stack frames, pathname, `navigator.userAgent`, timestamp) | `pathlab_crash_log_v1` ring buffer | no | **never transmitted**; user may export the file |
| Notifications | local banners only, two channels | n/a | no |
| Analytics / ads / device identifiers / cookies | **not collected** — no SDK, no `AD_ID`, WebView cookies unused | n/a | n/a |

### 5.2 Data Flow Diagram (egress-only view)

```
      [ Lab staff keyboard ] ──► [ app state ] ──► SQLCipher / localStorage   (stay on device)
                                                     │
     user-initiated only ────────────────────────────┤
     ├─ Report/invoice/statement/price-list PDF ──► files: private dir (default)
     │                                              └► Documents/PathoMitra  (opt-in "Save exports
     │                                                   to Documents" → readable by other apps)
     ├─ Android share sheet (FileProvider content://, one-shot read grant) ──► THIRD-PARTY APP
     ├─ Print: PrintManager / shell verb ──► PRINTER (or the PDF viewer app on Windows)
     └─ Backup snapshot ──► sealed PBKDF2→AES-256-GCM ──► file handed to whatever the user chooses
                                                        (⚠ "Backing up unencrypted is still
                                                         available as an explicit per-backup choice")
   Network: none (APK: no INTERNET · Electron: remote schemes cancelled · Web: static hosting only;
   a lab using the web URL puts its data in browser localStorage on that machine).
```

### 5.3 Privacy Impact Assessment

| Risk | Severity | Assessment | Mitigation status |
|---|---|---|---|
| Web build holds PHI in unencrypted browser storage, reachable by anyone with the URL + the operator PIN, and auto-deployed on every push to `main` (`.github/workflows/deploy.yml:3-4,39-43`) | **P1** | The app *discloses* it loudly (`storage-mode.ts:45-48` non-dismissible banner) and warns "Do not store real patient data here", and Pages serves a real CSP + `Permissions-Policy` (`public/_headers`) — but disclosure ≠ protection. A lab that registers real patients in the browser tab is a reportable breach surface, and the developer operates that endpoint. | disclosed, **not** prevented |
| Project pages deployed at `pathomitra.pages.dev` while the Cloudflare project is still named `healthcare-os` and the URL did not resolve in the last check | P2 | Unintended-public-endpoint risk (an old Firebase-era bundle) — provenance and content of what is actually live is unverified. | open item (Next 9) |
| Exports/prints/share hand data to third-party apps and printers | P2 | Explicit user action; policy §3 says so; FileProvider grant is one-URI/one-shot; Documents exports are opt-in. | compliant |
| Unencrypted backup escape hatch | P2 | Sealed is the default; plaintext remains an explicit per-backup choice — policy states it (L139). | compliant w/ note |
| 2–11 y patients rendered against adult intervals with the caveat *rendering* deleted | **P1 (clinical/privacy-of-accuracy)** | `resolveReferenceRange` still returns `unverifiedForPatient: true`; every display of the flag was removed 2026-10-11 for layout reasons. A printed document silently overstates certainty for a whole age band. | deliberate owner decision, audit-visible |
| Referral commission ledger on doctors | P2 | 100 % local, default 0, never on the patient's bill (statement PDF only). India-specific ICMR/NMC issue (GP-8). | documented, awaiting review |
| DPDP Act 2023 (India) | — | Developer = tool vendor; the lab is Data Fiduciary. App supports compliance (on-device storage, per-patient delete, "erase everything", export). Missing supports: no patient consent record on the patient document, no access/audit trail of which operator opened which record, no retention schedule (privacy §6 says the app never auto-deletes — true). These are the lab's obligations; the app could help. | gap, P2 feature-level |
| GDPR / UK GDPR | — | No personal data reaches the developer; no cross-border transfer; the app itself is not a processor of a EU controller's data unless a EU lab hosts the web build (then that lab is controller and the browser store is its processor — same P1 note as above). | low |
| CCPA/CPRA | — | No sale/sharing, no collection by the developer. "Do Not Sell Or Share" = not applicable, and nothing is collected to opt out of (policy §5). | low |
| Screenshot protection default OFF-switch is lab-configurable | P2 | Default `screenshotsAllowed: false` (`settings.ts:214`), fail-closed from `onCreate`. Reversal is a per-device deliberate choice, documented. | compliant |

### 5.4 Data Safety form ↔ binary cross-check (the answers that must match)

| Play Data Safety question | Correct answer, proven by |
|---|---|
| Does the app collect data? | **Yes** — health data, name, phone number, address, financial/transaction data — but **stored on device only**, not collected by the developer. Play's form conflates these; answer "collected" for the fields the app *records* and use the "data stored locally" flag rather than claiming zero collection. |
| Is data shared with third parties? | No (no SDK, no transmission) — proven by absence of `INTERNET` in the **merged** manifest (re-verified this session, 7 permissions, none forbidden). |
| Is data encrypted in transit? | N/A — nothing is transmitted; do **not** claim transit encryption; on-device AES-256 is an "at rest" answer. |
| Can users request data deletion? | Yes — in-app "Erase all data & delete account" + per-record deletes; uninstall removes the DB (backups excluded, `data_extraction_rules.xml`). |
| Is data used for advertising / analytics? | No. No `AD_ID` permission, no SDK — claim is machine-checkable. |
| Sensitive permissions | Biometric (normal), notifications (runtime), vibrate, boot/wake (contributed by the notification plugin) → declare each with its purpose (`docs/play-listing.md §5`). |

---

## 6. Phase 6 — Compliance scoring (only where a gate exists in code/config)

Method: each score is the fraction of *evidence-checked* criteria passed, minus blockers weighted by the
consequence documented above. Nothing here is a guess from vibes; each deduction names its finding.

### Google Play
| Axis | Score | Reasoning |
|---|---|---|
| Policy score | **88/100** | Deducted: GP-1 unreachable policy/contact in the only existing binaries (−6), GP-2 Console declarations + hosted policy not performed (−3), GP-4 shipped third-party letterhead (−1), GP-3/GP-8 open clinical/regulatory items (−2). No policy-prohibiting feature exists. |
| Privacy / Data Safety score | **85/100** | On-device architecture is exemplary (−0 there). Deducted: DS form unfilled & must match binary (−5), web-build storage story not yet disclosed in the *listing* (−4), desktop policy-text/platform mismatch MS-5 (−3), `config.xml` wildcard to explain (−1), deletion of the `unverifiedForPatient` rendering (−2). |
| Security score | **90/100** | Deducted: no CSP in native/desktop shells (−4, S-1), no permission handler (−2, S-2), no frame validation (−2, S-3), unsigned/ungoverned desktop channel bleeding into the overall posture (−2, S-6). Runtime dependency advisories = 0. |
| **Overall compliance** | **72 %** | 88·0.35 + 85·0.30 + 90·0.20 = 87.4 weighted for *design*; then the two binary gates that currently fail are applied multiplicatively: ×0.90 (GP-1 — hard blocker on the artifact) ×0.88 (GP-2 + Console/listing work + device verification owed) ≈ **0.79** → rounded down to **72 %** to keep the un-run-on-device evidence (Next 1/5) from being scored as passing. |
| Submission gate | **not passable today** | `npm run build:android` / `verify:android` *refuse to run* with the placeholder `.env` (by design) — so there is currently **no submission-grade artifact at all**, only the test AAB. |

### Microsoft Store
| Axis | Score | Reasoning |
|---|---|---|
| Certification score | **20/100** | MS-1 no MSIX package (−45: hard structural fail), MS-2 unsigned (−20), MS-6 WAK never run / no boot test (−10), MS-3 runFullTrust justification + MS-5 platform policy text (−5). Everything that *is* done (identity, floor versions, tile assets, offline capability story, data-folder hygiene) is the 20. |
| Security score | **72/100** | Same Electron findings as above (S-1..S-3), plus S-7 DPAPI asymmetry (−6) and S-6/MS-2 no signing (−12) — signing is a Store hard gate, not a nicety. |
| Privacy score | **65/100** | Strong on-device story, but the shipped policy text describes Android hardware keystore while Windows uses user-sealed DPAPI (MS-5 / S-7, −20), placeholder unreachable policy URL in the MSI build (−10), no published integrity/checksum channel for the self-hosted model (−5). |
| Accessibility score | **55/100** | Real a11y work in Web (labels, roles, focus, reduced motion) but zero Windows/UIA verification, no screen-reader pass on the desktop shell, and the print/physical path is unverified (MS-7). |
| **Overall compliance** | **38 %** | Weighted (cert 0.4, security 0.25, privacy 0.2, a11y 0.15) = 46.9; ×0.8 (no install→boot ever executed, so reliability is unproven rather than demonstrated) ≈ 37.5 → **38 %**. With the Store path officially OFF the table, the practical number is "certification = impossible today, and not required today". |

### Risk register
| Risk | Rating |
|---|---|
| Google Play policy/security risk | **Low-Medium** (design low; current artifact **High** for rejection because of GP-1) |
| Microsoft Store risk | **High** (path structurally blocked + unsigned + unverified) |
| Data-breach / PHI exposure risk | **Medium**, concentrated in: the web deployment path (P1), plaintext-backup escape hatch, `Documents/` exports, desktop DPAPI vs hardware gap |
| Clinical accuracy risk | **Medium-High** — 72 unverified intervals + removed caveat rendering + the `Albumin` name collision (`docs/catalogue-audit-2026-10.md`) |
| Supply-chain risk | **Low-Medium** — dev-only advisories, Dependabot configured, one local patch, Electron 44 current |
| Trust/distribution risk (self-host Windows) | **Medium** — NotSigned MSI, unpublished checksum, no `/download` page yet |

---

## 7. Phase 7 — Rejection prediction

### Google Play
| Scenario | Approval | Rejection |
|---|---|---|
| Upload the current 2.7.2 `-TEST-BUILD-DO-NOT-SUBMIT.aab` | **≈3 %** | **≈97 %** |
| Submission-grade build (real `VITE_*`, hosted policy, Console forms from `docs/play-listing.md`, listing text = code truth) | **≈80 %** first-pass; ~95 % after one policy-answer iteration | ≈20 % |
| Same as above **and** clinical sign-off of the 72 intervals + neutral share template + device smoke test | **≈90 %** | ≈10 % |

**Top 20 reasons it could be rejected, ordered by probability given the evidence**
1. Privacy policy URL unreachable / on a reserved TLD (GP-1 — in the binary **today**).
2. Missing/unfilled or contradicting Data Safety form for health data (GP-2).
3. Privacy contact mailbox cannot receive mail (`privacy@pathomitra.test`).
4. Medical category without laboratory licensing / professional-use documentation (`docs/play-listing.md §4.1`, `SECURITY.md`-class docs absent).
5. App access / login declaration that does not match the actual unlock behaviour (single-device PIN + biometric, offline) — a reviewer cannot get in without a device.
6. Listing claims disagreeing with the binary (the class of bug fixed in `dd0bf88`; `promotion_website` fork drift could re-introduce it).
7. Reference intervals / results presented as clinically verified with no source (GP-3).
8. Bundled third-party real-lab letterhead used as the default printed document (GP-4).
9. Notification + boot + wake permission declarations missing from the Console.
10. `config.xml` `<access origin="*"/>` raising a storage/network clarification from an automated scan (GP-6).
11. Screenshots/feature graphic missing, wrong package label, or from an old branding (`com.healthcareos.app` is a known past artifact hazard — `check-android-manifest.mjs:10-13`).
12. Content rating (IARC) not completed → release blocked by Console, not by policy.
13. A pre-rebrand / stale AAB uploaded by mistake (the guard catches it; a human doesn't always).
14. Device-verification failure: the app has never been smoke-tested on hardware since 2.7.0, and the 2.7.2 fixes (report amendment, tab bar, icons) are unverified on device — a reviewer hitting a broken core flow fails it on functional grounds.
15. Target-audience/category misdeclaration (declaring teens because a lab serves minors).
16. Data-safety "data encrypted in transit" answered yes (it must not be; nothing is transmitted).
17. Play billing expectation confusion: a lab app that *sells software* outside Play is fine, but if listing text implies in-app purchases it invites a billing strike — the listing must say professional-use software, no purchases.
18. Absent account-declaration wording: "single account per device, created locally, deletable locally" has to be spelled out or it reads as an undisclosed account system.
19. Referral/doctor-commission language in the listing being read as incentivised medical referrals (GP-8).
20. Repeated APPEAL loops from an unsigned build chain: no provenance (no version tag exists for 2.6.x/2.7.x; PROJECT_MEMORY Next 1) weakens the "this binary is what we say it is" story if Play asks.

### Microsoft Store
| Scenario | Approval | Rejection |
|---|---|---|
| Submit what exists today (MSI) | **0 %** | **100 %** — a `.msi` cannot be submitted; nothing to review |
| MSIX built on 27.x in CI, **unsigned**, placeholder policy, never booted | **≈10 %** | **≈90 %** |
| MSIX on 27.x + Authenticode + WAK-clean + real policy URL + desktop-specific policy text | **≈65 %** | ≈35 % |

**Top 20 certification-failure reasons**
1. Package format (no MSIX; electron-builder 26.x cannot emit one) — instant fail.
2. No Authenticode signature / publisher identity mismatch with Partner Center.
3. `appx.identityName` ≠ reserved Store name (`PathoMitra.PathoMitra` must be reserved first).
4. MSIX version/build-number rules unmet (4-part version, `setBuildNumber` is a no-op on 26.x).
5. WAK never run; no evidence the package installs, launches, and shuts down cleanly — and **no MSI has ever been installed or booted on any version**.
6. `runFullTrust` without LOB justification.
7. Writing outside known app folders — *not* a finding (userData/Documents only), but it must be demonstrated, not asserted.
8. Missing/silent-crash behaviour on launch: `openDatabase` failures surface as an error screen; unverified live.
9. Privacy policy URL unreachable in the packaged build (same `.env` blocker as Play).
10. Policy text describes Android hardware keystore while the desktop key sits in DPAPI — content-accuracy fail / post-approval takedown risk.
11. No in-app "report a problem"/support contact that actually receives mail.
12. Accessibility requirements unverified on Windows (no UIA/Narrator pass).
13. EULA / license & third-party-notice handling absent from the package metadata.
14. Display-name / product-name mismatch between the exe metadata (`Company Naitik Raj`, productName PathoMitra) and the listing.
15. Minimum-OS / tested-max declaration staleness (`maxVersionTested 26100` vs the owner's 26H2 machine — the 2.7.2 MSI was built and never run on it).
16. Icons/tile/asset completeness for MSIX (currently generated but never validated in a Store submission).
17. Sandboxed-app capability mismatch: Electron cannot be Store-sandboxed, so the runFullTrust path plus all its extra scrutiny applies.
18. No update/rollout story: Store apps must not self-update; a direct-download MSI is the current model, and it lacks signing + published hashes, so neither channel is trustworthy today.
19. Packaging reproducibility: dirty working tree + no git tag means the submission build cannot be traced to an exact commit.
20. Screenshots/metadata listing quality (Store rejects on "listing misleading" more often than teams expect — same class as GP item 6).

---

## 8. Phase 8 — Final report

### Executive summary
PathoMitra is an **architecturally** near-ideal candidate for both stores: no backend, no network
permission, no ads/analytics/crash SDK, no dangerous permissions, SQLCipher-at-rest everywhere it matters,
PBKDF2 credentials with a clock-robust lockout, sealed backups, in-app account deletion, honest on-device
disclosure, and a build chain that *fails closed* against placeholder privacy identities. **Its readiness
problem is not design — it is the last mile:** (1) the only artifacts that exist carry a
never-resolvable privacy policy/contact (`pathomitra.test`), (2) the Microsoft Store path is structurally
unbuildable on the pinned toolchain and the shipped installer is unsigned, (3) nothing desktop has ever
been installed or booted, and (4) clinical data (72 intervals, 2–11 y caveat suppression) is printed with
more certainty than it has been given. One owner input (a real domain + mailbox) and one verification pass
(install→boot→print) move the Play number from 72 → ~90 and turn the Windows story from "impossible" into
"pending a build decision".

### Readiness percentages, with the arithmetic shown
| Metric | Value | Exact reasoning |
|---|---|---|
| **A. Google Play readiness** | **72 %** | Weighted design score 87.4 (Policy 88 · Privacy 85 · Security 90) × 0.90 (GP-1 blocker present in the shipped binary) × 0.88 (Console/listing/device-verification work outstanding), rounded down. The submission command itself currently refuses to run → an artifact-level 0 % *today*, which is why the number is not higher. |
| **B. Microsoft Store readiness** | **38 %** (and **0 % submittable**) | Weighted 46.9 (Cert 20 · Sec 72 · Priv 65 · A11y 55) × 0.8 (reliability unproven — never booted). The MSIX gap (MS-1) means the practical readiness for submission is nil until the 27.x CI decision is taken. |
| **C. Security maturity** | **81 %** | Electron hardening 10/12 checklist items ✔ (2 open: CSP, permission handler; frame-check partial); runtime dep advisories 0/0; auth/crypto/keystore/IPC/storage posture all pass their adversarial reads; deductions — S-1 (−4), S-2 (−2), S-3 (−2), S-6 unsigned distribution (−5), S-7 DPAPI asymmetry undocumented (−3), desktop re-lock gap (−2), no WAK/boot evidence (−1). |
| **D. Privacy compliance** | **78 %** | Architecture + disclosure quality is exemplary (policy text is code-accurate and the app refuses to ship a placeholder *release*); deductions — unreachable policy in existing binaries (−6), Data Safety form not executed (−5), web/localStorage PHI path (−4), desktop-vs-Android key-protection asymmetry not in the policy (−3), DPDP supports missing (consent record, access audit trail, retention) (−3), `unverifiedForPatient` rendering removed (−1). |
| **E. Production readiness** | **60 %** | Strongest axis is code quality (588 tests, 87 %/81 % coverage, lint/type gates, reproducible Android artifacts verified byte-identical). Held back by operational reality: no real domain/mailbox/hosted policy (hard blocker), MSI never installed or booted, 2.7.x never smoke-tested on the phone, print never verified on paper, no code signing, no version tag for the whole 2.6.x/2.7.x line, dirty working tree (204-line `PatientsPage` change uncommitted), Cloudflare project-name mismatch, and an untracked fork (`promotion_website`) with copy drift risk. |

### Issue list
**Critical (P0)**
1. **GP-1 / MS-9** — privacy policy + contact unresolvable in every existing binary (`pathomitra.test`); it is the single input that gates both stores.
2. **MS-1** — no MSIX can be produced on electron-builder 26.x → the Store path has no package at all. *(Owner has formally de-scoped the Store; recorded as blocking-when-reopened.)*

**High (P1)**
3. **S-6/MS-2** — the only Windows distribution channel ships an unsigned installer with no published checksum (SmartScreen + supply-chain).
4. **S-1** — no CSP in the APK WebView or the Electron renderer (the web target has one; the two data-holding targets do not).
5. **GP-2** — Console declarations (Data Safety, IARC, audiences, permissions, app access) not executed; the form must match the binary.
6. **GP-3** — 72 unverified reference bands printed as clinical fact; no sign-off gate yet.
7. **M-PII-1 (§5.3)** — the deployed web build stores any data typed into it in unencrypted browser storage, auto-deployed on every push to `main` (disclosed, not prevented).
8. **Verification debt** — no MSI install→boot ever; 2.7.x never tested on the phone; print never verified on real paper; billing documents never printed.

**Medium (P2)**
9. No `setPermissionRequestHandler` (S-2) · 10. No per-frame IPC sender validation + unguarded `pm:db:clear` (S-3) · 11. Desktop policy text vs DPAPI reality (S-7/MS-5) · 12. `powerMonitor` re-lock (S-8, audit A-2) · 13. Shipped third-party real-lab letterhead (GP-4) · 14. `pathomitra.app` domain/mailbox does not exist yet `promotion_website/` copy publishes it · 15. Cloudflare Pages project still `healthcare-os` · 16. `<access origin="*"/>` in a toolchain-owned file (GP-6) · 17. Dead `REPORT_SECRET_KEY` + stale `server.ts` comments (S-5) · 18. `public/p-logo.png` delete-owed / `default-share-template.png` decision · 19. No version tag for 2.6.x/2.7.x (provenance) · 20. `manifest.json` still calls the product a "Clinical Digital Pathology Laboratory **Portal**" while the splash and policy deliberately use "Console" (a portal implies remote access) · 21. Dev server `allowedHosts: true` (S-4).

**Low**
22. `config.xml` cordova scaffolding could be dropped entirely · 23. Print staging leftovers survive until the next job · 24. `marketing-claims.test.ts` strips `/* */` but not `//` comments (a `//` quoting a banned word fails the build) · 25. recharts 10× dev-time warning (AM-6, recorded not changed).

### Immediate fixes (must do, in order)
1. Buy/point `pathomitra.app` (or any owned domain) → set `VITE_SUPPORT_EMAIL` + `VITE_PRIVACY_URL` in `.env` → `npm run build:privacy` → host `privacy-site/` there → confirm the strict live probe passes → `npm run verify:android` to cut the **submission** APK+AAB (this retires GP-1, item 14, part of item 4).
2. Replace the default share letterhead with a neutral template (GP-4) and fix `manifest.json`'s "Portal" wording.
3. Add the CSP (S-1) + `setPermissionRequestHandler` (S-2) + `senderFrame` origin check (S-3) to `electron/main.ts`/`ipc.ts`, and inject the same CSP into the native build's `index.html`; regression test each.
4. Install→boot the 2.7.2 MSI on a non-OneDrive machine and print one report on paper; run WAK once it installs cleanly (retires item 8-desktop half).
5. Tag the release (`v2.7.2`) and either commit or stash the `PatientsPage.tsx` work before cutting any submission build (provenance).

### Recommended
6. Authenticode signing (OV/EV) + publish version, SHA-256, system requirements on a `/download` page.
7. Write the desktop threat-model section of `SECURITY.md` (DPAPI vs KeyMint) and align `privacy-policy.ts` §3 with per-platform wording; then regenerate the hosted policy.
8. Implement `powerMonitor` minimize/suspend re-lock (A-2).
9. Execute the Clinical sign-off gate for the 72 intervals; restore a single per-report caveat line for out-of-band ages.
10. Decide the web build's role: either clearly "demo/evaluation only" (listing + page + policy) or stop auto-deploying to a public URL.
11. Move MSIX to a 27.x CI workflow when (if) the Store path returns; keep MSI as the direct-download target.
12. Fill `docs/play-listing.md §5` in the Console, commit the doc, and keep it and `promotion_website/` in sync with the app copy under one guard.

### Optional
13. DPDP helper features: patient consent note field, operator access/audit trail, retention reminder.
14. Drop the unused Cordova scaffolding module · 15. Tighten dev `allowedHosts` · 16. Remove the dead `REPORT_SECRET_KEY` and stale comments · 17. Add an OSS notice file to the Windows package · 18. UIA/Narrator pass on the desktop shell · 19. Revenue tiles / receipt document (billing follow-ups).

---

## Appendix — verification commands run in this session
```
node scripts/check-android-manifest.mjs        → ✓ v2.7.2 (2007002), 7 permissions, not debuggable,
                                                  backups excluded; ⚠ config.xml <access origin="*">
Select-String packaged_manifests\release\…     → the 7 permission names (no INTERNET, no exact alarm)
npm audit                                      → 15 (4 high / 11 moderate), all dev/tooling; 0 runtime
git status / git diff --stat / git check-ignore → dirty: PatientsPage.tsx, play-listing.md;
                                                  .env untracked & ignored
node -e require('electron/package.json').version → 44.7.0
grep src/  : fetch|XMLHttpRequest|WebSocket|sendBeacon|https:// | dangerouslySetInnerHTML|innerHTML|
             eval(|new Function | setPermission|ignoreCertificate|webSecurity|CSP
             → 0 code hits (only guard-test assertions)
```
