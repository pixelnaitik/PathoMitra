# Microsoft Store Listing + Certification Notes — draft for submission

**Drafted:** 2026-10-17 · **Consumes:** `docs/ms-store-remediation-plan-2026-10-17.md` Phase 8
**Status:** draft text, ready to paste — but the lines marked `⟨GATE⟩` must not be submitted until the
named condition is actually true. Every other statement here was verified against the code or the built
package on 2026-10-17.

Rule this document is written under: **Store Policies 10.1.1** — metadata must accurately describe the
product, its limitations included, and must never mislead as to features or functionality. Where the
honest sentence is less attractive than the marketing one, the honest one is used.

---

## 1. Product identity

| Field | Value |
|---|---|
| Product name | **PathoMitra** |
| Tagline (short-description opening, *not* the title) | Lab management, on the machine it runs on |
| Publisher display name | `⟨GATE D-3⟩` — matches the Partner Center account exactly. Today `electron-builder.config.mjs` says `Naitik Raj`; if the enrollment becomes a Company account, the manifest publisher and the MSI `CompanyName` must be re-built to match |
| Package family name | Route M: not applicable (Win32 MSI). Route X: taken from the Partner Center reservation, never guessed |
| Category | **Business → Productivity** (primary). Not "Health & Fitness → Medical": the app is a lab's administrative console, not a patient-facing or diagnostic device, and the category is a discoverability claim as much as a filing box |
| Supported languages | English (United States) only — the app ships one locale (`index.html lang="en"`), so declaring more would fail 10.7 |
| Architecture | x64 |
| License | MIT (open source) + the custom EULA text in §6 |

---

## 2. Description (plain text, no URLs, no HTML — 10.1.1)

```
PathoMitra is an offline laboratory console for pathology labs: patient registration, test
selection, report composition, amendments, invoicing and referring-doctor records, all on the
computer the lab already uses.

WHAT IT DOES
- Registers a patient with age, gender, contact details, referring doctor and a chosen panel of
  tests, and issues a serial number per record.
- Holds a catalogue of 163 built-in tests and panels with reference ranges split by adult male,
  adult female and infant bands, plus the lab's own custom tests.
- Composes a printable A4 report: results, units, reference ranges and derived values, with a
  versioned history every time an issued report is amended.
- Prices tests, raises itemised bills with discount, tax and payment records, and prints
  referral statements for doctors.
- Reports analytics on volume, revenue and turnaround for the lab's own use.
- Exports PDFs and CSVs, and takes sealed backups the lab controls.

HOW IT IS DIFFERENT, AND WHAT THAT COSTS
PathoMitra has no server, no account system and no network access at all. That is the design, not
an omission: patient data cannot leave a device that has no route out. The consequences are real
and stated here rather than discovered later:
- There is no sync. A lab runs one console on one machine. Two computers do not share records,
  and a phone and a PC hold separate databases.
- There is no remote access, no web portal and no automatic backup. Moving to a new machine means
  taking a backup file from the old one and restoring it on the new one.
- If the only computer holding the data fails and no backup was taken, the records are gone. The
  app cannot help, because it has nowhere to keep a copy.
- One operator account per installation, with a passcode, an auto-lock timer and a lockout after
  repeated failures. There are no user roles, no permissions per staff member and no audit trail
  of who was at the keyboard beyond the operator who issued each report.

DATA AND PRIVACY
All records live in a local database encrypted with SQLCipher (AES-256). The encryption key is
generated on first run and is held by the operating system: the Windows Credential Locker, sealed
by DPAPI to the signed-in Windows user account. That means another user of the same machine cannot
read it, and Windows does not roam it — but a process running as that same user can ask Windows to
unseal it, so the control that protects patient records on Windows is the Windows account itself:
screen lock plus a dedicated operator login. In a web browser the same records would sit in
unencrypted local storage, which is why the browser build is labelled as a demonstration and not a
place for patient data.

No analytics, advertising, crash-reporting, social or other third-party SDK is included. Nothing is
collected, transmitted or sold, by this software or by its developer, because the app has no
network capability. Error information is kept in a local log on the device that the operator can
read, save or clear, and patient identifiers are removed before an error is recorded.

WHAT PATHOMITRA IS NOT
It is not a diagnostic device and it provides no clinical decision support. It stores, formats and
prints what the laboratory enters; it does not interpret results, verify a diagnosis, or replace
the judgement of a qualified professional. Reference ranges and test metadata ship as editable
defaults compiled from publicly available standard sources — every laboratory must adapt them to
its own methods, instruments and protocols before use. Reports are only as accurate as the data
entered. Accreditation belongs to the laboratory: nothing in this software is, or claims to be,
HIPAA-compliant, NABL-accredited, ISO-certified, CE-marked or SOC 2 audited, and any accreditation
mark printed on a report is there because the laboratory typed it in and attested to it.

UNINSTALLING AND DELETING DATA
Uninstalling does not delete the lab's records. The installer deliberately leaves the data folder
in place so that a routine update or a reinstall can never destroy years of records. To remove
everything, use Settings > Security > "Erase all data & delete account" first, then uninstall, then
delete the %APPDATA%\PathoMitra folder. ⟨GATE Phase 4: once the erase-and-remove action ships, this
sentence becomes the one-paragraph version and the manual step disappears.⟩

SYSTEM REQUIREMENTS
64-bit Windows 10 version 1809 or later, or Windows 11. Screen resolution 1280x800 or larger at
100-125% display scaling (the console will not lay out correctly below 1024x640 logical pixels).
Around 500 MB of disk space and 1 GB of RAM free. No internet connection is required or used.
A printer or PDF writer for reports and bills. ⟨GATE Phase 6: the tested-OS list must match the
machines the app was actually installed and run on, not the range copied from the manifest.⟩
```

