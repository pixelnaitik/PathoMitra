# Google Play Pre-Submission Compliance Audit — Round 5 (2026-10-17)

Role: Senior Google Play Policy Reviewer + Android Security + Privacy Compliance + UX Audit +
Mobile Quality. Method: **evidence-only** — every finding cites a file:line read in this session or
a command actually executed. **Report-only: no source file was changed.**
Severity: P0 (compliance / data / submission blocker), P1 (user-visible or store-review risk),
P2 (polish / hardening).

Subject: `com.pathomitra.app` **PathoMitra**, versionName `2.7.7` / versionCode `2007007`
(uncommitted — git HEAD is `dd0bf88` = 2.7.2 on `desktop-electron`), minSdk 28, targetSdk 36,
compileSdk 36.

Supersedes nothing. `docs/play-audit-2026-10-16.md` (round 4 + its 2.7.4 remediation addendum)
stays the ledger for what was already fixed; this round is the delta plus a re-verification pass.

---

## 1. Commands actually executed (verified facts, 2026-10-17)

| Check | Result |
| --- | --- |
| `node scripts/check-android-manifest.mjs` | exit **0** — `com.pathomitra.app v2.7.7 (2007007)`, **6 permissions**, not debuggable, backups excluded; ⚠ `<access origin="*"/>` in tool-generated `res/xml/config.xml` |
| Merged release manifest read directly | `android/app/build/intermediates/packaged_manifests/release/…/AndroidManifest.xml` → `POST_NOTIFICATIONS`, `VIBRATE`, `WAKE_LOCK`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. No `INTERNET`, no dangerous perm, no `BOOT_COMPLETED`, no `BROWSABLE`, only `MainActivity` exported |
| `node scripts/check-release-config.mjs` (release path) | exit **0** — `contact pathomitra@healthcarediagnosticscenter.in, policy https://pathomitra.pages.dev/privacy (verified reachable)` |
| Live probe `https://pathomitra.pages.dev/privacy` (`Invoke-WebRequest`) | HTTP **200**, **11 797 B**, **0 `<script>` tags**, has `SQLCipher` / `keystore` / contact / `Grievance`, **`Windows` = False, `DPAPI` = False**, still contains `backed by hardware`, dated `Last updated 16 October 2026` |
| `npm run build:privacy` (regenerate locally) | writes `promotion_website/public/privacy.html` **13 624 B** + `privacy-site/index.html` 14 552 B + `terms.html` 7 161 B → **hosted page is 1 827 B / one revision behind** |
| `npm run lint:ci` | exit 0 — **0 errors / 22 warnings** (ratchet 23) |
| `npm run test:coverage` | **44 test files passed**, coverage 87.11 / 81.45 / 85.61 / 88.92 (thresholds 82/68/82/85) |
| `npm audit --omit=dev` | **0 vulnerabilities** (production tree) |
| `npm audit` (whole tree) | 15 (11 moderate / 4 high) — dev chain only |
| `npm outdated --prod` | 10 behind: `@capacitor/filesystem` 8.1.4→8.1.5, `@capgo/capacitor-printer` 8.1.6→8.1.8, `jspdf-autotable` 5.0.7→5.0.9, `lucide-react` 0.546.0→**1.59.0**, `motion` 12.38.0→**14.3.0**, `react`/`react-dom` 19.2.5→19.3.1, `recharts` 3.8.1→3.10.1, `tailwind-merge` 3.5.0→3.7.0, `zod` 4.6.5→4.6.7 |
| `zipalign -c -P 16 -v 4 buildoutput/android/app-release-2.7.7.apk` | exit **0**, `Verification successful` (build-tools 36.0.0) |
| ELF `p_align` of `lib/arm64-v8a/libsqlcipher.so` **inside the signed 2.7.7 APK** (extracted + header parsed) | **16384 on all 3 PT_LOAD segments** → 16 KB page size compliant |
| `apksigner verify -v --print-certs` (2.7.7 APK) | Verifies; **v2 true, v3 false, v4 false**; 1 signer; **DN `CN=Naitik Raj, O=PathLab OS, C=IN`**; cert SHA-256 `1550d59f…09587a4d` |
| APK entry census (2.7.7, 719 entries) | `assets/public/logo.png` 1 365 963 B **and** `assets/public/p-logo.png` 1 365 963 B (identical SHA-256 `89F3A438…`, referenced **nowhere** in `src/`, `index.html` or the built `dist/assets/*.js`); `brand-p.png` ≡ `android-chrome-512x512.png` (SHA-256 `116F616D…`, 397 649 B each); `libsqlcipher.so` × 4 ABIs = 7 622 448 B |
| APK `assets/public/index.html` | **no CSP** — 0 matches for `Content-Security-Policy` / `script-src` |
| Web-deploy-only assets inside the APK | `robots.txt`, `sitemap.xml`, `llms.txt`, `sw.js`, `manifest.json`, `_headers`, `_redirects`, `apple-touch-icon.png` → **all absent** (`vite.config.ts:29-38` strips them for `VITE_TARGET=native`) ✅ |
| `Get-ChildItem android/app/build/outputs/**` | `apk/release/app-release-2.7.7.apk` (17 142 458 B, 2026-10-17) and **`bundle/release/app-release.aab` = 12 874 296 B, dated 2026-10-16 22:25** |
| SHA-256 of that AAB vs `buildoutput/android/app-release-2.7.4-PLAY-PENDING-POLICY-DEPLOY.aab` | **identical** (`609CF31C47CD329A3CE84E1F0959…`) → the only bundle on disk is a **2.7.4** artifact, renamed to a neutral `app-release.aab` |
| `git status --porcelain` | 87 entries; **no tag** for any 2.6.x / 2.7.x; `pathomitra/main` == `pathomitra/HEAD` == `dd0bf88` |
| grep `prefers-color-scheme` in `src/**` | **0 hits**; `settings.ts` `themeMode: 'light'`; no `android/app/src/main/res/values-night/` |
| grep `text-[Npx]` in `src/**/*.tsx` | **211** px-locked font sizes (90 × 11px, 40 × 13px, 21 × 10px, 13 × 12px, 5 × 9px); only 6 rem-based arbitrary sizes |
| grep `unverifiedForPatient` outside `pathology-tests.ts(+test)` | **0 consumers** |
| Listing assets on disk | none — no `screenshots/`, no feature graphic; `docs/` holds only `.md` |

### Policy text read from primary sources (not assumed)

- Play **target API** requirement: from **31 Aug 2026** new apps and updates must target **Android 16 /
  API 36** → `targetSdkVersion 36` ✅ compliant today and for the next cycle.
- Play **Health Content and Services** policy (support 16679511): *all* developers must complete the
  **Health apps declaration form**; non-device health apps **"must include a clear disclaimer in their
  app description indicating that the app is 'not a medical device and does not diagnose, treat, cure,
  or prevent any medical condition'"** and **"must also remind users to consult a healthcare
  professional"**; the privacy policy must be an active, publicly accessible, non-geofenced,
  non-PDF URL.
- Play **Health apps declaration form** guidance (support 14738291): mandatory for every app including
  those with no health features; the matching PathoMitra category is *Medical → "Healthcare Services
  and Management"* ("managing health records, billing").
- Play **Data safety section** guidance (support 10787469): *"If your app collects or shares any of the
  required user data types, select **Yes**"*; FAQ — *"My app lets the user create an account or add
  information to their account, for example, birthday or gender… **You should declare the collection
  of this data**"*; and *"developers can only declare encryption in transit if it applies to all user
  data that their app collects **and transmits off the user's device**."*
- Play **app testing requirements for personal developer accounts** (support 14151465): personal
  accounts created after **13 Nov 2023** must run a **closed test with ≥12 testers opted in
  continuously for ≥14 days** and then **apply for production access**; Production stays disabled
  until then. Reviewers must be given **valid working test credentials**.

