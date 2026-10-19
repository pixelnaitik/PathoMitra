# PROJECT_MEMORY — PathoMitra (pathomitra)

> Persistent cross-session context. At the start of every session, read this file and continue the items
> under **Next / Open items**; after any state change, write verified facts back here.
> **This file is a snapshot — code, configuration and the built artifacts are the source of truth.** If a
> fact here conflicts with the tree, the tree wins; then correct it here.
> Detail that lives in a dated `docs/*.md` ledger is _referenced_ here, never duplicated.
>
> **History archive:** `docs/history/PROJECT_MEMORY-2026-10-18-pre-cleanup.md` is a verbatim copy of this
> file before the 2026-10-18 documentation cleanup (superseded build sheets 2.7.2 → 2.8.5, the Play
> rounds 4–5 and MS Store rounds 2–3 narratives, per-build hashes, dated audit scores). Nothing from it is
> current unless it is repeated below; read it only when a decision's provenance is needed.

## Verified 2026-10-18 (read or executed in the cleanup session)

| Fact                      | Value                                                                                                                                                                                                 | Evidence                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `package.json`            | version **2.8.6** (versionCode 2008006)                                                                                                                                                               | read from the file               |
| HEAD                      | `796f056` _chore(release): 2.8.6_ on `main`, **ahead 1 of `pathomitra/main` (`49f7949`)** — unpushed                                                                                                  | `git log` / `git branch -vv`     |
| Tags                      | **zero**, for every version ever cut                                                                                                                                                                  | `git tag --list`                 |
| Working tree              | clean except `PROJECT_MEMORY.md` and the untracked `docs/history/` archive this cleanup added                                                                                                         | `git status --short`             |
| Live artifacts            | `buildoutput/android/app-release-2.8.6.apk` + `buildoutput/desktop/PathoMitra-2.8.6.msi`                                                                                                              | both probed below                |
| Gate at packaging         | `npm run verify` green — `tsc --noEmit` clean · eslint 0 errors inside the `--max-warnings=23` ratchet · **50 test files / 786 tests** · coverage **89.58 / 81.44 / 91.14 / 90.77** · `vite build` OK | `.build-tmp/gate-286.log`        |
| Release gate              | `check-release-config.mjs` exit 0 **with the live privacy probe** ("verified reachable") — no `PRIVACY_URL_CHECK=skip`, no `--allow-placeholder`                                                      | `.build-tmp/sync-286.log`        |
| Hosted policy still stale | live `/privacy` = 200, 11 734 chars, **0 `<script>`, SQLCipher ×2, `Windows` ×0, `DPAPI` ×0**; local `promotion_website/public/privacy.html` = **13 624 B** and does contain them                     | `Invoke-WebRequest` + `Get-Item` |
| Electron                  | `^44.7.0` declared and shipped; 44.9.0 was the upstream latest on 2026-10-17 (re-check before bumping)                                                                                                | `package.json`                   |
| Print queue               | `buildoutput/print-checks/` = **14 PDFs, none ever printed on paper**                                                                                                                                 | directory count                  |
| Stray dev server          | **no** listener on `:5173`                                                                                                                                                                            | `Get-NetTCPConnection`           |

**⚠ The three verification gaps are unchanged:** no artifact has been installed or run **on a phone**, the
MSI **installer** has never been installed (packaged `win-unpacked/PathoMitra.exe` has booted), and nothing
has ever been printed on **paper**. Layout claims are proven by Chromium's own measured geometry against the
shipped stylesheet — strong, but not the device.

## Live build — 2.8.6 (packaged 2026-10-18, 22:06 / 22:25 local)

Full hand-over sheet: `buildoutput/BUILD_INFO.md` (still headed 2.8.5 — registering the 2.8.6 pair there is owed).

