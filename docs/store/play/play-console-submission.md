# Play Console Submission Pack — PathoMitra

Everything in this file is typed into **Play Console**, not into the repo. It is the exact
answer for each field, with the code fact behind it, so nothing here needs re-deriving at 1 a.m.
Pair it with [`play-listing.md`](play-listing.md) (listing text + policy + pre-upload gates). The dated
audit ledgers that used to sit beside these files (`docs/audits/play-audit-2026-10-16.md`,
`play-audit-2026-10-17.md`) were deleted from the tree on 2026-10-17 by commit `0bd338c`; their findings are
recorded in `docs/history/PROJECT_MEMORY-2026-10-18-pre-cleanup.md`.

Rule that governs the whole document: **an answer is only correct if the uploaded binary
matches it.** If a declaration and the artifact disagree, the declaration loses.

---

## 0. Before you open the Console

```
git status                      # must be clean
git tag v<version> && git push pathomitra --tags   # provenance: the upload must trace to a tag (NONE exists today)
npm run build:privacy           # regenerates privacy-site/ AND promotion_website/public/privacy.html
npm run verify                  # lint:ci + coverage + vite build
npm run verify:android          # guard -> native build -> asset guard -> AAB  (NO --allow-placeholder)
npm run check:android           # merged manifest: 6 permissions, no INTERNET, not debuggable
node scripts/check-release-config.mjs   # must print "verified reachable"
```

Then prove the artifact, not the config:

```
# the policy URL inside the shipped bundle must be the real one
<unzip the .aab> assets/public/index.html  ->  grep pathomitra          # expect: no .test / .invalid
npm run check:android                    ->  exit 0
zipalign -c -P 16 -v 4 <apk>             ->  "Verification successful"
apksigner verify --print-certs <apk>     ->  your release key, v2+
```

**The one external step still owed:** redeploy the brochure so `/privacy` serves the **current** static page.
The URL is no longer the problem it was — verified 2026-10-18, `https://pathomitra.pages.dev/privacy` returns
200 with a JS-free policy that names the contact, and `check-release-config.mjs` exits 0 with its live probe
(which is why the 2.8.x artifacts could be built on the release path). **What is wrong is freshness:** the
deployed copy is the older build without the per-platform key-storage and uninstall sections, while
`npm run build:privacy` regenerates a larger file that has them. The gate checks presence, never freshness, so
it cannot see this. Deploy is an owner instruction.

```
cd promotion_website && npm run build
npx wrangler@latest pages deploy promotion_website/dist --project-name pathomitra --branch main --commit-dirty=true
```

Do not upload a build whose filename does not say which track it belongs to. Test builds carry
`-TEST-BUILD-DO-NOT-SUBMIT`; a submission build carries the version and nothing else.

---

## 1. App → Create app

| Field                | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| App name             | `PathoMitra`                                                                       |
| Language             | English (United States) — add English (India) and Hindi as translations if offered |
| Type of app          | **App** (not Game)                                                                 |
| Free or paid         | **Free**                                                                           |
| Uploader certificate | the `com.pathomitra.app` release key (`1550d59f…09587a4d` today)                   |

Adaptive-icon note: the launcher foreground must fit the 66 dp safe zone (fixed in 2.7.1) — the
Play store icon is taken from the artifact, so no separate upload is needed beyond the 512×512.

---

## 2. Store listing (Main store listing)

Copy verbatim from `play-listing.md` §1. Do not paraphrase, and do not re-add anything from its
banned table.

| Field             | Content                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------- |
| Title             | `PathoMitra`                                                                            |
| Short description | `Offline pathology lab records, reports and billing - stored encrypted on your device.` |
| Full description  | `play-listing.md` §1 "Full description" block, unedited                                 |
| Icon              | from the artifact                                                                       |
| Feature graphic   | **1024×512, not yet created** — no capability claim in the artwork                      |
| Screenshots       | **≥2, not yet captured** — see §7 below                                                 |

**Never** put in any field: certification names, "signed/verified/tamper-proof", "cloud/sync/
access from anywhere", "AI", user counts, or a screenshot of the browser app.

---

## 3. App content — Target audience and categories