---

## 2. Google Play policy compliance, per policy

| Policy | Status | Risk | Finding | Fix |
| --- | --- | --- | --- | --- |
| Developer Program Policies (general) | ⚠ | Med | Submission pack (`docs/play-console-submission.md`) is written against a 2.7.3 world: tag, AAB, deploy step all stale | Re-cut the pack against 2.7.7 (PL-1, PL-2) |
| User Data / Personal & Sensitive | ❌ | **High** | DS-1 Data Safety draft answers "no data collected"; DS-2 hosted policy ≠ in-app policy; DS-3 banner-text claim inaccurate | See §3 |
| Permissions Policy | ✅ | Low | 6 permissions, none dangerous, none unused-but-declared; justification text drafted at `play-console-submission.md:165-171` but **not filed** | File it; optionally drop the cordova module for the `<access origin="*"/>` line |
| Device & Network Abuse | ✅ | Low | No `INTERNET`, no `FOREGROUND_SERVICE`, no exact alarms, no boot receiver, no silent install, no remote code | — |
| Impersonation / Trademarks | ⚠ | Med | `apksigner` DN is still `O=PathLab OS`, a retired brand, on the key that signs the shipped APK; package `com.pathomitra.app` vs brand `PathoMitra` | Re-issue cert `O=PathoMitra` **or** enable Play App Signing (upload key then stops being the device-verified identity) |
| Spam & Minimum Functionality | ✅ | Low | Full LIS feature set; one local account is a legitimate single-device design | — |
| Deceptive Behaviour / Misleading | ❌ | **High** | **HL-1** — listing text has no "not a medical device…" disclaimer, which is mandatory for a non-device health app; **HL-2** — no "consult a healthcare professional" reminder; **PR-3** — §3 of the policy claims the banner carries a "registration number (YYMM-series)" when it carries an internal UUID | See §4, §6 |
| Installs & Engagement (no incentivised installs) | ✅ | Low | No install-bait, no reward loops | — |
| Ads Policy | ✅ | N/A | No ad SDK, no `AD_ID` | Answer "No" |
| Financial Services | ⚠ | Med | No money movement (`models.ts` `PaymentModeSchema` is bookkeeping), but **MN-1**: the referral-commission editor offers **10 / 20 / 30 / 50 % presets** (`DoctorsPage.tsx:833-845`) with the ICMR / NMC caveat living only as a code comment (`referrals.ts:28-35`) | Surface a one-line notice where a non-zero rate is set; legal review before any lab uses it |
| Subscriptions | ✅ | N/A | None | Answer "No" |
| AI-generated content | ✅ | N/A | No AI dependency, no inference path; `marketing-claims.test.ts` bans AI wording | Re-declare if OCR/auto-suggest is ever added |
| Children's Safety | ⚠ | Med | Adults-only declared in docs, but **no IARC questionnaire or audience declaration filed**; the app *records* minors' clinical data — that must be stated in the form, not implied | File audience + IARC; wording at `play-console-submission.md:85-107` |
| Families Policy | ✅ | N/A | Not in the Families program (professional tool) | — |
| **Health Content / Health apps declaration** | 🚨 | **Blocker** | The declaration **is not mentioned anywhere in the repo** (`grep "Health apps declaration"` over `docs/*.md`, `PROJECT_MEMORY.md`, `SECURITY.md`, `README.md` → 0 hits) and is mandatory for every app | Complete it as *Medical → Healthcare Services and Management*; add HL-1 + HL-2 to the description |
| News App Requirements | ✅ | N/A | Not a news app | Answer "No" |
| User-Generated Content rules | ✅ | N/A | No feed, no messaging, single local operator; nothing published to other users | Answer "No" to UGC + inter-user communication |
| Google Play Billing | ✅ | N/A | No billing dependency, no digital goods sold in-app. Play's *Payments – Clinical Services* rule says clinical-service transactions should **not** use Play billing — correctly not used | Answer "No" to IAP |
| Data Safety form | 🚨 | **Blocker** | DS-1 (wrong answers) — see §3 | Rewrite §5 of the submission doc |
| Account deletion / sign-in transparency | ✅ | Low | In-app "Erase all data & delete account" satisfies the requirement; no remote account → no deletion URL needed | Screenshot that screen (already planned, `play-console-submission.md:203`) |
| Target API level (API 36, Aug 2026) | ✅ | — | `targetSdkVersion 36` verified in the packaged manifest | — |
| 16 KB page size | ✅ | — | Re-verified on the 2.7.7 APK this session: `zipalign -P 16` exit 0 **and** `p_align = 16384` × 3 PT_LOAD | — |
| Play pre-registration / production gate | ❌ | **High** | **PL-4** — if the developer account is *personal* and created after 13 Nov 2023, Production is disabled until a closed test with ≥12 continuously opted-in testers for ≥14 days + a production-access application. Nothing in the repo acknowledges this | Confirm account type/date; plan the 14-day test in advance — it is calendar time, not effort |

---

## 3. Data Safety — the round's most consequential finding

**DS-1 🚨 P0 — the drafted Data Safety answers are materially wrong under Play's own definition of
"collection".**

- `docs/play-listing.md:152`: *"Answer **all of these as 'No data collected'** and use the 'why' text
  below."*
- `docs/play-console-submission.md:141`: *"Does your app collect or share any of the required user
  data types? **No.** Nothing is collected: there is no network permission and no collector in the
  bundle."*
- `docs/play-console-submission.md:143`: *"…mark **not collected**, and use the 'data stays on device'
  explanation. **Do not mark it 'collected but not shared'**"*.
- `docs/play-console-submission.md:144`: *"Data encrypted in transit | **N/A** — nothing is sent in
  transit."*
- `docs/play-console-submission.md:234` even offers this as the pitch: *"offline by construction, which
  is why Data Safety is all-No"*.

Google's guidance (support 10787469, read this session) says the opposite: collection is *accessing or
storing* user data, the form asks you to select the data types your app **"collects or shares"**, and
the FAQ explicitly requires declaring locally-added account information (name, gender, date of birth)
as collected. There is no "N/A" on the transit-encryption question — it is a Yes/No, and with data
declared the honest answer is **No** (nothing is transmitted).

The offline architecture is real and is the *reason sharing is "No"*; it is **not** a reason collection
is "No". What PathoMitra stores on device, per `src/lib/models.ts` + `privacy-policy.ts` §2/§3, maps to
Play data types as:

| Play category | Type | Collected? | Shared? | Basis |
| --- | --- | --- | --- | --- |
| Personal info | Name | **Yes** | No | patient + referring-doctor + operator display name |
| Personal info | Phone number | **Yes** | No | `PatientSchema.phone` |
| Personal info | Address | **Yes** | No | patient address |
| Personal info | User IDs | **Yes** | No | internal patient/report ids, printed on slips |
| Personal info | Other info | **Yes** | No | age, gender |
| **Health and fitness** | **Health info** ("medical records or symptoms") | **Yes** | No | specimen/test data, pathology findings, report bodies |
| Financial info | Purchase history / Other financial info | **Yes** | No | invoices, payments, outstanding balances |
| Files and docs | Files and docs | **Yes** | No | exported PDFs/CSVs/sealed backups the app writes |
| — | Encryption in transit | **No** (not N/A) | — | no `INTERNET` permission, no egress path |
| — | Encryption at rest | **Yes** | — | SQLCipher AES-256; key in `EncryptedSharedPreferences` under the AndroidKeyStore |
| — | Deletion | **Yes**, in-app, self-service | — | Settings → Security → erase all data |
| — | Data used for ads / analytics / fraud / account security | **No** to all | — | none present |