- **`buildoutput/android/app-release-2.8.6.apk`** — 17 150 181 B, SHA-256
  `15ff13f4ee58449d1cbabce05d0bf30ab7d91f5a78d49102e7a522e06d3cb1a8`, versionName 2.8.6 / versionCode
  2008006, minSdk 28, targetSdk 36, `zipalign -c -P 16 -v 4` OK, signed with the stable key
  `1550d59f…09587a4d` → updates an installed 2.6.x–2.8.x **in place**, lab DB kept (**never uninstall**).
  `node .tmp/verify-apk.cjs 2.8.6` → **ALL CHECKS PASS** (31 assertions, incl. the shipped CSS being
  byte-identical to this tree's `dist/assets/index-BKLgSK--.css`). **No AAB.**
- **`buildoutput/desktop/PathoMitra-2.8.6.msi`** — 130 949 120 B (124.9 MB), SHA-256
  `f0f6555771d05085ff2f9376f1d326867daf650dd73bf878df5c5188a15e763f`, exe FileVersion 2.8.6 /
  ProductVersion 2.8.6.0 / Company `Naitik Raj`, **NotSigned** → test artifact, not a submission.
  Mirror `C:\pm-msi-2860` (convention `pm-msi-<maj><min><pat>0`) with `ELECTRON_BUILDER_CACHE=C:\pm-cache\eb`.
  `node .tmp/verify-msi.cjs 2.8.6` → **ALL CHECKS PASS** (19 assertions; the asar stylesheet equals the
  mirror's compiled CSS `96d52b2f70c3f6fb…`).
- 2.8.6 ships **no new behaviour** over 2.8.5 — it is a fresh release-train cut from `49f7949`, deliberately
  committed _before_ packaging so HEAD is exactly what the APK and MSI were compiled from.
- Superseded on disk: APKs 2.8.1–2.8.5, MSIs 2.8.1 / 2.8.4 / 2.8.5.

**Rule that cost a rebuild (2026-10-18):** husky's pre-commit hook runs `prettier --write`, so a build made
_before_ the commit can ship a different stylesheet from the one the commit contains. Commit, then build (or
rebuild after the hook has had its say) and assert byte-identity in the verifier.

## Mobile layout — MEASURE, DON'T REASON

The 2.8.4 pass declared the header/footer fixed after reading the source. It was wrong. The 2.8.5 pass
measured the layout in a browser and found two more defects. Keep the method, not just the fixes:

- `.tmp/make-layout-harness.cjs` → `.tmp/layout-harness.html`: the **real** compiled stylesheet plus the
  shell's real class strings; it exits 1 if any copied string is no longer verbatim in
  `DashboardLayout.tsx` / `ReportViewerDashboard.tsx` / `Sheet.tsx`, so the harness cannot drift from source.
- `.tmp/make-layout-viewports.cjs` wraps it in **iframes** at 320 / 360 / 412 / 600×900 / 800×360. Iframes,
  not `resize_page`: Chrome clamps its own window to ~500 px (it refuses to _be_ a phone), and a media query
  inside an iframe evaluates against the iframe's viewport.
- Serve from the dev server so the iframes are same-origin (`file://` cross-frame access is unreliable);
  measure with chrome-devtools `evaluate_script`, toggling `--safe-area-inset-bottom` between 0 and 48 px
  (3-button nav) and the FAB on/off — the two axes the bug was device-dependent on.
- What was actually wrong: **three different left edges** (cards 16 px, hamburger glyph 18 px, tab bar 12 px —
  that ragged edge _is_ the "header and footer are offset" complaint) → one `--shell-gutter` (1rem) /
  `--shell-gutter-lg` (2rem) pair now feeds header padding, content padding, tab-bar inset and FAB inset; and
  a **`md:p-8` variant shorthand silently clobbering the base `pb-[var(--content-gutter)]`** on every viewport
  ≥768 px (a variant shorthand sorts after a base utility in Tailwind) → the scroller pads per side
  (`pt-`/`pr-`/`pl-` + a separate `pb-`) so there is no shorthand left to clobber. Also: below `fold:` the
  report table drops its Flag column and the HIGH/LOW/NORMAL chip rides under the observed value (one
  `FlagChip` component, two placements), the sheet footer's wrapping row is a 2-col grid on a phone, the FAB
  is not drawn on Overview, and the header section title always renders and truncates.
- Shell invariants a future edit must not break: `@custom-variant fold { (min-width: 600px) and
(min-height: 480px) }` (mirrored by `SHELL_RAIL_MQ`; safe on desktop because `electron/main.ts` sets
  `minHeight: 640`), the `--tab-bar-h` / `--tab-bar-gap` / `--content-gutter[-fab]` tokens that both the bar
  and the gutter read, `.shell-h` / `.page-min-h` / `.overlay-max-h`, and `#main-content { overflow-x: clip }`
  (`overflow-y: auto` alone forces `overflow-x` to `auto` and the whole page pans).
- **Trap:** a plain `height:100vh; height:100dvh` pair inside one rule is **deleted by Lightning CSS**
  (same-property dedupe) — the `vh`→`dvh` fallback must be written as `@supports`.
- Capacitor inset detail: `SystemBars.java` switches on WebView major ≥ 140 — passthrough (real `env()`
  insets) vs native decor padding (CSS gets zeros). That is why the old `pb-28` footer failed only on some
  handsets. `Keyboard.resizeOnFullScreen` was dead config (removed) because `Keyboard.java` short-circuits
  whenever SystemBars is on the classpath (it is, in core v8).

### Measured again 2026-10-19 — the current stylesheet is clean; the PHONE IS STALE

Two device screenshots (1080×2400 ⇒ 360×800dp at 3×) of Overview + the report sheet were brought in as "the
header and footer are misaligned on different devices". Every symptom in them is a **pre-`49f7949` (2.8.5)**
signature, and none of them reproduces in this tree:

- FAB drawn on **Overview** — `fabVisible` only excluded `'patients'` before 2.8.5; it now excludes
  `['patients','dashboard']`.
- **No section title** in the header, just a void between the hamburger and the tool cluster — it was
  `hidden sm:block` (640px) and is gone on a 360dp portrait phone.
- Hamburger glyph at 18px vs cards at 16px — `-ml-2`, now `-ml-2.5`.
- Report table showing a **4th Flag column clipped at the card edge**, and a sheet footer as a
  `flex flex-wrap justify-end` row hugging the right over a dead left half.

Re-measured with the harness (regenerated against `dist/assets/index-BKLgSK--.css`, class strings verified
verbatim, exit 0) at 320 / 360 / 412 / 600×900 / 800×360, with `--safe-area-inset-bottom` toggled 0 ↔ 48px and
the FAB on/off. `.tmp/serve-layout.cjs` (new, throwaway) is a dependency-free root static server on `:5199`
— Vite was not started; iframes stay same-origin without it. Results, all green:

- **One left edge at every width**: burger glyph / card / tab-bar pill all at 16px below `md:`, all at 32px at
  800×360. The ragged edge is gone.
- **Last row clears the pill by 26.6–27.0px and the FAB by 7.9–8.3px — constant across both insets and all
  five viewports**, which is the proof the token arithmetic tracks `--safe-bottom` instead of hard-coding it.
- `#main-content` `scrollWidth - clientWidth` = **0** everywhere (no sideways pan).
- Header renders "Overview" at 320px (56px wide, truncating) — no void.
- Phone table shows exactly `Parameter / Observed value / Ref. range`; the Flag `th`/`td` compute to
  `display: none` below `fold:` and the chip renders **inside the value cell** (`cellIndex` 1); at 600×900 the
  Flag column returns and the phone copy goes to zero rect. `tableRight` == `wrapRight`, `scrollWidth -
clientWidth` = 0 → nothing clipped.
- Sheet footer is a real 2-col grid on a phone (buttons span 16→344 at 360px, no dead left half); at
  `fold:` it becomes the right-aligned inline row.

Also re-verified in the platform layer (read, not inferred): `node_modules/@capacitor/android/capacitor/src/
main/java/com/getcapacitor/plugin/SystemBars.java:194` — the passthrough branch needs
`getWebViewMajorVersion() >= 140` **AND** `hasViewportCover`; otherwise the decor view is padded natively and
CSS is handed zeros (line ~233 sets the insets to `Insets.of(0,0,0,0)`). `index.html` does ship
`viewport-fit=cover` and `capacitor.config.ts` sets `insetsHandling: 'css'` + `initialViewportFitValueHint:
'cover'`, so the _only_ remaining variable is the WebView major version per handset. That line is the honest
answer to "why does it break on one phone and not another".

**So the open item is not a layout bug — it is that no 2.8.5+ build has ever run on the handset.** Install
`buildoutput/android/app-release-2.8.6.apk` over the existing app (stable key ⇒ in-place, DB kept) and
re-shoot the same two screens before touching any shell CSS again.

**Method gap found:** the harness lives under git-ignored `.tmp/`, so the measurement discipline that caught
these bugs can disappear with a clean checkout. Promoting `make-layout-harness.cjs` + `make-layout-viewports.cjs`

- the server into `scripts/` and asserting the invariants above (single left edge, clearance ≥ 0 at insets 0
  and 48, zero h-scroll, Flag column dropped below `fold:`) as a test is the durable fix.

* **Open owner decision (asked 2026-10-18, still unanswered):** the tab bar is still a _floating pill_, so content
  scrolls under it mid-scroll by design; at rest the last row now clears it. If the mid-scroll overlap is what
  reads as "broken", the change to make is a solid full-bleed bar — a design call, not a bug fix.
* **Still owed on glass:** install `app-release-2.8.6.apk` over the existing 2.8.x, then in `chrome://inspect`
  check `getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-bottom')` and
  `#main-content`. `scrollWidth > clientWidth` (must be `false`), and log `adb shell dumpsys webviewupdate`
  per handset — that version is what flips Capacitor's inset path.

## Report printing — durable rules (all shipped in 2.8.6)

- **Page units.** A section with ≥ `BIG_PANEL_ROWS = 12` rows (`report-layout.ts`, `isBigPanel()`) leads the
  report and claims its own sheet; **every** smaller section is collected onto the ONE sheet after it
  (`pageUnits()` in `report-pdf.ts` — one `autoTable` call per unit, a forced `addPage()` between units,
  nothing forced inside the smalls unit). `countPageUnits()` = `bigs + (any small ? 1 : 0)`, order-independent;
  it is what keeps the composer's "Prints as about N page(s)" honest and the fit-to-page ladder's floor correct
  (the ladder is adopted only when it _reaches_ the floor). Owner decisions, not to be re-litigated: smalls
  start on a fresh sheet and never fill the gap under a short package; the cutoff stays size-based, never
  category-name-based; overflow continues normally.
- **Pad (pre-printed artwork).** A pad is a stack of identical forms, so **every** sheet carries the masthead.
  `continuationTopMm()` returns the artwork's own `p.mTop` on the pad — never `Math.min(p.mTop,
RUNNING_HEADER_MM)` (that 12 mm clamp printed our category/panel bands over the lab's address line) and the
  plain-paper branch pays `RUNNING_HEADER_MM + SPACE.sm`. Pad continuation sheets print no running strip, no
  footer band, no row rules; plain paper keeps all three (`Page i of N` is the only thing that reveals a
  missing sheet there).
- **Empty interval prints nothing.** `formatBand()` (`pathology-tests.ts`) returns `''` for a wholly empty band
  (a Widal impression is a conclusion, not a measurement) instead of `0 – 0`; one-sided bands keep formatting.
  Exactly one catalogue entry has an empty band (`widal_impression`) — measured, not guessed.
- **Ink the owner removed:** no `REFERENCE INTERVAL NOTES` block and no `*`/`†` markers on paper (the caveat is
  still computed so the composer can surface it, and a test still fails if a band goes missing); no `(H)`/`(L)`
  letters on the pad (bold value + arrow); numeric results left-justified with the marker 1.5 mm after the text
  that ends the cell — arrow x is derived from the cell's `halign`. Category band centred, panel band
  left-justified on the pad (its left padding equals the row padding).
- **Contrast is enforced, not assumed:** `print-contrast.ts` + `print-contrast.test.ts` walk every theme's
  palette (structural greys ≥ WCAG 1.4.11's 3:1), with `PRINT_HAIRLINE_MM = 0.25` as the stroke floor.
- **Architecture:** the generator is `src/lib/report-pdf.ts` (plain serializable input → jsPDF +
  `{pageCount, printedRows, compacted, filename}` out; no DOM, no `localStorage`), extracted out of
  `ReportsPage`; `report-sample-pdf.ts` is now a thin caller of the same builder, so Settings "Preview PDF"
  shows real pagination. `ReportPreview.tsx` (the live A4 canvas) draws one sample sheet and is **not** part of
  the pagination rule — do not "fix" it. Per-cell `pageBreak: 'avoid'` does not exist in jspdf-autotable v5;
  use `rowPageBreak`. Exact-fit column widths (sum == available) are the clean config — leaving slack is what
  triggers the "units width could not fit page" console line, so do not shave widths to silence it.
- **Geometry:** `RUNNING_HEADER_MM = 12`; `PAD_LAYOUT_PRESET` = **50 / 20 / 8 / 15** (this lab prints the pad
  template at those margins — no 15/15/10 pad value exists anywhere in `src/`, ask before touching it);
  `RECOMMENDED_LAYOUT_DEFAULTS` = modern template, 14/12/12/12. `migrateSettings` maps legacy values but never
  migrates a lab off a value it set, so no printed text moves off its own artwork.
- **Verification habit:** `npx tsx scripts/dump-report-pdfs.ts` writes the 14 print-check PDFs into
  `buildoutput/print-checks/` (it fails the run if the pad 3-form case drops below 3 pages), and pdfjs probes
  under `.tmp/probes/` assert baselines and band clearance on the written bytes. Every fix this round came with
  a negative control: restore the old code, the new test must fail.

## Overview

- Product: **PathoMitra** — offline digital-pathology lab management (web + Android + Windows desktop).
  Renamed from "PathLab OS" / "Healthcare OS" on 2026-10-11.
- Repo root (where the app lives): `5-main/5-main/` — the workspace is nested at
  `5-main 01 sept/5-main/5-main`.
- `package.json` name `pathomitra`. versionCode formula = `major*1_000_000 + minor*1_000 + patch`
  (2.8.6 → 2008006), confirmed by `check-android-manifest.mjs` _and_ `aapt2 dump badging` on built APKs.
- Stack: Vite + React + TypeScript + Tailwind v4 (design tokens as CSS custom properties); Capacitor 8 for
  Android; Electron 44 for the Windows shell. **No Firebase** — auth is a local account
  (`lib/local-account.ts`, `lib/password.ts`), data is on-device (SQLCipher / localStorage). A Firestore-shaped
  shim (`data/fs.ts` → SQLite) keeps call-site names like `handleFirestoreError` (`lib/firestore-errors.ts`)
  and `useCollectionList` alive — those are local, not network.
- Deployment: GitHub Actions → Cloudflare Pages (web); Play Store (Android — still blocked, see Next);
  Windows is a **direct-download MSI** (Store submission not started, plan in `docs/store/ms-store/`).
- Cloudflare tooling: `cf` CLI at `%APPDATA%\npm\cf`, authenticated as the owner's account
  (`a4a4379ad70efdcee4f86fc16b6443f9`), short-lived token — re-run `cf auth login` on expiry. The project has
  **no** Wrangler config file; Pages deploys are driven by `.github/workflows/deploy.yml` +
  `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`. Prefer `cf` for Cloudflare API work.
- **🚦 Owner gate (2026-10-16, still in force): do NOT push/redeploy to Cloudflare Pages automatically.**
  Local edits and `npm run build` are fine; stop before any `wrangler pages deploy` and wait for the owner to
  say "deploy".
- **Owner boundary (2026-10-16):** the same Cloudflare account holds OLD, SEPARATE projects — Pages
  `healthcare-os` + `naitik`, Workers `healthcarediagnosticscenter` / `green-scene-82e0` / `holy-art-ce3d`.
  **Do not inspect, rename, redeploy or clean them up.** Read-only context, not a to-do list.

## Long-lived architecture & decisions

### Rebrand → PathoMitra: deliberate non-renames (load-bearing)

Internal identifiers, not the product name — changing any of them makes existing data look deleted:
`DB_NAME = 'pathlab'` (the SQLCipher file), `PREFIX = 'pathlab:'` (localStorage), `PREFIX = 'pathlab_'`
(secure store, holds the unlock credential), `'pathologyos_settings'`, `'custom_pathology_tests'`,
`'pathlab_crash_log_v1'`, and `android/keystore.properties` (`pathlab-release.jks`, alias `pathlab-release`).
The signing-cert subject still reads `O=PathLab OS` (baked into the keystore; only a new key changes it).

Data carried across the rename: the export dir is `PathoMitra/` but `res/xml/file_paths.xml` keeps `legacy_*`
entries for `PathLab OS/`, `lib/backup.ts` reads/shares/deletes from **both** (`backupPathFor`), and
`BackupFileSchema.app` accepts `'PathoMitra' | 'PathLab OS'` so pre-rebrand snapshots still restore. Because
`applicationId` is `com.pathomitra.app`, PathoMitra installs as a _separate app_ beside old PathLab OS and
starts with an empty encrypted DB: migrate = backup in the old app → restore in PathoMitra. Uninstalling the
old app first destroys its only DB copy.

### Version & Android artifacts

- `android/app/build.gradle` reads version from `package.json` (`versionName = pkgJson.version`, versionCode by
  the formula); the APK name is injected by Gradle as `app-<buildType>-<versionName>.apk`.
- `assembleRelease` **replaces** the release output dir (does not accumulate); the manual copies in
  `buildoutput/android/` accumulate and are pruned by hand.
- Signing is driven by `android/keystore.properties` (git-ignored) or `KEYSTORE_*` env vars. Absent, the build
  still "succeeds", warns `no release keystore configured`, and produces an **unsigned, uninstallable** APK.
- **Signing key, stable 2.1.2 → 2.8.6:** `CN=Naitik Raj, O=PathLab OS, C=IN`, cert SHA-256
  `1550d59f334006410cc73be86af8fc7912d33449e554add5f2d430db09587a4d`. Same key ⇒ a new versionCode updates an
  installed app in place and keeps the lab database.
- Gradle runs on **Temurin 21.0.12.1** at `C:\Users\naiti\.gradle\jdks\eclipse_adoptium-21-amd64-windows.2`
  (what AGP 8.13 was proven against). `C:\Program Files\Java\jdk-21` no longer exists and machine-wide
  `JAVA_HOME` points at Android Studio's JBR (OpenJDK 25) — set `JAVA_HOME` explicitly for Gradle.

### Common commands

| Purpose                                         | Command                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Web build                                       | `npm run build`                                                                                             |
| Quality gate                                    | `npm run verify` (`lint:ci` + `test:coverage` + `build`)                                                    |
| Typecheck / lint                                | `npm run typecheck` · `npm run lint` · `npm run lint:ci` (`tsc --noEmit && eslint . --max-warnings=23`)     |
| Android release chain                           | `npm run verify:android` (`sync:android` → `android:aab` → `check:android`)                                 |
| Android **test** build (placeholders)           | `npm run android:test-build`                                                                                |
| Sync web → native assets                        | `npm run sync:android` (or `sync:android:test`)                                                             |
| APK / AAB directly                              | `npm run android:apk` · `npm run android:aab`                                                               |
| Manifest gate                                   | `npm run check:android`                                                                                     |
| Desktop renderer / main bundle / dev            | `npm run desktop:build-renderer` · `desktop:bundle-main` · `desktop:dev`                                    |
| Desktop MSI (the working target)                | `npm run desktop:msi` · `desktop:msi:test`                                                                  |
| Desktop package gate (reads the built artifact) | `npm run desktop:check-package` → `scripts/check-desktop-package.mjs`                                       |
| Desktop MSIX                                    | `npm run desktop:msix` — **fails on electron-builder 26.x** (`Unknown target: msix`); `appx` is implemented |
| Privacy static site                             | `npm run build:privacy`                                                                                     |
| Version release                                 | `npm run release` (standard-version)                                                                        |

`build:android` prerequisites: `check-release-config.mjs` + `VITE_TARGET=native` + `check-native-assets.mjs`.
Test-build variants pass `--allow-placeholder` + `PATHOMITRA_ALLOW_PLACEHOLDER_ASSETS=1` and print a
"TEST BUILD — NOT FOR SUBMISSION" banner; the release path still refuses placeholders.

### Git state (verified 2026-10-18)

- `main` @ `796f056` (2.8.6), **ahead 1 of `pathomitra/main` (`49f7949`)**; the only other working-tree changes
  are `PROJECT_MEMORY.md` and the untracked `docs/history/` archive. Remotes: `pathomitra` →
  https://github.com/pixelnaitik/PathoMitra.git (the real
  one); `origin` → https://github.com/pixelnaitik/5.git (**unrelated** — never push PathoMitra work there).
  `fresh-main` (Android-track branch) shows an `[ahead/behind]` against `origin/android`; it is noise.
- Push convention: `git push pathomitra <branch>:main`, judged by `git ls-remote`, never by PowerShell exit
  code. Identity: `pixelnaitik` / `pixelnaitik@users.noreply.github.com`.
- **⚠ Correction to what this file asserted until 2026-10-18:** `PROJECT_MEMORY.md` and
  `promotion_website/STORE-READINESS-REPORT.md` are **tracked** (committed since `23fabeb`, so their content is
  already on `pathomitra/main`) — not "untracked, never push". Treat anything written here as visible to that
  repo: ask the owner before adding new sensitive material (signing detail, rejection-risk scores), and keep
  owner-only notes in a file that is genuinely untracked.
- **0 tags exist** for any 2.6.x / 2.7.x / 2.8.x release — provenance is owed before any store submission.

### Notifications — banners only (verified 2026-10-12)

**Email / SMS / WhatsApp alert delivery was REMOVED on 2026-10-11** at the lab's request: a `mailto:` / `sms:`
/ `wa.me` hand-off puts alert text that can name a patient into a third-party app. Do not re-add those
channels. `NotificationPrefs.channels` has only `desktop`; `sanitizeNotificationPrefs` whitelists channel keys
so an older stored document cannot resurrect a button. Delivery seam: `src/lib/desktop-notifications.ts` picks
a backend at runtime — `native` → `@capacitor/local-notifications`, `service-worker` →
`showNotification()` (the only way Android Chrome accepts a banner), `page` → `new Notification()`. The plugin
is imported lazily; a failed banner returns `false`, never rejects. Alerts are **operational only** (overdue /
draft / amended / due), never clinical, and nothing auto-sends; `due` alerts report the **balance**, not the
gross, and link to `{ tab: 'bills' }`. Both channels are created `importance: 4, visibility: 0`, and the
banner carries a `bannerTitle`/`bannerBody` that is name-free (`notification-engine.ts`); non-native paths route
through `safeBannerFor()` because Chromium exposes no lock-screen control. `AndroidManifest.xml` declares
`POST_NOTIFICATIONS` and removes `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` / `RECEIVE_BOOT_COMPLETED` (with
the plugin's restore receiver) via `tools:node="remove"`; `check-android-manifest.mjs` keeps them forbidden.

### Desktop print + PDF (Electron)

Owner report was "Print opens the PDF app instead of the app's print dialog". The causes were environment
facts, not bugs: this PC's default printer is `Adobe PDF`, and `.pdf` is owned by `Acrobat.Document.DC`;
**Electron has no `shell.printFile()`** (only the shell `Print` verb), and `MSEdgePDF` registers no `Print`
verb at all (the app now says so instead of quietly opening a viewer).

- `electron/print.ts` `printPdfFile()` raises a window-modal native task dialog (Print now / Choose printer… /
  Open in PDF viewer / Cancel). **No `-ExecutionPolicy` flag** in the spawned powershell (a GPO-pinned domain
  policy fails `Bypass`).
- **In-app print dialog** (`src/components/PrintDialog.tsx`, shipped 2.6.4): printer picker, live preview, page
  range, copies, collation, orientation, scaling. Durable split: `print-model.ts` (pure range/scale/geometry),
  `pdf-preview.ts` (pdf.js loader + raster), `electron/print-window.ts` (printer list + hidden-window spool);
  IPC `pm:print:printers` / `pm:print:job` (malformed payloads return `{ok:false}`, never throw). The old
  `pm:print:pdf` leg is deleted.
- `pdfjs-dist@6.4.299` sits behind a dynamic import on the desktop branch only (own lazy chunk, never fetched
  on web/Android). v6 API: `page.render({canvas, canvasContext, viewport})`; `getDocument()` returns the task
  that owns `destroy()`; `isEvalSupported` is no longer a valid init key.
- Print path: rasterise the _selected_ pages at ~300 dpi → temp HTML → hidden `BrowserWindow` →
  `webContents.print({silent: true, printBackground: true, …, margins: 'none'})`. `pageRanges` is deliberately
  not sent (the document already holds only the chosen pages; Electron's `PageRanges` is 0-based, UI 1-based).
  Staging lives under `userData\Print\<uuid>.html` (`0o600`, swept per job), **not** `%TEMP%`; oversized jobs
  are refused before rasterising (`MAX_PRINT_PAGES`).
- Orientation is decided once: the raster carries the rotation and the CSS `@page` box is the sheet; `landscape`
  is not passed to `print()` because Blink lets `@page size` override it. **This is the one path never verified
  on paper** — this PC has no physical printer.

### Desktop (Electron) — track status

Windows is a **direct-download MSI** (owner decision; MSIX is backlogged). Boot path is proven only from a
**non-OneDrive** mirror.

- `electron/`: `main.ts` (window, custom privileged scheme `pathomitra://app` serving `dist/` with SPA fallback
  — what makes BrowserRouter + WebCrypto work where `file://` does not; runtime network-block; single instance;
  CSP set in both `protocol.handle` and `onHeadersReceived`; `Menu.setApplicationMenu(null)` + `devTools` off
  when packaged; `render-process-gone` / `did-fail-load` / `child-process-gone` / `uncaughtException` /
  `unhandledRejection` recovery), `preload.ts` (sandboxed CJS → `window.pathomitraDesktop`), `ipc.ts`
  (allow-listed channels, `event.senderFrame` checked, path-traversal-guarded), `db.ts` (SQLCipher via
  `better-sqlite3-multiple-ciphers`, `pathlab.db` under userData), `keyring.ts` (`@napi-rs/keyring` v2 —
  **no `PasswordManager`**; synchronous `Entry(service, username)`), `print.ts` + `print-window.ts`.
