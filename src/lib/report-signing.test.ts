import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ key: null as unknown }));

vi.mock('./secure-store', () => ({
  secureGet: async () => h.key,
  secureSet: async (_key: string, value: unknown) => { h.key = value; },
  secureRemove: async () => { h.key = null; },
}));

import { canonicalReportManifest, signReportIssuance, verifyReportIssuance } from './report-signing';
import type { ReportRecord } from './models';

const report = (): ReportRecord => ({
  id: 'r1',
  patientId: 'p1',
  patientName: 'Asha Rao',
  resultData: { Sodium: '140' },
  testSelection: ['Sodium'],
  signature: 'Dr Operator',
  status: 'final',
  createdAt: '2026-11-24T10:00:00.000Z',
  createdBy: 'Dr Operator',
  version: 1,
  issuanceSnapshot: {
    version: 1,
    createdAt: '2026-11-24T10:00:00.000Z',
    patient: { id: 'p1', name: 'Asha Rao', age: 30, gender: 'female', createdAt: '2026-11-24T10:00:00.000Z' },
    settings: {},
    tests: [],
  },
  verification: { reviewedBy: 'Dr Reviewer', role: 'pathologist', reviewedAt: '2026-11-24T10:00:00.000Z' },
});

beforeEach(() => { h.key = null; });

describe('report issuance signing', () => {
  it('produces a stable canonical manifest regardless of object key order', () => {
    const a = report();
    const b = { ...a, resultData: { Sodium: '140' }, issuanceSnapshot: { tests: [], patient: a.issuanceSnapshot!.patient, settings: {}, createdAt: a.issuanceSnapshot!.createdAt, version: 1 as const } };
    expect(canonicalReportManifest(a)).toBe(canonicalReportManifest(b));
  });

  it('signs and verifies an issued report', async () => {
    const value = report();
    const sealed = await signReportIssuance(value);
    value.issuanceSignature = sealed;
    expect(sealed.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyReportIssuance(value)).toEqual({ valid: true });
  });

  it('detects a changed result after issue', async () => {
    const value = report();
    value.issuanceSignature = await signReportIssuance(value);
    value.resultData.Sodium = '180';
    expect((await verifyReportIssuance(value)).valid).toBe(false);
  });
});
