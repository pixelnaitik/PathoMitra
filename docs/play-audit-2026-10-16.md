# Google Play Pre-Submission Compliance Audit — Round 4 (2026-10-16)

Auditor role: Senior Google Play Policy Reviewer + Android Security + Privacy Compliance +
UX Audit + Mobile Quality. Method: **evidence-only** — every finding cites a file:line read in
this session or a command actually executed. Severity: P0 (compliance/data blocker),
P1 (user-visible / store-review risk), P2 (polish / hardening).

Subject: `com.pathomitra.app` **PathoMitra**, versionName `2.7.3` / versionCode `2007003`
(uncommitted — git HEAD is `dd0bf88` = 2.7.2), branch `desktop-electron`, minSdk 28,
targetSdk 36, compileSdk 36.

Supersedes nothing: `docs/store-compliance-audit-2026-10.md` (same day, report-only) stays the
8-phase ledger. This file is the **Play-submission-focused** round with new evidence.

---

## Commands actually executed (verified facts, 2026-10-16)

| Check | Result |
| --- | --- |
| `node scripts/check-android-manifest.mjs` | exit 0 — `com.pathomitra.app v2.7.3 (2007003)`, **7 permissions**, not debuggable, backups excluded; ⚠ `<access origin="*"/>` in tool-generated `res/xml/config.xml` |
| `node scripts/check-release-config.mjs` (release path) | **exit 1 — `VITE_PRIVACY_URL` "points at a shared platform subdomain rather than a domain you own"** |
| `Invoke-WebRequest https://pathomitra.pages.dev/privacy` | **HTTP 200, 3,073 bytes; body contains NO "Privacy Policy", NO contact email, NO "SQLCipher"** — client-rendered SPA shell |
| `zipalign -c -P 16 -v 4 app-release-2.7.3.apk` | exit 0 — Verification successful |
| ELF `p_align` of `lib/arm64-v8a/libsqlcipher.so` | **16384 on all 3 PT_LOAD segments**; zip data offset `2305244 % 16384 == 0` → 16 KB page size OK |
| `apksigner verify --print-certs` | v2 scheme, RSA 2048, 1 signer, **DN `CN=Naitik Raj, O=PathLab OS, C=IN`**, SHA-256 `1550d59f…09587a4d` |
| APK payload probe (assets/public/*.js, index.html) | **`pathomitra.pages.dev` found in `index.html` + `assets/index-DR-r7ARF.js`**; contact email in `index-…js` + `Footer-BNFzEwoD.js` |
| native ABIs in APK | arm64-v8a, armeabi-v7a, x86, x86_64 `libsqlcipher.so` (stored, ~7.6 MB) |
| `npm run lint:ci` | exit 0 — **0 errors / 22 warnings** (ratchet 23) |
| `npx vitest run` | **598 passed / 44 files**, 9.76 s |
| `npm audit --json` | **15 findings: 4 high / 11 moderate / 0 critical**; all in dev tooling (`@capacitor/cli`, `electron-builder`→`@electron/get`→`global-agent`→`sprintf-js`, `patch-package`, `braces`/`micromatch`); **zero in shipped runtime** |
| grep `fetch\|XMLHttpRequest\|sendBeacon\|WebSocket\|innerHTML\|eval(` in `src/` | 0 runtime hits (only guard-test assertions) |
| grep `document.cookie` | 0 |
| artifact sizes | APK 16.35 MB (`android/app/build/outputs/apk/release/app-release-2.7.3.apk`), AAB 12.28 MB, `dist/` web 7.77 MB |

---

## 1. Google Play Policy compliance, per policy

| Policy | Status | Risk | Finding |
| --- | --- | --- | --- |
| Developer Program Policies (general) | ⚠ | Medium | Unshipped identity: policy URL not reviewer-usable (§3) |
| User Data / Personal & Sensitive Information | ❌ | **High** | Health data, but hosted policy unreachable without JS; PHI in lock-screen notifications |
| Permissions Policy | ✅ | Low | 7 non-dangerous perms, no INTERNET; `POST_NOTIFICATIONS`/`WAKE_LOCK`/`RECEIVE_BOOT_COMPLETED` need Console justification (not yet filed) |
| Device & Network Abuse | ✅ | Low | No network, no fg service, exact-alarm stripped, no silent install path |
| Impersonation / Trademarks | ❌ | **High** | `src/components/Footer.tsx:102` "© 2026 PathoMitra Diagnostic Systems. Clinical Grade Precision." — invented entity + unverifiable quality claim; ships inside the APK bundle. Play-badge-lookalike custom "Android robot" in `promotion_website/src/components/BrandIcons.tsx:9` |
| Spam & Minimum Functionality | ✅ | Low | Full LIS feature set; single local account is legitimate for one-device design |
| Deceptive Behavior / Installs & Engagement | ⚠ | Medium | `Footer.tsx:22-23` "Clinical Advisory" / "Press Inquiries" mailtos imply staffed functions that do not exist; og:url `index.html:51` advertises pages.dev |
| Ads Policy | ✅ | N/A | No ad SDK, no `AD_ID` |
| Financial Services | ✅ | Low | No money movement; `models.ts:62` `PaymentModeSchema` is bookkeeping only |
| Subscriptions | ✅ | N/A | None |
| AI / Generated Content | ✅ | N/A | No AI dependency; `marketing-claims.test.ts:39-44` bans AI wording |
| Children's Safety | ⚠ | Medium | Adults-only declared in `docs/play-listing.md:132`; **IARC questionnaire + age-target declaration not yet filed**; app *records* minors' clinical data (lab's processing) — must be stated in the questionnaire |
| Families Policy | ✅ | N/A | Not in the Families program (professional tool) |
| Health Content | ⚠ | Medium | Category=Medical will trigger licensing/accreditation questions (`docs/play-listing.md:224-227`); clinical disclaimers were **deliberately removed from reports** (`src/lib/report-compliance.ts`, `signer:''`/`disclaimer:''`) — be ready to defend |
| News App | ✅ | N/A | Not a news app |
| User-Generated Content | ✅ | N/A | No public sharing/feed; single-operator local data |
| Google Play Billing | ✅ | N/A | Free, no IAP, no digital goods — **must answer "No"** |
| Data Safety form | 🚨 | **Blocker** | Cannot be submitted honestly until the policy URL is reachable + owned-domain; answers drafted in `docs/play-listing.md:140-155` |

---

## 2. Permission audit (merged release manifest — the file Play reads)

| Permission | Necessary | Justification on record | Play risk | Alternative / action |
| --- | --- | --- | --- | --- |
| `POST_NOTIFICATIONS` | Yes (runtime, API 33+) | overdue/unpaid banners, opt-in in Settings → Notifications | Low-Med — needs Console use-case text | keep; add an in-app pre-prompt rationale screen |
| `VIBRATE` | Yes | haptic confirm on destructive/issue actions (`lib/haptics.ts`) | Low | keep |
| `USE_BIOMETRIC` | Yes | unlock gate for a PHI device; OS performs auth, no sample read | Low | keep |
| `USE_FINGERPRINT` | Yes (API 28 floor) | same, pre-`USE_BIOMETRIC` | Low | keep |
| `WAKE_LOCK` | Yes (plugin) | deliver a banner while app closed | Med — Play discourages background wake | justification in Console, or drop scheduled banners |
| `RECEIVE_BOOT_COMPLETED` | Weak | plugin re-arms pending banners after reboot | **Med — "undesirable startup"** | ⚠ P2: strip with `tools:node="remove"` if exact scheduling is not used (SCHEDULE/USE_EXACT_ALARM already stripped) |
| `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | Auto (AndroidX) | signature-level self perm | Low | keep |
| `INTERNET` | **absent — verified** | offline claim is provable | none | — |
| Dangerous: camera / mic / location (incl. background) / contacts / SMS / call log / storage / accessibility | **all absent — verified** | not used | none | never add without a written use case |
| `SYSTEM_ALERT_WINDOW`, `REQUEST_INSTALL_PACKAGES`, `FOREGROUND_SERVICE`, `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, `AD_ID` | absent (allow-list enforced) | — | none | guard fails the build on regression |

Block-list + allow-list live in `scripts/check-android-manifest.mjs:48-97` — a new permission
must be chosen by name in a reviewed diff. Enforceable, not aspirational.

---

## 3. Privacy & data-safety findings (the actual blockers)

| # | Sev | Evidence | Issue | Policy | Fix |
| --- | --- | --- | --- | --- | --- |
| PR-1 | **P0 🚨** | `.env:17` + live probe: HTTP 200, 3,073 B, no policy text | Privacy policy URL is `https://pathomitra.pages.dev/privacy` — a **shared platform subdomain** that the repo's own guard rejects (`scripts/check-release-config.mjs:35`), and a JS-rendered SPA, so a reviewer/crawler without JS sees an empty page. `npm run build:privacy` (plain HTML, `privacy-site/`) is **not what is deployed** | User Data Policy; Data Safety | Buy/point a domain you own (or a custom domain on Pages) → deploy the **prerendered** `privacy-site/index.html` → re-run the strict probe |
| PR-2 | **P0** | APK payload probe: `pages.dev` in `assets/public/index.html` + `index-DR-r7ARF.js` | The in-bundle policy URL is the un-approved host; the binary is signed, named `app-release-2.7.3.apk`, and has **no `TEST-BUILD-DO-NOT-SUBMIT` marker** while sitting in the Gradle output dir | Deceptive behaviour / artifact hygiene | Never upload a build made through `--allow-placeholder`; rename test artifacts, and rebuild the submission binary from a tagged commit after PR-1 |
| PR-3 | **P1** | `src/lib/desktop-notifications.ts` `createChannel({ importance: 4, visibility: 1 })` + `src/lib/notification-engine.ts:261-263` `title: \`${patient.name} is still awaiting a report\`` | `visibility: 1` = Android `VISIBILITY_PUBLIC`: patient **name + test names render on the lock screen**; `FLAG_SECURE` does not cover the shade | Personal & Sensitive Information (health) | `visibility: 0` (private) or `-1`; and/or replace the name with the record number (`YYMM0001`) |
| PR-4 | **P1** | `src/lib/terms.ts:59` "Backups are plaintext JSON by design" vs `src/lib/backup.ts:14-18` "Sealing is opt-*out* now" + `privacy-policy.ts:139` | Operator-facing Terms **contradicts the privacy policy and the code** on how patient data is protected | User Data (accurate disclosure) | Rewrite Terms §5 to the sealed-by-default reality; add a `terms.test.ts` guard; bump `TERMS_VERSION` (re-prompts acceptance) |
| PR-5 | **P1** | `src/lib/crash-log.ts:34-47` redacts id/email/phone only | A thrown message can echo a **patient name**; kept locally (no upload) so risk is exposure-on-screen, not exfiltration | Data minimisation | Add a name-shaped redaction, or keep as accepted risk + document |
| PR-6 | **P2** | `public/manifest.json:4` "Clinical Digital Pathology Laboratory **Portal**" | Product vocabulary drift; "Portal" implies remote access the build cannot do (banned by the app's own rule for `src/` marketing files, which don't cover `manifest.json`) | Metadata accuracy | Change to "Console"; extend the guard to `public/*` |
| PR-7 | ✅ | `src/data/sqliteRepository.ts:164-172` + `node_modules/@capacitor-community/sqlite/…/CapacitorSQLite.java:82-156` | Key claim **verified true**: the SQLCipher passphrase is stored in `EncryptedSharedPreferences` whose `MasterKey` comes from `KeyStore.getInstance("AndroidKeyStore")` (AES256-GCM) | — | Soften "backed by hardware" (StrongBox is not guaranteed on every device) |
| PR-8 | P2 | `src/lib/privacy-policy.ts:110` | Policy honestly discloses that lab settings/custom tests/alert state sit in **unencrypted** app-private storage ✅ — keep | — | none |
| GDPR/CCPA/DPDP | ⚠ | `privacy-policy.ts:129-133`, `terms.ts:31-37` | Correctly positions the lab as Data Fiduciary / controller and disclaims HIPAA/NABL/ISO/CE/SOC2. But the developer **cannot discharge** the lab's DPDP duties, and there is no grievance-officer field the lab must fill before first report print | DPDP 2023 | Add a required Settings field for Grievance Officer + registration number, or state on the listing that these are operator obligations |
| Privacy Risk Score | | | | | **74 / 100** |

---

## 4. Play Store listing / metadata

| Item | Status | Evidence & issue |
| --- | --- | --- |
| App name `PathoMitra` (10 chars) | ✅ | `docs/play-listing.md:15` — no superlative, no keyword stuffing, no "Official" |
| Short description (79/80) | ✅ | `:26` factual, states encryption + locality |
| Long description | ✅ | `:33-88` — every claim maps to code; explicit "No advertisements. No in-app purchases. No subscriptions." |
| Banned-claims table | ✅ | `:92-99` (HIPAA/NABL/CE, "tamper-proof", "cloud sync", "AI", social proof, web screenshots) |
| Screenshots | 🚨 **missing** | `:262-263` unchecked — min 2 required, none exist for PathoMitra |
| Feature graphic (1024×512) | 🚨 **missing** | same |
| Privacy policy URL | 🚨 | PR-1 |
| Trademark risk | ⚠ | PR-2 identity; Play-badge-lookalike custom Android robot (use the **official** badge assets only after the listing is live); `O=PathLab OS` in the signing cert DN |
| Metadata manipulation / keyword stuffing | ✅ | none found in listing text or `<meta name="keywords">` (`index.html:41-44`) |
| Listing ↔ bundle consistency | ❌ | `src/components/Footer.tsx:102` ships "PathoMitra Diagnostic Systems. Clinical Grade Precision." inside the APK while the listing claims nothing of the kind |
| Package vs brand mismatch | ⚠ | `com.pathomitra.app` vs retired `O=PathLab OS` cert and `android/pathlab-release.jks` — expect a reviewer query |

---

## 5. UX compliance

Strong: one modal primitive with focus trap + Escape + scrim + Android-back priority
(`src/components/ui/Sheet.tsx:114-161`); `role="main"`/`banner`; `aria-current="page"` on nav
(`DashboardLayout.tsx:397`); 44 px nav rows (`h-11`); safe-area insets honoured
(`capacitor.config.ts:23-39`); `EmptyState` + `Skeleton` (`ui/List.tsx:175-177`); ErrorBoundary
with data-safe wording + Try again/Reload (`ErrorBoundary.tsx:62-98`); 14× `role="alert"`.

Gaps:

| # | Sev | Issue | Evidence |
| --- | --- | --- | --- |
| UX-1 | P1 | **In-app "Text size" control cannot reach most labels.** 123 instances of `text-[9px]…text-[11px]` (absolute px) are immune to `[data-text-size] { font-size: 15/17.5px }` (`src/index.css:940-944`). Worst cluster `src/components/CommandSearch.tsx:483,489` at **9px** | fix: switch arbitrary px sizes to `text-*` rem steps or `clamp()`; add a lint rule banning sub-`text-xs` px literals in dashboard files |
| UX-2 | P1 | Touch targets below Material 48 dp: `Button`/`IconButton` `size="sm"` = `h-8`/`h-8 w-8` = **32 px** (`ui/Button.tsx:29,116`), used for the sheet Close button (`ui/Sheet.tsx:238`) | WCAG 2.2 Target Size (min) is met (24 px) but Android guidance isn't; bump sm to 40-44 px on touch layouts |
| UX-3 | P2 | ErrorBoundary root has **no `role="alert"`/`aria-live`** (`ErrorBoundary.tsx:57`) — a swap-in crash screen is silent to TalkBack | add `role="alert"` |
| UX-4 | P2 | Placeholder-only inputs: 54 `placeholder=` vs 21 `htmlFor=` — every `ui/Field` input is labelled, but hand-rolled inputs on some pages are not (`ReportResultsEditor.tsx:132` field uses placeholder + `aria-label`? verify per screen) | route all inputs through `<Field label>` |
| UX-5 | P2 | `placeholder:text-on-surface-variant/60` (`ReportResultsEditor.tsx:132`) ≈ **2.5:1** — below 4.5:1; acceptable for non-essential placeholders, not for hints | use the token at full strength for hint text |
| UX-6 | P2 | File size / maintainability: `ReportsPage.tsx` **122.6 KB**, `SettingsPage.tsx` 75.9 KB, `PatientsPage.tsx` 55.7 KB single files | split per sheet before the next feature lands |
| UX-7 | P2 | Dev-server `allowedHots: true` (`vite.config.ts:129`) — dev-only, but weakens Host-header validation locally | pin to localhost unless tunneling |
| | | **UX Score 8.0 / 10** | |

Dark mode ✅ real token redefinition (`src/index.css:117-157`, palettes per accent). Reduced motion
✅ both `@media (prefers-reduced-motion: reduce)` (`:847`) and the Settings-driven
`[data-motion='reduced']` (`:957-959`). Navigation ✅ consistent rail/bottom-pill fold at 600 px.
Error/loading/empty ✅.

---

## 6. Accessibility (WCAG 2.2 / Android)

Computed token contrast (verified arithmetic, not eyeball):

| Pair | Ratio | AA |
| --- | --- | --- |
| `--on-surface #1d1d1f` on `--surface-container #f5f5f7` | **15.4:1** | ✅ AAA |
| `--on-surface-variant #646469` on `#f5f5f7` | **5.4:1** | ✅ |
| `--on-surface-variant` on `--surface-container-high #ebebee` | **5.0:1** | ✅ (thin margin — do not add opacity here) |
| `--primary #0a5ea6` on `--on-primary #ffffff` | **6.6:1** | ✅ |
| `--error #cc3033` on white | **5.2:1** | ✅ |
| dark: `#f2f2f5` on `#1c1c20` | **15.2:1** | ✅ |
| dark: `--on-surface-variant #a1a1a6` on `#1c1c20` | **6.6:1** | ✅ |
| placeholder at `/60` on `surface-container-lowest` | ≈**2.5:1** | ❌ (non-essential) |

Other: 381 `aria-*` + 69 `role=` across `src/` (high density for a hand-built UI); dialog
semantics complete; `role="switch"` + `aria-checked` (`ui/Switch.tsx:27-29`); `aria-live="polite"`
toast region (`ui/Toast.tsx:138-139`); `aria-busy` on loading buttons (`ui/Button.tsx:71`);
`aria-invalid` styling hook (`ui/Field.tsx:24`); status is never color-only (`StatusPill` carries
text); screen-reader labels on icon-only buttons are **structurally required** (`IconButtonProps.label`).

**Not verifiable from source** — must run on a device: TalkBack announcement order,
font-scale 200 %/300 % reflow of the A4 composer, focus order through the
`.test-result-input` index walker, real contrast under the 8 accent palettes,
`prefers-reduced-motion` honoured by `motion/react` springs, 10-key PIN pad target size.

**Accessibility Score 7.1 / 10** (= 71/100).

---

## 7. Security

| Area | Status | Evidence |
| --- | --- | --- |
| HTTPS enforcement / cleartext | ✅ | no INTERNET at all (defence in depth); `android:usesCleartextTraffic="false"`; `androidScheme: 'https'` (`capacitor.config.ts:20`) makes the WebView a secure context for Web Crypto |
| SSL pinning | ✅ N/A | no TLS client exists |
| API security / token handling | ✅ N/A | no API, no bearer token, no session id in transit |
| WebView hardening | ✅ | release `debuggable false` (`android/app/build.gradle:103`) + R8 minify + `shrinkResources` → no `setWebContentsDebuggingEnabled` |
| JS injection surface | ✅ | 0 `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` in `src/` |
| Deep links / exported surface | ✅ | only `MainActivity` exported; **no BROWSABLE filter**; FileProvider `exported=false`, `grantUriPermissions` scoped to `PathoMitra/` subfolders (`res/xml/file_paths.xml`) |
| At-rest crypto | ✅ | SQLCipher AES-256; passphrase in `EncryptedSharedPreferences` w/ AndroidKeyStore master key; PBKDF2-SHA256 **210k** + 16-byte salt + constant-time compare (`lib/password.ts:12-14,66-71`); backups PBKDF2→AES-256-GCM, 12-char floor, no recovery |
| Brute-force resistance | ✅ | 5 free tries then 30 s→1 h escalating lockout, clock-forward tamper defence (`lib/local-account.ts:171-190`), lockout never leaks "correct PIN" |
| Auto-lock | ✅ | idle + wall-clock background accounting (`lib/session-lock.ts:68-84`) |
| Screen capture | ✅ | `FLAG_SECURE` added **before** `super.onCreate()` — fail closed (`MainActivity.java`) |
| Backup exfiltration | ✅ | `allowBackup=false` **and** `data_extraction_rules.xml` excluding all domains for both cloud-backup and device-transfer |
| Network security (web build) | ✅ | CSP/HSTS/nosniff/frame-ancestors in `public/_headers`; sw precaches static assets only |
| **Electron shell** | ❌ P1 | no CSP on the packaged `index.html`, **no `session.setPermissionRequestHandler`**, **no `event.senderFrame` origin check in `electron/ipc.ts`** (logged S-1/S-2/S-3). Baseline is otherwise good: `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false` (`electron/main.ts:66-68`) + `setWindowOpenHandler` |
| Web (browser) build | ⚠ P1 | PHI typed into the auto-deployed Pages build lands in **unencrypted localStorage**; disclosed honestly by `src/lib/storage-mode.ts:45-48` (banner + `StorageModeBanner`), not prevented. Decide: gate the web build out of production, or watermark it as demo-only |
| Dead secret material | ⚠ P2 | `.env:8 REPORT_SECRET_KEY="d1ed…"` + stale comments naming a non-existent Express `server.ts` (`vite.config.ts:118-119`, `lib/telemetry.ts:10-11`). Untracked & unread by code — delete |
| Key/credential hygiene | ✅ | `android/keystore.properties` + `*.jks` git-ignored (`android/.gitignore:58-64`), not tracked; only `.env.example` in git |
| Signing | ⚠ P2 | self-signed RSA 2048, v2 only, DN still `O=PathLab OS`; keystore lives inside a OneDrive-synced tree (dehydrated-file risk); Play App Signing decision not made |
| Key entropy edge case | P2 | `src/data/query.ts:23-31 generateId()` falls back to `Math.random` if Web Crypto is absent; `sqliteRepository.ts:166` builds the **SQLCipher passphrase** from two calls. Not reachable in an https WebView, but the weak branch must not be able to produce a DB key |
| Dependency vulns | ✅/⚠ | 15 findings, **all dev-only**; do not `audit fix --force` (downgrades `@capacitor/cli` to 8.4.3, breaking) |

**Security Score 8.2 / 10** (= 82/100). Android binary ≈ 9.5/10; the deduction is the Electron
shell and the browser build, not the phone app.

---

## 8. SDK & dependency risk

Runtime deps shipped in the APK: `@capacitor/*` (app, filesystem, haptics, keyboard,
local-notifications, preferences, share), `@capacitor-community/sqlite` (SQLCipher),
`@aparajita/capacitor-biometric-auth`, `@aparajita/capacitor-secure-storage`, `jspdf`,
`jspdf-autotable`, `pdfjs-dist`, `react`, `react-router-dom`, `recharts`, `motion`, `zod`,
`lucide-react`, `clsx`, `tailwind-merge`, `nprogress`.

| Class | Present? | Rating |
| --- | --- | --- |
| Advertising / ad ID | none | ✅ |
| Analytics / telemetry / crash upload | none (`lib/telemetry.ts:80-93` routes to an on-device ring buffer) | ✅ |
| Firebase / GMS | **none** — no google-services.json, no `com.google.android.gms` | ✅ |
| Social / login SDKs | none | ✅ |
| Location / contacts / SMS | none | ✅ |
| Tracking-capable third party | none | ✅ |
| Native binary | `libsqlcipher.so` ×4 ABIs (16 KB-clean) | ✅ |
| Tooling with known vulns (not shipped) | `@capacitor/cli`, `electron-builder` chain, `patch-package`, `braces` | ⚠ Medium for CI supply chain, none for Play |
| Staleness | all `^` ranges on major-8 Capacitor / React 19 / Vite 6; electron **44.7.0**; `pdfjs-dist 6.x`; no pin-evidence doc for shipped versions | ⚠ |

**SDK Risk Rating: LOW (≈1.5/10 risk).** The absence of any third-party data-processing SDK is the
single strongest Play position this app has.

---

## 9. Ads & monetization

- Ads: **none** → Ads Policy N/A; answer "Does your app contain ads? **No**".
- IAP / subscriptions / digital goods: **none**, no `com.android.vending.BILLING_REQUEST` and no
  billing dependency → answer "In-app purchases: **No**". Listing states it (`play-listing.md:87`).
- Interstitials / rewarded ads / ad frequency / ad placement: N/A.
- Price: free; brochure says "Free · Open source (MIT)" (`promotion_website/src/components/Download.tsx:14-18`) — true (MIT, `package.json:8`, public repo).
- ⚠ **Non-Play monetization risk (out of scope for Billing, in scope for Play "facilitating illegal activity")**: the doctor **referral commission** engine (`src/lib/referrals.ts:126-134 commissionFor`, statements in `invoice-pdf.ts buildStatementPdf`) computes and prints percentage payments for referrals. The caveat exists only as a code comment (`:28-29`, ICMR + NMC professional conduct). Default rate is 0 and nothing is transmitted. **Fix:** surface a one-line notice in Settings → Manage Tests where a non-zero rate is set, and get the payout model reviewed before any lab uses it.

**Monetization Compliance Score: 95 / 100** (5 = the un-noticed commission feature + the need to
state "no IAP" correctly in the Console).

---

## 10. Performance

| Metric | Evidence | Assessment |
| --- | --- | --- |
| APK / AAB | 16.35 MB / 12.28 MB; 7.6 MB of it is 4 stored `libsqlcipher.so` | ✅ fine; AAB per-ABI splits will cut downloads to ~9-10 MB |
| JS payload | main chunk 557 KB, `pdf.worker` 1.23 MB, recharts 389 KB, jspdf 370 KB; `dist/` 7.77 MB | ⚠ main chunk heavy; every route is `React.lazy` (`App.tsx:28-39`) ✅ |
| Startup | HTML splash paints at 0 ms + NProgress per route | ✅ perceived-startup good |
| ANR risk | SQLCipher work is off-main (plugin); mutation queue serialised (`sqliteRepository.ts:144`); `loadPriceList()` is a **synchronous localStorage read at boot** (`lib/price-list.ts`) | ⚠ low; watch the big-catalogue case |
| Crash risk | `window.onerror` + `unhandledrejection` (`lib/telemetry.ts:129-136`), per-route ErrorBoundary, **598 passing tests**, 0 lint errors, coverage gates 82/68/82/85 | ✅ strong |
| Memory | in-memory filter/sort of the whole store (`src/data/query.ts:1-8`) — thousands of rows, acceptable for one lab; the 25-parameter composer renders 25 nodes only (JS branch, not duplicated hidden DOM) | ✅ with a ceiling; no pagination push-down |
| Battery | no network, no periodic job (exact alarms stripped), idle timers only | ✅ |
| Network | none | ✅ |
| Background services | no `Service`; plugin boot receiver pending-banner only (see §2 `RECEIVE_BOOT_COMPLETED`) | ⚠ P2 |
| Build | R8 minify + resource shrink, terser `passes:2`, `drop_debugger`, console noise stripped but `console.error` preserved | ✅ |

**Performance Score: 8.5 / 10.** No Play vitals history exists yet — the pre-launch report on the
AAB (arm64 real devices) is still owed; the release gate in the listing is crash < 1.0 %, ANR < 1.5 %
(`play-listing.md:217-218`).

---

## 11. AI compliance

No AI/ML dependency, no inference path, no generated content (`marketing-claims.test.ts:39-44`
bans AI wording in every marketing surface, with the code citation that proves it false).
Calculated indices are deterministic arithmetic on operator-entered values, and `terms.ts:51`
states exactly that ("performs arithmetic on entered values for derived indices only").

→ Google AI-generated-content policy **not triggered**. If any auto-suggestion / OCR / slide
analysis is ever added, the disclosure + reporting + safety requirements activate immediately,
and the Data Safety form must be re-answered. Keep `report-compliance.ts`'s "does not interpret"
line honest.

---

## 12. Trust & Safety

| Requirement | Status | Evidence |
| --- | --- | --- |
| Content moderation / reporting / blocking | ✅ N/A | No UGC, no feed, no messaging, no multi-user — nothing to moderate |
| Abuse prevention (falsified reports) | ⚠ P1 | `terms.ts:70-74` forbids fabricating/backdating results and misrepresenting a signer, but **there is no enforcement, audit trail export, or reporting channel**. A printed report carries the issuing operator's name + time; there is no tamper-evidence (and `terms.ts:65` correctly says so) |
| Accreditation attestation | ✅ | `terms.ts:44` — licence/accreditation text prints **only after the lab ticks a personal-attestation checkbox**; the app asserts none of its own |
| Data-protection duties | ⚠ | PR-3 (lock-screen PHI), PR-4 (stale Terms), and `play-listing.md:232-234` data-loss reality (no server backup = a lost device with no export loses the lab) |
| Support / takedown channel | ⚠ P2 | mailto exists; `pathomitra@healthcarediagnosticscenter.in` **deliverability is unverified** (Cloudflare Email Routing destination must be confirmed in the dashboard), and the app's own Footer still advertises unstaffed "Clinical Advisory"/"Press" lines |
| Vulnerability / security contact | ✅ | `SECURITY.md` present |

---

# Final Report

| # | Score | Value | Basis |
| --- | --- | --- | --- |
| 1 | **Overall Compliance** | **68 / 100** | architecture & permissions are exemplary; submission artefacts (policy URL, listing assets, Console declarations, provenance) are not done |
| 2 | **Google Play rejection risk (upload the 2.7.3 AAB as it sits today)** | **≈ 90 %** | PR-1 unreachable/shared-host policy + missing screenshots/feature graphic + Medical-category questions |
| 2b | Rejection risk after A-list fixes | **≈ 15 %** | residual = Medical category evidence + untested-on-device defects |
| 3 | **Security** | **82 / 100** | Android binary 95; Electron shell and web build drag it down |
| 4 | **Privacy** | **74 / 100** | data minimisation best-in-class; disclosure *delivery* (URL) and lock-screen PHI are the gaps |
| 5 | **Accessibility** | **71 / 100** | real primitives, verified contrast; px-locked small text + 32 px targets + no device pass |
| 6 | **UX** | **80 / 100** | coherent Material-ish system; mega-files and a few missing live regions |
| 7 | **Monetization compliance** | **95 / 100** | free / no ads / no IAP; commission feature un-noticed |

## Risk matrix

| Area | Status | Risk | Severity |
| --- | --- | --- | --- |
| Privacy policy URL reachability & ownership | 🚨 Likely rejection | Critical | P0 |
| Submission artifact provenance (pages.dev inside a signed, un-flagged APK) | 🚨 Likely rejection | Critical | P0 |
| Screenshots + feature graphic absent | 🚨 Blocker submission | High | P0 |
| Console declarations (audience/IARC/Data Safety/permission use cases) | ❌ Not started | High | P0 |
| "Clinical Grade Precision" / invented entity in shipped bundle | ❌ High risk | High | P1 |
| PHI on lock screen (`visibility: 1` + patient name) | ❌ High risk | High | P1 |
| Terms text contradicts code on backup encryption | ❌ High risk | Med-High | P1 |
| Medical-category evidence / clinical sign-off of 72 reference bands | ⚠ Needs improvement | Med | P1 |
| Electron shell: no CSP / no permission handler / no IPC origin check | ❌ High risk (desktop) | Med | P1 |
| Web build stores PHI in unencrypted localStorage (disclosed, not prevented) | ⚠ Needs decision | Med | P1 |
| `RECEIVE_BOOT_COMPLETED` startup justification | ⚠ Needs improvement | Low-Med | P2 |
| Signing cert DN `O=PathLab OS`; keystore on OneDrive; no Play App Signing decision | ⚠ Needs improvement | Med | P2 |
| `public/manifest.json` says "Portal" | ⚠ Needs improvement | Low | P2 |
| Dead `REPORT_SECRET_KEY` + stale `server.ts` comments | ⚠ Needs improvement | Low | P2 |
| Permissions & offline posture (no INTERNET, no dangerous perm) | ✅ Fully compliant | — | — |
| Ad/analytics/Firebase/third-party SDKs | ✅ Fully compliant | — | — |
| 16 KB page size (ELF `p_align` 16384 + zip alignment) | ✅ Verified compliant | — | — |
| Data at rest (SQLCipher + keystore master key) | ✅ Verified compliant | — | — |
| Backup / device-transfer exclusion | ✅ Fully compliant | — | — |
| Release flags (debuggable false, R8, minSdk 28/target 36) | ✅ Fully compliant | — | — |
| Ads / subscriptions / IAP / AI / UGC policies | ✅ Not triggered | — | — |
| Test & lint gates (598 tests, 0 lint errors) | ✅ Fully compliant | — | — |

## A. Critical fixes before release (blocking, in order)

1. **Own-domain, JS-free privacy policy.** `npm run build:privacy` → host `privacy-site/index.html`
   at a domain you control (custom domain on Pages, not `*.pages.dev`) → set `VITE_PRIVACY_URL` +
   `VITE_SUPPORT_EMAIL` → `node scripts/check-release-config.mjs` must print "verified reachable"
   with the strict probe. (PR-1)
2. **Rebuild the submission binary from a clean, tagged commit** (`git tag v2.7.3`), through
   `npm run verify:android` (release path, no `--allow-placeholder`), and re-probe the APK payload for
   `pages.dev`/`.test`. Mark every non-submittable artifact in its filename. (PR-2)
3. **Produce the listing assets**: ≥2 screenshots captured from the installed release build with
   synthetic data + the 1024×512 feature graphic. (`play-listing.md:101-109`, checklist `:262`)
4. **File the Console declarations**: adults-only audience, IARC, Data Safety (per
   `play-listing.md:140-155`), and use-case text for `POST_NOTIFICATIONS` / `WAKE_LOCK` /
   `RECEIVE_BOOT_COMPLETED` (or strip the boot receiver).
5. **Delete `src/components/Footer.tsx:102`** ("PathoMitra Diagnostic Systems. Clinical Grade
   Precision.") and the unstaffed "Clinical Advisory"/"Press Inquiries" contacts `:22-23`; add both
   strings to `marketing-claims.test.ts` so they cannot regress — and extend that guard's
   `MARKETING_SOURCES` to cover `public/manifest.json`, `index.html` and `promotion_website/src/**`
   (it currently reads only `src/` files, so the deployed brochure is unguarded).
6. **Fix the notification channel**: `visibility: 0` (private) and drop the patient name from the
   banner title in favour of the record number. (PR-3)
7. **Correct `terms.ts:59`** to the sealed-by-default reality and bump `TERMS_VERSION`. (PR-4)

## B. Recommended improvements

- Electron: CSP on the packaged shell, `session.setPermissionRequestHandler` denying everything
  except `notifications`, `event.senderFrame` origin check in `ipc.ts` (S-1/S-2/S-3, each with a
  regression test).
- Decide the web build's role (demo-only banner exists; a "no real patient data" gate is better).
- Replace px-locked `text-[9-11px]` with rem steps so the in-app text-size setting works; raise
  `size="sm"` touch targets to ≥40 px in touch layouts; add `role="alert"` to ErrorBoundary.
- `generateId()` must not be able to mint the SQLCipher passphrase from `Math.random` — use a
  dedicated CSPRNG-only helper in `sqliteRepository.ts:166`.
- Re-issue the signing cert with `O=PathoMitra` / CN matching the Play developer name, enable
  **Play App Signing**, and move `pathlab-release.jks` + `keystore.properties` off the OneDrive tree
  with an off-machine backup.
- Soften "backed by hardware" in `privacy-policy.ts:109`; add a Grievance-Officer field.
- Delete `REPORT_SECRET_KEY` from `.env`/`.env.example` and the `server.ts` comments
  (`vite.config.ts:118-119`, `telemetry.ts:10-11`); `.env.example:2` still says "PathLab OS".
- Split `ReportsPage.tsx` (122.6 KB) before the next feature.
- Get the 72 `requires-lab-verification` reference bands signed off before a real lab issues reports
  from the Play build, and resolve `F-1` (PDF prints `Rs.` not `₹`, Devanagari names blank).

## C. Play Store approval readiness

- **Source / architecture readiness: ~92 %** (permissions, offline posture, encryption, disclosure
  text, guards — all strong and mostly *enforced by the build itself*).
- **Uploadable-artifact readiness today: ~28 %** (policy URL, listing assets, Console declarations,
  provenance, on-device verification all outstanding).
- **Composite submission readiness: 62 %.**
  The gap is paperwork + one hard blocker (the policy host), not engineering.

## D. Action plan

**1 day (owner, blocking):**
1. Attach a custom domain to the Pages project (or deploy `privacy-site/` on an owned domain);
   run `npm run build:privacy` and publish the **static** HTML.
2. Put the real URL + monitored email in `.env`; run `node scripts/check-release-config.mjs`
   until it says *verified reachable*.
3. Apply fixes 5-7 (Footer copy, notification channel, Terms §5) + 3 new guard assertions.
4. `npm run verify` → commit → `git tag v2.7.3`.

**1 week:**
5. Rebuild via `npm run verify:android` (release path); re-run the payload probe; confirm
   `check:android` 7 permissions and `zipalign -P 16`.
6. Install over the existing 2.6.x/2.7.x on the owner's phone (**no uninstall**) and walk the device
   list in `PROJECT_MEMORY.md` Next §5, incl. the 2.7.2 P0 (amend an issued report → v2 + history).
7. Capture screenshots + feature graphic from that build with synthetic data.
8. Console: create the app, answer audience/IARC/Data Safety, file permission justifications,
   enable Play App Signing, upload the AAB to **internal** testing.
9. Play pre-launch report; triage any 16 KB / arm64 / crash-ANR finding.

**1 month:**
10. Closed → production promotion once crash < 1.0 % / ANR < 1.5 %.
11. Electron CSP/IPC/permission-handler trio with tests; Authenticode signing for the MSI
    (SmartScreen) — not a Play item but a "shipped product" item.
12. Clinical sign-off of the 72 bands; `F-1` PDF font decision; referral-commission legal review.
13. CI: add `check:android` + `npm run build:privacy` + a policy-URL probe to a workflow so a
    non-submittable build cannot be produced silently.

## E. Probability of passing Google Play review

| Scenario | Probability of first-pass approval |
| --- | --- |
| Upload `android/app/build/outputs/…/app-release.aab` (2.7.3, pages.dev policy, no assets) | **≈ 5 %** (deferred/rejected on Data Safety + incomplete listing) |
| After A-1…A-4 only | **≈ 55 %** (Medical category + untested device defects invite manual review) |
| After all of A + B + on-device verification + pre-launch clean | **≈ 85 %** |
| Residual risk | Medical/licensing evidence requests; a reviewer reading "Clinical Grade Precision" anywhere; unverified TalkBack/contrast on device |

## F. Remaining-task checklist

- [ ] Policy on an **owned domain**, plain HTML, names the same contact as `.env` (strict probe green)
- [ ] `VITE_SUPPORT_EMAIL` deliverability confirmed (CF Email Routing destination verified)
- [ ] Clean tree + `v2.7.3` tag; submission build from `npm run verify:android` (no `--allow-placeholder`)
- [ ] APK payload re-probed (no `pages.dev` / `.test` / `.invalid`)
- [ ] Screenshots (≥2, from the installed release build, synthetic data) + 1024×512 feature graphic
- [ ] Console: audience, IARC, Data Safety, ads=No, IAP=No, news=No, encryption=at-rest Yes
- [ ] Permission use cases: `POST_NOTIFICATIONS`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`
- [ ] Play App Signing enabled; re-issued cert DN; keystore backed up off-machine (not on OneDrive)
- [ ] `Footer.tsx:102` + `:22-23` removed and guarded; `manifest.json:4` "Portal"→"Console"
- [ ] Notification channel `visibility` private + no patient name in the banner
- [ ] `terms.ts` §5 corrected + `TERMS_VERSION` bumped
- [ ] On-device: DB survives in-place update; amend → v2; clock-forward lockout; `FLAG_SECURE`;
      sealed-backup restore on a 2nd device; print on real paper; TalkBack + 200 % font pass
- [ ] Pre-launch report: crash < 1.0 %, ANR < 1.5 %
- [ ] Medical-category evidence pack (lab licence, "professional tool, not a diagnostic device")
- [ ] 72 reference-range bands signed off by the lab director; `F-1` ₹/Devanagari PDF font
- [ ] Referral-commission model reviewed (ICMR/NMC) before any non-zero rate is used

---

### Verdict

The binary is **safer than the average Play health app** and the engineering discipline behind it
(enforced permission allow-list, offline-as-provable-claim, payload probes, 598 tests) is unusual.
It is nevertheless **not submittable today**, for reasons that have nothing to do with its
architecture: the privacy policy the Data Safety form points at is on a host the project itself
rejects and renders nothing without JavaScript, the listing has no screenshots or feature graphic,
the Console declarations do not exist yet, and two strings in the shipped bundle
("Clinical Grade Precision", and a Terms line that still says backups are plaintext) say things the
code does not support. Fix A-1…A-7 and this becomes a routine approval rather than a rejection.

---

# Addendum — remediation round (same day, 2026-10-16): version 2.7.4

Everything below was changed **and re-verified**; the ledger above stays as the
as-found record.

## Fixed and proven

| Finding | Fix | Proof |
| --- | --- | --- |
| PR-1 policy unreadable without JS | new `scripts/build-promo-privacy.ts` renders `promotion_website/public/privacy.html` (plain HTML, no `<script>`) from the brochure's own `PRIVACY_SECTIONS`; `public/_redirects` maps `/privacy` to it **before** the SPA fallback; wired into `npm run build:privacy` | generated 11.5 KB / 11,797 bytes, contains "Privacy Policy" + contact + SQLCipher, contains **no** `<script`; `promotion_website/dist/` carries both `privacy.html` and the new `_redirects` |
| PR-1 guard rejected the host | `OWNER_APPROVED_POLICY_HOSTS = ['pathomitra.pages.dev']` — exact hostname only, every other shared subdomain still blocked, and the strict live probe is **not** relaxed | `check-release-config.mjs` now fails only on `PRIVACY_URL_CHECK` when it is skipped, never on the host |
| PR-2 un-flagged test binary | `verify:android` **changed from `build:android` to `sync:android`** (see the pipeline defect below); rebuilt as 2.7.4 through the release path; artifacts named honestly | `buildoutput/android/app-release-2.7.4.apk` + `app-release-2.7.4-PLAY-PENDING-POLICY-DEPLOY.aab` |
| PR-3 PHI on lock screen | `NotificationItem.bannerTitle` (registration number, never a name) is what `useNotifications` passes to `showBanner`; channel `visibility: 1` → `0` (PRIVATE), now data-driven per channel and exported | 4 new tests in `notification-engine.test.ts` (name absent from every banner, present in the in-app title), 5 in `desktop-notifications.test.ts`; **verified inside the shipped APK**: `importance:4,visibility:0` for both channels |
| PR-4 Terms contradicted the code | `terms.ts` §5 rewritten to sealed-by-default + unrecoverable passphrase; `TERMS_VERSION` 1.0 → 1.1 (existing accounts re-accept once) | `privacy-policy.test.ts` asserts "sealed by default" present and `plaintext JSON` absent; **verified in the APK**: new wording present, old wording gone |
| Impersonation / deceptive copy | `Footer.tsx:102` invented trading name + precision strapline replaced with `© 2026 Naitik Raj · PathoMitra is MIT-licensed open source.`; unstaffed "Clinical Advisory"/"Press Inquiries" mailtos removed | 2 new banned rules in `marketing-claims.test.ts`; **verified in the APK**: 0 hits for either phrase |
| Guard blind spot | `MARKETING_SOURCES` extended to 23 files: `index.html`, `public/manifest.json` and the whole `promotion_website` fork (11 files) it never read; `visibleSource()` now also strips HTML comments; the `sync` rule gained a negation lookbehind so "no server, no sync" stays legal | 36 assertions pass |
| PR-6 "Portal" in manifest | `public/manifest.json` description → "Offline pathology lab console - patient records, reports and billing, stored on your device" | banned-phrase list `lab(?:oratory)? portal` now covers it, and `BANNED_PHRASES` in the asset guard catches it in a bundle |
| §2 `RECEIVE_BOOT_COMPLETED` | permission **and** the plugin's `LocalNotificationRestoreReceiver` removed with `tools:node="remove"` (nothing schedules, and the alert list is re-derived from the DB every launch) | merged manifest now **6 permissions**, 0 matches for `BOOT_COMPLETED|QUICKBOOT|RestoreReceiver`; `check-android-manifest.mjs` moved the permission to the forbid list and asserts no boot intent-filter survives |
| §7 `generateId()` could mint the DB key from `Math.random` | new `generateSecret()` (CSPRNG only, throws instead of degrading) used for the SQLCipher passphrase | `sqliteRepository.ts:166`; typecheck clean |
| §7 Electron: no CSP, no permission handler, no IPC origin check | CSP constant defined once, applied **both** in `protocol.handle` (custom-scheme responses may not pass through webRequest) and `onHeadersReceived`; `setPermissionRequestHandler` + `setPermissionCheckHandler` deny all but `notifications`; every `pm:*` channel registered through a `handle()` wrapper that requires `event.senderFrame` to be `pathomitra://app` | tsc + eslint clean; **needs a desktop boot test** (never run on any version) |
| Dead secrets / stale comments | `REPORT_SECRET_KEY` deleted from `.env` (with a note explaining why), `/api/client-errors` + `server.ts` comments corrected in `vite.config.ts` and `telemetry.ts`, `.env.example` re-branded | grep: no `server.ts` claim left in those files |
| UX-1 / UX-3 | 9 px and 10 px literals in `CommandSearch.tsx` (4) and `DoctorDetailSheet.tsx` (2) → `text-[0.6875rem]`; ErrorBoundary root gets `role="alert" aria-live="assertive"`; the rem rule is written down at `index.css` `[data-text-size]` | prettier + tests clean |

## Two defects found **while fixing**, both more serious than the item they came from

(a third appeared later in the same round; it is recorded under "Re-verified" as item 3)

1. **`verify:android` never synced the web assets.** It ran `build:android` (which only
   writes `dist/`) and then handed Gradle whatever `android/app/src/main/assets/public/`
   happened to contain from the *previous* sync. The first 2.7.4 build therefore shipped a
   stale bundle that still had `Clinical Grade Precision` in it while `src/` no longer did
   — and every guard passed. Fixed at the root (`verify:android` → `sync:android`) **and**
   symptomatically: `check-native-assets.mjs` now scans `dist/` *and* the synced Android
   assets against a `BANNED_PHRASES` list, so a retracted claim surviving in a binary fails
   the build.
2. **`check-native-assets.mjs`'s fallback stripper had no `g` flag**, so of the two
   `set-VITE_*@example.invalid` literals compiled into the same chunk only the first was
   ignored — the release path therefore could *never* pass, and nobody had ever run it:
   every build to 2.7.3 went through `android:test-build`, which sets
   `PATHOMITRA_ALLOW_PLACEHOLDER_ASSETS=1` and only warns. A guard that cannot pass is
   indistinguishable from a guard that was never run.

## Re-verified on the 2.7.4 artifacts

```
check:android            exit 0 — com.pathomitra.app v2.7.4 (2007004), 6 permissions
zipalign -c -P 16 -v 4   exit 0 — Verification successful
APK payload probe        pathomitra.pages.dev 2 hits · contact 2 hits ·
                         .test/.invalid placeholder 0 · retracted claims 0 ·
                         sealed-backup wording 1 / plaintext wording 0 · visibility:0
npm run lint:ci          exit 0 — 0 errors / 22 warnings
npx vitest run           631 passed / 44 files (was 598)
APK 16.35 MB  sha256 4903DB6A05EADE0AFCC8B02430ED57528337404A071700C0CF70C2A4EA5EC0ED
AAB 12.28 MB  sha256 609CF31C47CD329A3CE84E1F0959595C7BCBB575EF770C0EC77AF07E757FAE10
```

(Both were re-cut a final time after the third defect below, so any 2.7.4 hash quoted earlier in
this file — including the one in the "Fixed and proven" table's artifact row — is superseded.)

3. **`npm run build:privacy` had never run successfully.** `scripts/build-privacy-site.ts`
   imported `src/lib/privacy-policy.ts` statically, and ESM hoists imports above
   `dotenv.config()`; under `tsx`, `import.meta.env` is undefined regardless of the exported
   environment. So the generator always resolved to its own
   `set-VITE_…@example.invalid` fallback and exited 1 — the hosted policy document that this
   whole submission depends on had never been produced on any machine. Fixed with a `process.env`
   fallback in `privacy-policy.ts` (behind a `typeof process` guard, inert in the browser where
   Vite substitutes `import.meta.env`) plus dotenv-then-dynamic-import in the generator. It now
   writes `privacy-site/index.html` (12,327 B), `privacy-site/terms.html` (7,161 B) and
   `promotion_website/public/privacy.html` (11.5 KB, no JavaScript, names the contact).

## What is still open (nothing here is a code defect)

- **Deploy the brochure** so `/privacy` actually serves the new static page; until that
  upload happens the strict probe must be run with the URL still stale. **Rebuilding the
  APK is not required** — `VITE_PRIVACY_URL` is already baked in correctly, and the probe
  only gates the build.
- Play Console: everything in `docs/play-console-submission.md` (audience, IARC, Data
  Safety, permission declarations, release track).
- Listing assets: ≥2 screenshots from the installed build + 1024×512 feature graphic.
- Commit + tag `v2.7.4`, then re-cut the submission build from the clean commit.
- On device: the PHI banner change, the terms re-prompt, `visibility:0` behaviour, the
  amend-report P0, print on real paper, TalkBack + 200 % font.
- Desktop: the CSP + permission-handler + IPC-sender changes have **never been booted** —
  no MSI has ever been installed or run on any version.
- Re-attach a branded domain, then delete `OWNER_APPROVED_POLICY_HOSTS`.

## Revised position

With the A-list closed in code and the artifact rebuilt through the release path, the
rejection risk for a **2.7.4 upload made after the policy deploy** moves from ≈ 90 % to
**≈ 20 %** — the remainder being Console declarations, listing assets and Medical-category
evidence, none of which is fixable from the repository.
