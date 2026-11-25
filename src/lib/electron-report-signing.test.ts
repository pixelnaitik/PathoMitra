import { beforeEach, describe, expect, it, vi } from 'vitest';

const secrets = vi.hoisted(() => new Map<string, string>());
vi.mock('../../electron/keyring', () => ({
  getSecret: vi.fn(async (key: string) => secrets.get(key) ?? null),
  setSecret: vi.fn(async (key: string, value: string) => {
    secrets.set(key, value);
  }),
  deleteSecret: vi.fn(async (key: string) => secrets.delete(key)),
}));

import {
  desktopReportPublicKey,
  signDesktopReport,
  verifyDesktopReport,
} from '../../electron/report-signing';

describe('Desktop report signing', () => {
  beforeEach(() => secrets.clear());

  it('keeps the private key in the main-process credential store and verifies by registry key id', async () => {
    const key = await desktopReportPublicKey();
    expect(key.keyId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secrets.has('report-signing-private-v2')).toBe(true);
    expect(secrets.get('report-signing-private-v2')).toContain('PRIVATE KEY');
    const signed = await signDesktopReport('synthetic manifest');
    expect(
      (await verifyDesktopReport('synthetic manifest', signed.signature, key.keyId)).valid,
    ).toBe(true);
    expect(
      (await verifyDesktopReport('tampered manifest', signed.signature, key.keyId)).valid,
    ).toBe(false);
    expect(
      (await verifyDesktopReport('synthetic manifest', signed.signature, 'unknown-key')).valid,
    ).toBe(false);
  });
});