| Question                        | Answer                                                                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who will use your app           | **Everyone 13+** / do **not** select any age group below 13                                                                                                                                                                        |
| Categories                      | **Medical** primary. Do not add "Parents", "Education", "Games".                                                                                                                                                                   |
| Is your app targeting children? | **No.** It is a professional console for laboratory staff; it _records_ a minor patient's clinical data on the laboratory's behalf, which is the laboratory's processing, not a child-directed feature. Say exactly that if asked. |

### IARC content rating questionnaire

Answer it — it is mandatory and blocks the first release. PathoMitra contains none of the rated
content, so the honest run is "No" to essentially every question. Two to be careful with:

| Question                                         | Answer | Why                                                       |
| ------------------------------------------------ | ------ | --------------------------------------------------------- |
| Fantasy or realistic gambling                    | No     |                                                           |
| Extremely graphic or realistic violence          | No     |                                                           |
| User-generated content                           | **No** | no feed, no sharing to other users, single local operator |
| Users can communicate with each other            | **No** |                                                           |
| Personal information is displayed to other users | **No** |                                                           |
| Access to control parental features              | No     | not in the Families program                               |

If the questionnaire asks about health/medical content, describe it as
"professional laboratory software that stores and formats results entered by a qualified operator;
it does not diagnose and is not patient-facing."

---

## 4. App content — Ads, In-app purchases, News, Health

| Declaration                                           | Answer                                                                                                                                                                                     | Proof in the binary                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ads                                                   | **No app or in-app ads**                                                                                                                                                                   | no ad SDK, no `com.google.android.gms.permission.AD_ID` (`check-android-manifest.mjs` forbids it)                                                                                                                                                           |
| In-app purchases                                      | **No**                                                                                                                                                                                     | no Play Billing dependency; `play-listing.md` §1 says "No in-app purchases"                                                                                                                                                                                 |
| Subscriptions                                         | **No**                                                                                                                                                                                     |                                                                                                                                                                                                                                                             |
| News app                                              | **No**                                                                                                                                                                                     |                                                                                                                                                                                                                                                             |
| Health / medical                                      | Category Medical; describe as **professional tool**, not a diagnostic device                                                                                                               | `terms.ts` §4, `report-compliance.ts` prints no clinical disclaimer because it makes no clinical claim                                                                                                                                                      |
| **Health apps declaration** (separate mandatory form) | App category: **Medical → Healthcare Services and Management**. Do **not** select "Medical Device Apps" — the app stores, formats and prints operator-entered data and interprets nothing. | `play-listing.md` §2 "Health apps declaration"; the policy also requires the listing to say the app "is not a medical device and does not diagnose, treat, cure, or prevent any medical condition" and to remind users to consult a healthcare professional |

**Be ready for a follow-up on the Medical category.** Google commonly asks for the applicant's
laboratory licence or accreditation evidence. That belongs to the _laboratory_, not to the app:
prepare a short statement that PathoMitra is software sold/shipped as an MIT-licensed open-source
tool, that accreditation text printed on a report is operator-supplied behind an attestation
checkbox (`terms.ts` §3), and that the developer holds no NABL/ISO/CE/HIPAA claim
(`privacy-policy.ts` §5 says so out loud).

---

## 5. App content — Data safety

⚠ **Read before filling anything: Play defines "collection" as _accessing or storing_ data, including data
that is only ever stored on the user's own device** (support article 10787469, read 2026-10-17), and the
transit-encryption question has **no N/A** option. The all-"No data collected" answers this file used to
recommend were **wrong** — offline-by-construction justifies _not shared_, never _not collected_ — and a Data
Safety form is enforceable after publication, not only at review. The table below is the corrected set.

The form still rests on three facts that are enforced by the build, not asserted here:

1. **`INTERNET` is absent** from the merged release manifest → nothing can leave the device.
2. **No third-party SDK** with data access — no Firebase, analytics, ad, crash or social library
   in `package.json` dependencies, and `grep` finds no `fetch`/XHR/`sendBeacon`/WebSocket in `src/`.
3. **Deletion is self-service in-app** — Settings → Security → "Erase all data & delete account".

