# Microsoft Store Pre-Submission Certification Review — PathoMitra for Windows

**Review date:** 2026-10-17 (round 3; round 2 = `docs/ms-store-review-2026-10-16.md`, round 1 = `docs/store-compliance-audit-2026-10.md`)
**Reviewer posture:** adversarial certification reviewer + Windows security + privacy compliance + accessibility + UX. Failure assumed unless compliance is verifiable.
**Mode:** read-only audit. No shipped source, config, or artifact was modified; the only files written are this report, four `.tmp/*.cjs|ps1` probes (git-ignored), and two screenshots.
**Subject:** PathoMitra **2.7.7** (`package.json` 2.7.7, working tree **uncommitted**; HEAD is `dd0bf88` = 2.7.2), Electron 44.7.0 shell in `electron/`, packaged by `electron-builder.config.mjs`.
**Policy source:** *Microsoft Store Policies* — **Publish date September 15, 2026 / Effective date October 22, 2026**, fetched from learn.microsoft.com/windows/apps/publish/store-policies **in this session**. 10.2.9 quoted verbatim below.

---

## 0. Headline verdict

| Metric | Round 2 (10-16) | **This round (10-17)** |
|---|---|---|
| Overall Compliance Score | 46 / 100 | **61 / 100** |
| Privacy Score | 58 / 100 | **76 / 100** |
| Security Score | 72 / 100 | **80 / 100** |
| UX Score | 74 / 100 | **78 / 100** |
| Accessibility Score | 70 / 100 | **74 / 100** |
| Performance Score | 66 / 100 | **82 / 100** |
| SDK Risk Rating | B (moderate) | **A− (low–moderate)** |
| Store rejection risk, artifact as-is | ≈100 % | **≈100 %** (nothing submittable exists yet) |
| Certification readiness | 8 / 100 | **34 / 100** |
| Approval odds after §A — Route M (10.2.9 signed MSI) | ≈80 % | **≈75 %** |
| Approval odds after §A — Route X (`.appx`) | ≈45 % | **≈45 %** |

**What moved the score is measurable, and it moved in the product's favour.** The four code blockers from round 2 are closed **and are present in the shipped bytes**, not just in the source tree: `app.asar`'s `/dist-electron/main.js` (28.9 KB) contains `setApplicationMenu`, `devTools`, `context-menu`, `render-process-gone`, `did-fail-load`, `child-process-gone`, `uncaughtException`, `unhandledRejection`, `Content-Security-Policy`, `setPermissionRequestHandler`, `setPermissionCheckHandler`, `senderFrame`, `themeSource`, `onBeforeRequest`, with 4 `isPackaged` gates (probe: `.tmp/store-review-2707-probe.cjs`). The renderer bundles carry `DPAPI` ×2, `Credential Locker` ×1, `Windows` ×16 and **zero** hits for `backed by hardware`, `removes the local database`, `Clinical Grade Precision`, `app.pathomitra.app`.

**What still blocks submission is not code.** Four things, all external or owner-side: no Authenticode (measured below), no Store listing at all, no versioned HTTPS URL for the binary, and a **hosted privacy policy that contradicts the policy inside the app**.

### Verified this session (the load-bearing measurements)

1. **`node scripts/check-desktop-package.mjs C:\pm-msi-2707\release-desktop\win-unpacked PathoMitra-2.7.7.msi` → exit 1.**
   `PE inventory: 9 files, 2 validly signed, 0 foreign-platform` — the 7 `NotSigned` are `PathoMitra.exe`, `ffmpeg.dll`, `dxcompiler.dll`, `vk_swiftshader.dll`, `vulkan-1.dll`, `keyring.win32-x64-msvc.node`, `better_sqlite3…/prebuilds/win32-x64.node`, plus the installer. Round 2 measured 16 unsigned of 18; the 2.7.7 payload pruning cut the unsigned surface to a third, but 10.2.9 still fails at the first byte.
2. **Sizes are now defensible:** `resources/` **13.0 MB** (budget 40), `app.asar` **12.91 MB / 354 files** (was 205.92 MB / 15 155), `win-unpacked` **380.6 MB / 137 files**, MSI **130 940 928 B (124.9 MB)**, **0 foreign-platform binaries**, 44 non-runtime files totalling **0.52 MB** (was 3 582 / 103.62 MB).
3. **A packaged build has now been booted and *seen* rendering.** `win-unpacked\PathoMitra.exe`: 4 processes, window `PathoMitra — Lab Management Simplified`, `pathlab.db` held with a sharing violation (locked by the app), `-shm`/`-wal` written by the run, clean exit → 0 processes. A `PrintWindow` capture (`.tmp/packaged-boot-2707-dpi.png`, `screenshots/ms-store-2026-10-17-packaged-auth.png`) shows the fully-rendered auth console — **the CSP does not blank the window**. This closes round 2's "everything is unverified in practice" caveat for the run path; the *installer* path is still unexercised.
4. **`node scripts/check-release-config.mjs` → exit 0** (with its own warning: *"Using the owner-approved policy host `pathomitra.pages.dev` — a platform subdomain, not a domain bearing your brand"*).
5. **…but the URL that exit code certifies is stale.** Live `Invoke-WebRequest https://pathomitra.pages.dev/privacy` → **200 / 11 797 B / 0 `<script>` / SQLCipher ×2 / support address ×3 / `Windows` ×0 / `DPAPI` ×0 / `localStorage` ×0**. Locally, `promotion_website/public/privacy.html` is **13 624 B with `Windows` ×8 / `DPAPI` ×2** (built 2026-10-17 12:28). The gate checks *presence*, never *freshness*, so it cannot see this. See PR-01.
6. **`npm audit --omit=dev` → 0 vulnerabilities**; whole tree 15 (11 moderate / 4 high), all dev chain. `npm run lint:ci` → **0 errors / 22 warnings** (ratchet 23). `npm run test` → **639 passed / 44 files** in 10.66 s. Re-run today, not inherited.
7. **Provenance is still absent:** `git tag --list` → **0 tags**, `git status --short` → **87 paths**, HEAD `dd0bf88` (2.7.2). Both 2.7.7 artifacts were built from uncommitted source.

---

## 1. Store Policy Compliance

### 1.1 Certification, packaging, lifecycle

