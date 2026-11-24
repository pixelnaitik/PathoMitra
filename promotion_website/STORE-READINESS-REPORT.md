# Store-Readiness Report — `promotion_website` vs Google Play + Microsoft Store

Date: 2026-10-14 (version references refreshed to the current 2.7.2 build on 2026-10-16 — the audit
findings themselves are unchanged). Scope: the brochure site in this folder, checked against the real
submission requirements of both stores and against the app it advertises (`com.pathomitra.app`, repo
version **2.7.2**, HEAD `dd0bf88` on `desktop-electron`).

Method: every statement below is from reading this folder, the parent app source, `docs/play-listing.md`,
`PROJECT_MEMORY.md`, live DNS/HTTP checks from this machine, and the current Google Play / Microsoft
Learn policy pages (fetched today). Anything I could not verify is in §8 — do not treat it as done.

---

## 0. Owner decisions + what has already been fixed (same day)

Two questions were asked and answered on 2026-10-14:

| Decision | Answer | Effect on this report |
| --- | --- | --- |
| Domain + mailbox for `support@` / privacy URL | **"I will add it later"** | §2.1 and §2.2 stay open. Nothing that needs a contact field can be submitted until then — Play Console, the Data Safety form's contact block, and Microsoft's Support info all read from it. §7 resequenced so the domain-independent work happens first. |
| Windows distribution | **Direct download only** (signed MSI from `/download`) — **Microsoft Store deferred** | **§6 becomes a reference, not a to-do list.** The MSIX/electron-builder-27 blocker in §2.4 is no longer a submission blocker; the age-rating questionnaire, Store screenshots ≥1366×768, `identityName` reservation and Partner Center enrollment drop out of scope. What *stays* required for a self-hosted Windows build: honest system requirements, a per-platform privacy statement, a checksum + provenance on `/download`, and code signing (SmartScreen currently warns — the 2.7.2 MSI is `NotSigned`). |

Already fixed in this folder, verified by the bundle (§9 list updated):

- §4.1 `Share by SMS, email or WhatsApp from the app` → `Print, save or share the PDF via the
  Android share sheet` (`SolutionsPage.tsx:99`).
- §4.2 Footer's invented entity + clinical claim → `© 2026 PathoMitra · Lab Management Simplified.`
- §4.3 Hero mock `Verified`/`Signed` → `Issued`/`Draft`, with a comment recording why.
- §4.4 Hero strapline `No setup` → `No server to set up`, and the encryption/offline claims scoped to
  Android; `index.html`'s `twitter:description` updated in the same pass so the share card agrees.
- Gates after the change: `tsc --noEmit` **0** · `vite build` **exit 0** (2106 modules, 444.02 kB JS /
  138.19 kB gz) · old strings **absent** from `dist/assets/*.js`, new strings **present**.