**Length check:** ~4,300 characters — inside the 10,000 limit, no URLs, no markup, no HTML entities.

---

## 3. Short description (≤ 1000 chars; first 270 are what a shopper sees)

```
PathoMitra is an offline lab console for pathology laboratories: patient registration, test
selection, versioned reports, invoicing and referring-doctor records — encrypted with SQLCipher on
the machine it runs on. There is no server, no sync and no network access, so patient data has no
route off the device. One operator account, one computer. Reports are formatted, not interpreted:
the software is not a diagnostic device, reference ranges ship as editable defaults, and
accreditation belongs to the laboratory. Uninstalling leaves the encrypted data folder in place by
design, so a reinstall cannot destroy records.
```

---

## 4. Search terms — exactly 7 (10.1.3)

| # | Term | Why it is a user's word, not ours |
|---|---|---|
| 1 | `pathology lab software` | the category a lab searches in |
| 2 | `laboratory information system` | the industry name for what this is (LIS) |
| 3 | `patient record management` | what the operator buys it to do |
| 4 | `pathology report printing` | the daily job |
| 5 | `lab billing and invoicing` | the second daily job |
| 6 | `offline medical records` | the differentiator, phrased as a need |
| 7 | `clinical lab records encrypted` | the requirement that closes the sale |

Not used, on purpose: `react`, `vite`, `capacitor`, `tailwindcss`, `open source`, `free`, `PathoLab`.
The first four are build tools no laboratory searches for (and `package.json.keywords` currently
carries all of them — **do not mirror that array into this field**, it holds 9 entries and 10.1.3
allows 7). `free` is a pricing term. `PathoLab` is the retired brand name and would be a
misleading-representation risk against the current product.

---

## 5. Screenshots (≥ 1 required; 4–6 recommended; Desktop ≥ 1366×768, PNG ≤ 50 MB, caption ≤ 200 chars)

Capture procedure — the only acceptable source is **the installed package**, not `npm run dev`, and
not `src/components/Hero.tsx`'s `ProductMock` (an invented dashboard that is labelled
"Illustration · sample data" precisely because it is not a product view):