| ID | Item | Status | Risk | Policy ref | Evidence (this session) | Required fix |
|---|---|---|---|---|---|---|
| P-01 | A Store-ingestible artifact exists | 🚨 Violation | Critical | 10.2.5 / 10.2.9 | `Get-ChildItem -Recurse -Include *.appx,*.msix,*.appxbundle,*.appxupload` (excl. node_modules) → **0**; `Package.appxmanifest` → **0**; `release-desktop/` holds only the orphan `win-unpacked.tmp` | Choose Route M or X (§E) and produce it. Tile art for the appx route already exists and is gate-checked (`desktop-resources/appx/{StoreLogo,Square44x44Logo,Square150x150Logo,Wide310x150Logo,SplashScreen}.png` vs `scripts/check-desktop-assets.mjs:62-69`) — the container has simply never been built |
| P-02 | Binary **and every PE** signed, chaining to a Microsoft Trusted Root CA participant | 🚨 Violation | Critical | 10.2.9 bullet 2 (verbatim: *"The binary and all of its Portable Executable (PE) files must be digitally signed with a code signing certificate that chains up to a certificate issued by a CA that is part of the Microsoft Trusted Root Program"*) | 7 PEs + the MSI `NotSigned` (measurement 1 above); `Get-AuthenticodeSignature` is the oracle `check-desktop-package.mjs:71-81` uses | Buy an OV/EV cert; `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` feed the existing `win.signExts: ['.dll','.node']` (`electron-builder.config.mjs:164` — note 26.15.3 has **no** `signDlls`), rebuild, re-run the gate to **9/9 Valid** |
| P-03 | Silent install, UAC allowed | ✅ Compliant | Low | 10.2.9 bullet 5 | `msi.oneClick: true` + `perMachine: true` (`electron-builder.config.mjs:181,185`) | none — do not switch to an assisted wizard |
| P-04 | Standalone installer, not a web stub, no bundled third-party software | ✅ Compliant | Low | 10.2.9 bullet 6 | `files: ['dist/**','dist-electron/**']` + named excludes; offline payload | none |
| P-05 | Versioned, immutable HTTPS download URL, maintained per version | 🚨 Violation | Critical | 10.2.9 bullets 3-4 | `promotion_website/src/lib/downloads.ts` → `DOWNLOAD_URLS = { android: null, windows: null }`; no public host for any Windows build | Publish `…/PathoMitra-2.7.7.msi` at a TLS-only, never-mutating path; a new URL per version |
| P-06 | Clean uninstall and removal of product data | ❌ Violation | High | **10.2.7** (*"must clearly communicate and enable a user's ability to cleanly uninstall and remove your product"*) | MSI deliberately leaves `%APPDATA%\PathoMitra` (`electron-builder.config.mjs:6-9`, `nsis.deleteAppDataOnUninstall: false`), documented as a choice at `SECURITY.md:146-148` and policy §6 | Keep the data-safety choice, but make it *enable* removal: an uninstall-time prompt (keep / erase) or a shipped `uninstall-clean` documented step; the policy already instructs the operator — 10.2.7 asks the product to enable it |
| P-07 | No dynamic code / self-update | ✅ Compliant | Low | **10.2.2** | `publish: null` (`:228`); `main.ts:276-290` cancels every remote-scheme request at runtime | none — quote this in the certification notes |
| P-08 | No malware / no unwanted secondary installs; small trustworthy surface | ⚠ Warning | Medium | 10.2.3 | 0 foreign PEs, asar 12.91 MB, 44 non-runtime files (0.52 MB) — a 20× improvement on round 2. Remaining: `@types/*` packages and `.md`/`.map` inside a product asar | Add `!node_modules/@types/**` to `files`; keep the gate as the evidence |
| P-09 | No unsupported settings changes | ✅ Compliant | Low | 10.2.8 | no `AppExecutionAlias`, no default-handler or DDE registration; `setAppUserModelId('com.pathomitra.desktop')` (`main.ts:101`) is the supported notification-identity API | none |
| P-10 | Product is testable; first-run path disclosed | ⚠ Warning | Medium | 10.3.1 | Packaged first run lands on the auth console (screenshot proves it) and requires local account creation + Terms acceptance (`TermsGate.tsx:58`, `TERMS_VERSION` 1.1) | Write the exact reviewer recipe (create account → lab name → passcode rule → Terms → 5-strike lockout) into Notes for certification |
| P-11 | Declared OS range must be tested | ❌ Violation | High | 10.4.1 | `appx.minVersion 10.0.17763.0` / `maxVersionTested 10.0.26100.0` (`:220-221`); this machine is Windows 11 26H2 and the *only* runs ever performed are `win-unpacked` boots from a mirror — no install, no floor OS | Test on the floor OS or raise `minVersion`; `maxVersionTested` must be a machine the app actually ran on |
| P-12 | Publisher identity ↔ product | ⚠ Warning | Medium | 10.14 / 10.8.3 | `appx.publisher 'CN=Naitik Raj'`, `publisherDisplayName 'Naitik Raj'`; the MSI's own `CompanyName` is `Naitik Raj` (measured from `PathoMitra.exe` VersionInfo) | A B2B lab suite holding patient billing records should be a **Company** enrollment; decide before the reservation, because the publisher CN is baked into the manifest |
| P-13 | Provenance: submission must trace to a commit + tag | ❌ Violation | High | 10.2 / Partner Center hygiene | 0 tags, 87 dirty paths, HEAD = 2.7.2 | Commit the 2.7.3→2.7.7 rounds, tag, rebuild the artifact from the tag |

### 1.2 Privacy & data (10.5)

