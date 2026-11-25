# Security Policy

PathoMitra is a clinical system: it holds patient demographics, diagnosis
results, and billing records. Treat every vulnerability report as urgent,
including the ones that look theoretical.

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |
| < main  | :x:                |

There are no long-running release lines: fixes are merged to `main` and shipped
in the next tagged release.

## Reporting a vulnerability

**Do not open a public issue for anything with security impact** — not even one
that looks obviously severe. Use one of:

- [GitHub private vulnerability reporting](https://github.com/pixelnaitik/PathoMitra/security/advisories/new)
  (requires the repository owner to enable it under
  Settings → Security → Advanced Security), or
- an email to the maintainer address shown on the
  [repository page](https://github.com/pixelnaitik/PathoMitra), if private
  vulnerability reporting is unavailable.

You should get a response within **7 days**, and a fix or a written explanation
within **30 days** for anything that can expose patient data. Please include:

- the affected code path or surface,
- the state you started from (locked, unlocked, mid-backup, …),
- whether real patient data was reachable, and
- a proof of concept that does **not** contain real patient records — use fake
  names and synthetic records.

## Threat model

The app is offline by design: the shipped APK requests **no `INTERNET`
permission** and ships no analytics, no tracking and no remote crash reporting.
The threat model assumes the device can be lost, borrowed, or inspected by
someone with USB debugging, and that the JavaScript bundle is fully readable —
anything enforced only in React is **not** a control.

The real controls, and what a valid vulnerability against them looks like:

1. **Encrypted on-device database.** Clinical data lives in a SQLCipher
   (AES-256) SQLite database — `@capacitor-community/sqlite` on Android,
   `better-sqlite3-multiple-ciphers` on Windows. The key is randomly generated on
   first run and is never derived from the operator passcode. Where the key is
   _held_ differs by platform and the difference is load-bearing — see
   "Desktop (Windows)" below. Any path to plaintext — encryption silently
   disabled, the key derived from a constant, the database copied out
   unencrypted — is critical.
   `capacitor.config.ts` sets `androidIsEncryption: true` explicitly so a
   config change can never silently produce a plaintext database; removing it
   is a security regression.
2. **Local authentication.** Up to 21 operator accounts with action-level
   permissions, unlocked by PBKDF2-hashed passcodes (Web Crypto in the
   `https://localhost` WebView secure context) and optional Android biometrics or
   Windows Hello. Every mutation requires an authenticated actor; a lock-screen
   bypass, plaintext hash, client-resettable lockout, or authorization bypass is
   critical.
3. **Session re-locking.** The app re-locks on background and after the idle
   interval, and escalates a lockout after repeated failed attempts.
   Regressions that let a locked session keep serving data are high severity.
4. **Backup files.** Backups are AES-256-GCM encrypted snapshots. The app
   may create local snapshots and copy the latest verified snapshot to the
   operator-selected local destination on a schedule; it must never transmit
   patient data to a server or remote service. Restore writes a durable encrypted
   safety snapshot first, and successful drills record observed RPO/RTO and
   reconciled counts. A path that sends backup data remotely or skips rollback
   protection is a critical privacy/safety violation.
5. **Stored XSS / markup injection.** Patient and result values are rendered
   into lists, PDFs, and the share/preview surfaces. A payload that executes,
   or that escapes the A4 report layout to exfiltrate another patient's data,
   is high severity.
6. **Release build hardening.** `debuggable false`, R8 minification with the
   reflection-heavy keep-rules, native asset/alignment/signature checks, and
   source/artifact provenance manifests. Android and Windows release workflows
   fail closed when signing secrets are absent. A change that makes a release
   WebView debuggable, ships an unsigned release artifact, or skips a guard is
   reportable.
7. **The no-network invariant.** The manifest must not request `INTERNET` or
   any permission the documented feature list does not name. A dependency or
   PR that adds a network permission, a remote font, or a phone-home call is a
   security regression by definition — review it as one.

## Desktop (Windows) threat model

The Electron shell (`electron/`) is a different platform, not the APK in a
window, and its guarantees are not identical. This section is what
`electron/keyring.ts` refers to; the privacy policy (§3) states the same
asymmetry to the operator in plain language, because a lab can only manage a
difference it has been told about.

**Where the database key lives, and what that costs.** `electron/db.ts` mints a
32-byte key with `crypto.randomBytes` and `electron/keyring.ts` writes it to the
**Windows Credential Locker**, which DPAPI seals to the current Windows user
account. Consequences, stated plainly:

- Another user on the same machine cannot read it, and Windows does not roam it.
- **Any process running as that user can ask Windows to unseal it.** This is the
  gap that a hardware-backed keystore does not have, and it is the reason the
  Windows deployment control is the _Windows account_, not the database: a shared
  or administrator-readable login, or malware running under the operator's
  profile, reaches the key. Screen lock plus a dedicated operator account is the
  mitigation; a lab that needs the stronger bound runs the Android build on a
  device with a hardware-keystore implementation.
- The key is deliberately unreachable from the renderer: `electron/ipc.ts`
  enforces `assertRendererAccount` in all three keyring handlers against the
  allow-list in `src/lib/renderer-credentials.ts`, and `db-key` is on a main-only
  deny list. A report of "a compromised page can read the SQLCipher key" is a
  valid critical finding; "a compromised page can read `pathlab_*` records" is
  already the designed behaviour and is not.

**What else the shell enforces.**

- **Renderer isolation.** `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false` (`electron/main.ts`); the preload exposes only typed
  `ipcRenderer.invoke` wrappers, never raw `ipcRenderer`.
- **No network, enforced at runtime.** `session.defaultSession.webRequest.onBeforeRequest`
  cancels every remote-scheme request, so the offline posture is a runtime
  property rather than "we simply never call anything". A path that reaches the
  network from a packaged build is critical.
- **Deny-by-default permissions.** `setPermissionRequestHandler` /
  `setPermissionCheckHandler` allow `notifications` only.
- **Content-Security-Policy on the shell's own responses.** The bundle is served
  by a custom `pathomitra://` scheme handler, which is why the policy is attached
  there (and again in `onHeadersReceived`) instead of relying on `public/_headers`
  — that file only ever reaches the Cloudflare deployment. Inline bootstrap
  scripts are SHA-256 pinned; `script-src` has no `unsafe-inline` or `unsafe-eval`.
  The remaining `style-src-attr 'unsafe-inline'` exception is scoped to React,
  Recharts, and dynamic layout transforms; stylesheet execution itself remains
  `style-src 'self'`. A report that removes the exception without breaking those
  controls is welcome.
- **Path containment in the trusted process.** Every filesystem-facing IPC channel
  resolves inside an app-owned root, re-checking the **real** path so a symlink or
  junction cannot escape (`within()` in `electron/ipc.ts`); deletes are narrowed to
  the two backup folders and refuse directories. A report that reads or deletes
  anything outside those roots is critical.
- **Print staging holds PHI.** Raster pages and the spooled HTML are staged
  under `userData\Print\<uuid>\` with private permissions and removed after the
  job — never `%TEMP%`. Pages stream one at a time from the renderer instead of
  retaining the whole raster set in memory. A change that puts staging back in a
  shared folder or leaves it behind is a privacy regression.
- **No self-update, no remote code.** `publish: null`; nothing fetches and
  executes. (This is also what makes the app cleanly compliant with Store
  Policies 10.2.2.)

**Known Windows-specific gaps, so they are not mistaken for discoveries:**

- The MSI **deliberately leaves `%APPDATA%\PathoMitra` in place** on uninstall
  (a reinstall must not destroy a laboratory's records). The operator has to
  "Erase all data & delete account" first; see privacy policy §6.
- Windows Hello depends on an enrolled platform authenticator and must be
  validated on the target Windows device; the passcode remains the fallback.
- Signed Windows release artifacts require owner-provided `WIN_CSC_LINK` and
  `WIN_CSC_KEY_PASSWORD`. Until then, signing is an external prerequisite and
  `npm run desktop:check-package` must not be treated as evidence of a signed
  release.

## Scope

Only test software and devices you own or are explicitly authorised to test.
Do not probe a laboratory's installed devices, their backups, or the Google
Play listing of a laboratory running this app.

## Notes for operators building from source

- **Never commit `android/keystore.properties`, `*.jks` / `*.keystore`, or
  `.env`** — all are git-ignored. The release keystore is the identity of your
  app on Google Play; losing it means losing the listing.
- **Set real `VITE_SUPPORT_EMAIL` / `VITE_PRIVACY_URL` values.** The canonical
  policy URL is `https://pathomitra.pages.dev/`; the build guard refuses release
  placeholders and the strict live probe verifies the hosted contact/policy.
- **Keep the 16 KB page-alignment check green.** `release.yml` verifies every
  native library in the AAB; Play rejects updates targeting API 35+ whose
  `.so` files are under-aligned.

## Privacy and compliance

PathoMitra keeps all data on the device, which is the strongest privacy
posture available, but it is **not** a certified HIPAA/GDPR-compliance product.
Compliance for a laboratory depends on how the device, the backups, and the
premises are managed. Do not treat this repository as providing compliance on
its own.
