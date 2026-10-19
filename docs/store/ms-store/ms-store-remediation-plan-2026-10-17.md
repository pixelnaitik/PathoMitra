# Microsoft Store Remediation Plan — PathoMitra for Windows

**Created:** 2026-10-17 · **Source of findings:** [`ms-store-review-2026-10-17.md`](ms-store-review-2026-10-17.md) (round 3)
**Progress check (2026-10-18):** the tree is now `796f056` / 2.8.6 with a probed APK+MSI pair. T-1.1 and T-1.3
are **done and re-verified in source** today; T-1.4 and T-1.5 are **not** done (their files still read
`themeMode: 'light'` and `minWidth: 1024 / minHeight: 640`); Electron is still `^44.7.0`, so Phase 2 has not run.
**Target:** a Windows artifact that can be submitted and pass certification — Route M (Policy 10.2.9, signed MSI behind a versioned HTTPS URL) unless the owner chooses Route X.
**Status legend:** ⬜ not started · 🟨 in progress · ✅ done (verified) · 🔒 owner/external input required · ⏸ deferred by decision
**Ownership:** **Agent** = executable in this repo now · **Agent+** = needs a build/machine run the agent can drive but must not decide · **Owner** = human/external (purchase, permission, sign-off, hosting).

---

## 0. How to use this plan

1. Work the phases in order. Phase 0 is the only thing that can run in parallel with everything — start it **first**, because a code-signing certificate and a Partner Center enrollment are the two longest lead times and nothing in Phase 5 can finish without them.
2. Every task has a **Done when** line. A task is not done because the code was written; it is done because the named command printed the named result. This is the pattern that caught the 2.7.7 round's `win-unpacked ≤ 300 MB` lie — a gate constant that no artifact could satisfy.
3. Two gates must be green at the end of **every** code phase, and stay green until submission:
   - `npm run verify` (lint:ci 0 errors / ≤ 23 warnings, vitest all-pass, coverage ≥ 82/68/82/85, `vite build`)
   - for desktop-touching phases: `node scripts/check-desktop-package.mjs <win-unpacked> <msi>`
4. Do not run `npm audit fix --force` (breaks `@capacitor/cli` + patch-package). Do not major-bump `vite`/`tailwindcss` in this window.
5. Never text-round-trip a file through PowerShell 5.1 (CP1252 mojibake). Use the editor or Node.
6. Anything that changes shipped runtime behaviour needs the packaged boot probe, not just a unit test: `Start-Process C:\pm-msi-<ver>\release-desktop\win-unpacked\PathoMitra.exe`, assert window + `pathlab.db` locked, then capture with `.tmp/capture-packaged-dpi.ps1` (**must** call `SetProcessDPIAware()` — an unaware host reports a phantom clipped layout at 150 % scaling).

---

## 1. Critical path

```
[Owner] Phase 0  cert purchase ─┐
[Owner] Phase 0  Partner Center enrollment + name reservation ─┐
                                                                │
[Agent] Phase 1  code pass A (copy, gates, banner, theme, size) │
[Agent] Phase 2  Electron 44.9.0 + rebuild + boot probe         │
[Owner] Phase 3  lab sign-off → [Agent] caveat + disclaimer     │
[Agent] Phase 4  uninstall clean-removal affordance             │
                                                                ▼
[Agent] Phase 5  wire signing → rebuild → 9/9 Valid → publish versioned URL
[Agent+] Phase 6 install → boot → smoke → uninstall on a clean machine
[Owner] Phase 7  deploy the fresh privacy policy (+ freshness gate)
[Agent] Phase 8  listing copy + screenshots + cert notes
[Agent+] Phase 9  Narrator / Accessibility Insights attestation
[Agent] Phase 10 commit → tag → rebuild from tag → SUBMIT
```

Longest pole: **the certificate** (Phase 0 → Phase 5). Everything in Phases 1–4 is repo work that can be finished while it is in flight.

---

## 2. Phase 0 — Owner decisions and external inputs (start today, 🔒)