| ID | Item | Status | Risk | Policy ref | Evidence | Required fix |
|---|---|---|---|---|---|---|
| PR-01 | The policy URL must serve the *current* policy (10.5.1: *"must be kept up-to-date as you add new features"*) | 🚨 Violation | Critical | 10.5.1 | Measurement 5: the deployed page has **zero** `Windows`/`DPAPI`/`localStorage` matches while the app's own §3 (in the shipped asar) describes all three. Two live policies now disagree about where the encryption key sits on Windows and what an uninstall does | Deploy the 13 624 B page (owner gate blocks the deploy), then re-probe for `Windows` + `DPAPI` + the address, and add a freshness assertion to `check-release-config.mjs` (compare a content hash or the `PRIVACY_LAST_UPDATED` string against the live body) |
| PR-02 | Policy must state how PI is *stored and secured* on the submitted platform | ✅ Compliant (in-app) | Low | 10.5.1 | `src/lib/privacy-policy.ts:126-136` — per-platform §3 including *"any process running as your user can ask Windows to unseal it"*, and §6 (`:161`) the uninstall split + operator instruction; pinned by `privacy-policy.test.ts` | none in-app; PR-01 is the remaining half |
| PR-03 | Policy must not contradict the product's own UI claims | ❌ Violation | High | 10.5.1 + 10.1.1 | **NEW (N-3).** `src/pages/auth/AuthPage.tsx:154` renders the first-screen headline **"Your lab. / Securely connected."** and `:68` **"Keep sensitive information safe and compliant"**, `:129` `Secure Workspace` — on a product whose policy §4 says *"Because the app holds no network permission, there is no pathway for data to leave the device"* and §5 says *"not certified as HIPAA-compliant, NABL-accredited, ISO-certified…"*. Both are visible in the packaged screenshot | Re-word to the truth ("Your lab. / Offline and encrypted." / "Keep sensitive information private and local"), and add `src/pages/auth/AuthPage.tsx` to `MARKETING_SOURCES` in `marketing-claims.test.ts:20-55` (it is not covered today, which is how this survived three audit rounds) |
| PR-04 | Modern cryptography for PI at rest | ✅ Compliant | Low | **10.5.4** | `electron/db.ts:59,101-104` (`cipher='sqlcipher'`, `kdf_iter=256000`, key pragma before any statement), key from `crypto.randomBytes(32)` (`:72`); PBKDF2-SHA256 210 k unlock hash; AES-256-GCM sealed backups | none — strong cert note |
| PR-05 | Sensitive (health/financial) data: product-related + express consent | ✅ Compliant | Low | **10.5.5** | Terms gate before the console, versioned re-prompt (`local-account.ts:119,131`); DPDP/GDPR allocation in §2/§5 | keep the gate |
| PR-06 | No undisclosed collection / telemetry / third-party SDKs | ✅ Compliant | Low | 10.5.1 / 10.10 | 0 analytics/ad/crash SDKs; `fetch(`/`XMLHttpRequest`/`sendBeacon`/`axios` = **0** hits across `src/**` (probe `.tmp/review-2707-measure.cjs`); on-device ring buffer | none — state verbatim in the certification notes |
| PR-07 | No confidential content in notifications | ⚠ Warning | Medium | **10.9.3** | Fixed half: `bannerTitle`/`bannerBody` (`notification-engine.ts:285-379`) carry the registration number, not the name, and no amount or `amendReason`; Android channel `visibility: 0` (`desktop-notifications.ts:68-75`). **NEW (N-4):** on Windows the banner goes through `new Notification()` (`:273`) — Chromium exposes **no** lock-screen visibility control, so *"Patient 26100007 is still awaiting a report"* and *"Bill IN2610-0042 is unpaid"* can render on a locked PC whenever Windows' "notifications on lock screen" is on | Gate desktop banners on the unlocked state (suppress while locked / post to the in-app centre only), or drop the record identifier from the Windows banner text; disclose the rule in the cert notes |
| PR-08 | Children's data | ✅ Compliant | Low | 10.5.8 / 11.15 | §8 handles the minor-patient case honestly; not child-directed, not a consumer app | answer the IARC questionnaire consistently with §8 |
| PR-09 | Policy host bears the developer's brand | ⚠ Warning | Medium | 10.5.1 (applicable-law clause) + store practice | `OWNER_APPROVED_POLICY_HOSTS = ['pathomitra.pages.dev']` (`check-release-config.mjs:61`) is an owner-granted exception to the project's own `BLOCKED_URL_HOSTS`; the gate prints a warning on every release build | Move the policy (and the installer URL) to a domain bearing the brand once the owner registers one |

### 1.3 Advertising, monetisation, AI, UGC, child safety, risk of harm

| Area | Status | Evidence & note |
|---|---|---|
| 10.10 Advertising | ✅ N/A | No ad/measurement SDK (PR-06); policy §4 disclaims |
| 10.8 Financial transactions | ✅ N/A | No Store IAP, no payment capture, no subscription. Invoicing bills **the lab's own patients** offline — 10.8.1/10.8.2 do not attach |
| 11.16 / RAIA (AI) | ✅ N/A — verified | 0 generative-AI code or dependency; `marketing-claims.test.ts:67` actively **bans** "AI-native / AI-powered" claims, so the drift vector is closed by a test |
| 11.12 UGC | ✅ N/A | Offline, single operator; no content is viewable by other users online, so no moderation duty attaches |
| 11.15 Child safety | ✅ N/A | No content surface |
| 11.11 Age rating | ⚠ Action | IARC/PIRS questionnaire unanswered; the "no personal-information collection" answer must not be ticked — the app *processes* health data locally, and the honest answer set has to match §2/§3 |
| 11.3.2 Risk of harm | ❌ Violation (P1) | **Still open, re-verified.** `src/lib/report-compliance.ts:139-140` returns `signer: ''` and `disclaimer: ''`, and 72 catalogue intervals carry `verification: 'requires-lab-verification'` whose caveat rendering was deleted — the issued clinical report carries **no** professional-use caveat. 10.2 preamble: *"you must include all legally required and industry-standard warnings, notices, and disclaimers in your product"* | Reinstate one caveat line per issued report (lab-director sign-off is the gate, not the code) |
| 11.2 Third-party IP | ⚠ Warning | `public/default-share-template.png` (192 245 B) is a real lab's letterhead and **is inside the shipped package** (`.tmp/asar-2707-extract/dist/default-share-template.png`, same size) → rights exposure + a 10.1.1 accuracy problem in any screenshot using it | Replace with neutral art before shooting screenshots |
| 10.7 Localization | ✅ Compliant | `index.html lang="en"`, English-only product; declare only `en-US` in the listing |

---

## 2. Permissions & Capabilities Audit

**There is still no manifest in the tree** (0 `Package.appxmanifest`; 0 appx builds). The only declaration is the `appx` block (`electron-builder.config.mjs:211-223`), so this section audits *behaviour the shipped package exercises* against *what a manifest must say*.

| # | Capability / permission | Necessary? | User justification | Certification risk | Recommended alternative |
|---|---|---|---|---|---|
| Cap-01 | `runFullTrust` (`:219`, the **only** declared capability) | Yes for Electron | Electron cannot run in an AppContainer; printing shells out (`print.ts:72-131`: `powershell.exe -Command` → `Get-CimInstance Win32_Printer`, `Start-Process -Verb PrintTo`) | **High** — 10.6 (*"capabilities must legitimately relate to the functions of your product… you must not circumvent operating system checks for capability usage"*) and `runFullTrust` is the maximum-privilege hatch | Route M makes this moot (a Win32 MSI has no capability set to justify). If Route X: a written 5-line justification in the cert notes naming the Electron runtime + the Win32 spooler |
| Cap-02 | Internet (client) | **No** | offline by design | Low ✅ and **provable**: `main.ts:276-290` cancels anything not `pathomitra:/file:/data:/blob:/about:` in a packaged build (the `chrome-extension:`/`devtools:` entries live only in the dev branch — verified in the shipped bytes) | Declare nothing; state "no network capability required" |
| Cap-03 | Location | No | never used | ✅ | not declared; `Permissions-Policy: geolocation=()` is even sent by the shell (`main.ts:228`) |
| Cap-04 | Microphone | No | never used | ✅ | not declared; same header denies it |
| Cap-05 | Camera | No | never used | ✅ | not declared; same header denies it |
| Cap-06 | Notifications | Yes (opt-in) | four operational alerts (`notification-engine.ts:285-379`) | Medium — local toasts via Chromium, permission now gated by both handlers allowing `notifications` only (`main.ts:255-269`) ✅; the residual issue is content on a locked PC (PR-07) | keep; fix PR-07 |
| Cap-07 | Broad file-system access | Partially | exports/backups under `%APPDATA%\PathoMitra`, opt-in `Documents\PathoMitra` | **High** under MSIX (would need `broadFileSystemAccess`, which Microsoft scrutinises) | Route M again: a normal Win32 app folder. Never declare `broadFileSystemAccess` |
| Cap-08 | Background tasks | **No** | none: `window-all-closed → app.quit()` (`main.ts:315`), no `powerMonitor`, no auto-start; measured idle cost 0.6 % of one core and 0 processes after close | ✅ | keep; implement the session re-lock (`A-2`) as a foreground timer, not a background task |
| Cap-09 | Registry / NT service / drivers | No | none found | ✅ | if ever added → 10.2.4 disclosure in cert notes |
| Cap-10 | Credential Locker (DPAPI) | Yes | SQLCipher key + unlock secret (`keyring.ts`, `db.ts:56`) | Medium — no capability exists for it; works only under `runFullTrust`, and it is the claim the *hosted* policy currently omits (PR-01) | keep; document honestly (done in-app) |
| Cap-11 | Process spawning | Yes (printing) | `execFile('powershell.exe', …)` + WMI + `Start-Process -Verb` | **Medium-High** — a static scan sees a shell + WMI + handler launch | disclose the print architecture in the cert notes; the sender-frame check (`ipc.ts:180-215`) and the realpath re-check are already in place |
| Cap-12 | `shell.openPath` / `openExternal` | Yes | reveal/open a saved report | Low-Medium, confined by `withinAppRoots` + `isTrustedSender` | keep; never widen the roots |
| Cap-13 | DevTools / application menu in production | **No** | **Closed.** `Menu.setApplicationMenu(null)` + `devTools: !app.isPackaged` + `context-menu` suppression, all behind `app.isPackaged`, present in the shipped `main.js` | ✅ (was 🚨 in round 2) | none |
| Cap-14 | Destructive IPC | — | `pm:db:clear` is wrapped by the trusted-sender `handle()` (`ipc.ts:231`) but has no typed confirmation token | Medium | require a confirmation phrase on destructive channels; one test |