1. Install the signed MSI on a machine at 1920×1200 (or larger), 100 % scaling.
2. Seed it with a **fictional demo lab** — invented names, invented registration numbers, invented
   results. Never a real patient record, and never `public/default-share-template.png` (a real
   laboratory's letterhead) in any report surface. `⟨GATE D-9⟩`
3. Capture with a DPI-aware tool (`.tmp/capture-packaged-dpi.ps1` calls `SetProcessDPIAware()`;
   an unaware capture at 150 % scaling returns a virtualised rectangle that looks clipped when the
   layout is fine — that false alarm happened on 2026-10-17).

| # | Screen | Caption (≤ 200) |
|---|---|---|
| 1 | Overview dashboard | Register patients, build reports and track the day's workload — all on the lab's own machine, with no server in the loop |
| 2 | Register patient, wide two-column layout | Patient details on the left, the test panel on the right, and one price line per package rather than one per component |
| 3 | Report composer, entry table | Every parameter, its reference range, its unit and its result in one table; derived values are calculated, not typed |
| 4 | Issued report with version history | Amending an issued report requires a reason and keeps the previous version — the history is part of the record |
| 5 | Bill / invoice | Itemised bill with discount, tax and payment state, printed from the lab's own letterhead and price list |
| 6 | Settings → Security | Passcode, auto-lock timer, screenshot protection and sealed backups, with the erase-everything control on the same screen |

---

## 6. EULA / license terms

Offer the MIT license text plus this clause, in this order (it is the sentence that keeps the
medical-adjacent claim honest):

```
PathoMitra is provided under the MIT license, without warranty of any kind. It is an administrative
tool for laboratories: it stores, formats and prints data entered by the laboratory. It is not a
medical device, provides no clinical decision support, and does not verify, interpret or approve
any result. Reference ranges and test metadata ship as editable defaults and must be validated
against the laboratory's own methods, instruments and protocols before use. Regulatory compliance
and accreditation of the laboratory and of its reports remain the laboratory's responsibility.
```

---

## 7. Age rating (IARC) — the honest answer set

| Question | Answer | Basis |
|---|---|---|
| Violence, gore | No | — |
| Sexual content | No | — |
| Gambling | No | — |
| User-generated content | **No** | Reports and bills never leave the device except by the operator's own hand; there is no surface where content created in the app is viewed by another user online, which is what 11.12 keys on |
| Online chat / contact with strangers | No | no network capability |
| Collects or transmits personal information | **No — with the qualifier stated in the description** | the app processes health data *locally*; nothing is collected or transmitted by the developer. Answering "yes" here would be wrong; answering "no" without the description saying the data stays on-device would be misleading, which is why §2 has the "DATA AND PRIVACY" block |
| Directed at children | No | professional tooling; §8 of the privacy policy handles the minor-*patient* case honestly |

---

## 8. Notes for certification (the reviewer-facing answers, pre-written)

These are the questions a manual reviewer asks. Each answer is a fact checked on 2026-10-17.

**Testability / first run (10.3.1).** No demo credentials exist and none can be issued: there is no
server to hold them. The reviewer creates the account on first launch. Exact path:
launch → "Create account" → **Lab name** (first field) → display name → passcode (the form states
the charset rule; "Use letters too" switches the keypad) → accept the Terms → the console opens on
Overview. Five consecutive wrong passcodes enforce a rising lockout delay; the console also
re-locks after the inactivity period set in Settings (default 5 minutes). Uninstalling does not
remove the data folder — see the uninstall note below.

**Security (10.2).** The renderer runs with `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`. A Content-Security-Policy is attached to every response the shell serves, by both
the custom-scheme handler and `onHeadersReceived`. All IPC channels verify the sender frame and are
allow-listed; filesystem channels re-validate the **real** path so a symlink or junction cannot
escape an app-owned root; the SQLCipher key is on a main-process-only deny list and is unreachable
from the renderer. In a packaged build there is no application menu and DevTools is disabled.
Permissions are denied by default with exactly one exception (`notifications`).

**No dynamic code (10.2.2).** `publish: null` — no self-updater, no remote configuration, no
downloaded code. `session.webRequest.onBeforeRequest` cancels every request on a remote scheme
(http, https, ws, wss) in a packaged build; only the app's own `pathomitra://`, `file:`, `data:`,
`blob:` and `about:` origins are served. The offline posture is enforced at runtime, not merely
"we never call anything".

**Capabilities (10.6).** No location, camera, microphone, background task, storage-wide capability
or registry/service/driver dependency. Printing uses the Windows spooler through the operating
system's own print path (`Get-CimInstance Win32_Printer` for the device list, then a hidden
print window); no third-party print driver is installed or required. `⟨GATE Route X only⟩` if the
submission is an `.appx`, `runFullTrust` is declared because Electron cannot run inside an
AppContainer and the print path needs the Win32 spooler — say this, do not let the capability be
discovered.

