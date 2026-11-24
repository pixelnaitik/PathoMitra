import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { isPlaceholderAuthority, PRIVACY_SECTIONS } from './privacy-policy';
import { TERMS_SECTIONS } from './terms';

/**
 * Guard for the defect that shipped in 2.5.1: `privacy@pathomitra.test` and
 * `https://policy.pathomitra.test/` passed every release check (which only knew
 * the literal `example.invalid`) and were inlined into the signed APK — leaving a
 * pathology app holding patient data advertising a privacy policy on a TLD that
 * RFC 2606 reserves and can never resolve. Play requires a publicly reachable
 * policy, so this detection is load-bearing for approval, not cosmetic.
 */
describe('isPlaceholderAuthority — reserved and placeholder hosts', () => {
  it.each([
    // The exact hosts that reached the release bundle: the mailbox host and the
    // policy URL's hostname. Both are passed already extracted, as
    // hasPlaceholderPrivacyContact() does — this function takes a host, not a URL.
    ['pathomitra.test', 'policy.pathomitra.test'],
    // Reserved, never-resolvable suffixes (RFC 2606 / RFC 6761).
    ['example.invalid', 'anything.test'],
    ['a.example', 'a.localhost'],
    ['svc.local', 'policy.example'],
    // Literal scaffold hosts from .env.example.
    ['your-lab-domain.example', 'policy.your-domain.dev'],
    ['localhost', 'lab.example.com'],
  ])('flags %s / %s as a placeholder', (emailHost, urlHost) => {
    expect(isPlaceholderAuthority(emailHost)).toBe(true);
    expect(isPlaceholderAuthority(urlHost)).toBe(true);
  });

  it('does not flag a real domain just because it contains a reserved-looking word', () => {
    // `.example` is reserved but `example.org` / `.com` are not — matching had to
    // stay on the suffix so a legitimate policy host is never blocked.
    for (const host of ['pathomitra.com', 'lab.example.org', 'policy.pathomitra.health']) {
      expect(isPlaceholderAuthority(host), host).toBe(false);
    }
  });

  it('is case-insensitive and tolerates ports and www', () => {
    expect(isPlaceholderAuthority('POLICY.PathoMitra.TEST')).toBe(true);
    expect(isPlaceholderAuthority('www.lab.test')).toBe(true);
    expect(isPlaceholderAuthority('localhost:5173')).toBe(true);
  });
});

describe('privacy policy content', () => {
  const body = PRIVACY_SECTIONS.flatMap(s => s.body).join(' ');

  it('says the settings/custom-test store is not inside the encrypted database', () => {
    // "All records are kept in SQLCipher" was an overstatement: settings, custom
    // tests and notification read-state live in localStorage (lib/settings.ts).
    expect(body).toMatch(/not AES-256 encrypted/);
    expect(body).not.toMatch(/^All records are kept/);
  });

  it('discloses banner-only alert delivery, with no compose hand-off left', () => {
    // The Email / SMS / WhatsApp compose buttons were removed on 2026-10-11, so the
    // policy must not read as though the app still hands alert text to a mail or
    // messaging app. Those scheme names may appear only in the sentence recording
    // that they went away.
    expect(body).toMatch(/delivered as system banners and nothing else/);
    expect(body).toMatch(/those were removed/);
    expect(body).not.toMatch(/buttons build a mailto/);
    expect(body).not.toMatch(/whichever app the device resolves/);
  });

  it('describes the re-lock as an inactivity countdown, not an instant background lock', () => {
    // `lib/session-lock` no longer locks the moment the app leaves the foreground —
    // leaving the app now starts the same countdown the operator sets. The policy
    // claimed "when you leave the app", which is no longer what happens.
    expect(body).toMatch(/re-locks automatically after a period of inactivity/);
    expect(body).not.toMatch(/re-locks automatically when you leave the app/);
  });

  it('states that a snapshot is sealed, and that the passphrase cannot be recovered', () => {
    // lib/backup.ts seals exports by default; the policy has to say so, and it has
    // to say the hard part too — an unrecoverable key is a data-loss risk the lab
    // can only manage if it is told before it needs the file.
    expect(body).toMatch(/AES-256-GCM/);
    expect(body).toMatch(/cannot be reset/);
    expect(body).toMatch(/unencrypted is still available/);
  });

  it('says the alert banner names no patient, and the channel is lock-screen private', () => {
    // The Android shade is readable on a locked device and FLAG_SECURE does not
    // cover it, so the policy's silence about banner content was the overstated
    // part. lib/notification-engine.ts (bannerTitle) and
    // lib/desktop-notifications.ts (visibility 0) are what this sentence promises.
    expect(body).toMatch(/never names a patient/);
    expect(body).toMatch(/private lock-screen visibility/);
    expect(body).toMatch(/in-app alert list does show names/);
  });

  it('describes key storage per platform, and never claims hardware on Windows', () => {
    // Store review PR-02 (Microsoft Store Policies 10.5.1 requires the policy to
    // say how information is stored and secured). The whole policy used to
    // describe Android storage only, while the Windows build seals the key with
    // DPAPI in the Credential Locker (electron/keyring.ts, electron/db.ts) — so a
    // Windows reader was told "backed by hardware", which is the one claim that
    // path cannot support. A JS string with a single backslash also silently eats
    // `\P`, which is why the folder path is asserted here rather than eyeballed.
    expect(body).toMatch(/Windows Credential Locker/);
    expect(body).toMatch(/DPAPI/);
    expect(body).toMatch(/%APPDATA%\\PathoMitra/);
    expect(body).toMatch(/any process running as your user/);
    expect(body).toMatch(/does not encrypt at all/);
    // The hardware-backed sentence may survive only as the recorded correction.
    expect(body).not.toMatch(/stored in the Android keystore, which is backed by hardware/);
    expect(body.match(/hardware-backed/g) ?? []).toHaveLength(2);
  });

  it('says uninstalling on Windows leaves the data, and tells the lab what to do', () => {
    // Store review P-06 / PR-03. electron-builder.config.mjs keeps the data on
    // purpose (an MSI must not take a laboratory's records with it), so the old
    // flat claim that uninstalling removes the database was false on the one
    // platform being certified — and the honest version has to carry the
    // instruction that makes it safe.
    expect(body).not.toMatch(/^Uninstalling the app removes the local database/);
    expect(body).toMatch(/Uninstalling is not the same as deleting/);
    expect(body).toMatch(/leaves the app data folder/);
    expect(body).toMatch(/use "Erase all data & delete account" first/);
  });
});