- Renderer seam: `src/lib/desktop-bridge.ts`, `getShellKind()` / `hasShellOutput()` in `native-files.ts`,
  `src/data/desktopRepository.ts` (same `applyQuery`/`makeDoc` semantics as WebRepository, one JSON row per
  collection), `src/data/index.ts` three-way choice + `isShell` boot gate (desktop lands on the auth console,
  no landing page, no service worker).
- **Renderer credential allowlist (roadmap P0, shipped `835aa16`):** the renderer may only name `pathlab_*`
  accounts (`src/lib/renderer-credentials.ts`); `db-key` is main-only, enforced by `assertRendererAccount` in
  **all three** keyring IPC handlers.
- **Atomic desktop transaction (P0.4/P0.5):** `electron/db.ts` `saveEntitiesBulk()` runs a batch inside one
  `db.transaction`; `pm:db:commit` → `bridge.db.commit`; `DesktopRepository.transaction()` buffers writes,
  joins nested transactions, flushes with ONE commit and promotes cache only on success.
- Both native deps ship Node-API `prebuilds/win32-x64.node` and are loaded as-is by Electron 44 —
  `@electron/rebuild` is **not** needed at load time (it may still run during packaging).
- Session lock: backgrounding starts the same inactivity countdown the lab set (`autoLockSeconds` = 300),
  elapsed time measured against the wall clock on return (Android freezes JS timers when suspended); desktop
  skips the visibilitychange trigger. Still owed: `powerMonitor` re-lock (audit `A-2`), Windows Hello
  (`biometric.ts`), an Android↔Windows backup round-trip.