✅ **The parent-app copy is now fixed too (2026-10-15, `dd0bf88`, audit round 3 / AM-3):** the
in-app `src/pages/{SolutionsPage,Hero,HowItWorks}.tsx` claims were corrected to the same wording and
3 banned-claim rules added to `marketing-claims.test.ts` so neither fork regresses. The 2.7.2 APK no
longer ships the removed-channel claim. (This closes the note that read "outside this workspace — needs
a repo-root session"; this is that session.)

---

## 1. Verdict

The brochure is **good marketing and not yet a store-supporting site.** Its privacy writing is strong
(it matches the Data Safety answers), but the stores' *hard requirements* are mostly not on the site,
and two of them are attached to addresses that do not exist.

| Area | Play | MS Store | Site today |
| --- | --- | --- | --- |
| App name / short / full description | required | required | ✅ copy exists in `docs/play-listing.md`, ❌ not on the site |
| Privacy policy on a domain you own | required | required (app processes personal data) | ❌ points at a URL that does not resolve |
| Support email / phone / postal address | required (Console contact) | required (Support info) | ❌ email domain is dead; no phone/address anywhere |
| Screenshots | min 2 (320–3840 px) | min 1 Desktop ≥ 1366×768 | ❌ none — the site only has a CSS/SVG mock |
| Feature graphic 1024×500 | **required to publish** | optional (promo assets) | ❌ does not exist |
| Icon 512×512 ≤ 1 MB | required | package tiles required | ✅ `public/android-chrome-512x512.png` (313 KB) |
| Terms / EULA | recommended | listing field (custom license terms) | ❌ no page |
| System requirements | from manifest | structured fields | ❌ absent |
| Per-platform disclosure (Android vs Windows vs Web) | implied by policy accuracy | required for certification | ⚠ Android-only policy |
| Store deep links / badges | — | — | ❌ site has zero download path (all CTAs are `mailto:`) |

**Three things block both submissions and are not website-editing problems:** the `pathomitra.app`
domain + mailbox, the privacy-policy hosting, and (for the Store) an MSIX package. Details in §2.

---

## 2. P0 — broken right now (verified, not theoretical)

### 2.1 `pathomitra.app` does not exist in DNS

```
Resolve-DnsName pathomitra.app   →  DNS name does not exist   (NS: NXDOMAIN, MX: NXDOMAIN)
control: www.cloudflare.com      →  resolves fine (so this machine's DNS is working)
```

Consequences:

- `support@pathomitra.app` — hardcoded in **three** places (`src/lib/contact.ts:8`,
  `src/lib/privacy-policy.ts:26`, `src/components/Footer.tsx:4`) — **cannot receive mail.** Play
  Console's contact email and the listing's developer contact both use it; Microsoft's Support info
  requires valid contact details, and a bouncing support address is a classic certification failure.
- `PRIVACY_POLICY_URL = 'https://pathomitra.pages.dev/privacy'` (`src/lib/privacy-policy.ts:29`)
  also **does not resolve** from here — so the policy link inside your own published policy text is
  dead, and the site itself is not deployed anywhere (`.github/workflows/deploy.yml` builds the
  **root app** to Pages project `pathomitra`; nothing in CI touches `promotion_website/`, and this
  folder's `dist/` is the 2026-10-13 build).
- `PROJECT_MEMORY.md` Next item 2 already tracks this as the single hard blocker (`.env` still holds
  `privacy@pathomitra.test` / `policy.pathomitra.test`, which `scripts/check-release-config.mjs`
  rejects on purpose).

**Fix:** register `pathomitra.app` (or pick a domain you truly own), put MX/Zoho/Google Workspace on
it, decide the two addresses (`support@`, `privacy@` or `dpo@`), and deploy this brochure to it. Until
then every store field that takes an email or URL is unfillable.

### 2.2 The privacy URL must be plain HTML on your own domain — the brochure cannot be it

`docs/play-listing.md` §2 says the guard rejects `pages.dev` / `vercel.app` / `netlify.app` /
`github.io` and does a **live fetch requiring the hosted page to name the same contact**. Two
problems stack here:

1. `https://pathomitra.pages.dev/privacy` is a platform subdomain → rejected by your own guard, and
   it is exactly what Google's medical/health reviewers poke at.
2. This brochure is a **HashRouter SPA** (`src/App.tsx:37`). Served without JS, `/privacy` is not
   even a route — a no-JS fetcher sees an empty `<div id="root">`. A policy that a crawler or a
   reviewer's `curl` cannot read fails the spirit and often the letter of both stores' checks.

**Fix:** keep the brochure's `/privacy` page as the human-friendly copy, and make the **console
field** point at `https://<your-domain>/privacy/` built by `npm run build:privacy` (the repo already
generates `privacy-site/index.html` + `terms.html` as JS-free HTML from `src/lib/privacy-policy.ts`).
Then set the brochure's `PRIVACY_POLICY_URL` to that same canonical URL so the two cannot drift.

### 2.3 No store assets exist at all

Required, missing, and currently nowhere to generate them from:

- Play **feature graphic** 1024×500, JPEG or 24-bit PNG **no alpha** — Google: *"You must provide a
  feature graphic to publish your store listing."* Also fixes the site's `og:image`, which today
  points at the 512 icon (`index.html:34`) while `twitter:card` is `summary_large_image` — the share
  card renders wrong.
- Play **screenshots**: minimum 2 across device types, 320–3840 px, the long side ≤ 2× the short
  side; phone art in 9:16 / 16:9, and if you enable tablets/Chromebook, **4** screenshots at
  1 080–7 680 px. **Alt text ≤ 140 chars is now requested per graphic asset.**
- Microsoft **screenshots**: 1 required (recommend 4), Desktop ≥ 1366×768 (4K supported), PNG ≤ 50 MB,
  and **captions ≤ 200 chars** each. Plus the recommended **1:1 app tile 300×300** (Store overrides
  the package logo with it).
- The `docs/play-listing.md` checklist itself says: *"Screenshots must come from the installed release
  build, plus the 1024×512 feature graphic — neither exists yet for PathoMitra."*

**Fix:** add a `/media` (press-kit) page here and make it the single source of both stores' art, so
the two forks of this marketing code stop generating assets separately.

### 2.4 Microsoft Store cannot take what you build today

- The Store requires an **MSIX/APPX package**. `electron-builder.config.mjs` states plainly:
  *"msix is deliberately absent: electron-builder 26.15.3 has no msix target at all… MSIX comes back
  only as a Microsoft Store artifact, on electron-builder 27.x."* Today's artifact is
  `PathoMitra-*.msi` (perMachine, oneClick, **NotSigned**) — that is an SCCM/direct-download
  deliverable, **not** a Store submission.
- `appx.identityName: 'PathoMitra.PathoMitra'` and `publisher: 'CN=Naitik Raj'` are set, but
  `PROJECT_MEMORY.md` records the unresolved dependency: *"MSIX identityName must match the Partner
  Center reservation before submission."* If the Partner Center account is enrolled as an
  **Individual**, your display name is your legal name (`Naitik Raj`) and the CN must match it; if
  you later enroll as a **Company**, the publisher CN changes and every previously built package
  breaks. Decide the enrollment type before building anything for the Store.
- The MSI has **never been run after install** (memory, Next item 5) — a Store submission fails
  hard-certification on a crash, and an app that cannot install/uninstall cleanly is an automatic
  kill.
- `capabilities: ['runFullTrust']` (packaged-desktop escape hatch) means Microsoft's "capabilities
  drive the privacy question" rule bites: with `runFullTrust` you cannot claim "no network" the way
  the Android manifest lets you. The Store listing therefore needs its own honest Windows text (§4).

---

## 3. P1 — content the stores ask for that this site does not carry

Add these pages/sections. Column "Source" says where the truthful copy already exists, so nobody has
to invent anything.

| # | Add here | Why a store needs it | Source of truth |
| --- | --- | --- | --- |
| 1 | **`/download`** — Android + Windows + "in-browser" chooser, Play/Store badges, direct MSI link, version, file size, SHA-256, release date | Both listings have a Website field and reviewers follow it. Today the site's only action is `mailto:` — a lab that lands here has no path to either store | `buildoutput/`, package.json version |
| 2 | **`/terms`** (Terms of Service + the Windows EULA text) | Play: TOS is expected wherever you promise professional use; Microsoft: custom license terms field; also the place to state "no warranty of clinical outcome" | new text, reuse the DPDP/GDPR paragraphs from `lib/privacy-policy.ts:80-83` |
| 3 | **`/support`** — monitored email, **phone**, **postal address**, hours, response-time target, DPDP grievance line, "what to do if a device is lost" | Play Console developer contact requires email + phone + address; MS Support info wants contact + URL. `docs/play-listing.md` §4 item 2 explicitly says "a real support mailbox… appears in the policy, in the Console contact fields and in the DPDP grievance line" | decision owed (see §8) |
| 4 | **`/security` or extend `/technology`** — per-platform table: Android (SQLCipher + hardware keystore, banner-only alerts, `FLAG_SECURE`), **Windows** (`better-sqlite3-multiple-ciphers` + Credential Locker/DPAPI, print path), **Web** (plain `localStorage`, unencrypted) | Both stores judge "is the description accurate" per platform. Today the policy text is **Android-only**; the Windows build's key storage is DPAPI, not a hardware keystore (memory: "DPAPI vs hardware Keystore asymmetry", SECURITY.md owed) | `data/index.ts`, `lib/desktop-*`, `electron/main.ts` |
| 5 | **Permissions & capabilities page** — the 7 Android permissions with one-line rationales, "no dangerous permissions", and the Windows `runFullTrust` + offline statement | Play asks for a permission rationale in the Data Safety/sensitive-permission flow (POST_NOTIFICATIONS, WAKE_LOCK, RECEIVE_BOOT_COMPLETED are already flagged in `docs/play-listing.md` §5) and **exact-alarm is stripped, so the listing must not promise timed alerts** | merged release manifest via `npm run check:android` |
| 6 | **`/system-requirements`** | MS has structured Requirements fields (**≤ 11 items each** for minimum/recommended hardware, ≤ 200 chars per item) + a listing "Additional system requirements" block; Play shows the Android version from the manifest | `variables.gradle`: minSdk **28** (Android 9), targetSdk/compileSdk **36**; `appx.minVersion 10.0.17763` (Win 10 1809), `maxVersionTested 10.0.26100`, x64 only |
| 7 | **`/changelog`** (or a "What's new" block on `/download`) | MS "What's new in this version" ≤ **1 500 chars** and is required on every update after the first; Play release notes per rollout | git tags + `npm run release:dry` |
| 8 | **Pricing / licensing statement** — free or paid, no ads, no IAP, no subscription, no data sale | Play declares Ads = No, IAP = No; MS has Pricing + Product declarations. The site currently promises nothing about price, so the Console answers have no public counterpart | `docs/play-listing.md` §2 declarations |
| 9 | **Adults / professional-use-only statement** | Play target-audience declaration (and the Families rules if you ever declare under-13); MS age-rating questionnaire (IARC) must match your public positioning | `docs/play-listing.md` §2 "Adults and professionals only" |
| 10 | **"Not a medical device" line, in plain sight** | Play's **Health apps declaration is mandatory for every app** (since 2024) and the Jan-2026 medical-device labelling regime adds MDR/IVDR disclosures (SRN, UDI-DI, eIFU, Notified-body number) you cannot supply — so the site and the form must both say the app is a records/billing console, not a regulated device, and it must **not** select "Medical Device Apps" or "Clinical Decision Support" | `report-compliance.ts` + the "not a diagnostic device" sentences already in the policy |
| 11 | **Accessibility statement** (WCAG 2.1 AA posture, known gaps, contact) | EU enforcement for lab software plus both stores' growing expectation; you already do the work (`reducedMotion="user"`, skip-link, `#main-content` per page, aria-hidden decoration) — say it out loud | `src/App.tsx`, `index.css` |
| 12 | **Data-safety summary block** (mirrors the Play form in human prose: collected / shared / backed up / encrypted at rest / deletion) | Google compares the form against the policy and the website; a mismatch is what turns an auto-review into a manual one | `docs/play-listing.md` §2 Data Safety table |
| 13 | **`robots.txt`, `sitemap.xml`, canonical URLs, JSON-LD `SoftwareApplication`/`MobileApplication`** | A public site that advertises two store products should carry `sameAs` store URLs, `applicationCategory: MedicalBusiness`, `operatingSystem`, `offers.price: 0`; it also helps reviewers confirm the product identity. Root `public/` already has these files to copy the pattern from — **but** the SPA/hash routing means sub-pages are not crawlable; either ship prerendered HTML per route or move to BrowserRouter + Pages `_redirects` | root `public/robots.txt`, `sitemap.xml` |

---

## 4. Claims on this site that will read as inaccurate to a reviewer

Highest-value fixes, because both stores reject on **claim vs behaviour**, not on architecture.

1. **`Share by SMS, email or WhatsApp from the app`** — `src/pages/SolutionsPage.tsx:99` (same line
   exists in the parent app's `src/pages/SolutionsPage.tsx:99`). The app **removed** the
   Email/SMS/WhatsApp compose buttons on 2026-10-11 (`NotificationCenter.tsx:8-14`,
   `notification-engine.ts:13-17`, and `privacy-policy.test.ts:55` guards exactly this in the
   *policy*). What remains is the Android **system share sheet** (`lib/native-files.ts`,
   `ReportsPage.tsx:1450`) — where the *user* picks WhatsApp/Drive/email — and on Windows it is
   `bridge.shell.show()` (`native-files.ts:308-312`), i.e. **no share sheet at all**. As written the
   bullet promises an in-app messaging feature the app no longer has, and one Windows certainly
   lacks. → Reword: *"Hand the issued PDF to any app on your phone through the Android system share
   sheet."* Add a Windows-accurate line ("opens in your default app").
2. **`© 2026 PathoMitra Diagnostic Systems. Clinical Grade Precision.`** — `Footer.tsx:98`. Two
   problems: (a) "Clinical Grade Precision" is a clinical-quality claim, and the whole compliance
   strategy is the opposite sentence ("not a diagnostic device", "no accreditation asserted");
   (b) **"PathoMitra Diagnostic Systems" is not the publisher of record anywhere** — the store
   publisher is `Naitik Raj` (`appx.publisherDisplayName`), and a mismatch between the site's legal
   entity and the Console's verified developer name is an impersonation/trademark flag, plus the EU
   DSA trader-info fields must be truthful. → Delete the claim; use the entity that is actually on
   the developer account, or register the company and change everything to match.
3. **Hero queue mock labels `Verified` and `Signed`** — `Hero.tsx:31-33` (+ the floating chip).
   `report-compliance.ts:39-41` deliberately avoids *"verified", "sealed", "tamper-evident,
   certified"* because there is no signing service, and `docs/play-listing.md` bans those words from
   listing text **and screenshots**. The mock is decorative (`aria-hidden`) but it is the image a
   reviewer sees first, and it is the thing that will get copied into a screenshot. → Rename to the
   app's real vocabulary (`Issued` / `Awaiting sign-off` / `Draft`), and never screenshot the web mock.
4. **`Runs offline · No setup · Encrypted on-device records`** — `Hero.tsx:307`. "No setup" is
   contradicted by a Windows install + first-run account creation + test-catalogue configuration, and
   "Encrypted on-device records" is platform-conditional (Trust.tsx:44-48 already admits the browser
   build is unencrypted). SolutionsPage already has the accurate version: *"No server to buy, install
   or maintain"*. → Use that everywhere.
5. **`PRIVACY_LAST_UPDATED = '11 October 2026'`** while the policy describes changes landed
   2026-10-13/14 (sealed backups, notification-channel removal, report footer). Both stores want the
   policy to match the uploaded build. → Re-date at submission and re-verify each of the three
   load-bearing claims the file's own header lists (`privacy-policy.ts:8-16`).

---

## 5. Google Play — field-by-field status

Limits and requirements verified today on support.google.com (Play graphics/metadata page) and
developer.android.com.

| Field | Limit / rule | PathoMitra | Status |
| --- | --- | --- | --- |
| App name | ≤ 30 chars | `PathoMitra` (8) | ✅ |
| Short description | ≤ 80, no superlatives / no CTA / no symbols | 79-char line in `docs/play-listing.md:26` | ✅ copy, not on site |
| Full description | ≤ 4 000 | ≈ 2 150 chars in `docs/play-listing.md` | ✅ copy, not on site |
| Icon | 512×512, 32-bit PNG with alpha, ≤ 1 024 KB | 313 KB | ✅ verify alpha |
| Feature graphic | **1024×500, JPEG/24-bit PNG, no alpha — required to publish** | — | ❌ |
| Screenshots | **min 2**; 320–3840 px; long side ≤ 2× short; tablet/Chromebook album min 4 | — | ❌ |
| Alt text per asset | ≤ 140 chars | — | ❌ not written |
| Promo video | optional, YouTube URL | — | ⬜ optional |
| Privacy policy | URL on a domain you own, readable without JS | pages.dev link, dead | ❌ P0 |
| Data safety form | all "no data collected"; at-rest yes; deletion in-app | answers written in `docs/play-listing.md:141-155` | ⚠ Console entry owed |
| Health apps declaration | **mandatory for every app**, incl. "no health features" | not answered; pick "Healthcare Services and Management"-style record/billing, **not** Medical Device Apps, **not** Clinical Decision Support | ❌ |
| Content rating | IARC questionnaire before publishing | not answered | ❌ |
| Target audience | declare; no under-13 | "adults and professionals only" in the doc | ⚠ Console entry owed |
| Ads / IAP / News | declare | No / No / No | ✅ answers exist |
| Account deletion | in-app or web | in-app `eraseAllData()` | ✅ |
| Contact email / phone / address | Console profile | email dead, no phone/address | ❌ P0 |
| targetSdk | **new apps + updates must target API 36 (Android 16) since 31 Aug 2026** | `variables.gradle: targetSdkVersion = 36` | ✅ verified |
| 16 KB page size | apps targeting API 35+ must support 16 KB pages (new apps from 1 Nov 2025; updates by 1 May 2026) | unverified in the AAB | ⚠ must assert on the artifact |
| Play App Signing + release keystore | required for new apps | keystore exists; Play App Signing state unverified | ⚠ checklist item open |
| Bundle format | AAB required | `app-release-2.7.2.apk` + `app-release-2.7.2-TEST-BUILD-DO-NOT-SUBMIT.aab` exist (2.7.2 / versionCode 2007002, test-build chain) | ⚠ real-`.env` rebuild owed |
| Pre-launch quality | crash < 1.0 %, ANR < 1.5 % (promo eligibility) | never run on a track | ❌ |

Also owed per `docs/play-listing.md` §5: real `.env` values, `check:android`-clean upload, screenshots
from the installed build, re-lock verification, `FLAG_SECURE` device test, sealed-backup restore test,
permission rationales for the three notification permissions.

---

## 6. Microsoft Store — field-by-field status

Verified today against learn.microsoft.com (Add/edit Store listing info, App properties, App
screenshots and images).

| Field | Rule | PathoMitra | Status |
| --- | --- | --- | --- |
| Package | **MSIX/APPX required for a Store submission** (MSI is not accepted) | MSI today; `msix` target absent on electron-builder 26.x | ❌ P0 |
| `identityName` / reservation | must match the reserved product name | `PathoMitra.PathoMitra` set, reservation unknown | ❌ verify in Partner Center |
| Publisher CN / display name | must match the verified account publisher | `CN=Naitik Raj` — decide Individual vs Company enrollment first | ⚠ |
| OS range | manifest | min `10.0.17763` (Win 10 1809), tested `10.0.26100` (24H2), x64 | ✅ |
| Capabilities | must match behaviour; drives the privacy question | `runFullTrust` only | ⚠ needs a Windows-true policy section |
| Store listings: **Description** | **required**, ≤ 10 000 plain-text chars, **no URLs/HTML** | no Windows copy exists (Play copy is a starting point) | ❌ |
| Product features | ≤ 20 items, ≤ 200 chars each, no bullets of your own | derivable from `Features.tsx` | ❌ |
| Short description | ≤ 1 000, first 270 shown | `docs/play-listing.md:26` fits | ⚠ |
| What's new | ≤ 1 500 (blank on first submission) | none | ⚠ |
| **Screenshots** | **≥ 1 required**, Desktop ≥ 1366×768 (≤ 4K), PNG ≤ 50 MB, caption ≤ 200, up to 10 | none | ❌ P0 |
| Store logo 1:1 | 300×300 optional, recommended (overrides package logo) | downscale from the 512 icon | ❌ |
| Poster/box art | 720×1080 / 1080×1080 — game/Xbox only | n/a | ⬜ |
| Trailers | optional, ≤ 15, mp4/mov + thumbnail + title | none | ⬜ optional |
| Category | required | "Health & Fitness → Medical" or "Business" | ❌ decision |
| Privacy policy URL | required when the app accesses/collects/transmits personal info; certification fails without it | dead URL (§2.1) | ❌ P0 |
| Support info | website + support email/phone | dead email | ❌ P0 |
| System requirements | structured hardware fields + ≤ 11 extra min/recommended items | none stated | ❌ |
| Age rating | IARC/PIRS questionnaire | not answered | ❌ |
| Product declarations | ads / IAP / data collection statements | none made | ⚠ |
| EULA / license terms | custom text or Store default | none | ❌ |
| Certification | install → launch → uninstall clean, no crash | **the MSI has never been run after install** | ❌ |

---

## 7. Recommended build order (resequenced for the §0 decisions)

**Now, no domain needed:**

1. ~~Fix the four copy problems in §4~~ — **done 2026-10-14, see §0**, and the identical fix was
carried into the parent app 2026-10-15 (`dd0bf88`, AM-3) — both forks now guarded.
2. **`/download`** — the Windows path is now the front door: version, file size, **SHA-256**,
   release date, "what Windows will show" (SmartScreen warning until Authenticode is bought), plus
   the Android section pointing at Play once it exists. A signed MSI also needs code signing to be
   trustworthy on a lab PC — that is now a purchasing decision, not a Store requirement (the current
   PathoMitra-2.7.2.msi is `NotSigned`).
3. **`/system-requirements`** and the **per-platform `/security`** section — both are still owed
   because the privacy policy describes Android only while the shipping Windows build stores its
   key in the Credential Locker (DPAPI), not a hardware keystore. A lab reading "encrypted on-device
   records" on a Windows install must be told what actually protects it.
4. **Store art** for Play only: feature graphic 1024×500, ≥2 phone screenshots at 9:16 from the
   installed APK with synthetic data, tablet set of 4, alt text ≤140. Also make the OG image
   1200×627 (§4.5) so the site shares correctly.

**Blocked until the domain + mailbox land (your "later"):**

5. `VITE_SUPPORT_EMAIL` / `VITE_PRIVACY_URL` real values → `npm run build:privacy` → host the plain
   HTML → deploy this brochure to its **own** Pages project (never reuse `pathomitra`, or `deploy.yml`
   overwrites the app bundle).
6. Play Console forms + contact block: Data Safety, **Health apps declaration**, content rating,
   target audience, ads/IAP, categories.
7. Pre-upload gates: `npm run verify` · `npm run verify:android` · assert 16 KB page alignment on the
   AAB · closed track + pre-launch before production.

**Out of scope by decision (keep §6 as the checklist for later):** MSIX on electron-builder 27.x,
`.msixupload` Store signing, `identityName` reservation, Partner Center enrollment type, age-rating
questionnaire, Store screenshots/tiles, Store certification.

---

## 8. What I could not verify from here (open asks)

- Play Console / Partner Center account state: developer verification (rolling out 2026–2027),
  organization vs individual enrollment, D-U-N-S availability, Play App Signing status, whether
  "PathoMitra" is free of trademark conflicts in your target markets, and whether the product name is
  reserved on the Store.
- Whether `pathomitra.pages.dev` exists at all (it does not resolve from this machine, and CI says it
  deploys there) — check the Cloudflare dashboard.
- Whether the release keystore is backed up off-machine (open checklist item in both files).
- Whether the uploaded AAB is 16 KB page-size aligned.
- Whether `support@pathomitra.app` was ever intended to be real, or is a placeholder — the memory file
  lists confirming it as owed (Next item 10).
- Business facts the listings need and only you can supply: is it paid or free, per-lab licence or
  one-time, which country sells first, and what phone/address you are willing to publish.

---

## 9. Files this report points at

- `src/lib/privacy-policy.ts:26-32` (dead email, dead canonical URL, stale date)
- `src/lib/contact.ts:8`, `src/components/Footer.tsx:4,98` (dead email, invented entity + clinical claim)
- `src/pages/SolutionsPage.tsx:99` (share-by-SMS/WhatsApp claim)
- `src/components/Hero.tsx:31-33,307,325-345` (Verified/Signed mock, "No setup")
- `src/components/Trust.tsx:18-22,44-48` (Android-scoped claims — good, keep, extend to Windows)
- `index.html:34` (`og:image` = 512 icon under a `summary_large_image` card)
- `src/App.tsx:37` (HashRouter → no crawlable, no-JS-readable policy route)
- `public/` (icons only: no feature graphic, no screenshots, no press kit)
- Parent repo: `docs/play-listing.md` (authoritative Play copy), `electron-builder.config.mjs`
  (`msix deliberately absent`, appx identity/publisher), `android/variables.gradle` (minSdk 28,
  target/compile 36), `.github/workflows/deploy.yml` (deploys the app, not this folder),
  `scripts/build-privacy-site.ts` + `npm run build:privacy` (the JS-free policy pages).
