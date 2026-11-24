import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ docs: new Map<string, Array<{ id: string; data: () => Record<string, unknown> }>>() }));
vi.mock('../data', () => ({
  initDataStore: async () => ({
    list: async (entity: string) => h.docs.get(entity) ?? [],
  }),
}));

import { auditDataIntegrity } from './data-integrity';

const doc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

beforeEach(() => h.docs.clear());

describe('auditDataIntegrity', () => {
  it('reports orphaned clinical links, duplicate identifiers, and invalid invoice arithmetic', async () => {
    h.docs.set('patients', [doc('p1', { name: 'Asha' })]);
    h.docs.set('orders', [
      doc('o1', { orderNo: 'ORD-1', patientId: 'missing', status: 'ordered', items: [] }),
      doc('o2', { orderNo: 'ORD-1', patientId: 'p1', status: 'ordered', items: [] }),
    ]);
    h.docs.set('samples', [doc('s1', { accessionNo: 'ACC-1', patientId: 'p1', orderId: 'missing', status: 'expected', custody: [] })]);
    h.docs.set('reports', [doc('r1', { patientId: 'p1', status: 'final', testSelection: ['Sodium'] })]);
    h.docs.set('invoices', [doc('IN-1', {
      patientId: 'p1', invoiceNo: 'IN-1', amount: 100, paidAmount: 120, status: 'paid',
      items: [{ name: 'CBC', kind: 'test', qty: 2, unitPrice: 30, lineTotal: 50, unpriced: false, covers: [] }],
    })]);
    h.docs.set('reportVersions', [doc('v1', { reportId: 'missing' })]);

    const report = await auditDataIntegrity();
    const ids = report.issues.map(issue => issue.id);
    expect(ids).toEqual(expect.arrayContaining([
      'orders:orphan:o1',
      'orders:duplicate:ORD-1',
      'samples:order:s1',
      'reports:snapshot:r1',
      'invoices:overpaid:IN-1',
      'invoices:arithmetic:IN-1:CBC',
      'reportVersions:orphan:v1',
    ]));
    expect(report.scanned).toMatchObject({ patients: 1, orders: 2, samples: 1, reports: 1, invoices: 1, reportVersions: 1 });
  });

  it('returns a clean report for a consistent small dataset', async () => {
    h.docs.set('patients', [doc('p1', { name: 'Asha' })]);
    h.docs.set('orders', [doc('o1', { orderNo: 'ORD-1', patientId: 'p1', status: 'ordered', items: [] })]);
    h.docs.set('samples', [doc('s1', { accessionNo: 'ACC-1', patientId: 'p1', orderId: 'o1', status: 'expected', custody: [] })]);
    const report = await auditDataIntegrity();
    expect(report.issues).toEqual([]);
  });
});