| Data safety question                                                       | Answer                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does your app collect or share any of the required user data types?        | **Collected: Yes. Shared: No.** The app accesses and stores data the operator enters on the device.                                                                                                                                                                                                                   |
| Is all of the above true for all countries/regions?                        | Yes                                                                                                                                                                                                                                                                                                                   |
| Which data types are collected                                             | Name, Phone number, Address, User IDs, Other personal info (age, gender), **Health info** (pathology findings), Financial info (bills and payments), Files and documents (exports/backups). **Precisely what the lab enters, kept locally; never transmitted** — that is the explanation field for each type.         |
| Data shared with third parties                                             | **No** — no network permission, no collector, no SDK in the bundle                                                                                                                                                                                                                                                    |
| Data encrypted in transit                                                  | **No** — answer "No", not "N/A": there is no transit at all (no `INTERNET` permission).                                                                                                                                                                                                                               |
| Data encrypted at rest                                                     | **Yes** — SQLCipher AES-256, passphrase held in `EncryptedSharedPreferences` keyed by the Android Keystore (`sqliteRepository.ts`, `@capacitor-community/sqlite` `CapacitorSQLite.java`). Hardware backing is device-dependent, so say it the way `src/lib/privacy-policy.ts` §3 does — not "always hardware-backed". |
| Users can request data deletion                                            | **Yes**, in-app and immediate (Settings → Security → "Erase all data & delete account")                                                                                                                                                                                                                               |
| Is data deletable in-app                                                   | Yes — the same action wipes the database and the local account                                                                                                                                                                                                                                                        |
| Data kept after deletion                                                   | No                                                                                                                                                                                                                                                                                                                    |
| Data used for advertising / analytics / fraud detection / account security | **No** to all                                                                                                                                                                                                                                                                                                         |
| Data backed up to a cloud service                                          | **No** — `allowBackup=false` and every domain excluded in `data_extraction_rules.xml` (cloud backup _and_ device-to-device transfer)                                                                                                                                                                                  |
| Privacy policy URL                                                         | the value of `VITE_PRIVACY_URL`, which must serve plain HTML naming `VITE_SUPPORT_EMAIL`                                                                                                                                                                                                                              |

**If Google asks for evidence:** attach the `npm run check:android` output (it prints the
permission count and the manifest path it read) and the merged
`android/app/build/intermediates/packaged_manifests/release/.../AndroidManifest.xml`.

---

## 6. Sensitive permissions — declaration text

Declare each permission with the reason it is in the binary. Play rejects a permission whose
stated purpose the app does not use, and this app is unusual in that it has almost none.