Why it matters: an inaccurate Data Safety section is enforceable **after** publication, not just at
review — Play's own guidance states the developer "remains solely responsible for making complete and
accurate declarations", and health data is the most scrutinised category. Submitting "all-No" for an
app that stores names, phone numbers, addresses, genders, ages and pathology findings is the single
declaration most likely to produce a policy strike or a listing-level mismatch flag later.

Recommended fix: rewrite `docs/play-console-submission.md` §5 and `docs/play-listing.md` §2 "Data
safety form" to the table above, and add the one-sentence explanation that belongs in the "why"
field: *"All of this data is entered by the laboratory on the user's own device and is never
transmitted or shared — the app has no network permission — but it is stored, so collection is
Yes and sharing is No."*

**DS-2 ❌ P1 — the hosted policy and the shipped in-app policy are different documents.**
Re-verified: live `https://pathomitra.pages.dev/privacy` = **11 797 B**, `Windows` / `DPAPI` = 0
matches, and it still asserts the key is *"backed by hardware"*; `npm run build:privacy` this session
writes **13 624 B** with the corrected §3 (platform split: AndroidKeystore *may* be hardware-backed,
"the claim this policy used to make … was stronger than the truth, and is corrected here") and §6
(uninstall behaviour differs on Windows). `src/lib/privacy-policy.ts:14-16` promises *"the hosted
policy and the in-app policy cannot drift apart"* — they have drifted.
Policy hook: Health Content and Services requires the posted policy to "comprehensively disclose" the
app's real practices; Play also requires the Console / in-app / web URLs to be consistent.
Fix: deploy the regenerated brochure (owner deploy gate — needs an explicit "deploy"), then re-run the
strict probe. Rebuilding the APK is **not** required: `VITE_PRIVACY_URL` is already baked in correctly.

**DS-3 ⚠ P2 — `privacy-policy.ts:134` describes a banner field that does not exist.**
It says the banner "carries the registration number (the same YYMM-series number printed on the slip
and used to find the record)". `notification-engine.ts:285 / 311 / 340` interpolate `patient.id` /
`report.patientId`, which are `generateId()` UUIDs (`sqliteRepository.ts` `add()`), and the UI itself
truncates them as unknown-to-humans (`ReportsPage.tsx:1957-1960` — `patientId.substring(0, 8) + '...'`).
`docs/play-console-submission.md:194` repeats the same claim to the person capturing screenshots.
The privacy *intent* is met and is well tested (`notification-engine.test.ts:479-553` proves no name,
no `₹`, no `Reason:` in any banner) — it is the description that is wrong, and a 36-char UUID on a
lock screen is also bad UX.
Fix either way: reword the policy to "an internal record identifier", **or** mint a real YYMM-series
display number and use it. The second option is better for the bench and for the listing story.

**Privacy Risk Score: 71 / 100.** Best-in-class data minimisation and honest in-app disclosure cost
17 points for a stale hosted policy, an inaccurate banner sentence, and a Data Safety plan built on a
misreading of Play's definition of collection.

---

## 4. Health-content / listing audit

| Item | Status | Evidence & issue |
| --- | --- | --- |
| App name `PathoMitra` (10 chars) | ✅ | `play-listing.md:15` — no superlative, no keyword stuffing, no "Official" |
| Short description (79/80) | ✅ | `:26` factual; states encryption + locality |
| Long description structure | ✅ | `:33-88` — every capability claim maps to code; explicit "No advertisements. No in-app purchases. No subscriptions." |
| **HL-1 mandatory non-device disclaimer** | ❌ **P1** | Play requires a non-device health app to state in the **app description** that it is *"not a medical device and does not diagnose, treat, cure, or prevent any medical condition"*. `play-listing.md:81-83` says only "not a diagnostic device" **inside the last NOTES bullet**; the mandated wording does not appear anywhere (`grep -i "medical device"` over `play-listing.md` + `play-console-submission.md` → 0 hits) |
| **HL-2 "consult a healthcare professional"** | ❌ **P1** | Required by the same clause. Absent from the description and from the Console pack |
| **HL-3 Health apps declaration form** | 🚨 **P0** | Not mentioned anywhere in the repo; mandatory for every app; PathoMitra's honest answer is *Medical → Healthcare Services and Management* (and *not* "Medical Device Apps") |
| "Android hardware keystore" in the listing | ⚠ P1 | `play-listing.md:65-66` "key is held in the **Android hardware keystore**" and `:147` "SQLCipher / AES-256, **hardware keystore**" — the corrected in-app policy retracts exactly this (`privacy-policy.ts:127`: hardware-backed "is not guaranteed"). Listing and policy must agree; use the honest wording |
| Keyword stuffing / metadata manipulation | ✅ | None in listing text or `<meta name="keywords">` (`index.html:41-44`); `package.json:71-81` has 9 keywords incl. `react/vite/capacitor/tailwindcss` — irrelevant to Play, but wrong for a Store metadata field if mirrored |
| Screenshots (≥2 required) | 🚨 **P0** | none exist — no `screenshots/` directory, no image in `docs/`; `play-listing.md:101-109` still unchecked |
| Feature graphic 1024×512 | 🚨 **P0** | same |
| Screenshot feasibility | ❌ **P1** | **PL-3** — `FLAG_SECURE` is on by default (`MainActivity.java:33`, `settings.ts:214` `screenshotsAllowed: false`, fail-closed on corrupt value at `:328-329`). `play-console-submission.md:192` already tells the owner to turn it off to capture. It also means **Play's pre-launch report gallery and a reviewer's own capture come out black** — see §7 |
| Listing ↔ bundle consistency | ✅ | `Footer.tsx:111` is now `© 2026 Naitik Raj · PathoMitra is MIT-licensed open source.`; the invented trading name and "Clinical Grade Precision" are gone and are banned strings in `marketing-claims.test.ts` |
| Misleading product mock | ✅ | `Hero.tsx:124-135` — the fake URL pill and "Live" badge are gone; the chrome is labelled `Illustration · sample data`. Keep it out of Store screenshots (the caption only defends a *marketing* surface, not a listing screenshot) |
| `og:url` inside the shipped bundle | ⚠ P2 | `index.html:51` advertises `https://pathomitra.pages.dev`; the APK copy still carries it. Cosmetic, but it is a web identity inside an offline binary |
| Package vs brand | ⚠ P2 | `com.pathomitra.app` vs `O=PathLab OS` cert — expect a reviewer query; scripted answer exists (`play-console-submission.md:213-220`) |

**Listing verdict:** the copy that exists is honest and unusually disciplined; what is missing is the
two sentences Play specifically mandates for a health app, the declaration form, and every visual
asset. Fix priority: HL-3 → screenshots/feature graphic → HL-1/HL-2 wording → keystore wording.

---

## 5. Permission audit (merged *release* manifest — the file Play reads)

