import { describe, it, expect } from 'vitest';
import { isPlaceholderAuthority, PRIVACY_SECTIONS } from './privacy-policy';

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

  it('discloses the Email / SMS / WhatsApp compose hand-off', () => {
    expect(body).toMatch(/mailto/);
    expect(body).toMatch(/wa\.me/);
  });

  it('states that a snapshot is sealed, and that the passphrase cannot be recovered', () => {
    // lib/backup.ts seals exports by default; the policy has to say so, and it has
    // to say the hard part too — an unrecoverable key is a data-loss risk the lab
    // can only manage if it is told before it needs the file.
    expect(body).toMatch(/AES-256-GCM/);
    expect(body).toMatch(/cannot be reset/);
    expect(body).toMatch(/unencrypted is still available/);
  });
});