- **Known gap:** the **APK ships with no CSP** (`assets/public/index.html` has no `<meta http-equiv>`, and
  Capacitor's `WebViewLocalServer` attaches its CSP header only to the remote-proxy path). Defence-in-depth
  only — no `INTERNET` permission and 0 XSS sinks by test. Any change needs a device check first.
- `MSIX identityName` must match the Partner Center reservation before a Store submission is attempted.

### Custom app logo / branding (verified 2026-10-12)

The microscope stays the **default fallback + logged-in Overview home mark**; an uploaded logo replaces it
everywhere else (splash, sign-in tile, non-home dashboard tabs, marketing header, browser tab icon).
Storage is `LabSettings.brandLogoUrl` (inline `data:image/...`, `''` = default) in `src/lib/settings.ts`, with
`isBrandLogoDataUrl()` + `BRAND_LOGO_MAX_CHARS = 2_000_000` and a fail-closed `migrateSettings`; it rides
localStorage into encrypted backups for free. `src/lib/brand-logo.ts` has `processLogoFile()` (≤5 MB input,
raster downscaled to 512 px → PNG with a WebP retry; SVG stored as-is behind a script/`on*=`/`href` screen),
`useBrandLogo()`, `readBrandLogo()`, `applyBrandFavicon()`; `BrandLogo.tsx` renders the custom image or lucide
`Microscope`. Upload UI: Settings → **Lab Organization** → "App logo".
⚠ `index.html`'s pre-JS splash swaps `#splash-logo` from the stored data URL with a **vanilla mirror of the
acceptance rule** — if the rule changes, both sides must move.
favicon: `favicon_io/` (repo root, owner-generated) is canonical; the favicon set + `android-chrome-*` are
copied into `public/`; `favicon_io/site.webmanifest` is NOT copied (stub, conflicts with `public/manifest.json`);
no SVG favicons (owner). All 512 art is one file (`public/brand-p.png` == `android-chrome-512x512.png` ==
`desktop-resources/icon.png`), which also feeds `scripts/make-msix-assets.ps1` and the Android launcher layers.
`public/brand-p.png` is load-bearing (splash default + `DEFAULT_BRAND_LOGO_SRC`) — keep. Native launcher icon
and the Capacitor boot frame are baked static assets: a runtime logo cannot change the home-screen icon.

### Auth console redesign — photo backdrop (verified 2026-10-12)

`src/pages/auth/AuthPage.tsx` `Shell` = responsive split: full-bleed photo + theme-aware veil (the `dark:`
variant tracks `[data-theme="dark"]`), a frosted `AuthHeader`, a `FeaturePanel`, and the form card; below `lg`
the panel drops and the card centres. `CreateAccountForm` and `UnlockForm` both reuse `Shell`. Asset
`public/auth-lab-bg.jpg` is the 2.12 MB source PNG re-encoded to an **86.7 KB JPEG**, referenced
root-absolute so it resolves on web, on `pathomitra://app`, and in the APK (not in `WEB_ONLY_ASSETS`, so it
ships in all three builds). On phone (`isNative`) the headline / description / feature rows are **not** rendered.
Copy note: the headline is "Your lab. / **Offline and encrypted.**" and the row reads "Encrypted at rest, on
the device that runs your lab." — the earlier "Securely connected." / "safe and compliant" claims were removed
(10.1.1 / Play over-claim) and `AuthPage.tsx` is now in `marketing-claims.test.ts`'s scanned list. Do not
re-introduce a connectivity or compliance claim there.

### Pathology catalogue & reference ranges (verified 2026-10-11)

- **Population model = three bands:** Adult male (≥12 y), Adult female (≥12 y), Infant (0–24 mo). The old
  `child` band is deleted; `general` is the _absence of a sex/age split_, not a fourth band. Boundaries
  `ADULT_MIN_AGE_YEARS = 12`, `INFANT_MAX_AGE_YEARS = 2`.
- `resolveReferenceRange(ranges, age, gender)` (`src/lib/pathology-tests.ts`) is the single source of truth for
  editor, A4 preview, jsPDF and `resolveValueStatus`; returns `{ kind, label, values, unverifiedForPatient, reason }`.
- **2–11 y has no band by design:** the adult interval is shown and the resolver flags
  `unverifiedForPatient: true`, but **the lab deleted every rendering of that flag on 2026-10-11** (a 2-year-old's
  CBC printed ~20 caveat lines and pushed the signature to page 2). Only **2** bands still carry
  `verification: 'requires-lab-verification'` — the "72 bands" figure in older notes is stale. Reinstating the
  caveat is one render site (one line per report, not per parameter) and needs lab sign-off.
- Patient age is stored in **whole years** (`PatientSchema.age`), so `age < 2` is the closest representable
  0–24 mo; month-unit / DOB is the known follow-up.
- Catalogue: **165 entries** (140 tests, 20 profiles, 5 headers), counted from
  `DEFAULT_PATHOLOGY_TESTS` on 2026-10-18. `auditPathologyCatalogue()` reports duplicates
  and unknown profile members; two findings are **deliberately unfixed** pending lab sign-off because both change
  historical report rendering: `Albumin` exists as both a serum (LFT) and a urine record name (`findTestInfo`
  returns the first → the LFT row loses its numeric range, and the price list inherits the collision — one shared
  price entry), and `HEMOTOLOGY` (21 records, incl. Hbs Ag / Anti HCV / V.D.R.L / E.S.R.) vs `HAEMATOLOGY` (32).
  **Do not "fix the typo"** — that would file hepatitis-B and syphilis serology under Haematology; it is the lab
  director's taxonomy call.

### Report compliance copy (load-bearing decision)

`src/lib/report-compliance.ts` `buildReportLegalLines` returns `signer: ''` and `disclaimer: ''`: the
"Electronically signed by …" line and the "For use by qualified healthcare professionals …" disclaimer are
**OFF every report surface** (renderers `.filter(Boolean)` them away; verified absent from APK + MSI bundles),
and `report-compliance.test.ts` asserts they are absent. The constants are kept for a one-place reinstatement,
which is a **lab-director gate** (Store 11.3.2 / "risk of harm"). Related honesty work: "Finalize & Sign" →
**"Issue report"**, status from `src/lib/report-status.ts` (Draft / Issued / Amended), the always-"Unsigned"
column and "Secured" shield deleted, and `report-status.test.ts` asserts "signed" never appears in a visible
string.

### Google Play readiness (ledgers in `docs/store/play/`)

Offline, no `INTERNET`, no dangerous permission, on-device SQLCipher. Submission is blocked on paperwork and a
device run, not on code: the hosted policy is stale (see Next), **no AAB exists for 2.8.6** (Play requires an
AAB; `verify:android` was never run this round), `FLAG_SECURE` is default-on so **Play pre-launch screenshots
and a reviewer's captures come out black** (turn it off for the capture session), reviewers must be given
working test credentials (there is no seeded demo account by design — the Console note must walk onboarding
inside the 5-min re-lock window), targetSdk 36 is already satisfied (required since 2026-08-31), and a personal
developer account created after 2023-11-13 cannot reach Production without a closed test with ≥12 testers
opted in for ≥14 days plus approved production access. The **Data Safety** answers in `docs/store/play/` were
corrected 2026-10-18: Play defines collection as _accessing or storing_, so "no data collected" was wrong —
collected **Yes** / shared **No** / encrypted in transit **No** (there is no N/A) / at rest **Yes** / deletion
in-app **Yes**; and the mandatory **Health apps declaration** form (Medical → Healthcare Services and
Management, explicitly _not_ Medical Device Apps) is required and must be filled.

### promotion_website — standalone static brochure

`promotion_website/` (created 2026-10-13) is a standalone static copy of the marketing site (landing +
technology + solutions + privacy + **download**) with all auth removed.

- **No `node_modules`** — deps resolve by Node's upward walk into the parent tree. **Do NOT run `npm install`
  there** (its `package.json` declares no deps on purpose; an install would shadow the parent with an empty
  tree). Build: `npx vite build`; dev: `npx --no-install vite --port 5199`. Root `build`/`typecheck`/`lint`
  ignore it (root tsconfig `exclude` + `eslint.config.js` ignores).
- Routing is **BrowserRouter** (clean `/technology`, `/privacy`, `/solutions`, `/download`) since 2026-10-16;
  deep links resolve because `public/_redirects` ships `/* /index.html 200`, and `/privacy` is mapped to the
  generated static `privacy.html` **above** that fallback (Pages is first-match-top-down). In-page jumps use
  `lib/scroll.ts`. `PRIVACY_POLICY_URL = https://pathomitra.pages.dev/privacy`.
- Contact email is hardcoded in **three** places (`src/lib/contact.ts`, `src/lib/privacy-policy.ts`
  `PRIVACY_CONTACT_EMAIL`, `src/components/Footer.tsx`) → `pathomitra@healthcarediagnosticscenter.in`.
  Topology (owner-confirmed): `pathomitra.pages.dev` is the **main site**; `healthcarediagnosticscenter.in` is
  **mail routing only** — do not set the policy/host to it. Mailbox delivery depends on an Email Routing
  destination verified in the CF dashboard (not checkable from this machine).
- It is a **hand-maintained fork** of `src/components/{Header,Hero,Features,HowItWorks,Trust,CTA,Footer}.tsx`;
  any change to the app's marketing components must be re-copied by hand. Colour mode follows
  `prefers-color-scheme` only there.
- `src/lib/downloads.ts` holds `DOWNLOAD_URLS = { android: null, windows: null }` → both store badges link to
  the internal `/download` status page. **No public download URL exists for either platform; do not hardcode
  store links** — fill `DOWNLOAD_URLS` when a channel goes live (a versioned HTTPS MSI URL is also what Store
  policy 10.2.9 requires).
- ⚠ **Name collision:** `.github/workflows/deploy.yml` runs `wrangler pages deploy dist
--project-name=pathomitra` for the **app** web bundle, so the next CI push would overwrite the brochure at
  that URL. Give one of them its own project before the next `deploy.yml` run.
- ⚠ `wrangler pages project create` without `--force` mis-reads this folder as Hydrogen (no lockfile) and
  deploys nothing — create the project with `--force`.
- Canonical store-readiness notes: `promotion_website/STORE-READINESS-REPORT.md`. Two owner decisions from it
  (2026-10-14): domain + mailbox deferred ("I will add it later"); Windows = **direct download only**. Its §6
  MS framing was corrected — the Store _does_ accept a signed `.msi`/`.exe` behind a versioned URL (policy
  10.2.9) and `.appx` containers; re-check that file before filling anything from it.

### Billing + doctor referrals (committed `ad013bc`, first shipped 2.7.0)

Modules: `price-list.ts` (one document, `meta/price-list`; `localStorage pathologyos_price_list` is a mirror
for synchronous readers only — the encrypted doc is authority, `loadPriceList()` runs at bootstrap and after
every restore; `BillingPrefs` in `meta/billing-prefs`; `PRICE_LIST_UPDATED_EVENT` keeps screens in step),
`invoices.ts` (`buildInvoiceDraft` / `raiseInvoice` / `recordPayment` / `voidInvoice` / `deleteInvoice` /
`summarise` / `balanceOf`; **the document id IS the bill number**), `invoice-registry.ts` (`IN`+`YYMM`+4-digit
seq, cloned from `patient-registry.ts`: meta counter doc + 100-step probe + throws rather than overwriting),
`invoice-pdf.ts` (invoice, statement, statements summary, price list — one file for all four; audit `F-4`
"single PDF pipeline" is still open), `referrals.ts`, `ManageTestsPanel.tsx`, `BillsPage.tsx`.

Rules the code enforces (each was a real trap — keep them): 0. **A package is ONE billable thing.** `panelOwnedMemberNames()` + `billableTests()` define the priced-unit
set (`billableTests(DEFAULT_PATHOLOGY_TESTS)` = **104 of the 165 rows**, measured 2026-10-18); `billLinesFrom` emits one line for an
unpriced package (flagged `unpriced: true`, members absorbed). Members of a package with
`hideMembersFromBrowse: false` stay individually priced.

1. **Panel double-count guard:** `PatientsPage.addTest` stores the panel _and_ all its members, so pricing the
   list naively bills a CBC plus ~20 components. Headers never bill; the same test twice → one line with qty.
2. **A bill renders from its own `items[]`, never from the live price list** (two tests pin that a later tariff
   edit leaves a stored bill unchanged).
3. **Commission is stamped at bill time** (the `InvoiceReferralSchema.percent` copy) on **`taxableBase`**
   (post-discount, pre-tax) — editing a doctor's % must never restate a past month's payout.
4. Totals are always recomputed by `toInvoiceDoc` from the lines; no call site can put a number on a bill its
   lines don't add up to (`amount === taxableBase + tax`, `discount ≤ subtotal`).
5. **`isInvoiceOutstanding()` is the only correct status test** (`'partial'` exists; the old
   `status !== 'pending'` check would have silently stopped alerting on part-paid bills).
6. Unpriced ⇒ `unpriced: true`, printed as `not priced`, never a silent ₹0.
7. Schema (`models.ts`, backward compatible): `InvoiceStatusSchema = pending | partial | paid | void`;
   `DoctorSchema.referralPercent` **defaults 0 (opt-in)**; patients store `doctorName` (not an id), so referral
   grouping uses `doctorNameKey()` — with a pinned rule that a degree suffix keeps two records distinct
   (`DR N KUMAR` ≠ `DR N KUMAR MBBS`).
8. Dues (2.8.4+): `PatientSchema.dueAmount/dueNote/dueUpdatedAt/dueRecordedBy` are written only through
   `toPatientDueDoc`, which **requires a typed 10-digit phone agreeing with the record** (two patients can share
   a name); the due is seeded from the unpaid-bill balance, editable, 0 clears it; shown as a chip, filterable
   via "With dues (N)", and exported in the patients CSV. `planMissingBills()` / `generateMissingBills()` run
   sequentially through the ordinary `raiseInvoice` (so commission is stamped and no two bills race onto one
   number) and are idempotent — a second run attempts 0.

Deliberate limitations (not bugs): bills print `Rs.` not `₹` (jsPDF's WinAnsi fonts lack U+20B9 — open audit
`F-1`; `pdfMoney()` is the one-line change point once a font is embedded, and Devanagari names are the same
casualty); prices are keyed on the folded test name (hence the shared `Albumin` entry); built-in tests are
editable in price / availability / note only; no commission line ever appears on a patient's bill; ReportsPage
has no bill action (`raiseInvoiceForReport()` exists for it).

## Decisions & Pitfalls

- **A gate constant is a factual claim — check it against the artifact before believing it, and before
  "fixing" the build to chase it.** `check-desktop-package.mjs` asserted `win-unpacked ≤ 300 MB` while
  Electron 44.7.0's own win32-x64 binaries are **319.3 MB**: no amount of pruning could satisfy it. The budget
  now sits on `resources/` (13.0 MB measured vs a 40 MB bar), the installer bar is 150 MB with both measured
  points recorded in the file, and the `app.asar ≤ 45 MB` bar (which the 206 MB regression really did violate)
  was kept. _Loosening a bar needs a measurement and a written reason in the same file._
- **Measure what the main bundle actually resolves before shipping `node_modules`.**
  `dist-electron/main.js` needs only `electron`, `node:*`, `better-sqlite3-multiple-ciphers`,
  `@napi-rs/keyring` (`preload.cjs` needs only `electron`); every renderer dep is already bundled into `/dist`.
  The pruning took asar 74.7 → 8.7 MB (11 809 → 354 files), win-unpacked 459.7 → 380.6 MB, MSI 171 → 124.9 MB.
  Verify with a specifier walk of the **built bundle**, then re-verify by **booting
  `win-unpacked\PathoMitra.exe`** and confirming the encrypted DB opens (`pathlab.db` locked, `-shm`/`-wal`
  written, header ≠ `SQLite format 3`).
- **Boot testing the packaged app is the cheap half of desktop verification.** Run
  `release-desktop\win-unpacked\PathoMitra.exe` straight from the mirror — no install, no admin, no
  SmartScreen — `Start-Process`, wait ~20 s, assert process count + `MainWindowTitle`, read
  `%APPDATA%\PathoMitra`, then `CloseMainWindow`. It writes only normal first-run state.
- **A DPI-unaware PowerShell host lies about window geometry, and the lie looks like a layout bug.** At
  1920×1200/150 % an unaware `GetWindowRect` + `PrintWindow` returned "1280×752" and a clipped bitmap that read
  as "the auth card overflows the viewport". Call `SetProcessDPIAware()` first (`.tmp/capture-packaged-dpi.ps1`
  does) and never report a clipped-render defect from an unaware capture.
- **Seed a fresh packaging mirror from the previous local mirror** (local→local robocopy is ~6 min faster than
  OneDrive→local), then overlay the current source excluding `node_modules`. Valid only while
  `package-lock.json` is unmodified — compare the lock graphs first, and spot-check
  `node_modules\electron\dist\electron.exe` after.
- **Never run desktop builds from the OneDrive tree.** Files-On-Demand dehydrates the Chromium bundle, so
  `electron.exe` dies with `STATUS_BREAKPOINT` (zero output, even `--version`) from any OneDrive path; the same
  binary runs fine from `C:\pm-msi-<ver>`. Use a throwaway mirror, never a shared dir (concurrent sessions
  collide). (An earlier "Smart App Control" diagnosis was wrong — SAC was toggled off during the hunt; harmless.)
- **`robocopy /XD dist` silently guts the packaging mirror** — `/XD` matches by NAME at every depth, so it also
  drops `node_modules/electron/dist`, every package's own `dist/` and `vite/dist`, while still reporting
  `0 FAILED`. Use the documented exclusion list only:
  `/XD .git .tmp .tmp-build .build-tmp coverage buildoutput release-desktop android`.
- **A command flagged risky runs in a workspace-rooted sandbox that silently denies writes to `C:\pm-msi-*`.**
  Re-run with `required_permissions=all`; don't trust `-ErrorAction SilentlyContinue` there — it hides exactly
  this.
- **Sandboxed builds fail on esbuild temp cleanup.** Point TEMP **inside the repo with an absolute path**
  (`$env:TEMP=$PWD.Path+"\.tmp"`, same for TMP/TMPDIR); a relative `..\.tmp` breaks the Gradle daemon. `.tmp` /
  `.tmp-build` are git-ignored and in `eslint.config.js` ignores (without that, eslint lints an unpacked
  app-builder-lib and reports fake errors).
- **⚠ but do NOT point TEMP into the repo when packaging.** electron-builder puts its tool cache under `%TEMP%`,
  and `icons@1.1.0/icon-tool.js` then sits under the workspace `package.json` (`"type": "module"`) and fails
  `require is not defined in ES module scope`. Keep the builder cache outside any package scope:
  **`ELECTRON_BUILDER_CACHE=C:\pm-cache\eb`**.
- **electron-builder 26.x has NO `msix` target.** 26.15.3/26.17.0 know only `squirrel`, `appx`, `msi`,
  `msiwrapped` (+ nsis/portable); `Unknown target: msix` is why `desktop:msix` fails locally and why the orphan
  `release-desktop/win-unpacked.tmp/` exists. `app-builder-lib@27.x` ships `MsixTarget`; `createMsixupload` /
  `enforcePackageIntegrity` / `setBuildNumber` are silently-ignored keys on 26.x. **MSI is the working
  one-click path** (`perMachine: true` → Program Files / all users / one UAC; the desktop shortcut is guaranteed
  by `MsiTarget.js` `Advertise` + `DISABLEADVTSHORTCUTS=1`; `AllowSameVersionUpgrades="yes"`). Note 26.15.3 has
  no `win.signDlls` — use `win.signExts: ['.dll', '.node']`; unknown keys are ignored silently.
- **`npm` 11 allowScripts blocks install-scripts by policy** — the Electron binary did not download with plain
  `npm i`. `npm install-scripts approve electron esbuild core-js electron-winstaller` then
  `node node_modules/electron/install.js` (`ELECTRON_MIRROR` honored). Bumping Electron means bumping the
  `allowScripts` pin in `package.json` too, or the postinstall is blocked.
- **PowerShell treats git/npm stderr progress as an error** — `git push` succeeded yet returned ExitCode 1 with
  red text. Judge success by re-verifying (`git ls-remote`, `aapt2`, `apksigner`), never by exit code alone.
  `apksigner.bat` prints a JVM "restricted method" warning even on success; `desktop:bundle-main` prints a
  `NativeCommandError` because esbuild writes progress to stderr. Also: no `head` (use
  `Select-Object -First N`), and separate statements with `;`, never `&&`.
- **Never round-trip file contents through PowerShell text pipes in this repo.** PS 5.1
  `Get-Content -Raw | Set-Content -Encoding utf8` decodes UTF-8 as CP1252 → mojibake + BOM + CRLF. Use the edit
  tool or Node `fs`. (`.gitattributes` pins the repo to LF — `* text=auto eol=lf` — so a tool that writes CRLF is
  fighting the checkout convention. This file has also been rewritten concurrently by another process, which
  silently dropped an earlier write-back.)
- **A "before" snapshot must be read from the store, never from edited state.** `planReportWrite(existing,
next)` is a pure gate — only as honest as the `existing` handed to it. `ReportsPage` passed the object the
  editor mutates, so `isReportContentChanged` was false, the write returned `{ok:true, ops:[]}`, the sheet
  closed with a success toast, and **nothing was stored** (fixed 2.7.2, `dd0bf88`, AM-1). Reusable rule: when a
  domain gate decides whether to keep history based on a diff, the "before" comes from the persisted record. A
  unit test of the pure gate cannot catch this — only driving the real screen and reading storage afterwards did.
- **SQLCipher `transaction()` cannot nest on Android — join, never re-BEGIN.** `SqliteRepository.enqueue()`
  skips the mutation queue for any caller arriving while `inTransaction` is set, so a second `transaction()`
  used to call `conn.beginTransaction()` inside an open one; `Database.java` threw
  `Failed in beginTransactionAlready in transaction`, its rollback ended the _first_ transaction, and the
  report being written was discarded. Since 2.7.1 (`0cf62bc`): `transaction()` **joins** an open transaction,
  `startNativeTransaction()` rolls back a transaction left open by an earlier run and retries BEGIN once, and
  `ReportsPage` keeps one report write in flight. Consequence to keep in mind: a concurrent writer is folded
  into the open transaction and commits or rolls back with it — that is the one-connection contract, not a bug
  to fix by re-adding a second BEGIN.
- **…part 2: the writes themselves re-BEGIN (fixed 2026-10-17).** `SQLiteDBConnection.run(sql, values,
transaction = true)` defaults to `true`, so `Database.java` wrapped _every_ write in its own BEGIN/COMMIT and
  the FIRST write inside a `transaction()` body aborted the outer one — **every** report issue and every
  delete-cascade was dead, not just double-taps. Fix: pass `transaction = false` in `applySet`, `delete`,
  `clearAll` (one statement is atomic in autocommit; multi-statement atomicity is `transaction()`'s job). Also
  fixed a latent `VACUUM`-inside-a-transaction failure in `clearAll`. The regression fake now rejects a
  `transaction=true` run while active — that is what turns the existing batch test into a real guard.
  `desktopRepository` is unaffected (it buffers and issues ONE commit).
- **`res/xml/config.xml` is toolchain-owned** — `npx cap sync android` regenerates `<access origin="*"/>`, so
  hand-edits don't survive. `check-android-manifest.mjs` reports it as a warning; the hard assertion (no
  `INTERNET`) does the enforcing. Do not hand-edit it.
- **`DeleteFile` reported success on `buildoutput/android/*.apk` and did NOT delete them** — superseded
  artifacts are a human cleanup step. Likewise trust a `SearchReplace`/`Write` result only after reading the
  file back.
- **`expandTestSelection()` feeds four call sites** (Analytics "Total Tests", the composer's blank count,
  `useNotifications` overdue, the bill "covers N" label). It once counted catalogue section headings as tests, so
  Analytics said 27 where the report's own details sheet said 25. Any change must be checked against all four;
  the overdue comparison is symmetric so it was unaffected.
- **Guard tests that read source text break on formatting.** `bill-print-layout.test.ts` asserted tight regexes
  against the _source_ of `invoice-pdf.ts`, and the project's own Prettier pass reflowed the matched call. The
  assertions are whitespace-tolerant now. Any source-text guard must assume Prettier can reformat the line it
  reads. `marketing-claims.test.ts` strips `/* */` but **not** `//` comments — a `//` comment quoting a banned
  word fails the build, so write such explanations as block comments.
- **eslint config has NO type-aware rules** — don't add `@typescript-eslint/*` disables blindly (they become
  dead directives). The lint gate is `--max-warnings=23` on a 22-warning baseline; the ratchet was raised when
  real call paths added warnings, never lowered to make a gate pass. Coverage thresholds are 82/68/82/85 and
  were met by adding tests, not by lowering them.