| Permission | Necessary | User justification on record | Play risk | Action |
| --- | --- | --- | --- | --- |
| `POST_NOTIFICATIONS` | Yes (runtime, API 33+) | overdue / draft / amendment / unpaid banners, opt-in from Settings → Notifications (`SettingsPage.tsx:533` calls `requestPermission()`, `useNotifications.ts:363-364` posts only when granted) | Low-Med — needs Console use-case text | keep; add a pre-prompt rationale screen (P2) |
| `VIBRATE` | Yes | haptic confirm on issue + destructive actions (`lib/haptics.ts`) | Low | keep |
| `USE_BIOMETRIC` | Yes | unlock gate for a PHI device; the OS authenticates, no sample is read | Low | keep |
| `USE_FINGERPRINT` | Yes (API 28 floor) | same, pre-`USE_BIOMETRIC` | Low | keep |
| `WAKE_LOCK` | Yes (plugin) | deliver an opted-in banner while the app is closed | Low — justification text drafted, not filed | keep, declare |
| `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | Auto (AndroidX) | signature-level self-permission | Low | keep |
| `INTERNET` | **absent — verified** | the offline claim is provable | none | never add |
| Background location / location / camera / microphone / contacts / SMS / call log / storage (incl. `READ_MEDIA_*`) / accessibility / `AD_ID` / `SYSTEM_ALERT_WINDOW` / `REQUEST_INSTALL_PACKAGES` / `FOREGROUND_SERVICE` / `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` / `RECEIVE_BOOT_COMPLETED` | **all absent — verified in the packaged manifest** | not used | none | allow-list + block-list at `check-android-manifest.mjs:53-105` fail the build on regression; the boot receiver is removed as a *component* too (`AndroidManifest.xml:53-55`), not just as a permission |

Enforcement quality: a new permission must be chosen by name in a reviewed diff. That is stronger than
most published health apps. **Permissions score: 96 / 100** (the 4 is the unfiled declarations and the
vestigial `<access origin="*"/>`).

---

## 6. Security audit

| Area | Status | Evidence |
| --- | --- | --- |
| Cleartext / HTTPS / SSL pinning | ✅ N/A→best | no `INTERNET` at all, `usesCleartextTraffic="false"`; there is no TLS client to pin |
| API security / token handling | ✅ N/A | no API, no bearer token, no session id in transit |
| At-rest crypto | ✅ | SQLCipher AES-256 (`capacitor.config.ts:40-46` `androidIsEncryption: true` set explicitly so a config edit cannot silently produce a plaintext DB); passphrase from `generateSecret()` — CSPRNG-only, **throws instead of degrading** (`query.ts:44-54`, used at `sqliteRepository.ts:166`) — the 2.7.4 `Math.random`-branch hole stays closed |
| Credential storage | ✅ | PBKDF2-SHA256 210k + 16-byte salt + constant-time compare (`lib/password.ts`); key in `EncryptedSharedPreferences` w/ AndroidKeyStore `MasterKey` (verified in plugin Java in round 4) |
| Brute force / auto-lock | ✅ | 5 tries then 30 s → 1 h escalating lockout with clock-forward defence (`local-account.ts:171-190`); idle + wall-clock background re-lock (`session-lock.ts:68-84`) |
| Screen capture | ✅ (with a side effect) | `FLAG_SECURE` added before `super.onCreate()` — fail closed (`MainActivity.java:32-33`). **PL-3**: the same correctness makes Play pre-launch screenshots and reviewer captures black |
| Backup / device transfer | ✅ | `allowBackup=false` **and** `data_extraction_rules.xml` excluding all five domains for both `cloud-backup` and `device-transfer` |
| Exported surface | ✅ | only `MainActivity` exported, no `BROWSABLE`; FileProvider `exported=false`, paths narrowed to `PathoMitra/` (+ read-only legacy `PathLab OS/`) in `file_paths.xml:20-49` |
| JS injection surface | ✅ | 0 `innerHTML` / `dangerouslySetInnerHTML` / `eval` / `new Function` in `src/`, with an asserting test |
| **WebView CSP** | ❌ **P1** | **SEC-1** — the 2.7.7 APK's own `assets/public/index.html` has **no CSP** (verified by reading the entry out of the signed APK). Desktop and web have one; the native origin does not. Impact is bounded (no network) but not zero: a DOM-XSS would still reach the Capacitor bridge, i.e. the SQLCipher plugin |
| Cordova compatibility shell | ⚠ P2 | `res/xml/config.xml` keeps `<access origin="*" />`; inert with no `INTERNET` and no plugin (`cordova_plugins.js` is 0 bytes) but it is a headline a policy scanner can surface |
| Error log redaction | ⚠ P2 | **SEC-2** — `crash-log.ts:34-40` redacts 32+ hex ids, emails and phone-shaped digits, **not names**. A validation message that echoes a patient name persists to app-private `Preferences`. Local-only, so exposure is on-screen, not exfiltration. Either add a name-shaped rule or accept + document |
| Signing | ⚠ P2 | self-signed RSA 2048, **v2 only** (v3/v4 false — not a Play requirement at minSdk 28), DN `O=PathLab OS`; keystore inside a OneDrive tree (files-on-demand dehydration has broken a copy before); Play App Signing decision still not made |
| Secrets hygiene | ✅ | `.env` holds only the two public values; `REPORT_SECRET_KEY` deleted with an explanatory note (`:19-24`); `keystore.properties` / `*.jks` git-ignored and untracked |
| Dependency vulnerabilities | ✅ | `npm audit --omit=dev` → **0**; the 15 whole-tree findings are all dev tooling |
| Provenance | ❌ **P0** | **PL-2** — see §9: the only AAB is a 2.7.4 bundle under a neutral filename, and no 2.6.x/2.7.x tag exists |

**Security Score: 84 / 100** (Android binary alone ≈ 92; deductions are the missing CSP, the log
redaction gap, the signing identity, and provenance).

---

## 7. UX compliance audit

Strong (verified in source): one modal primitive with a real focus trap, Escape, scrim and
Android-back priority (`ui/Sheet.tsx`), now with `inert` on the background; `role="main"` / `banner`;
`aria-current="page"` on nav; 44 px nav rows; safe-area insets honoured (`capacitor.config.ts:23-32`,
`Keyboard.resizeOnFullScreen: true` for Android 15+ edge-to-edge forms); `EmptyState` + `Skeleton`;
ErrorBoundary with data-safe wording + retry and `role="alert" aria-live="assertive"`; permission
prompts are user-initiated from Settings, never on first paint; the bottom nav is exactly 4 items.

| # | Sev | Issue | Evidence |
| --- | --- | --- | --- |
| UX-1 | **P1** | **Android system font scale cannot reach most of the UI, and the in-app "Text size" setting can't either.** 211 arbitrary `text-[Npx]` literals (90 at 11px, 21 at 10px, 5 at 9px) are immune to `[data-text-size='sm'|'lg'] { font-size: 15px / 17.5px }` (`index.css:958-962`), and nothing sets WebView `textZoom` from `Configuration.fontScale`. A user on Large/Extra-large font accessibility gets 9-11 px text in a clinical console. Only 6 call sites were converted to rem in 2.7.4 | fix: convert the 9/10/11 px cluster to `rem`, or add a `textZoom` bridge; add a lint rule banning sub-12px px literals |
| UX-2 | **P1** | Touch targets below Material 48 dp: `Button`/`IconButton size="sm"` = 32 px (`ui/Button.tsx`), used for the sheet Close button. WCAG 2.2 *Target Size (Minimum)* is met at 24 px; Android guidance is not | raise `sm` to 40-44 px in touch layouts |
| UX-3 | **P1** | **No system dark-theme support.** `prefers-color-scheme` = 0 hits in `src/`, no `values-night/`, `themeMode: 'light'` default, `capacitor.config.ts:16` `backgroundColor: '#f5f5f7'`, `index.html:6` one light `theme-color`, and the pre-paint bootstrap script (`index.html:62-70`) hardcodes `themeMode = 'light'`. On a bench phone in dark mode the app opens white; Play's pre-launch gallery will show it | follow `prefers-color-scheme` for the default, keep the manual override |
| UX-4 | P2 | Placeholder/hint text at `/60` opacity ≈ 2.5:1 (`ReportResultsEditor.tsx`) — fine for a placeholder, not for a hint | use full-strength token for hints |
| UX-5 | P2 | 54 `placeholder=` vs 21 `htmlFor=` — every `ui/Field` input is labelled, hand-rolled ones may not be | route inputs through `<Field label>` |
| UX-6 | P2 | Maintainability: `ReportsPage.tsx` still a single ~1.9k-line page; `SettingsPage.tsx`, `PatientsPage.tsx` next | split per sheet before the next feature |
| UX-7 | P2 | `vite.config.ts:131` `allowedHosts: true` — dev-only, but disables Host-header validation locally | pin to localhost unless tunnelling |
| UX-8 | P2 | Banner titles show a 36-char UUID (`notification-engine.ts:285`) — unreadable on a heads-up banner, and it is what the policy calls a "registration number" | see DS-3 |

**UX Score: 7.6 / 10** (= 76/100).

---

## 8. Accessibility audit (WCAG 2.2 AA + Android)

Contrast **measured** in earlier rounds and unchanged in the token layer: body 16.8:1 light /
16.2:1 dark, secondary text worst case 4.55:1, status containers 7.1-11.0:1, `--primary` on
`--on-primary` 6.6:1 — all AA. `--chart-4` was corrected in the MS Store pass. Semantics are dense:
real focus trap + `role="dialog"` + `aria-modal` + `useId` labels + roving arrow-key focus in Sheet;
`role="switch"`/`aria-checked`; `aria-live="polite"` toast region; `aria-busy` on loading buttons;
`aria-invalid` hook; status is never colour-only (`StatusPill` carries text); icon-only buttons
**structurally require** a `label` prop; skip link at `App.tsx:364-369`; genuine
`@media (forced-colors: active)` block; `prefers-reduced-motion` handled both by media query and by
the Settings-driven `[data-motion='reduced']`.

Gaps:

| Check | Result |
| --- | --- |
| 1.4.4 Resize text / 1.4.10 Reflow at 200-300 % | ❌ **the main failure** — 211 px-locked sizes and no `fontScale` bridge (UX-1). Pinch zoom is allowed (no `maximum-scale`) ✅, which partially satisfies 1.4.4 |
| 2.5.5 / Material target size | ⚠ 32 px `size="sm"` controls |
| 1.4.3 contrast | ✅ measured AA; two non-text 1.4.11 borders below 3:1 (acceptable for borders) |
| TalkBack / VoiceOver pass | ❌ **never run on a device, on any version** — announcement order, the `.test-result-input` index walker under a screen reader, the A4 composer at 200 %, the 10-key PIN pad target size are all unverified |
| `prefers-contrast` | 0 hits (forced-colors is covered; the web equivalent is not) |
| Focus order through the report composer | unverified — 25 inputs walked by DOM index, which is exactly what a screen-reader or a re-layout can desynchronise |

**Accessibility Score: 6.6 / 10** (= 66/100). It went down from round 4's 7.1 because round 4 credited
the 2.7.4 `text-[9px]→rem` conversion as a fix for UX-1; measured this session it covered 6 of 211
sites, and the Android `fontScale` path was never checked at all.

---

## 9. Provenance and artifact audit

| # | Sev | Finding |
| --- | --- | --- |
| PL-1 | **P0** | **No AAB exists for the current version.** `android/app/build/outputs/bundle/release/app-release.aab` is 12 874 296 B dated **2026-10-16 22:25** and its SHA-256 (`609CF31C…`) is **identical to `buildoutput/android/app-release-2.7.4-PLAY-PENDING-POLICY-DEPLOY.aab`**. Play requires AAB for new apps. `check:android` reads the *packaged* manifest (which is 2.7.7), so the guard would pass while a stale 2.7.4 bundle sits under a neutral, upload-shaped filename in the default output path. The name even says "PLAY-PENDING-POLICY-DEPLOY", and the policy has since been deployed — so that bundle is doubly stale |
| PL-2 | **P0** | Everything shipped is built from an **uncommitted** tree (87 dirty entries, `package.json` 2.7.7 vs HEAD 2.7.2) and **no tag exists for any 2.6.x/2.7.x**. `docs/play-console-submission.md:17` still instructs `git tag v2.7.3`. The upload cannot be traced to a commit |
| PL-3 | **P1** | `FLAG_SECURE` default-on means Play's **pre-launch report screenshot gallery and a human reviewer's capture are black**. Not a policy violation, but it defeats the very tooling the release plan depends on (`play-console-submission.md:222-223`) and the "Functional reliability… without missing screens" production-access check |
| PL-4 | **P1** | If the developer account is personal and was created after 13 Nov 2023, **Production is disabled until a closed test with ≥12 continuously opted-in testers for ≥14 days** plus an approved production-access application. Nothing in the repo accounts for this calendar cost |
| PL-5 | **P1** | Reviewer access: the app has a local account, a passcode, a biometric gate, a rising lockout and an idle re-lock. Play's production-access guidance explicitly asks for **valid working test credentials**. There is no seeded demo account (deliberately — `marketing-claims.test.ts` bans the word), so the Console "notes to reviewers" must walk onboarding step by step, and the reviewer must finish within the re-lock window (default 5 min) |
| PL-6 | P2 | 14 superseded APKs + 4 `.aab`s still in `buildoutput/android/` (2.5.7 → 2.7.6) alongside `app-release-2.7.7.apk`; the 2.7.7 AAB was never copied there at all |
| PL-7 | P2 | `res/xml/config.xml` `<access origin="*" />` (see §6) |

---

## 10. SDK & dependency risk

Runtime dependencies shipped in the APK: `@capacitor/*` (app, filesystem, haptics, keyboard,
local-notifications, preferences, share), `@capacitor-community/sqlite`, `@capgo/capacitor-printer`,
`@aparajita/capacitor-biometric-auth`, `@aparajita/capacitor-secure-storage`, `jspdf`,
`jspdf-autotable`, `pdfjs-dist`, `html2canvas` (bundled), `react`, `react-router-dom`, `recharts`,
`motion`, `zod`, `lucide-react`, `clsx`, `tailwind-merge`, `nprogress`.

| Class | Present? | Rating |
| --- | --- | --- |
| Advertising / ad ID | none | ✅ |
| Analytics / telemetry / crash upload | none — `lib/telemetry.ts` routes to an on-device ring buffer | ✅ |
| Firebase / GMS | **none** — no `google-services.json`, no `com.google.android.gms` | ✅ |
| Social / login SDKs | none | ✅ |
| Location / contacts / SMS | none | ✅ |
| Tracking-capable third party | none | ✅ |
| Native binaries | `libsqlcipher.so` × 4 ABIs (16 KB-clean) | ✅ |
| Print plugin (`@capgo/capacitor-printer`) | local, adds no permission in this manifest; 8.1.6 → 8.1.8 owed | ⚠ Low |
| Tooling with known advisories (**not shipped**) | `@capacitor/cli`, `electron-builder` chain, `patch-package`, `braces` | ⚠ Medium for the CI supply chain, nil for Play |
| Staleness | 10 prod deps behind, incl. two majors (`motion` 12→14, `lucide-react` 0.546→1.59); no pin-evidence doc for shipped versions | ⚠ |

**SDK Risk Rating: LOW (≈1.3/10 risk).** The complete absence of any third-party data-processing SDK
is the strongest single Play position this app holds.

---

## 11. Ads & monetization

- Ads: **none** → Ads Policy N/A. Answer "No".
- IAP / subscriptions / digital goods: **none**; no `com.android.vending.BILLING_REQUEST`, no Play
  Billing dependency. Answer "No". Listing states it.
- Play's *Payments – Clinical Services* carve-out: lab-service transactions must **not** go through
  Play billing — correctly not used; billing here is on-device bookkeeping only.
- Interstitials / rewarded / ad frequency / placement: N/A.
- Price: free; MIT; public repo — the brochure's "Free · Open source (MIT)" is true.
- **MN-1 ⚠ P1** — the referral-commission engine. `DoctorsPage.tsx:816-850` is a one-tap sheet to set
  a **10 / 20 / 30 / 50 %** rate with the hint *"Share of each referred patient's discounted bill
  credited to this doctor"*, and the only warning is a code comment (`referrals.ts:28-35`: ICMR
  ethical guidelines, NMC professional-conduct rules, NABH standards treat referral inducement as
  misconduct). The 2.7.7 round *added* long-press access to this sheet, widening discoverability, and
  added no user-facing caveat. Play does not prohibit the feature (it is the lab's money, nothing is
  transmitted, default rate 0), but a Play reviewer who opens the doctors screen and reads a 50 %
  referral-rate preset alongside a Medical category is a bad first impression — and India's rules are
  the real exposure.
  Fix: one line in that sheet + one in Settings → Manage Tests whenever a non-zero rate exists; keep
  it out of screenshots and the listing (already true); get the payout model reviewed.

**Monetization Compliance Score: 88 / 100** (down from 95: the commission entry point became more
discoverable in 2.7.7 with no matching disclosure).

---

## 12. Performance

| Metric | Evidence | Assessment |
| --- | --- | --- |
| APK size | 17 142 458 B (2.7.7). Of that, `libsqlcipher.so` × 4 ABIs = 7 622 448 B, and **3 161 224 B is image weight**: `logo.png` + `p-logo.png` (identical SHA-256, referenced nowhere in `src/`, `index.html` or the built JS) plus a second copy of the 512 px mark as `brand-p.png` | ⚠ **PF-1 (P2, but free to fix)**: ~3.1 MB / 18 % of the APK is dead or duplicated. Add `logo.png`, `p-logo.png` to a dead-asset list (or delete from `public/`) and de-duplicate `brand-p.png` |
| AAB | **does not exist for 2.7.7** (PL-1); the 2.7.4 bundle is 12.28 MB and per-ABI splits would cut device downloads to ≈9-10 MB | 🚨 |
| JS payload | main chunk 575 753 B, `pdf.worker` 1 264 342 B, recharts 397 943 B, jspdf 378 984 B, html2canvas 198 914 B, motion 136 366 B; `dist/` 7.84 MB | ⚠ main chunk heavy, but every route is `React.lazy` ✅ |
| Startup | HTML splash paints at 0 ms; NProgress per route | ✅ perceived startup good |
| ANR risk | SQLCipher off-main (plugin); mutations serialised (`sqliteRepository.ts:144`); `loadPriceList()` is `async` wrapping a **synchronous `localStorage.getItem`** (`price-list.ts:216,257`) at boot | ⚠ low; watch the large-catalogue case |
| Crash risk | `window.onerror` + `unhandledrejection`, per-route ErrorBoundary, **44 test files passing**, coverage 87.11/81.45/85.61/88.92, 0 lint errors | ✅ strong |
| Memory | in-memory filter/sort of the whole store (`data/query.ts`), no pagination push-down | ✅ with a ceiling for one lab |
| Battery | no network, no periodic job, no exact alarms, no boot receiver; idle timers only | ✅ |
| Background services | no `Service` in the packaged manifest; only AndroidX `ProfileInstallReceiver` (permission-gated, standard) and the plugin's non-exported publishers | ✅ |
| Play vitals | **no history at all** — no pre-launch report has ever been run on any PathoMitra bundle | ❌ owed |

**Performance Score: 82 / 100.**

---

## 13. AI compliance

No AI/ML dependency, no inference path, no generated content. `marketing-claims.test.ts:39-44` bans AI
wording in every marketing surface with the code citation that proves it false, and `terms.ts:51`
states the truth: *"performs arithmetic on entered values for derived indices only"*.
→ Google's AI-generated-content requirements are **not triggered**. If OCR / auto-suggestion / slide
analysis is ever added, disclosure + reporting + safety requirements activate and both the Data Safety
form and the Health apps declaration must be re-answered.

---

## 14. Trust & Safety

| Requirement | Status | Evidence |
| --- | --- | --- |
| Content moderation / reporting / blocking | ✅ N/A | no UGC, no feed, no messaging, no multi-user |
| Abuse prevention (falsified reports) | ⚠ P1 | `terms.ts:76-79` forbids fabricating, backdating or misrepresenting a signer, but there is **no enforcement, no audit-trail export and no reporting channel**; `terms.ts:71` honestly says the app "cannot prove that a document was never altered" |
| Reference-range caveat | ⚠ P2 | **TS-1** — `pathology-tests.ts:1996-2001` computes `unverifiedForPatient` for out-of-population ranges and for `requires-lab-verification` bands, and `:42` states it "is rendered as a badge on the report". **No renderer reads it** (0 consumers outside `pathology-tests.ts`/its test). The safety caveat is computed and thrown away. Only 2 bands are currently flagged (the older "72 bands" figure in `PROJECT_MEMORY.md` is stale) |
| Printed-report disclaimer | ✅ / owner decision | `report-compliance.ts:139-140` returns empty `signer`/`disclaimer` by owner decision 2026-10-12; all accreditation text is operator-supplied behind a personal attestation (`:80-86`, `terms.ts:44`). Play's mandatory disclaimer belongs in the **listing**, not the report — see HL-1 |
| Data-protection duties | ⚠ | DS-1..DS-3; plus the data-loss reality: no server backup means a lost device with no export loses the lab (`play-listing.md:246-248`) |
| Support / takedown channel | ✅ | `pathomitra@healthcarediagnosticscenter.in` in policy + Console fields; unstaffed "Clinical Advisory"/"Press Inquiries" mailtos removed and banned |
| Vulnerability contact | ✅ | `SECURITY.md` |
| DPDP 2023 (India) | ⚠ P2 | correctly positions the lab as Data Fiduciary, but there is **no Grievance-Officer field** the lab must fill before a first report prints; the hosted policy mentions "Grievance Officer" as an obligation without a place to record one |

---

# Final Report

| # | Score | Value | Basis |
| --- | --- | --- | --- |
| 1 | **Overall Compliance** | **58 / 100** | binary + permissions + encryption + hygiene are exemplary; the *declarations* are wrong in the one place Play can enforce after publication (Data Safety), the mandatory Health apps declaration and health disclaimer do not exist in the plan, and there is no uploadable bundle for the current version |
| 2 | **Google Play rejection risk, uploading today** | **≈ 95 %** | no 2.7.7 AAB, no screenshots/feature graphic, no Health apps declaration, "all-No" Data Safety, uncommitted/un-tagged provenance — the submission cannot even reach "start review" |
| 2b | Rejection risk after the A-list | **≈ 25 %** | residual: Medical-category evidence, personal-account production gate, no on-device verification yet |
| 3 | **Security** | **84 / 100** | Android binary ≈ 92; − CSP on the native origin, − name-unredacted crash log, − signing identity, − provenance |
| 4 | **Privacy** | **71 / 100** | best-in-class minimisation; − stale hosted policy, − inaccurate banner sentence, − Data Safety mis-declaration |
| 5 | **Accessibility** | **66 / 100** | real primitives + measured contrast; − 211 px-locked sizes with no `fontScale` bridge, − 32 px targets, − zero TalkBack pass |
| 6 | **UX** | **76 / 100** | coherent Material-ish system, excellent error/empty/loading states; − font scale, − no dark-mode follow, − mega-files, − UUID banners |
| 7 | **Monetization Compliance** | **88 / 100** | free / no ads / no IAP, correctly outside Play billing; − the undiscovered-caveat commission sheet |
| — | **Performance** | **82 / 100** | −3.1 MB dead/duplicate images, − 4 ABIs in an APK, − no AAB, − no Play-vitals history |
| — | **Permissions** | **96 / 100** | enforced allow-list; − unfiled declarations |
| — | **SDK risk** | **1.3 / 10** (LOW) | zero third-party data processors |

## Risk matrix

| Area | Status | Risk | Severity |
| --- | --- | --- | --- |
| Data Safety answers drafted as "no data collected" (DS-1) | 🚨 Likely rejection / post-publication enforcement | Critical | P0 |
| Health apps declaration form not in the plan (HL-3) | 🚨 Blocker | Critical | P0 |
| No AAB for 2.7.7; stale 2.7.4 bundle as `app-release.aab` (PL-1) | 🚨 Cannot submit | Critical | P0 |
| Screenshots + feature graphic absent | 🚨 Blocker submission | High | P0 |
| Uncommitted tree, no tag for any 2.6.x/2.7.x (PL-2) | 🚨 Provenance | High | P0 |
| Mandatory "not a medical device…" + "consult a professional" wording missing from the description (HL-1/HL-2) | ❌ High risk | High | P1 |
| Hosted policy ≠ in-app policy; "backed by hardware" still live on the web (DS-2) | ❌ High risk | High | P1 |
| Listing claims "Android hardware keystore" the corrected policy retracts | ❌ High risk | Med-High | P1 |
| No system font-scale path — 211 px-locked sizes (UX-1) | ❌ High risk (a11y) | Med-High | P1 |
| No system dark theme (UX-3) | ⚠ Needs improvement | Med | P1 |
| `FLAG_SECURE` default-on ⇒ black pre-launch/reviewer screenshots (PL-3) | ⚠ Needs decision | Med | P1 |
| Personal-account production gate: 12 testers × 14 days (PL-4) | ❌ Blocks release | Med-High | P1 |
| No reviewer access story for the passcode/biometric/lockout app (PL-5) | ⚠ Needs improvement | Med | P1 |
| Referral commission 10-50 % presets, no in-product caveat (MN-1) | ⚠ Needs improvement | Med | P1 |
| No CSP on the native WebView origin (SEC-1) | ❌ High risk (hardening) | Med | P1 |
| Permission use cases drafted but not filed | ⚠ Needs improvement | Low-Med | P1 |
| `unverifiedForPatient` computed, never rendered; code comment claims a badge (TS-1) | ⚠ Needs improvement | Med | P2 |
| Banner "registration number" claim is a UUID (DS-3 / UX-8) | ⚠ Needs improvement | Low-Med | P2 |
| ~3.1 MB dead/duplicate images in the APK (PF-1) | ⚠ Needs improvement | Low | P2 |
| Crash log does not redact names (SEC-2) | ⚠ Needs improvement | Low | P2 |
| 10 prod deps behind, 2 majors (motion, lucide-react) | ⚠ Needs improvement | Low | P2 |
| Cert DN `O=PathLab OS`; keystore on OneDrive; no Play App Signing decision | ⚠ Needs improvement | Med | P2 |
| `<access origin="*" />` in tool-generated `config.xml`; `og:url` in the binary | ⚠ Needs improvement | Low | P2 |
| No Grievance-Officer field for the lab (DPDP) | ⚠ Needs improvement | Low | P2 |
| Permissions set (6, none dangerous, none unused) | ✅ Fully compliant | — | — |
| No INTERNET / no ads / no analytics / no Firebase / no tracking SDK | ✅ Fully compliant | — | — |
| 16 KB page size (zipalign + ELF `p_align`, re-verified on 2.7.7) | ✅ Verified compliant | — | — |
| targetSdk 36 (Aug-2026 API requirement) | ✅ Verified compliant | — | — |
| Data at rest (SQLCipher + AndroidKeyStore master key) | ✅ Verified compliant | — | — |
| Backup + device-transfer exclusion | ✅ Fully compliant | — | — |
| Release flags (not debuggable, R8, resource shrink, minify) | ✅ Fully compliant | — | — |
| Web-deploy-only assets absent from the APK | ✅ Verified compliant | — | — |
| Ads / subscriptions / IAP / AI / UGC / News policies | ✅ Not triggered | — | — |
| Gates: 0 lint errors / 44 test files / 87 % coverage / 0 prod CVEs | ✅ Fully compliant | — | — |

## A. Critical fixes before release (ordered, blocking)

1. **Rewrite the Data Safety answers to "collected = Yes, shared = No"** (`docs/play-console-submission.md`
   §5 + `docs/play-listing.md` §2) using the §3 table; encrypted in transit = **No**, at rest = Yes,
   deletion = Yes in-app. (DS-1)
2. **Add the Health apps declaration to the plan** and answer it *Medical → Healthcare Services and
   Management*, explicitly **not** "Medical Device Apps". (HL-3)
3. **Add the two mandated sentences to the full description** — the "not a medical device and does not
   diagnose, treat, cure, or prevent any medical condition" disclaimer and a "consult a healthcare
   professional" reminder — and drop `play-listing.md:65-66,147` "hardware keystore" down to the honest
   wording. (HL-1, HL-2)
4. **Deploy the regenerated brochure** so `/privacy` serves the 13 624 B document, then re-run the
   strict probe. Owner deploy gate — this needs an explicit go. (DS-2)
5. **Commit the round, tag it, and build the bundle from the tag**: commit → `git tag v2.7.7` →
   `npm run verify:android` (release path) → copy the AAB to `buildoutput/android/` **and delete or
   rename the stale 2.7.4 `app-release.aab`** so it cannot be uploaded by accident. Re-probe the new
   bundle's `assets/public/index.html` for the policy URL. (PL-1, PL-2)
6. **Produce the listing assets** — ≥2 screenshots from the installed release build with synthetic
   patients (`Test Patient One`, `9000000001`) + the 1024×512 feature graphic. Temporarily
   Settings → Security → Allow screenshots, then turn it back on. (Screenshots, PL-3)
7. **File the Console declarations**: audience (adults/professionals), IARC, permission use cases
   (`POST_NOTIFICATIONS`, `WAKE_LOCK`, `USE_BIOMETRIC`/`USE_FINGERPRINT`), ads = No, IAP = No,
   news = No, plus the reviewer-access note that walks onboarding. (PL-5, §2)
8. **Confirm the developer-account type/creation date** and, if personal and post-13-Nov-2023, start
   the 12-tester / 14-day closed test immediately — it is the longest pole in the schedule and cannot
   be compressed. (PL-4)

## B. Recommended improvements

- Convert the 9/10/11/12/13 px literals (169 of 211 sites) to `rem`, or bridge `Configuration.fontScale`
  into WebView `textZoom`; then add an ESLint rule banning sub-12 px arbitrary text so it cannot regress.
  (UX-1)
- Follow `prefers-color-scheme` for the default theme mode, add `values-night/` for the splash/status
  bar, and a second `theme-color` with `media="(prefers-color-scheme: dark)"`. (UX-3)
- Add a CSP to the native origin (`index.html` meta or a Capacitor `WebViewAssetHandler`) with a
  `script-src 'self'`, verified on a phone — the reason it was left out last round is that only a
  device can prove it does not break the app. (SEC-1)
- Give patients a real human-readable registration number (YYMM-series) and use it in `bannerTitle`
  and the policy, instead of a UUID. (DS-3, UX-8)
- Render `unverifiedForPatient` as the badge its own comment promises, or delete the computation and
  the comment. (TS-1)
- One-line ICMR/NMC notice in the commission sheet + Settings when a rate > 0 exists. (MN-1)
- Add a name-shaped redaction to `crash-log.ts` or document the accepted risk. (SEC-2)
- Delete `logo.png` + `p-logo.png` (2.73 MB) and de-duplicate `brand-p.png` (0.40 MB) from the APK
  payload — a free 18 % size cut on the shipped binary. (PF-1)
- Re-issue the signing cert with `O=PathoMitra`, enable **Play App Signing**, and move
  `pathlab-release.jks` + `keystore.properties` off the OneDrive tree with an off-machine backup.
- Drop the empty cordova compatibility module so `<access origin="*" />` stops appearing in reports.
- Bump `@capacitor/filesystem`, `@capgo/capacitor-printer`, `jspdf-autotable`, `react(-dom)`,
  `recharts`, `tailwind-merge`, `zod`; treat `motion` 12→14 and `lucide-react`→1.x as their own
  reviewed changes.
- Add a Settings → Lab Organization **Grievance Officer** + licence-number field (DPDP) that prints on
  the report only when the attestation is ticked, following the existing accreditation pattern.
- Split `ReportsPage.tsx` before the next feature lands.

## C. Play Store approval readiness

| Gate | Readiness | Note |
| --- | --- | --- |
| Binary / permissions / encryption / page-size / target-SDK | **96 %** | the strongest surface; enforced by the build itself |
| Data-practice truthfulness (in-app policy, terms, disclaimers) | **88 %** | honest and code-mapped; DS-3 + listing keystore wording are the misses |
| **Data Safety + health declarations** | **15 %** | the drafted answers are wrong (DS-1) and the Health apps declaration is not even in the plan (HL-3) |
| Listing text | **65 %** | disciplined copy, missing the two mandated health sentences |
| Listing assets | **0 %** | nothing exists |
| Artifact provenance | **10 %** | uncommitted, untagged, wrong-version AAB in the upload path |
| Console / account / release track | **10 %** | not started; the 14-day closed test may be mandatory |
| On-device verification + Play vitals | **0 %** | no pre-launch report on any bundle, ever |
| **Composite submission readiness** | **34 %** | up from 28 % in round 4 only because the policy URL is now live; the declaration findings are newly discovered |

## D. Action plan

**1 day**
1. Rewrite §5 of `docs/play-console-submission.md` and the Data Safety block of `docs/play-listing.md`
   to "collected Yes / shared No" with the §3 type table. (DS-1)
2. Add HL-1 + HL-2 sentences and fix the two "hardware keystore" lines in the listing text; add both
   new phrases to the banned/required-claim guard so a future rewrite cannot drop them.
3. Add the Health apps declaration to the checklist with the exact answer.
4. Fix DS-3 (reword the policy or mint a real registration number).
5. Delete the dead 2.73 MB images; re-run `npm run verify`.
6. Commit the 2.7.7 round and `git tag v2.7.7`.

**1 week**
7. Owner: deploy the regenerated brochure → strict probe green.
8. `npm run verify:android` from the tag; copy the new AAB to `buildoutput/android/`; rename the stale
   2.7.4 bundle `STALE_2.7.4_DO_NOT_UPLOAD.aab`.
9. Install 2.7.7 **over** the running 2.7.x on the lab phone (same key, no uninstall) and walk: report
   issue with blank results, amendment → v2, long-press commission, bill headed with the lab's own
   name, sealed-backup restore on a second device, print on real paper, TalkBack + 200 % font, the
   UUID-vs-registration-number banner, and a screenshot while protection is on (expect black) and off.
10. Capture the screenshots + feature graphic from that build.
11. Console: create the app, answer audience / IARC / Data Safety / **Health apps declaration** /
    permission use cases, enable Play App Signing, upload the AAB to internal, then start the closed
    test with ≥12 testers (day 1 of the 14, if the account is personal).
12. Read the Play pre-launch report; triage any crash/ANR/16 KB/arm64 finding.

**1 month**
13. Font-scale rem conversion + dark-mode follow + native CSP, each with a regression test and a real
    device pass.
14. Production-access application once the 14-day window closes; promote crash < 1.0 % / ANR < 1.5 %.
15. Referral-commission legal review (ICMR/NMC/NABH) before any lab sets a non-zero rate.
16. Reference-range sign-off by the lab director for the `requires-lab-verification` bands; decide the
    TS-1 badge; `F-1` PDF Unicode font (bills print `Rs.` not `₹`, Devanagari names blank).
17. CI: add `check:android`, `build:privacy`, a live policy probe, **and an AAB-freshness assertion**
    (bundle mtime/version must match `package.json`) so a stale bundle can never be the one uploaded.

## E. Probability of passing Google Play review

| Scenario | First-pass approval probability |
| --- | --- |
| Upload the tree as it sits (2.7.7 APK + stale 2.7.4 AAB, no assets, all-No Data Safety) | **≈ 5 %** — the listing is incomplete and Production may be disabled outright |
| After A-1…A-8 (declarations + assets + tagged rebuild + policy deploy) | **≈ 55 %** — Medical-category evidence and an untested device invite manual review |
| After all of A + B + on-device verification + clean pre-launch | **≈ 85 %** |
| Residual risk | laboratory-licensing evidence requests; the individual-vs-organisation account question (not verifiable from public policy text — confirm in the Console); the Health declaration reviewer rubric; a reviewer reading the commission presets |

## F. Remaining-task checklist

- [ ] Data Safety re-drafted: collected **Yes** (Name, Phone, Address, User IDs, Other personal,
      **Health info**, Financial info, Files and docs), shared **No**, transit **No**, rest **Yes**,
      deletion in-app **Yes**
- [ ] **Health apps declaration** completed (Medical → Healthcare Services and Management; not a
      medical device)
- [ ] Long description carries the mandated non-device disclaimer + consult-a-professional reminder
- [ ] Listing says "Android Keystore", not "hardware keystore"; and the policy stops saying
      "backed by hardware"
- [ ] Hosted policy = the 13 624 B regenerated page; `check-release-config.mjs` strict probe green
      against the *current* document, not a stale one
- [ ] Tree committed, `v2.7.7` tagged, AAB built from the tag, stale 2.7.4 bundle renamed
- [ ] ≥2 screenshots from the installed release build + 1024×512 feature graphic (protection off, then
      back on)
- [ ] Console: audience, IARC, permission use cases, ads=No, IAP=No, news=No
- [ ] Account type/creation date confirmed; if personal post-13-Nov-2023 → closed test with 12
      continuously opted-in testers for 14 days, then production-access application
- [ ] Reviewer-access note describing onboarding step by step, inside the 5-minute re-lock window
- [ ] Play App Signing enabled; cert re-issued `O=PathoMitra`; keystore off OneDrive + off-machine backup
- [ ] On device: DB survives the in-place update; amend → v2; clock-forward lockout; `FLAG_SECURE`
      both ways; sealed restore on a second phone; real-paper print; TalkBack + 200 % font
- [ ] Pre-launch report clean (crash < 1.0 %, ANR < 1.5 %)
- [ ] Commission sheet carries the ICMR/NMC line; payout model legally reviewed
- [ ] `unverifiedForPatient` rendered or removed; the code comment no longer promises a badge that
      does not exist
- [ ] Dead/duplicate images removed (≈3.1 MB)
- [ ] Grievance-Officer + licence field added for DPDP
- [ ] Medical-category evidence pack (lab licence; "professional tool, not a diagnostic device")

---

### Verdict

Re-tested from the artifact, not the tree: the binary is cleaner than round 4 claimed — 6 permissions,
no `INTERNET`, no dangerous permission, 16 KB alignment proven twice (zip + ELF), targetSdk 36, not
debuggable, backups fully excluded, 0 production CVEs, 44 green test files, and zero third-party data
processors. That is a genuinely strong submission foundation, and nothing in the code needs to change
to get it.

What has not changed since round 4 is that **this app is submitted by paperwork, and the paperwork is
wrong in two places that matter more than any defect found last round.** The Data Safety draft answers
"nothing is collected" for an app that stores patients' names, phone numbers, addresses, genders and
pathology findings — Play defines storing as collecting, and it enforces the declaration after
publication, not only at review. And the Health apps declaration, plus the two sentences the Health
policy requires in the app description, are not in the plan at all: the repo's submission pack was
written without ever knowing that form exists. Around that, the artifact story is stale — the only
bundle on disk is a 2.7.4 build whose own filename says `PLAY-PENDING-POLICY-DEPLOY`, sitting in the
default output path under the neutral name Play would upload, while the tree it came from has never
been committed or tagged.

Close A-1…A-8 and this becomes a routine approval. Do not close DS-1 and the architecture you built to
protect patient data becomes the thing that gets the listing flagged.