/**
 * The operator-accepted terms must describe the build the operator is running.
 *
 * Terms §5 said "Backups are plaintext JSON by design" for weeks after lib/backup.ts
 * started sealing every snapshot with AES-256-GCM. A consent document that
 * misstates how patient data is protected is worse than no consent document: the
 * lab calibrates its own diligence (and its DPDP risk) on what it read here, and
 * a Play reviewer comparing the terms against the policy finds two answers.
 */
describe('terms of use describe the real build', () => {
  const terms = TERMS_SECTIONS.flatMap(s => s.body).join(' ');

  it('describes backups as sealed by default', () => {
    expect(terms).toMatch(/Backups are sealed by default/);
    expect(terms).toMatch(/cannot be reset/);
  });

  it('never claims backups are plaintext by design', () => {
    expect(terms).not.toMatch(/plaintext JSON/i);
    expect(terms).not.toMatch(/by design so that you can always recover/i);
  });

  it('still disclaims every certification the app does not hold', () => {
    // docs/play-listing.md bans these words in listing text for the same reason:
    // claiming an accreditation the product does not have is an Impersonation
    // violation, and here the app is at least honest about not having it.
    expect(terms).toMatch(/not HIPAA-compliant, NABL-accredited, ISO-certified, CE-marked or SOC 2 audited/);
  });
});

/**
 * The hosted policy at pathomitra.pages.dev/privacy is a fork of the in-app one
 * (`promotion_website/src/lib/privacy-policy.ts`), and Google reviews the hosted
 * copy. They must not disagree on the three facts the Data Safety form is built
 * from — that is the mismatch that turns an automated scan into a manual review.
 */
describe('hosted policy agrees with the in-app policy on the load-bearing facts', () => {
  const hosted = readFileSync('promotion_website/src/lib/privacy-policy.ts', 'utf8');
  const inApp = PRIVACY_SECTIONS.flatMap(s => s.body).join(' ');

  it.each([
    ['the no-INTERNET claim', /INTERNET permission/],
    ['the no-tracker claim', /no advertising, analytics|advertising, analytics, crash-reporting/i],
    ['the no-dangerous-permission claim', /no camera, microphone, location/i],
    ['the deletion-in-app claim', /Erase all data|erase all data/i],
  ])('both documents state %s', (label, pattern) => {
    expect(inApp, `in-app policy: ${label}`).toMatch(pattern);
    expect(hosted, `hosted policy: ${label}`).toMatch(pattern);
  });

  it('neither document claims a sync path or remote access', () => {
    // Not "HIPAA-compliant" and friends: both documents say the app is *not*
    // certified, so the words appear legitimately. What must never appear is a
    // positive claim of remote capability the binary has no permission for.
    for (const [name, text] of [
      ['in-app', inApp],
      ['hosted', hosted],
    ] as const) {
      expect(text, name).not.toMatch(/cloud sync|synced automatically|sync(?:s|ed)? to (?:a )?server|access from anywhere|remote backup|remote access/i);
    }
  });
});