- **Two layouts, one JS branch.** The report composer picks its DOM with
  `useMediaQuery('(min-width: 1024px)')`; hiding one set with `hidden lg:grid` is **not** an option because
  `handleInputKeyDown` walks `document.querySelectorAll('.test-result-input')` by index — a hidden second set
  would jump the caret into invisible inputs. Verified invariant: a 25-parameter order yields exactly 25 input
  nodes. `src/hooks/useMediaQuery.ts` is the only JS viewport query besides `SHELL_RAIL_MQ` (600 px); keep it
  aligned with a real Tailwind edge and keep it rare (a `setMatches()` re-read inside `useEffect` costs a
  `react-hooks/set-state-in-effect` warning, and there is one spare slot in the ratchet).
- **`keyboard-only:` Tailwind v4 variant** (declared as `@media (hover: hover) and (pointer: fine)`) gates
  keyboard-hint chips; use as `hidden keyboard-only:flex`.
- **Capacitor plugin methods can be stateful on Android only.** `Haptics.selectionChanged()` is a no-op unless
  `selectionStart()` opened a session (guarded by a flag in the plugin's Java); iOS has no such state. When a
  native "feedback" call does nothing on device, read the plugin's Java/Kotlin in `node_modules` before blaming
  permissions — and the merged manifest is the authority on what shipped.
- **Concurrent sessions share this tree.** Another agent may re-run `sync:android` or edit the same files
  mid-session. Treat every file as read-modify-write, re-read immediately before editing, check
  `LastWriteTime`, and never run `npm run build` / `verify` / any packaging command while another agent builds
  (shared `dist/`). No `git commit`/`push` mid another session's work — it sweeps their WIP.
- **`git status` is the source of truth for the tree**, not anything written here; re-read it before claiming a
  commit's contents. And **the APK/MSI are the source of truth for what shipped** — read the artifact
  (`aapt2`, `zipalign`, `apksigner`, asar extraction, pdfjs probes) instead of trusting the summary in this
  file. `@electron/asar`'s `extractFile` needs paths WITHOUT a leading slash.
- **A test claim needs a negative control.** Restore the old code and confirm the new test fails (used for the
  pad-clearance, page-units and layout rounds). Tests that pass either way are decoration, and the "starts a
  continuation sheet near the top edge" case was replaced rather than deleted because it asserted the bug.

## Screenshots / visual context

Screenshots taken in-session do not survive across sessions. When a visual conclusion must be retained, write
it as prose here or save a named file under `screenshots/` (workspace root; the 2026-10-17 packaged-auth captures
are there) and register the path. `take_screenshot` via chrome-devtools refuses paths outside its own roots.
**MCP choice matters:** the playwright MCP returns the screenshot inline even when the file it writes is
unreachable, so use it for anything that clicks, types or submits; the chrome-devtools MCP attaches to a Chrome
that already holds **the owner's real lab data** — use it to _read_ a page the owner opened, not to drive it.

## Next / Open items

Ordered by blocking power. Items marked DONE were removed from this file on 2026-10-18; their records are in
`docs/history/PROJECT_MEMORY-2026-10-18-pre-cleanup.md`.

1. **Install and RUN the 2.8.6 APK on the lab phone** — the only real verification left on Android.
   `buildoutput/android/app-release-2.8.6.apk` (stable key, **update in place, never uninstall**). Confirm what
   a browser cannot: the SQLCipher adapter, issuing a report with blank results, amending to v2 + a history row,
   the long-press commission sheet, the bill headed with the lab's own name, the mobile shell (last row clears
   the tab bar with a 48 px inset; no sideways pan) — see the `chrome://inspect` checks under _Mobile layout_.