**Notifications (10.9.3).** Alerts are operational only (overdue samples, unissued drafts,
amendments, unpaid bills) and never clinical. Banner text carries no patient name. On Android the
channel is created with private lock-screen visibility. On Windows and in a browser the platform
offers no equivalent control, so the banner title is generic ("A registered patient is still
awaiting a report") and names no record; the detail stays in the in-app alert centre, which is
behind the unlock. Nothing is sent by email, SMS or a messaging app — those channels were removed.

**Personal information (10.5).** The product processes patient health data entirely on the device.
The developer receives, collects, hosts or can access none of it; there is no third-party SDK of any
kind in the package. The privacy policy URL points at a plain-HTML page with no script dependency,
and it states the platform-specific storage controls (Windows Credential Locker + DPAPI, Android
Keystore with its hardware-backing caveat, unencrypted browser storage) and the uninstall
behaviour. `⟨GATE Phase 7⟩` the deployed page must be the current one — on 2026-10-17 the hosted
copy predated the per-platform rewrite and contradicted the policy inside the app.

**Uninstall and data removal (10.2.7).** The installer leaves `%APPDATA%\PathoMitra` in place by
design, so that an update or a reinstall can never destroy a laboratory's records; the product
states this in its policy and in the listing. `⟨GATE Phase 4⟩` once the "Erase data and remove
PathoMitra" action ships, this note becomes: the app provides an in-product action that erases the
database and account and then hands off to Windows to uninstall, so clean removal is enabled rather
than merely documented.

**Dependencies (10.2.4).** No non-integrated software is required for the primary functionality.
The runtime is Electron, bundled inside the package. Printing needs a printer or a PDF writer,
which is stated in the system requirements.

**Engine currency (10.2.1).** `⟨GATE Phase 2⟩` state the Electron version in the submitted build and
confirm it is within two Chromium majors of the current release, with known security issues patched.
The 2.7.7 build shipped Electron 44.7.0, which is four releases behind 44.9.0 (Chromium
152.0.7977.149 → .167 plus PDFium/V8/ANGLE backports in between) — that is the reason for the bump,
not a form-filling exercise.

---

## 9. What must be true before this file is pasted into Partner Center

- [ ] Signed MSI built and `check-desktop-package.mjs` reports **9/9 Valid**, exit 0 (Phase 5)
- [ ] The MSI is hosted at a versioned, immutable HTTPS URL, and that URL is what is entered (Phase 5)
- [ ] The privacy policy URL serves the current per-platform text (Phase 7) — and the app's own policy page says the same thing
- [ ] Electron bumped and the packaged build re-boot-verified (Phase 2)
- [ ] Auth console copy no longer claims connectivity or compliance (T-1.1 — **done 2026-10-17**)
- [ ] Desktop banners are identifier-free (T-1.3 — **done 2026-10-17**)
- [ ] Report caveat/disclaimer reinstated (Phase 3, needs D-5)
- [ ] Erase-and-remove action shipped (Phase 4) — and §2/§8's uninstall sentences updated
- [ ] Screenshots captured from the installed package at ≥1366×768 with fictional data (Phase 8)
- [ ] Tested-OS list in §2 matches the Phase 6 smoke note
- [ ] Publisher display name matches the enrollment decided in D-3