| #   | Input                                                                                                                                                     | Why it blocks                                                                                                                        | Lead time             | If not answered                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------- |
| D-1 | **Route M vs Route X** (default: **M**)                                                                                                                   | decides whether Phase 5 needs a Store name reservation + `runFullTrust` justification, and whether the container work is done at all | 1 h                   | Plan proceeds on M; Route X delta is §12                                                     |
| D-2 | **Code-signing certificate** — OV/EV from a Microsoft Trusted Root participant, or **Azure Trusted Signing** (`azureSignOptions`; the two cannot coexist) | 10.2.9 fails on the first unsigned PE; also kills the SmartScreen prompt on every lab PC                                             | days (org validation) | No Store submission is possible. Direct download still ships, still warns                    |
| D-3 | **Partner Center account type** — Individual vs **Company** (recommended for a B2B lab suite, 10.14) + fee                                                | publisher CN is baked into the manifest and the listing                                                                              | days                  | Expect a reviewer question; `CN=Naitik Raj` is honest but weakens the listing                |
| D-4 | **Permission to deploy `promotion_website` to Cloudflare Pages**                                                                                          | the hosted policy is stale and contradicts the shipped one (PR-01) — the only fix is a deploy                                        | minutes               | PR-01 stays a 🚨 blocker; do **not** paper over with `PRIVACY_URL_CHECK=loose`               |
| D-5 | **Lab-director sign-off** on the report caveat wording + the 72 `requires-lab-verification` bands                                                         | 11.3.2 + 10.2 "industry-standard disclaimers"                                                                                        | days                  | Phase 3 cannot ship; the printed report keeps zero caveat                                    |
| D-6 | **A branded domain** for the policy and the installer URL (or accept `pathomitra.pages.dev`)                                                              | 10.5.1 "applicable laws" + the project's own block-list exception                                                                    | hours–days            | Keep the owner-approved exception; note it in cert notes                                     |
| D-7 | **A clean non-OneDrive test machine** (and ideally a Windows 10 1809 VM)                                                                                  | 10.4.1 requires the declared OS range to be true; the MSI has never been installed                                                   | hours                 | P-11 stays ❌; do not lower `maxVersionTested` without a run                                 |
| D-8 | **A physical printer**                                                                                                                                    | the orientation/duplex/range path has never been verified on paper                                                                   | hours                 | PR-3 print-job verification stays open (not Store-blocking, but a clinical-correctness risk) |
| D-9 | Neutral replacement art for `public/default-share-template.png`                                                                                           | 11.2 third-party IP (a real lab's letterhead ships in the asar)                                                                      | hours                 | Screenshots must not show it; listing art blocked                                            |

---

## 3. Phase 1 — Code pass A: no external input needed (🟨 Agent, ~1 day — T-1.1 ✅ T-1.3 ✅, rest open)

Six findings that are pure repo work. Do them in one commit-able round so `npm run verify` is paid once.

### T-1.1 — Remove the first-screen over-claims and close the guard hole (PR-03, ✅ done — re-verified 2026-10-18)

- **Files:** `src/pages/auth/AuthPage.tsx` (`:68`, `:129`, `:154`), `src/lib/marketing-claims.test.ts`.
- **Change:**
  1. `:154` headline second line `Securely connected.` → **`Offline and encrypted.`** (keep the `text-secondary` span and the line break).
  2. `:68` row body `Keep sensitive information safe and compliant.` → **`Keep patient records on your own device, encrypted at rest.`** (`compliant` is the specific problem — §5 of the policy disclaims every certification).
  3. `:129` `Secure Workspace` → **`Local Workspace`** (or `Encrypted Workspace`).
  4. Add `'src/pages/auth/AuthPage.tsx'` to `MARKETING_SOURCES` (`:20-55`).
  5. Add two `BANNED_CLAIMS` rules: `/securely connected/i` and `/\bsafe and compliant\b/i`, each with a `why` naming the offline posture (`main.ts:276-290` egress block, no `INTERNET` permission) and the §5 non-certification sentence.
- **Trap:** the guard strips `/* */` but **not** `//` — write the justification as a block comment or the build fails on your own comment text.
- **Test:** the two new rules are the test; add a positive assertion that `AuthPage.tsx` is in the scanned list (so it cannot silently drop out again).
- **Done when:** `npm run verify` exit 0, and a grep of `dist/` for `Securely connected` / `safe and compliant` returns 0 after `npm run build`.
- **Risk/rollback:** copy-only; no behaviour change. Owner may prefer different wording — the guard change is the load-bearing half.

### T-1.2 — Make the two release gates actually see what they claim (PR-01 helper, P-08, ⚠)

- **Files:** `scripts/check-release-config.mjs`, `scripts/check-desktop-package.mjs`, `electron-builder.config.mjs`.
- **Change:**
  1. `check-release-config.mjs`: after the existing readability probe, assert the live body contains (case-insensitive) `PRIVACY_LAST_UPDATED`'s value **and** the platform words `Windows` + `DPAPI` when the build target is desktop. Today the probe passes on a 9-day-old page — that blindness is how PR-01 survived. Keep the failure message actionable (print the expected marker and the found length).
  2. `check-desktop-package.mjs`: replace the printed PE count with an expectation — `expected 9 PEs, all Valid` — and add a `MAX_NON_RUNTIME_FILES = 10` / `MAX_NON_RUNTIME_MB = 0.2` assertion so the asar cannot silently regrow (measured today: 44 files / 0.52 MB).
  3. `electron-builder.config.mjs`: add `'!node_modules/@types/**'` to `files` (15 type-only packages ship inside a product asar for no reason).
- **Done when:** the gate **fails** when pointed at the current stale URL (proving the assertion works) and passes against a locally-served copy of the fresh `privacy.html`. Prove both; a freshness assertion that cannot fail is not an assertion.
- **Note:** this will make `npm run build:android` / `desktop:msi` fail until Phase 7 deploys. That is correct and intentional — say so in the commit message so a later session does not "fix" the gate.

### T-1.3 — De-identify the Windows/web banner path (PR-07, ✅ done — re-verified 2026-10-18: `safeBannerFor` + `GENERIC_BANNER_TITLES` in `notification-engine.ts`, consumed by `useNotifications.ts`)

- **Files:** `src/lib/notification-engine.ts`, `src/hooks/useNotifications.ts`, `src/lib/desktop-notifications.ts` (+ their tests).
- **Root cause:** Android gets `visibility: 0` (private on the lock screen). The desktop/web path is `new Notification()` (`desktop-notifications.ts:273`) and Chromium exposes **no** lock-screen control, so `bannerTitle`'s registration number and `bannerBody`'s status are legible on a locked PC.
- **Change:** add an exported `safeBannerFor(item: NotificationItem)` in `notification-engine.ts` that returns `{ title, body }` with the record identifier removed and the target described generically (`'A collected sample is still awaiting a report'`, `'An invoice is unpaid'`), keeping the count/age detail that carries no identifier. `useNotifications.ts:378` posts `safeBannerFor(item)` whenever the backend is not `native`; the native path keeps `bannerTitle`/`bannerBody` (private visibility + name-free already).
- **Tests:** extend `notification-engine.test.ts` — feed a patient name, a registration number and an invoice number through `safeBannerFor` and assert none survives; assert the in-app `title`/`body` are unchanged (the operator still needs to know which record).
- **Done when:** new tests pass and `desktop-notifications.test.ts` still pins both halves of the Android rule.
- **Trade-off, write it down:** a desktop banner becomes less actionable. Mitigation: the alert centre and deep link are unchanged, and the Settings → Notifications row gains one clause of copy saying desktop banners are deliberately generic.

### T-1.4 — Dark-mode system default (MS-W3 residual, ⚠ Medium — ⬜ not started as of 2026-10-18)

- **Files:** `src/lib/theme.ts`, `src/lib/settings.ts` (`:112`, `:207`, `:313`, `:412`), `index.html` (pre-paint bootstrap), the Settings appearance picker, `src/components/DashboardLayout.tsx` (toggle).
- **Change:**
  1. `theme.ts`: `export type ThemeMode = 'light' | 'dark' | 'system'` + `export function resolveThemeMode(mode: ThemeMode): 'light' | 'dark'` → `matchMedia('(prefers-color-scheme: dark)')` for `'system'`, else the explicit value. `applyTheme` takes the resolved value.
  2. `settings.ts`: `DEFAULT_SETTINGS.themeMode = 'system'`; `migrateSettings` keeps any **stored** `light`/`dark` untouched (an existing lab's choice must not flip) and only applies `'system'` to a missing value (`:313` already does exactly that shape); `writeSettings` (`:412`) calls `applyTheme(id, resolveThemeMode(mode))`.
  3. Register a `change` listener on the media query so a live Windows theme switch follows while the mode is `'system'` (ignore it once the user has chosen explicitly).
  4. `index.html` bootstrap: resolve `'system'`/absent → `prefers-color-scheme` so the pre-paint splash matches `electron/main.ts:155` (which already paints the window from `shouldUseDarkColors`). Today the two disagree: dark frame → light document.
  5. Settings picker gains a **System** option (default), keeping Light/Dark.
- **Tests:** `settings.test.ts` — a stored `'dark'` survives migration; an absent value becomes `'system'`; `resolveThemeMode('system')` follows the query. No new lint warning (`react-hooks/set-state-in-effect` has one spare slot at 22/23 — put the listener in its own effect with a cleanup, and re-check).
- **Done when:** `npm run verify` exit 0 **and** the packaged boot probe on this machine (set Windows to Dark first) shows a dark document, not a dark frame over light content — captured with `.tmp/capture-packaged-dpi.ps1`.

### T-1.5 — Make the declared window minimum honest (10.4.1, ❌ High for the listing — ⬜ not started as of 2026-10-18)

- **Files:** `electron/main.ts:150-151`, `docs/` system-requirements text (Phase 8).
- **Measured:** `minWidth 1024 / minHeight 640` are DIPs. A 1366×768 panel at 150 % gives 910×512 DIP — the minimum cannot be honoured there and the window is silently clamped (observed here: a 1440×900 request became 1280×752 DIP).
- **Change:** lower to `minWidth: 880, minHeight: 560` (the composer already falls back to stacked cards below 1024 px, and the register sheet to a single column), then state requirements as **"1024×640 logical or larger; 1280×800 recommended; 100–125 % scaling"** in the listing. If the owner would rather keep 1024, the alternative is to detect a smaller work area at boot and show a "screen too small" dialog — 10.4.1 explicitly allows and expects that.
- **Done when:** boot probe at 880×560 shows no horizontal clipping of the auth card, the register sheet and the composer (capture + eyeball), and the layout fallbacks still resolve to exactly one set of `.test-result-input` nodes.

### T-1.6 — Confirmation token on destructive IPC (Cap-14, ⚠ P3)

- **Files:** `electron/ipc.ts:231` (`pm:db:clear`), the renderer caller (`desktopRepository` / erase path), `ipc.test`-equivalent.
- **Change:** the destructive channel requires a second argument equal to a literal the UI obtained from a typed confirmation (`'ERASE'`), and the handler refuses anything else. Sender-frame trust already exists; this adds the human gate.
- **Done when:** a test asserts `pm:db:clear` without the token returns `{ ok: false }` and does not clear.

---

## 4. Phase 2 — Electron 44.7.0 → 44.9.0 (S-10, ❌ P1, ⬜ Agent, ~half a day)

- **Files:** `package.json` (`devDependencies.electron`, **and** the `allowScripts."electron@44.7.0"` pin — it must become `electron@44.9.0` or the install postinstall is blocked), `package-lock.json`.
- **Steps:** `npm install electron@44.9.0` → `npm run verify` → rebuild the desktop bundle (`npm run desktop:msi:test` is enough for a probe; the release path needs Phase 7's green gate) → boot `win-unpacked\PathoMitra.exe` → assert 4 processes, window title, `pathlab.db` locked, screenshot non-blank, clean exit.
- **Watch for:** the 44.8.0 `net.fetch` Network-Service-restart fix and the 44.9.0 "link-opened windows use the opener's session" change both touch code paths this app uses (`net.fetch` in the `pathomitra://` handler, `setWindowOpenHandler` deny). Re-check both in the boot probe. Native modules are Node-API prebuilds, so `@electron/rebuild` is not required at load — but if the boot fails to open the DB, that is the first thing to suspect.
- **Done when:** `node_modules/electron/dist/version` reads `44.9.0`, `npm run verify` exit 0, and the packaged boot probe passes at the new version.
- **Why not `npm audit fix --force`:** it never touched Electron anyway; the 15 dev-chain advisories stay accepted risk (documented in [`ms-store-review-2026-10-17.md`](ms-store-review-2026-10-17.md) §7).

---

## 5. Phase 3 — Clinical caveat + disclaimer on issued reports (11.3.2 + 10.2, ❌ P1, 🔒 then ⬜)

- **Blocked by:** D-5 (lab-director sign-off on wording).
- **Files:** `src/lib/report-compliance.ts` (`:35` `PROFESSIONAL_USE_DISCLAIMER`, `:44` `SIGNER_SUFFIX`, `:139-140`), the renderers that consume them (`ReportViewerDashboard.tsx:209`, `ReportsPage.tsx:698`, `default-template.ts:143`, `report-layout.ts:184`, `SettingsPage.tsx:301`), `report-compliance.test.ts` (currently asserts **absence** — it must flip to asserting **presence, exactly once per report**).
- **Design (from the 2026-10-11 failure):** the old defect was _per-parameter_ caveat spam (a 2-year-old's CBC printed ~20 lines and pushed the signature to page 2). The fix is **one line per report**, derived from the set of `unverifiedForPatient` flags rather than emitted per row, plus the professional-use disclaimer.
  - Proposed caveat: _"Reference ranges are laboratory-configurable defaults; values marked ‡ were not verified for this patient's age/sex band."_
  - Proposed disclaimer: _"For use by qualified healthcare professionals. Not a substitute for clinical judgement."_
- **Done when:** a printed A4 report shows both lines once, the signature block still fits on page 1, and `report-compliance.test.ts` + the layout tests pass. Verify by printing to PDF in the packaged build and reading the produced PDF text, not the DOM.

---

## 6. Phase 4 — Clean uninstall / data removal (P-06, ❌ P1, ⬜ Agent, ~half a day)

- **Constraint that must not be broken:** the MSI deliberately does not touch `%APPDATA%\PathoMitra`, because a routine upgrade must never destroy years of records. That decision is correct and stays.
- **Change (recommended, low-risk):** make removal _enabled_, not merely documented —
  1. Settings → Data → a desktop-only **"Erase data and remove PathoMitra"** action: run the existing `eraseAllData()` (already clears DB + account, throws on failure), then hand off to `ms-settings:appsfeatures` via `shell.openExternal` so Windows performs the uninstall with its own consent UI.
  2. New IPC channel `pm:app:uninstall-handoff` behind `isTrustedSender` + the T-1.6 token pattern.
  3. Policy §6 and the listing description state the sequence in the same words.
- **Alternative (fuller, higher risk):** spawn `msiexec /x {ProductCode} /qb` after erasing — requires ProductCode discovery (registry archaeology) and a UAC prompt at the wrong moment. Only take this if the owner rejects the handoff.
- **Done when:** an installed build erases, hands off, uninstalls, and a post-uninstall `%APPDATA%\PathoMitra` check shows the outcome the policy describes — recorded in the Phase 6 smoke note.

---

## 7. Phase 5 — Signing, rebuild, versioned URL (P-02/P-05, 🚨 P0, 🔒 then ⬜)

1. **Wire** (no secret committed): `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` (or `azureSignOptions` — never both). `win.signExts: ['.dll','.node']` + `signtoolOptions` sha256/RFC-3161 are already correct for 26.15.3.
2. **Build** in a non-OneDrive mirror, per the established procedure: seed `C:\pm-msi-<ver>` by robocopy from the previous mirror (local→local; **do not** add `dist` to `/XD`), overlay the current source excluding `node_modules`, `ELECTRON_BUILDER_CACHE=C:\pm-cache\eb`, keep TEMP out of the OneDrive tree, `npm run desktop:msi`.
3. **Prove:** `node scripts/check-desktop-package.mjs C:\pm-msi-<ver>\release-desktop\win-unpacked PathoMitra-<ver>.msi` → **`9 files, 9 validly signed, 0 foreign-platform`**, installer `Valid`, exit **0**. Print the signer subject. This is the single most important line in the plan.
4. **Publish** the MSI at a versioned, TLS-only, immutable URL (GitHub Release asset or Cloudflare R2 object — **not** a path that gets overwritten), record SHA-256, set `promotion_website/src/lib/downloads.ts → DOWNLOAD_URLS.windows`, and list the hash + system requirements on `/download`.
5. **Register** the artifact (path, size, SHA-256, signer, commit) in `buildoutput/BUILD_INFO.md` and `PROJECT_MEMORY.md`.

- **Done when:** items 3 and 4 are both true, and the URL from item 4 is the one pasted into Partner Center.

---

## 8. Phase 6 — Install → boot → smoke → uninstall (P-11, ⬜ Agent+ on a clean machine, ~1 day)

Run on a **non-OneDrive** machine (ideally the declared floor OS, Windows 10 1809, plus the current release), with SmartScreen expected to pass silently once signed:

1. `msiexec /i PathoMitra-<ver>.msi /qn` (perMachine, one UAC) → shortcut present and launches.
2. Create account (lab name first field) → Terms accept → unlock; wrong passcode moves the failure count by exactly one; clock-forward during lockout does not release.
3. Register a patient → `YYMM0001`-style number; duplicate-phone warning fires.
4. Issue a report **with blank results** (the 2.7.7 transaction fix), then amend it → stored `version: 2` + a `reportVersions` row (the AM-1 P0 must not regress).
5. Raise a bill → header shows the lab's own name, no "PAYABLE ON COLLECTION", unpriced line prints `not priced`.
6. Print one report and one bill **on real paper** (A4 portrait/landscape, range `2,4`, copies).
7. Sealed backup → restore on a second profile/device.
8. Watch Task Manager for 60 s: startup to window (expect ≈450 ms), working set (expect ≈410 MB), idle CPU (expect <1 %).
9. Uninstall → inspect `%APPDATA%\PathoMitra` and confirm it matches the policy sentence, then run the Phase 4 erase-and-remove path and confirm the outcome.
10. Repeat 1–2 and 4 on the 2.7.2 → <ver> **upgrade** path (advertised shortcuts, `DISABLEADVTSHORTCUTS`).

- **Done when:** a dated note exists at `docs/desktop-smoke-<date>.md` with each numbered result and the `%APPDATA%` observation. `maxVersionTested` may only claim an OS that appears in that note.

---

## 9. Phase 7 — Deploy the fresh policy + mailbox test (PR-01, 🚨 P0, 🔒 Owner gate, minutes)

1. Owner clears the deploy gate → `cd promotion_website; npm run build` → `npx wrangler@latest pages deploy promotion_website/dist --project-name pathomitra --branch main --commit-dirty=true` (run from a normal terminal — `npx` in this shell dies on a `$LASTEXITCODE` bug in `npx.ps1`).
2. Verify with a raw probe: `Invoke-WebRequest https://pathomitra.pages.dev/privacy` must return **13 624 B, 0 `<script>`, `Windows` ≥ 8, `DPAPI` ≥ 2**, the support address, and the `PRIVACY_LAST_UPDATED` string. Confirm `/privacy` serves the static file and not the `_redirects` SPA fallback; if it falls back, also emit `privacy/index.html`.
3. Re-run `node scripts/check-release-config.mjs` → exit 0 **with the new freshness assertions enabled** (T-1.2). Until step 2 is done this gate fails by design.
4. Send a test message to `pathomitra@healthcarediagnosticscenter.in` and confirm delivery (Email Routing destination must be verified in the Cloudflare dashboard — not checkable from this machine).
5. ⚠ Name collision: `.github/workflows/deploy.yml` deploys the **app** bundle to `--project-name=pathomitra`, the same Pages project as the brochure. Give one of them its own project **before** the next `deploy.yml` run, or the policy page will be overwritten by the app.

---

## 10. Phase 8 — Listing authoring, screenshots, cert notes (⬜ Agent drafts, 🔒 Owner publishes)

| Field                   | Content rule                                                                                                                                                                                                                                                                                                                                                                                             | Source of truth                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title                   | `PathoMitra` — no tagline (10.1.1)                                                                                                                                                                                                                                                                                                                                                                       | the tagline stays in the short description                                                                                                                                                               |
| Short description       | ≤ 1 000 chars                                                                                                                                                                                                                                                                                                                                                                                            | verified behaviour only                                                                                                                                                                                  |
| Description             | ≤ 10 000, **no URLs/HTML**, limitations first: offline, single operator account, no cloud/sync, reports are formatted not diagnosed, ranges are editable lab defaults, Windows key is DPAPI-sealed                                                                                                                                                                                                       | `src/lib/privacy-policy.ts` §1-§6 + `SECURITY.md`                                                                                                                                                        |
| Search terms            | exactly **7**, no frameworks, no pricing, no other product titles (10.1.3)                                                                                                                                                                                                                                                                                                                               | do **not** copy `package.json.keywords` (9, four of them build tools)                                                                                                                                    |
| Screenshots             | ≥ 4, Desktop ≥ 1366×768, PNG ≤ 50 MB, caption ≤ 200                                                                                                                                                                                                                                                                                                                                                      | captured from the **packaged build** with `.tmp/capture-packaged-dpi.ps1` at 1920×1200: Overview, Register patient, Report composer, Bills, Settings. Never `ProductMock`, never the letterhead template |
| System requirements     | "1024×640 logical minimum, 1280×800 recommended, 100–125 % scaling, x64, Windows 10 1809+ (tested: <the OSes in the Phase 6 note>)"                                                                                                                                                                                                                                                                      | `main.ts` minimums + Phase 6                                                                                                                                                                             |
| Category                | Business (or Medical) — pick one and keep the metadata consistent                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                        |
| Age rating              | IARC honestly; **do not** answer "no personal information collected"                                                                                                                                                                                                                                                                                                                                     | policy §2/§3                                                                                                                                                                                             |
| EULA                    | MIT + the "not a diagnostic device" clause                                                                                                                                                                                                                                                                                                                                                               | `LICENSE`, policy §5                                                                                                                                                                                     |
| **Certification notes** | pre-answer: 10.2.2 (`publish: null`, runtime egress block, no remote code) · 10.3.1 (exact first-run recipe, no demo credentials are possible offline) · 10.5 (no collection, no SDKs, no telemetry, on-device ring buffer) · 10.6 (why `runFullTrust`/Win32 spooler, if Route X) · 10.9.3 (banner content rule, both platforms) · 10.2.4 (no non-integrated dependencies; printing uses the OS spooler) | `SECURITY.md` + this plan                                                                                                                                                                                |

---

## 11. Phase 9 — Accessibility attestation (⚠ P2, ⬜ Agent+, half a day)

Store Policies has **no** accessibility certification clause, so this is EN 301 549 / ADA exposure and listing quality — but it is the one claim in the a11y score that is currently unevidenced.

1. Narrator pass on the packaged build: auth console → register → composer → bills → settings; announce each control, verify the skip link, the `role="status"` toasts, and that `inert` removes the background from the tree.
2. Accessibility Insights for Windows: no critical failures; capture the `.aatx`/results.
3. Keyboard-only walkthrough at 200 % zoom; tab order through the composer's Enter/↑/↓ caret walk.
4. Write `docs/accessibility-attestation-<date>.md` with what passed, what did not, and the date/build.

---

## 12. Phase 10 — Provenance, then submit (⬜ Agent)

1. Commit the whole 2.7.3→2.7.8 line (unstage the deliberately-untracked files: `PROJECT_MEMORY.md`, `promotion_website/STORE-READINESS-REPORT.md`, the dated audit ledgers, `favicon_io/`).
2. Push to `pathomitra/main` (judge success by `git ls-remote`, never by PowerShell exit code) and **tag** `v<version>` — 0 tags exist for the entire 2.6.x/2.7.x line.
3. Rebuild the artifact **from the tag**, re-run Phase 5 step 3, and register it.
4. Partner Center: paste the versioned URL, upload the listing (Phase 8), complete the declarations, submit.

---

## 13. Route X delta (only if D-1 chooses `.appx`)

1. Reserve the product name first, then set `appx.identityName` from the reservation (`PathoMitra.PathoMitra` is currently a guess).
2. `PM_WIN_TARGETS=appx npm run desktop:msix` — never run here; expect first-run friction (4-part MSIX version, `makeappx`/`makepri` are installed at `C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\`).
3. Write the `runFullTrust` justification (Electron runtime + Win32 print spooler) into the cert notes.
4. **Solve the data-loss problem before submitting:** MSIX redirects `%APPDATA%\PathoMitra` into the package LocalCache, which Windows deletes on uninstall/repair — that destroys the lab database. It requires moving storage to a non-redirected known folder (or `packagesPath`/`unvirtualized` writes) and a migration for existing installs. Until that is designed, Route X is not merely harder, it is unsafe for this product.
5. Tile art already exists and is gate-checked (`desktop-resources/appx/*`), so the asset work is done.

---

## 14. Definition of Submittable (every line must print the named result)

```
node scripts/check-desktop-package.mjs <win-unpacked> <msi>   → "9 files, 9 validly signed, 0 foreign-platform", installer Valid, exit 0
Invoke-WebRequest <VITE_PRIVACY_URL>                          → contains Windows + DPAPI + PRIVACY_LAST_UPDATED + support address, 0 <script>
node scripts/check-release-config.mjs                         → exit 0 with the freshness assertions live
npm run verify                                                → 0 errors, ≤23 warnings, all tests, coverage ≥82/68/82/85, build ok
npm run test                                                  → all pass (786 tests / 50 files at 2.8.6)
npm audit --omit=dev                                          → 0 vulnerabilities
node_modules/electron/dist/version                            → 44.9.0
git tag --list                                                → v<version> present; artifact built from that commit
docs/desktop-smoke-<date>.md                                  → install + boot + smoke + uninstall recorded; OS list == manifest range
Partner Center                                                → title, 7 terms, description, ≥4 screenshots ≥1366×768, sysreq, IARC, EULA, cert notes
grep -r "Securely connected\|safe and compliant" dist/         → 0 hits
```

---

## 15. Finding → task map (nothing may be orphaned)

| Finding                                      | Sev | Task                                                                                             | Owner                          |
| -------------------------------------------- | --- | ------------------------------------------------------------------------------------------------ | ------------------------------ |
| P-02 unsigned PEs + MSI                      | 🚨  | D-2 → Phase 5                                                                                    | Owner + Agent                  |
| P-05 no versioned HTTPS URL                  | 🚨  | Phase 5.4                                                                                        | Agent                          |
| PR-01 stale hosted policy                    | 🚨  | Phase 7 + T-1.2                                                                                  | Owner (deploy)                 |
| §4 no Store listing                          | 🚨  | Phase 8                                                                                          | Agent drafts / Owner publishes |
| P-01 no container built                      | 🚨  | D-1 → Phase 5 / §13                                                                              | Owner decides                  |
| S-10 Electron 4 releases behind              | ❌  | Phase 2                                                                                          | Agent                          |
| PR-03 auth over-claims                       | ✅  | T-1.1 **done** (verified in `AuthPage.tsx` + the guard 2026-10-18)                               | Agent                          |
| 11.3.2 no report caveat/disclaimer           | ❌  | D-5 → Phase 3                                                                                    | Owner then Agent               |
| P-06 uninstall retains PHI                   | ❌  | Phase 4                                                                                          | Agent                          |
| P-11 OS range untested / MSI never installed | ❌  | D-7 → Phase 6                                                                                    | Agent+                         |
| §4 system requirements unstated              | ❌  | T-1.5 + Phase 8                                                                                  | Agent                          |
| P-13 uncommitted, 0 tags                     | ❌  | Phase 10                                                                                         | Agent                          |
| PR-07 Windows banner on lock screen          | ✅  | T-1.3 **done** (`safeBannerFor` + generic titles on the non-native path, re-verified 2026-10-18) | Agent                          |
| MS-W3 dark-mode default                      | ⚠   | T-1.4                                                                                            | Agent                          |
| Cap-01 `runFullTrust` unjustified            | ⚠   | Phase 8 cert notes (Route X: §13.3)                                                              | Agent                          |
| Cap-11 PowerShell/WMI print path             | ⚠   | Phase 8 cert notes                                                                               | Agent                          |
| P-12 Individual publisher                    | ⚠   | D-3                                                                                              | Owner                          |
| §6 canonical doc says MSI rejected           | ⚠   | Phase 8.0 (fix `STORE-READINESS-REPORT.md` §6)                                                   | Agent                          |
| PR-09 platform-subdomain host                | ⚠   | D-6                                                                                              | Owner                          |
| a11y unvalidated on Windows                  | ⚠   | Phase 9                                                                                          | Agent+                         |
| 11.2 letterhead asset                        | ⚠   | D-9                                                                                              | Owner (art)                    |
| P-08 `@types/*` + 44 non-runtime files       | ⚠   | T-1.2.3                                                                                          | Agent                          |
| Cap-14 destructive IPC token                 | ⚠   | T-1.6                                                                                            | Agent                          |
| Small-text legibility (9/10 px)              | ⚠   | Phase 11 backlog                                                                                 | ⏸                              |
| Dev-chain advisories (15)                    | ⚠   | accepted risk, documented                                                                        | ⏸                              |
| APK origin has no CSP                        | ⚠   | not Store scope; separate Android round                                                          | ⏸                              |

---

## 16. Schedule

**Working days 1–7 (agent-executable, no external dependency):** Phase 1 (all six tasks, one gated round) → Phase 2 → Phase 4 → Phase 10.1-2 (commit + tag) → Phase 8 drafting (copy + cert notes text, no publish) → `STORE-READINESS-REPORT.md` §6 correction.

**Calendar, gated by owner inputs:**

| Window  | Gate                  | Work                                                     |
| ------- | --------------------- | -------------------------------------------------------- |
| Day 1   | —                     | Phase 0 asks raised; Phase 1 starts                      |
| Day 2–3 | —                     | Phase 2 + 4 + 10 commit/tag                              |
| Day 3–5 | D-2 cert in hand      | Phase 5 wire + sign + prove + publish URL                |
| Day 4   | D-4 deploy permission | Phase 7 policy deploy + freshness gate green             |
| Day 5–6 | D-7 machine           | Phase 6 install → smoke → uninstall note                 |
| Day 6–7 | D-5 lab sign-off      | Phase 3 caveat + disclaimer, re-gate, rebuild            |
| Day 8   | D-1/D-3/D-6           | Phase 8 screenshots + listing entered; Phase 9 a11y pass |
| Day 9   | all green             | §14 Definition of Submittable, then submit               |

If D-2 (the certificate) slips, everything from Phase 5 onward slips — the correct fallback is to keep shipping the direct-download MSI **and still do Phases 1, 2, 3, 4, 7**, because those are security and accuracy defects, not Store bureaucracy.

---

## 17. Risk register

| Risk                                           | Trigger                                                                                         | Mitigation                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Electron bump changes session/scheme behaviour | 44.8.0 `net.fetch` + 44.9.0 opener-session changes                                              | boot probe after the bump; keep the previous mirror for a one-command rollback |
| Freshness assertion blocks every release build | Phase 7 not deployed yet                                                                        | intentional; do not weaken it. Announce in the commit message                  |
| Dark-mode default flips an existing lab's UI   | migration overwriting a stored choice                                                           | `'system'` applies **only** to an absent value; test pins it                   |
| Generic desktop banners feel useless           | over-stripping                                                                                  | alert centre + deep link unchanged; one clause of Settings copy                |
| Signed build published to a mutable URL        | overwriting the same path                                                                       | versioned filename + hash recorded; 10.2.9 requires a new URL per version      |
| MSIX route taken without storage fix           | LocalCache deletion on uninstall/repair                                                         | §13.4 makes it a precondition, not a follow-up                                 |
| Concurrent session edits the same files        | `PROJECT_MEMORY.md`, `electron/main.ts`, `privacy-policy.ts` have been edited mid-flight before | re-read every file immediately before touching it                              |