2. **Install → boot the MSI** (`buildoutput/desktop/PathoMitra-2.8.6.msi`, mirror `C:\pm-msi-2860`). The
   packaged `win-unpacked` exe has booted (2.8.5, twice); the **installer** path — perMachine one-UAC, advertised
   shortcut, upgrade over an installed older version, uninstall behaviour — has never run on any version.
   Install outside the OneDrive tree. `NotSigned` → SmartScreen "More info → Run anyway".
3. **Print on paper.** `buildoutput/print-checks/` (14 sheets) is the queue; the orientation/duplex/range path
   and every pad-clearance claim are unverified until one sheet comes out of the lab's printer (this PC has no
   physical printer). No bill or referral statement has ever been printed either.
4. **Privacy policy is a _freshness_ problem, not a _presence_ problem (re-verified today).** Live
   `https://pathomitra.pages.dev/privacy` = 200, JS-free, SQLCipher ×2, contact present — but it is the **older
   11 734-char build with `Windows` ×0 / `DPAPI` ×0**, while `promotion_website/public/privacy.html` on disk is
   **13 624 B** and has the per-platform key storage (§3) and the uninstall split (§6). The app links to a page
   that contradicts the policy inside the app. Fix = redeploy `promotion_website` (**owner gate: no Cloudflare
   deploy unless the owner says so**), then confirm `/privacy` resolves to the static file and not the
   `_redirects` SPA fallback. Do not paper over with `PRIVACY_URL_CHECK=loose|skip`. The matching gate change
   (assert `PRIVACY_LAST_UPDATED` in the fetched body) is task T-1.2 in
   `docs/store/ms-store/ms-store-remediation-plan-2026-10-17.md` — deferred, and it will make release builds
   FAIL until the deploy lands (intended).