**Verdict:** behaviourally the best capability posture available (no location, camera, mic, network, background work, or registry writes) and declaratively still empty. The declaration gap only bites on Route X.

---

## 3. Privacy & Security Review

### 3.1 Security controls, re-verified against the artifact

| ID | Item | Status | Evidence | Sev |
|---|---|---|---|---|
| S-01 | Renderer isolation | ✅ | `main.ts:163-172`: `contextIsolation`, `sandbox: true`, `nodeIntegration: false`, `spellcheck: false`; `preload.cjs` (2.5 KB in the asar) exposes typed `invoke` wrappers only — no raw `ipcRenderer` (probe) | — |
| S-02 | Path containment | ✅ | `ipc.ts` lexical + **realpath** re-check (symlink/junction escape), case-insensitive | — |
| S-03 | SQLCipher key unreachable from the renderer | ✅ | `assertRendererAccount` in all three keyring handlers; `db-key` on a main-only deny list | — |
| S-04 | CSP on the desktop shell | ✅ (was ❌) | `main.ts:57-70` policy (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`) applied **both** in `protocol.handle` (`:225`) and `onHeadersReceived` (`:237-244`); `'unsafe-inline'` only for the 4 documented inline scripts in `index.html`; the packaged boot proves it renders | — |
| S-05 | Permission handlers | ✅ (was ❌) | `setPermissionRequestHandler` + `setPermissionCheckHandler`, allow-list `{notifications}` | — |
| S-06 | IPC sender-frame validation | ✅ (was ❌) | `isTrustedSender()` + a generic `handle()` wrapper on every `pm:*` channel | P3 for the confirmation token (Cap-14) |
| S-07 | Production menu / DevTools | ✅ (was 🚨) | see Cap-13 | — |
| S-08 | Main-process crash resilience | ✅ (was 🚨) | `attachRecovery()` (`main.ts:111-144`) with Reload / Restart / Keep waiting, plus `child-process-gone`, `uncaughtException`, `unhandledRejection` (`:310-342`) → 10.4.2 addressed | — |
| S-09 | Authenticode | 🚨 Violation | 7 PEs + installer `NotSigned` on the 2.7.7 artifact | **P0** |
| S-10 | Engine currency | ❌ Violation (new precision) | shipped Electron **44.7.0** (`node_modules/electron/dist/version` in the build mirror). Upstream: 44.7.1 → *Chromium 152.0.7977.149*; 44.7.2 → *backported ANGLE/Chromium/PDFium/V8 fixes*; 44.8.0 → *Chromium 152.0.7977.167 + Node 24.22.0*; 44.9.0 (released 2026-10-17) → *fixed link-opened windows not using the opener's session and webPreferences*. The package predates four security releases | **P1** |
| S-11 | HTTPS enforcement / encryption in transit | ✅ N/A | no transport exists; the only outbound surfaces are the policy page and `mailto:` | — |
| S-12 | Windows threat model documented | ✅ (was ❌) | `SECURITY.md:86-155` "Desktop (Windows) threat model": DPAPI vs hardware asymmetry, the same-user-malware threat named, renderer isolation, egress block, permission defaults, CSP, path containment, print staging, no self-update, and four declared known gaps | — |
| S-13 | Print staging PHI hygiene | ✅ | `userData\Print\<uuid>.html` at `0o600`, swept per job, oversized refused | — |
| S-14 | XSS sinks | ✅ | `dangerouslySetInnerHTML` / `innerHTML` / `eval(` = **0** hits in `src/**` (measured), with a test asserting it | — |
| S-15 | Uninstall leaves encrypted PHI | ❌ Violation | P-06 | **P1** |
| S-16 | Binary metadata honesty | ✅ | `PathoMitra.exe`: FileVersion `2.7.7`, ProductVersion `2.7.7.0`, CompanyName `Naitik Raj`, LegalCopyright `© 2026 Naitik Raj`, Language en-US | P3: `OriginalFilename` empty |

> **Privacy Score: 76 / 100**
> + honest per-platform storage and deletion language, no collection, no SDKs, consent gate, modern crypto, name-free banners.
> −12 the hosted policy is stale and therefore contradicts the shipped policy (10.5.1) · −5 in-app claims ("Securely connected", "safe and compliant") contradict the product's own offline posture · −3 Windows lock-screen banner exposure (10.9.3) · −2 policy lives on a platform subdomain by an owner exception to the project's own guard · −2 no data-retention limit or DPA-style operator support beyond §5.

> **Security Score: 80 / 100**
> −10 unsigned PEs and installer · −6 engine four releases behind a security train · −4 shell/WMI print-spawn surface needing disclosure · −3 destructive IPC without confirmation · −2 uninstall leaves PHI · −2 no CSP on the *APK* origin (Android, out of Store scope but the same renderer code) · −1 never installed (only `win-unpacked` booted).
> Credit: the round-2 P0 set (menu, crash handlers, CSP, permissions, sender-frame, threat model) is closed **and provably present in the shipped bytes**.

---

## 4. Store Listing Audit

**Nothing of a listing exists.** No `screenshots/`, no `store-assets/`, no Windows description/keywords/category/EULA anywhere in the tree (directory sweep this session). The only Windows listing artefact is a *checklist*, and that checklist is now wrong:

| Field | Rule | Status | Risk | Issue found (this session) | Fix |
|---|---|---|---|---|---|
| Canonical checklist accuracy | — | ❌ Violation | High | **NEW (N-5).** `promotion_website/STORE-READINESS-REPORT.md` §6 still states *"**MSIX/APPX required for a Store submission** (MSI is not accepted)"* — flatly contradicted by 10.2.9 as fetched today — and still marks the policy URL and support email "dead", both of which are live now. The document an owner would fill Partner Center from is actively misleading | Rewrite §6: Route M is policy-valid; correct the URL/email status; date the corrections |
| Product name | 10.1.1 — no marketing text in the title | ⚠ | Medium | `PathoMitra` is clean, but the tagline is baked into `package.json:7`, `index.html` `<title>` ("PathoMitra — Lab Management Simplified", and therefore the window title bar) and the exe's `FileDescription` | Store title = `PathoMitra`; tagline goes to the short description only |
| Name reservation ↔ package | must match | ❌ | High | `appx.identityName 'PathoMitra.PathoMitra'` (`:213`) is a guess — never reserved | Reserve first, then set `identityName` from the reservation |
| Description | ≤ 10 000 chars, no URLs/HTML, must state limitations | ❌ | High | does not exist; and PR-03 proves this codebase's copy drifts into claims the product cannot support | Draft from verified behaviour only: offline, single operator account, no cloud/sync, reports are formatted not diagnosed, ranges are editable lab defaults |
| Keywords | 10.1.3 — ≤ 7 unique, relevant, no pricing, no other product titles | ⚠ | Medium | `package.json` carries **9** keywords, four of which are build frameworks (`react`, `vite`, `capacitor`, `tailwindcss`) | Author 7 real search terms; do not mirror `package.json` |
| Screenshots | ≥ 1 (Desktop ≥ 1366×768), PNG ≤ 50 MB | 🚨 | Critical | none. The packaged app renders at 1280×752 DIP on this display, so a capture here would be **under** the size floor | Capture on a ≥ 1366×768 (prefer 1920×1200) desktop from the *packaged* build; never from `ProductMock` (now labelled "Illustration · sample data" ✅) and never showing `default-share-template.png` (11.2) |
| Trademark / third-party marks | 11.2 | ⚠ | Medium | `promotion_website/src/components/BrandIcons.tsx` + `StoreBadge` hand-draw Google/Microsoft store badges; the brochure names Windows/GitHub | Use plain text ("available for Windows") in the Store listing; keep badge art on the own site |
| System requirements | 10.4.1 | ❌ | High | not stated anywhere, and now measurable: `main.ts:150-151` sets `minWidth 1024 / minHeight 640` **DIP**. This machine is 1920×1200 @ 150 % = 1280×800 DIP, and the window was clamped to 1280×752 DIP. A 1366×768 panel at 150 % gives **910×512 DIP** — the app cannot honour its own minimum there | Publish "1280×800 or larger at 100–125 % scaling (≥ 1024×640 logical)" and/or lower the minimum with a graceful small-window layout |
| Support contact | 10.14 | ⚠ | Medium | `VITE_SUPPORT_EMAIL` is a real address and is baked into the shipped bundle (asar probe: 2 hits); its Cloudflare Email Routing destination is unverifiable from this machine | Send a test message and confirm delivery before listing |
| Age rating / declarations / EULA | 11.11, product declarations | ❌ | Medium | none authored | Complete IARC consistently with §2/§3 (health data processed locally ≠ "no personal information collected") |
| Certification test path | 10.3.1 | ⚠ | Medium | first run = local account creation; no demo credentials possible offline | Notes for certification recipe (P-10) |

---

## 5. UX & Accessibility Audit

Measured across `src/**` (133 non-test files, probe `.tmp/review-2707-measure.cjs`): **392 `aria-*`**, **72 `role=`**, **130 `aria-label`**, **27 `htmlFor`**, **7 `aria-live`**, **9 `inert`**, **4 `tabIndex`**, **1 `autoFocus`**, **4 `sr-only`**, **1 `forced-colors`**, **0 `prefers-contrast`**, **0 `prefers-color-scheme`**, 18 `onKeyDown`, 2 `reducedMotion`/`prefers-reduced-motion`, 4 `data-text-size`. Every remaining `role="button"` string in production code is inside a comment explaining its removal (`DashboardLayout.tsx:538-541`, `DoctorsPage.tsx:628-631`, `PatientsPage.tsx:875-878`) — round 2's open item is closed.

| Area | Status | Evidence | Gap / fix | Sev |
|---|---|---|---|---|
| Fluent / Windows design language | ⚠ | Material/Apple-flavoured token system, 5 palettes, no WinUI/`Segoe UI`/Mica affordance | Not a policy violation (the Store has no Fluent clause). It will read as "reskinned web app" in manual review | P2 |
| Keyboard navigation | ✅ | focus trap + return focus + `inert` background (`ui/Sheet.tsx`, 9 hits), roving arrow keys in the date grid, Enter/↑/↓ caret walk in the composer, `MotionConfig reducedMotion="user"` | only 4 `tabIndex` / 1 `autoFocus` → focus placement is implicit, not designed | P2 |
| Screen reader | ⚠ | skip link `App.tsx` (`#main-content`), `role="status"`/`aria-live="polite"`, `role="alert"` on the boundary, labelled charts | **never validated with Narrator or Accessibility Insights for Windows** — there is no attestation artifact, which is what a reviewer or an EN 301 549 claim needs | P1 (quality, not cert) |
| Contrast | ✅ measured | `--chart-4` is now `#b8730a` light / `#ffb340` dark (`index.css:105,151`) — round 2's 1.4.11 fail is closed; body/secondary text previously measured 16.8:1 / 4.55:1 | re-measure after any palette change | P3 |
| Small text | ⚠ | 5 × `text-[9px]`, 21 × `text-[10px]`, 91 × `text-[11px]` remain, with a `data-text-size` ladder as the mitigation | 9–10 px on a bench console is a legibility risk; either floor at 11 px or add the `no-restricted-syntax` rule the docs believe exists | P2 |
| High contrast / `forced-colors` | ✅ | real `@media (forced-colors: active)` block | `prefers-contrast` 0 — low priority once forced-colors works | P3 |
| Dark mode | ❌ (half-fixed) | `nativeTheme.themeSource = 'system'` + `backgroundColor` from `shouldUseDarkColors` (`main.ts:91,155`) fixed the white flash. **But** `src/**` has **0** `prefers-color-scheme` and `settings.ts:207` still defaults `themeMode: 'light'` → on a Dark-mode Windows the app now paints a **dark frame, then a light document** | Read the resolved mode as the *first-run default* (keep the manual override) so frame and content agree | P2 (**MS-W3** residual) |
| High-DPI | ✅/⚠ | Chromium honoured 150 % (window 1920×1128 physical = 1280×752 DIP, measured) | the `minWidth` interaction with small high-DPI panels (see §4 system requirements) | P2 |
| Error handling / resilience | ✅ (was 🚨) | main-process recovery dialog + renderer `window.onerror`/`unhandledrejection`/ErrorBoundary + 639 passing tests | add one regression test per new `electron/` handler (the current tests cover the renderer layer) | P2 |
| Responsive layout | ✅ | fold breakpoints, `Sheet` clamped to `min(1120px,94vw)`, composer table ≥ 1024 px with the stacked branch below, JS-branch (not CSS) so the index-based caret walk cannot hit hidden inputs | the two desktop layouts are still owner-unapproved | P2 |
| First-run copy accuracy | ❌ | PR-03 — "Securely connected." / "safe and compliant" on the auth screen, in the shipped build, on the first screen a reviewer sees | re-word + extend the claims guard to `AuthPage.tsx` | **P1** |

> **UX Score: 78 / 100** — 450 ms start, real crash recovery, measured layouts, honest labels; minus the dark-mode frame/content mismatch, the first-screen over-claim, and a listing that does not exist.
>
> **Accessibility Score: 74 / 100** — above the median for an Electron app (392 aria attributes, focus trap, `inert`, forced-colors, measured contrast, no `role="button"` fakes) with **zero** assistive-technology validation on Windows. Store Policies (Sept 2026 edition) still contains no accessibility certification clause, so this is EN 301 549 / ADA exposure and listing quality, not a rejection driver.

---

## 6. Performance Audit

| Metric | Measured this session | Verdict |
|---|---|---|
| **Startup** | `Start-Process` → main window present in **450 ms** (probe `.tmp/perf-probe-2707.ps1`) | ✅ excellent for an Electron app |
| **Render** | packaged window captured via `PrintWindow`: full auth console, 715 613 B PNG, no blank frame | ✅ proves CSP + scheme handler + preload work in the package |
| **Memory** | 4 processes, working set **411.8 MB**, private bytes **211.1 MB**, peak **489.9 MB** | ⚠ Electron tax; fine at lab scale, no pagination push-down in `src/data/query.ts` |
| **CPU (idle)** | **0.062 CPU-seconds over 10 s = 0.6 % of one core**, across all 4 processes | ✅ |
| **Battery / background** | no background task, no WNS, no auto-start, `window-all-closed → app.quit()`; **0 processes after close** | ✅ best available posture |
| **Crash risk** | renderer: onerror/unhandledrejection/ErrorBoundary + 639 tests; main: 4 handlers + recovery dialog | ✅ (was 🚨) |
| **Package size** | MSI **124.9 MB**; `win-unpacked` **380.6 MB / 137 files**; `resources/` **13.0 MB**; `app.asar` **12.91 MB / 354 files**; **0 foreign-platform binaries**; 44 non-runtime files = **0.52 MB** | ✅ inside the project's own budgets; 10.4.4 defensible (Electron's own binaries are 319.3 MB of the installed size) |
| **Cold start on the floor OS (1809)** | never measured | ❌ P-11 |
| **Install path** | the MSI has never been installed (only `win-unpacked` run) | ⚠ the last unverified desktop claim |

> **Performance Score: 82 / 100** — the round-2 🚨 (277 MB asar, 104 MB of sources and maps, foreign binaries, never-run package) is closed and replaced by measurements. Deductions are for 411 MB idle RAM, a 125 MB download, and an uninstalled installer.

---

## 7. SDK & Dependency Audit

| Package | installed | latest | Verdict |
|---|---|---|---|
| **electron** | **44.7.0** | **44.9.0** (2026-10-17) | ❌ 4 releases behind, spanning Chromium 152.0.7977.149 → **.167**, PDFium/V8/ANGLE backports, Node 24.22.0, and a session-isolation fix (S-10) |
| electron-builder / app-builder-lib | 26.15.3 | 26.15.3 | ✅ current (and 26.15.3 genuinely has no `msix` target — Route X means `appx`) |
| better-sqlite3-multiple-ciphers | 13.0.3 | 13.0.3 | ✅ the SQLCipher carrier |
| @napi-rs/keyring | 2.1.1 | 2.1.1 | ✅ |
| jspdf / pdfjs-dist | 4.2.1 / 6.4.299 | same | ✅ |
| jspdf-autotable | 5.0.7 | 5.0.9 | ⚠ |
| react / react-dom | 19.2.5 | 19.3.1 | ⚠ |
| zod | 4.6.5 | 4.6.7 | ⚠ |
| vite / tailwindcss | 6.4.4 / 4.2.4 | 8.3.4 / 4.3.3 | ⚠ dev-only — do **not** major-bump pre-submission |

- **`npm audit --omit=dev` → 0 vulnerabilities** (production tree). Whole tree **15** (11 moderate / 4 high), all dev chain (`patch-package→…→braces`, `@capacitor/cli→xcode→uuid`, `electron-builder→app-builder-lib→@electron/get→global-agent→roarr→sprintf-js`). Still **do not** `npm audit fix --force` — it breaks `@capacitor/cli` and patch-package.
- **No tracking SDK, no ad SDK, no crash SDK, no analytics** — verified by dependency list *and* by 0 network-call sites in `src/**`. This is the strongest possible answer to the Store privacy questionnaire; state it verbatim.
- Shipped-surface hygiene: the Android/web stack (`@capacitor*`, `jeep-sqlite`, `@stencil/core`, `sql.js`), the Node canvas, `rollup`'s native binary, all `.map`/`.md`/`sqlite3.c` and every non-`win32-x64` prebuild are now **absent from the package** (asar walk). Residual: 15 `@types/*` packages and 44 small non-runtime files.

> ### SDK Risk Rating: **A− (low–moderate)**
> Zero shipped-runtime advisories, every crypto/PDF carrier current, no third-party telemetry, no foreign binaries — with one real defect: **the Chromium engine in the package is four releases behind a security train**, which is both a 10.2 risk item and the cheapest fix on this list.

---

## 8. AI Compliance Audit

**Not applicable — verified, not assumed.** 0 AI/LLM dependencies, 0 inference call sites, no dynamic generative content, and `marketing-claims.test.ts:67` bans AI *claims* in visible copy, so the disclosure obligations of 11.16 and the RAIA transparency duties have nothing to attach to. RAIA "reliability & safety" remains relevant **by analogy**: derived values come from deterministic arithmetic (`report-calculations.ts` strict `parseMeasurement`), which is good — but 11.3.2's missing caveat is the same over-claiming defect class (see §1.3).

---

## 9. Risk Matrix

| Area | Status | Risk | Severity |
|---|---|---|---|
| Authenticode on MSI + 7 PEs (10.2.9) | 🚨 | submission cannot pass | **P0 Critical** |
| Store listing (title/description/keywords/screenshots/system reqs/IARC/EULA) | 🚨 | nothing exists to review | **P0 Critical** |
| Versioned immutable HTTPS URL for the binary (10.2.9) | 🚨 | no artifact to ingest | **P0 Critical** |
| Hosted privacy policy is stale → contradicts the shipped policy (10.5.1) | 🚨 | false statement about PI on a medical product | **P0 Critical** |
| Store-ingestible container chosen + built (10.2.5) | 🚨 | Route X only | **P0 Critical** |
| Electron 44.7.0, 4 releases behind a Chromium/PDFium security train (10.2) | ❌ | known-fixed engine vulns shipped | **P1 High** |
| Auth screen "Securely connected." / "safe and compliant" (10.1.1 + 10.5.1) | ❌ | misleading representation, first screen | **P1 High** |
| Clinical caveat + disclaimer absent from issued reports; 72 unverified ranges (11.3.2 + 10.2) | ❌ | risk of harm; legally-relevant disclaimer missing | **P1 High** |
| Uninstall leaves encrypted PHI (10.2.7) | ❌ | "cleanly remove" not enabled | **P1 High** |
| `maxVersionTested` / `minVersion` never tested; no install run (10.4.1) | ❌ | unsupported claims | **P1 High** |
| Submission traces to uncommitted source, 0 tags | ❌ | provenance | **P1 High** |
| Windows banner has no lock-screen control (10.9.3) | ⚠ | PHI identifier on a locked PC | P2 Medium |
| `runFullTrust` + PowerShell/WMI print path unjustified in writing (10.6) | ⚠ | capability review conversation | P2 Medium |
| Individual publisher for a B2B lab suite (10.14) | ⚠ | account-type question | P2 Medium |
| `STORE-READINESS-REPORT.md` §6 still says MSI is not accepted | ⚠ | misdirects the submission | P2 Medium |
| Policy host is a platform subdomain (owner exception) | ⚠ | brand/consistency smell | P2 Medium |
| Dark-mode frame vs light content at launch (MS-W3 residual) | ⚠ | first-run quality | P2 Medium |
| No Narrator / Accessibility Insights attestation | ⚠ | EN 301 549 / ADA | P2 Medium |
| `default-share-template.png` = a real lab's letterhead, shipped (11.2) | ⚠ | third-party IP + screenshot accuracy | P2 Medium |
| 15 dev-chain advisories; `@types/*` + 44 non-runtime files in asar | ⚠ | hygiene | P3 Low |
| `pm:db:clear` without a confirmation token; 9 `text-[9px]`/`text-[10px]` sites | ⚠ | defence-in-depth / legibility | P3 Low |
| Offline by construction + runtime egress block, no self-update (10.2.2), no IAP (10.8), no ads (10.10), no AI (11.16), no UGC (11.12), SQLCipher AES-256 + PBKDF2 + GCM (10.5.4), terms gate (10.5.5), sandbox + path + keyring + sender-frame guards, crash recovery (10.4.2), production menu/DevTools off, CSP on the shell, honest per-platform policy in-app, name-free banner text, `inert` sheets, focus trap, skip link, forced-colors, contrast-measured tokens, 0 foreign binaries, 450 ms start, 0.6 % idle CPU, clean exit, 639 tests / 0 lint errors | ✅ | — | compliant |

**🚨 Likely certification failure:** P-01, P-02, P-05, PR-01, and the absence of a listing (§4).
**❌ High risk:** P-06, P-11, P-13, PR-03, S-10, 11.3.2, §4 system requirements.
**⚠ Needs improvement:** Cap-01/06/07/11/14, PR-07, PR-09, P-08, P-10, P-12, dark mode, a11y attestation, letterhead asset, canonical-doc staleness, dependency hygiene.
**✅ Fully compliant:** everything listed in the last matrix row — this is now the majority of the policy surface, which is exactly why readiness moved 8 → 34.

---

## A. Critical fixes before submission (blocking, dependency order)

1. **Choose the container (owner, 1 hour).** Route M = 10.2.9 signed **MSI** behind a versioned HTTPS URL (recommended: no capability justification, no LocalCache data-loss risk, target already builds). Route X = `PM_WIN_TARGETS=appx` → `.appx` (Store re-signs; needs the Partner Center name reservation, a written `runFullTrust` justification, and reintroduces the `%APPDATA%` → LocalCache redirect that deletes the lab DB on uninstall/repair).
2. **Buy and wire code signing (external lead time).** `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` with the existing `win.signExts: ['.dll','.node']`; rebuild; `node scripts/check-desktop-package.mjs …` must print **`9 files, 9 validly signed, 0 foreign`** and exit 0.
3. **Deploy the current policy and make the gate prove freshness.** Publish the 13 624 B page to the exact `VITE_PRIVACY_URL`, re-probe for `Windows` + `DPAPI` + the support address, confirm `/privacy` resolves to the static file and not the `_redirects` SPA fallback, then extend `check-release-config.mjs` to assert the live body contains `PRIVACY_LAST_UPDATED` (today's gate passes on a stale page — that is the defect that let this survive).
4. **Bump Electron 44.7.0 → 44.9.0** and re-run the boot probe (450 ms start + non-blank capture) in the same build pass as item 2.
5. **Fix the first-screen claims (PR-03) and close the guard hole.** Re-word `AuthPage.tsx:68,129,154`; add `src/pages/auth/AuthPage.tsx` to `MARKETING_SOURCES`; add banned rules for `securely connected` and `and compliant` (block comments only — the guard strips `/* */` but not `//`).
6. **Reinstate one clinical caveat + disclaimer line per issued report** (lab-director sign-off is the gate; `report-compliance.ts` was built for a one-place reinstatement).
7. **Make uninstall enable clean removal (10.2.7).** Uninstall-time keep/erase prompt, or a shipped `PathoMitra – Erase data and remove` entry point, plus the matching policy sentence.
8. **Install → boot → smoke → uninstall the MSI once on a clean, non-OneDrive machine** at the declared floor OS: create account, register a patient, issue + amend a report (confirm v2 + history row), raise and print a bill on real paper, back up + restore, then uninstall and inspect `%APPDATA%\PathoMitra`. Record it as a dated note.
9. **Commit + tag, then rebuild from the tag.** Everything 2.7.3→2.7.7 is gated (verified green today) but uncommitted; a certification submission must trace to a revision.
10. **Author the listing** (§4) with real captures at ≥ 1366×768 from the packaged build, 7 search terms, stated system requirements, IARC answers consistent with §2/§3, and certification notes pre-answering 10.2.2 (no dynamic code), 10.3.1 (first-run recipe), 10.6 (`runFullTrust`/print-spooler justification), 10.9.3 (banner content rule), and 10.5 (no collection, no SDKs).

## B. Recommended improvements (non-blocking, high value)

1. Windows lock-screen banner policy (PR-07) — suppress or de-identify while locked.
2. Dark-mode first-run default from the resolved system theme; keep the manual override.
3. `!node_modules/@types/**` in `files`; add a `9/9 Valid` expectation to the package gate output.
4. Narrator + Accessibility Insights for Windows pass, written up as an attestation artifact under `docs/`.
5. Floor the type ladder at 11 px (5 × `text-[9px]`, 21 × `text-[10px]` remain) or add the `no-restricted-syntax` rule the docs claim exists.
6. Confirmation token on `pm:db:clear`; one regression test per new `electron/` handler.
7. Replace `default-share-template.png` with neutral art; resolve the `public/p-logo.png` delete-owed question.
8. Fix `promotion_website/STORE-READINESS-REPORT.md` §6 (MSI **is** accepted under 10.2.9) and its "dead URL/email" rows.
9. Lower `minWidth`/`minHeight` or add a small-window layout so the declared minimum is always honourable.
10. Add a `desktop.yml` CI workflow that builds + signs + runs `check-desktop-package.mjs` on `windows-latest` (no such workflow exists — `.github/workflows` holds only `android.yml`, `ci.yml`, `deploy.yml`, `release.yml`).
11. Company Partner Center enrollment for a professional lab suite (10.14).
12. Native (APK) CSP — out of Store scope, but the same renderer code ships there and the origin is unprotected today.

## C. 7-day action plan

| Day | Work | Done when |
|---|---|---|
| 1 | Route decision (A-1) + order the cert (longest lead) + reserve the Store name if Route X. Fix `AuthPage` copy + guard (A-5) | written decision, cert purchase in flight, guard covers `AuthPage.tsx` |
| 2 | Electron 44.9.0 + rebuild + boot probe (A-4). Deploy the fresh policy and extend `check-release-config.mjs` with the freshness assertion (A-3) | probe prints a non-blank window at the new version; live body contains `Windows` + `DPAPI`; gate fails on a stale page |
| 3 | Sign + rebuild + `check-desktop-package.mjs` (A-2). Uninstall-clean behaviour (A-7) | **9/9 Valid**, gate exit 0 |
| 4 | Clinical caveat reinstatement with the lab director (A-6) + commit + tag + rebuild from the tag (A-9) | one caveat line on a printed report; artifacts trace to a tag |
| 5 | Install → boot → full smoke → uninstall on a clean machine at the floor OS, incl. one real-paper print (A-8) | dated smoke note in `docs/` + `%APPDATA%` behaviour recorded |
| 6 | Listing authoring: title, 7 terms, description from verified behaviour, system requirements, ≥ 4 packaged screenshots, IARC, EULA, product declarations (A-10) | listing fields complete; screenshots ≥ 1366×768 |
| 7 | Certification notes (10.2.2 / 10.3.1 / 10.5 / 10.6 / 10.9.3 pre-answers) + Partner Center submission | submission created with nothing in §A open |

## D. Remaining checklist (owner-only inputs — no agent can verify these)

- [ ] Route M vs Route X (blocks everything).
- [ ] Code-signing certificate purchase + key custody (OV vs EV; EV also clears SmartScreen sooner).
- [ ] Company vs Individual Partner Center enrollment (10.14) + fee.
- [ ] Permission to deploy `promotion_website` to Cloudflare Pages (the standing gate; the stale policy is otherwise unfixable).
- [ ] Confirm the support mailbox actually receives mail (Email Routing destination verified).
- [ ] A branded domain for the policy **and** the installer URL, replacing the `pages.dev` exception.
- [ ] Lab-director sign-off on the 72 `requires-lab-verification` bands, the neonate/2–11 y question, and the `Albumin` / `HEMOTOLOGY` catalogue findings.
- [ ] Legal review of doctor referral commissions (ICMR/NMC) before any non-zero rate is used.
- [ ] A physical printer for the orientation/duplex/range path (never verified on paper).
- [ ] A machine at the declared floor OS (1809) or a decision to raise `minVersion`.
- [ ] Owner eyeball-approval of the uncommitted desktop registration-sheet + report-composer layouts.
- [ ] Whether `PROJECT_MEMORY.md` / `STORE-READINESS-REPORT.md` stay untracked (they carry the signing fingerprint).

## E. Fastest path to Microsoft Store approval

**Route M — Policy 10.2.9, signed MSI behind a versioned HTTPS URL. ≈ 7–12 working days, ≈ 75 % approval odds after §A.**

1. Certificate first (only external lead time). 2. Sign MSI + all 9 PEs and prove it with the gate. 3. Deploy the fresh policy + make the gate assert freshness. 4. Electron 44.9.0 + the `AuthPage` copy fix + the clinical caveat — one code pass, all gated. 5. Uninstall-clean behaviour (10.2.7 is the one policy clause a reviewer can test in 30 seconds). 6. Install → boot → smoke → uninstall once, on a clean machine. 7. Author the listing from verified behaviour and pre-answer 10.2.2 / 10.3.1 / 10.5 / 10.6 / 10.9.3 in the cert notes. 8. Submit; expect one question about the publisher account type and one about the print-spooler approach.

**Why not Route X first:** it needs a name reservation, a container path never built here, a written `runFullTrust` justification, and it re-imports the LocalCache redirect that destroys the lab database on uninstall/repair — while 10.2.9 accepts the artifact that already builds. Treat MSIX/APPX as the post-approval upgrade (free Microsoft signing, delta updates, no SmartScreen).

**If the owner stays on direct download** (the 2026-10-14 decision), items 2–6 above are still mandatory — they are security and accuracy defects, not Store bureaucracy. The unsigned MSI currently triggers a SmartScreen warning on every lab PC, and the stale hosted policy is a false statement about patient data either way.

---

## Method note (reproducible by a later session)

Evidence produced this session: `node scripts/check-desktop-package.mjs C:\pm-msi-2707\release-desktop\win-unpacked PathoMitra-2.7.7.msi` (exit 1, 7 unsigned + installer), `node .tmp/store-review-2707-probe.cjs` (asar header walk + marker grep of the **shipped** `main.js`/renderer bundles), `node -e "…extractAll…"` into `.tmp/asar-2707-extract`, `node .tmp/review-2707-measure.cjs` (a11y / sink / metadata counts), `node scripts/check-release-config.mjs` (exit 0), raw `Invoke-WebRequest` on the live policy URL, `npm audit --omit=dev` / `npm audit` / `npm view <pkg> version` currency sweep, `npm run lint:ci` (0/22) and `npm run test` (639/44), `Get-AuthenticodeSignature` + `VersionInfo` on the packaged binaries, `node_modules/electron/dist/version` in the build mirror, `.tmp/perf-probe-2707.ps1` (450 ms start, 411.8 MB WS, 0.6 % idle CPU, clean exit), and `.tmp/capture-packaged-dpi.ps1` (`PrintWindow` capture — **run the capture with `SetProcessDPIAware()`**, a DPI-unaware PowerShell host returns virtualised rects at 150 % and the bitmap looks clipped when it is not). Screenshots: `.tmp/packaged-boot-2707-dpi.png` (authoritative) and `screenshots/ms-store-2026-10-17-packaged-auth.png` (registered in `PROJECT_MEMORY.md`).

Policy sources re-fetched 2026-10-17: *Microsoft Store Policies* (publish 2026-09-15, effective 2026-10-22) and the Electron release notes for 44.7.1 / 44.7.2 / 44.8.0 / 44.9.0.