| Permission                          | Declaration                                                                                                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST_NOTIFICATIONS`                | Required so the laboratory can opt in to local alert banners (overdue samples, unissued drafts, unpaid bills). Off by default; enabled in Settings → Notifications; the app posts a banner only on the device that already holds the record. |
| `WAKE_LOCK`                         | Contributed by `@capacitor/local-notifications` so a banner the lab enabled is delivered reliably while the app is not in the foreground. No background data, no scheduled job.                                                              |
| `USE_BIOMETRIC` / `USE_FINGERPRINT` | Lets the operator unlock a device holding patient records with the OS biometric gate. The app never receives, reads or stores a biometric sample — Android performs the authentication and reports the result.                               |
| `VIBRATE`                           | Haptic confirmation on issuing a report and on destructive actions. Accessibility/usability only.                                                                                                                                            |

Stripped and therefore **not** declared: `INTERNET`, `ACCESS_NETWORK_STATE`,
`SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED` (+ its receiver), every
dangerous permission, `AD_ID`, `SYSTEM_ALERT_WINDOW`, `REQUEST_INSTALL_PACKAGES`,
`FOREGROUND_SERVICE`. Say so plainly if a reviewer queries the `<access origin="*"/>` line that
survives in the tool-generated `android/app/src/main/res/xml/config.xml`: it belongs to the empty
Cordova compatibility module, is inert while `INTERNET` is absent, and no Cordova plugin is
installed.

---

## 7. Screenshots and feature graphic (capture sheet)

Capture from the **installed release build** on a real phone, light theme, at 1080 px width.
Never screenshot the browser app or the marketing site (`play-listing.md` bans it: they show the
retired claims).

Preparation, once:

1. Install the release APK over the existing install (same key, **do not uninstall**).
2. Settings → Data → create demo data only. Use obviously synthetic patients: `Test Patient One`,
   phone `9000000001`, never a real name or number. Nothing on a screenshot may be a real patient.
3. Turn screenshot protection **off temporarily** (Settings → Security → Allow screenshots) — the
   build default is on, so a screenshot would otherwise come out black. Turn it back on after.
4. Do **not** enable the alert-banner toggle before the capture: the banners carry a registration
   number, not a name, but a lock-screen or shade screenshot in a store listing invites questions.

Shot list (order matters — the first two carry the most weight):

1. **Reports list** — a few issued drafts so the screen is not empty.
2. **New report / result entry** — the grid with values typed in, showing units and reference ranges.
3. **A4 report preview** — the printed layout, synthetic name.
4. **Analytics** — volume/revenue/turnaround charts.
5. **Bills** — an itemised invoice.
6. **Settings → Security** — the passcode, auto-lock and "Erase all data" row: this is the screen
   that visually answers the Data Safety form.

Feature graphic: 1024×512, the adaptive-icon mark on the existing palette, wordmark only.
**No text making a capability claim** — no "encrypted", "HIPAA", "AI", "world's first".

---

## 8. Release

1. **Play App Signing: enable it.** Today the APK is signed directly with
   `android/pathlab-release.jks`, whose certificate DN is still `CN=Naitik Raj, O=PathLab OS, C=IN`
   — a retired brand. Enabling Play App Signing means Google holds the app signing key and your
   `.jks` becomes the _upload_ key; that also means the stale DN stops being the identity a device
   verifies. Decide deliberately: with App Signing ON, losing your upload key is recoverable,
   with it OFF, losing the keystore means losing the app forever — and the keystore currently
   lives inside a OneDrive-synced folder (files-on-demand can dehydrate it; it has broken a copy
   before). Move it off OneDrive and keep an off-machine backup either way.
2. Create an **Internal testing** release, upload `app-release.aab`.
3. Run **Pre-launch report**; require: no crash, no ANR, arm64 device coverage, and no 16 KB
   page-size warning (already proven: `zipalign -P 16` clean, `libsqlcipher.so` `p_align = 16384`).
4. Fix anything it finds, then promote to **Closed testing** with the labs that agreed to test.
5. Production only when vitals are clean: crash rate < 1.0 %, ANR < 1.5 % (Play's own thresholds).

---

## 9. Known items that will draw a second look

| Item                                        | How to answer                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Category Medical, no certifications claimed | Correct and deliberate. The app disclaims HIPAA/NABL/ISO/CE/SOC 2 in its own policy; accreditation text on a report is operator-typed behind an attestation.                                                                                                                                                                    |
| A clinical app that asks for no `INTERNET`  | Unusual but unproblematic — say "offline by construction: the app **stores** data so Data Safety declares it collected, but it **shares** nothing because the binary has no network permission".                                                                                                                                |
| Doctor referral **commission** feature      | Not in any screenshot, not in the listing. It records a rate the lab sets (default 0) and prints a statement; nothing is transmitted. Paying for referrals is restricted in India (ICMR ethical guidelines, NMC professional-conduct rules) — reviewed before any lab is encouraged to use non-zero rates. Do not advertise it. |
| No account to delete remotely               | There is no server and no account; deletion is the in-app erase. `play-listing.md` §2 records this as the account-deletion answer.                                                                                                                                                                                              |
| Terms re-prompt on first unlock             | Intended: `TERMS_VERSION` moved to 1.1 because §5 misdescribed backup encryption. A silent terms change is not an accepted one.                                                                                                                                                                                                 |

---

## 10. Sign-off list

- [ ] `git tag` pushed and the AAB built from that commit
- [ ] `check-release-config.mjs` prints **verified reachable**
- [ ] brochure redeployed so `/privacy` serves the static page
- [ ] `check:android` exit 0 with **6** permissions
- [ ] screenshots captured from the installed build + feature graphic
- [ ] IARC questionnaire completed
- [ ] Data Safety answers entered exactly as §5
- [ ] permission declarations as §6
- [ ] Play App Signing decision made and the keystore backed up off OneDrive
- [ ] internal release + pre-launch report clean
- [ ] The remaining `requires-lab-verification` reference band(s) signed off by the lab director — **2**
      carry the flag in `src/lib/pathology-tests.ts` as of 2026-10-18 (the "72 bands" figure that used to sit
      here was counted before the catalogue was corrected and is stale)
- [ ] `F-1` PDF font decision (bills print `Rs.` not `₹`; Devanagari names blank) — fix or disclose