5. **Commit / tag / push provenance.** HEAD `796f056` is 1 ahead of `pathomitra/main` and **there are no tags at
   all** — `docs/store/play/play-console-submission.md` §0 and the Store plan's P-13 both make "the upload traces
   to a tag" a precondition, and Store 10.2.9 wants a versioned URL whose bytes never change. Owner decides when
   to push; nothing here authorizes it.
6. **No AAB for the current version.** Play will not accept an APK. `npm run verify:android` (which now runs
   `sync:android` → `android:aab` → `check:android`) has not been run for 2.8.6, and its banned-phrase scan on
   the artifact is likewise unrun. Beware the stale-bundle trap this created before: `android/app/build/outputs/
bundle/release/app-release.aab` is a 2.7.4 artifact sitting under a neutral filename.
7. **Windows/Store decision (owner has NOT chosen) — Route M (signed `.msi` behind a versioned HTTPS URL,
   policy 10.2.9) vs Route X (`.appx`).** The plan with per-task "Done when" commands is
   `docs/store/ms-store/ms-store-remediation-plan-2026-10-17.md`; Phase 0 lists the 9 owner inputs. The long
   pole is a code-signing certificate (`WIN_CSC_LINK` + the existing `win.signExts`) —
   `check-desktop-package.mjs` fails on signing only (7 PEs + the MSI are `NotSigned`). Then: no Store listing
   exists yet (draft in `docs/store/ms-store/ms-store-listing-and-cert-notes-2026-10-17.md`), no versioned URL
   (`DOWNLOAD_URLS.windows` is still `null`), and `electron-builder.config.mjs` + `STORE-READINESS-REPORT.md`
   still carry the outdated "MSIX blocked / MSI not accepted" framing.
8. **Electron 44.7.0 → 44.9.0** (four security releases behind; Store 10.2.1 engine currency). Needs the
   `allowScripts` pin bumped in the same change, then a rebuild and the boot probe.
9. **Deferred by decision, still open:** T-1.4 first-run theme default (`settings.ts:234` is still
   `themeMode: 'light'`; `nativeTheme.themeSource='system'` fixed the flash but a Dark-mode Windows still
   paints a dark frame then a light document), T-1.5 window minimums (`electron/main.ts:150-151` still
   1024×640 DIP, which will not fit a 1366×768 panel at 150 % scaling), T-1.6 confirmation token on
   `pm:db:clear`, and the 10.2.7 uninstall clean-removal affordance (keep the data-safety choice, expose the
   erase). An `electron/` regression test for the CSP + sender-frame path is still worth having.
10. **Clinical sign-off gate before any interval is treated as approved:** the 2 remaining
    `requires-lab-verification` bands, the neonate and 2–11 y questions, the report caveat (11.3.2), and the
    `Albumin` / `HEMOTOLOGY` findings all need the lab director. Do not fix `HEMOTOLOGY` without that call.
11. **Billing compliance question (owner has not answered):** paying doctors a percentage for referrals is
    restricted in India (ICMR ethical guidelines + NMC professional-conduct rules; bears on NABH). The machinery
    exists with rate default 0 and nothing transmitted — get the payout model reviewed before non-zero rates are
    used, and never advertise it.
12. **Open audit findings that still gate quality** (ledger deleted from `docs/audits/` by `0bd338c`; the list
    is kept in the archive): `F-1` PDF Unicode font (largest user-visible risk — bills print `Rs.`, Devanagari
    names blank; needs a font-asset decision) · `F-4` single PDF pipeline · `PR-3` print-job verification ·
    `A-2` desktop `powerMonitor` re-lock · `B-2/B-3` backup safety net (scheduled snapshot + pre-restore
    snapshot) · `N-1` full-window alert sweep · `D-6/D-7` migration-ladder + shim traps · `DR-2` `doctorId`
    foreign key · AM-6 recharts warn-on-first-paint (open by choice).
13. **Asset hygiene (re-measured 2026-10-18):** `public/logo.png` and `public/p-logo.png` are byte-identical
    (`89F3A438…`, 1 365 963 B each) and referenced **nowhere** outside test fixtures — ~2.7 MB of dead image
    weight that ships in the APK and the asar. Decide with the owner whether to delete them (the `p-logo.png`
    delete-owed question has been open since 2026-10-12). `public/brand-p.png` **is** load-bearing
    (splash default + `DEFAULT_BRAND_LOGO_SRC`) and is the same file as `android-chrome-512x512.png` and
    `desktop-resources/icon.png` (`116F616D…`) — keep. Separately, `public/default-share-template.png`
    (192 245 B) is a real lab's letterhead shipped as the built-in default share template; it needs neutral art
    (Store 11.2 third-party IP) and must not reach store screenshots.
14. **Not started (each needs a product/schema decision first):** range-management workflow (per-lab overrides,
    approvals, change history), synonym admin UI, search analytics, month-level patient age.
15. **Cheap safety net still missing:** `minSdk` 28 (Android 9, factory WebView ~Chrome 66) vs Tailwind v4's
    Chrome 111 and `dvh`'s 108. The `vh`→`dvh` fallbacks exist, but an un-updated Android System WebView still
    gets a degraded palette (`color-mix()`, `oklch()`) with no startup guard. A
    `CSS.supports('color','color-mix(in srgb, red, blue)')` check plus an "update WebView" screen is the close.
16. **Register the 2.8.6 pair in `buildoutput/BUILD_INFO.md`** — that hand-over sheet still heads "live pair is
    2.8.5", so the next session reading only it will re-package over a stale assumption. (Out of scope for the
    2026-10-18 docs cleanup, which touched only `PROJECT_MEMORY.md` and `docs/`.)

## Where the detail lives

- `buildoutput/BUILD_INFO.md` — per-artifact hand-over sheets (git-ignored; hash-level detail).
- `docs/store/play/play-listing.md` + `play-console-submission.md` — Google Play listing copy and every Console
  field (Data Safety + the Health apps declaration corrected 2026-10-18).
- `docs/store/ms-store/ms-store-review-2026-10-17.md` — current (round 3) Windows certification ledger;
  `…-2026-10-16.md` is round 2 and superseded; `…-remediation-plan-…` is the execution plan;
  `…-listing-and-cert-notes-…` is the draft listing.
- `docs/design/design.md` — UI rules (token architecture, typography, motion); **values live in
  `src/index.css`**, never in the doc.
- `docs/history/PROJECT_MEMORY-2026-10-18-pre-cleanup.md` — everything this file no longer carries.
- **Docs cleanup of 2026-10-18** (documentation only — no source file was touched): `PROJECT_MEMORY.md`
  rewritten from 2 533 lines to this; `docs/README.md` now states which ledger is current; the two Play
  ledgers were corrected (Data Safety "collected = Yes / shared = No / transit = No", the Android-key
  storage claim aligned with `privacy-policy.ts` §3, the Health apps declaration added, the "`/privacy` is a
  JS shell" and `check-release-config` exit-1 advice replaced with the freshness wording);
  `docs/design/design.md` §3 no longer promises a remote Inter import and §4 now carries the `fold:` /
  `--shell-gutter` / per-side-padding rules; `ms-store-review-2026-10-16.md` is marked superseded; the round-3
  review and the remediation plan got cross-reference and status fixes (T-1.1 and T-1.3 ✅, T-1.4/T-1.5 ⬜).
- Deleted 2026-10-17 by `0bd338c` (recover with `git show 23fabeb:docs/audits/<file>` if ever needed — the
  conclusions survive in the archive above): `docs/audits/feature-audit-2026-10.md`,
  `catalogue-audit-2026-10.md`, `play-audit-2026-10-16.md`, `play-audit-2026-10-17.md`,
  `store-compliance-audit-2026-10.md`.
