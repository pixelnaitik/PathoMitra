import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SQLITE_SCHEMA } from './sqliteRepository';

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SQLITE_SCHEMA);
  db.prepare('INSERT INTO principal_context (id, uid, role, updatedAt) VALUES (1, ?, ?, ?)').run(
    'issuer-1',
    'pathologist',
    '2026-11-24T00:00:00.000Z',
  );
});

afterEach(() => db.close());

const insert = (table: string, id: string, data: unknown) =>
  db.prepare(`INSERT INTO ${table} (id, data) VALUES (?, ?)`).run(id, JSON.stringify(data));
const update = (table: string, id: string, data: unknown) =>
  db.prepare(`UPDATE ${table} SET data = ? WHERE id = ?`).run(JSON.stringify(data), id);

const finalReport = {
  status: 'final',
  patientId: 'p1',
  patientName: 'Asha Rao',
  testSelection: ['Sodium'],
  issuanceSnapshot: { version: 1 },
  resultData: { Sodium: '140' },
  version: 1,
  issuerUid: 'issuer-1',
  verification: {
    reviewedBy: 'Dr Reviewer',
    reviewerUid: 'reviewer-1',
    role: 'pathologist',
    reviewedAt: '2026-11-24T00:00:00.000Z',
  },
  issuanceSignature: { signature: 'synthetic', keyId: 'device-1', manifestHash: '0'.repeat(64) },
};

describe('SQLite clinical guards', () => {
  it('rejects blank or orphaned final reports at the database boundary', () => {
    expect(() => insert('reports', 'bad', { ...finalReport, patientId: '' })).toThrow(
      /invalid final report/,
    );
    expect(() =>
      insert('reports', 'bad2', { ...finalReport, issuanceSnapshot: undefined }),
    ).toThrow(/invalid final report/);
    expect(() => insert('reports', 'good', finalReport)).not.toThrow();
    expect(() => update('reports', 'good', { ...finalReport, status: 'draft' })).toThrow(
      /cannot return to draft/,
    );
  });

  it('rejects invalid order and sample transitions even if renderer rules are bypassed', () => {
    insert('orders', 'o1', { status: 'ordered' });
    expect(() => update('orders', 'o1', { status: 'issued' })).toThrow(/invalid order status/);
    expect(() => update('orders', 'o1', { status: 'collected' })).not.toThrow();

    insert('samples', 's1', { status: 'expected', custody: [] });
    expect(() => update('samples', 's1', { status: 'disposed' })).toThrow(/invalid sample status/);
    expect(() => update('samples', 's1', { status: 'collected', custody: [] })).not.toThrow();
  });

  it('keeps custody history append-only and audit events immutable', () => {
    insert('samples', 's1', { status: 'collected', custody: [{ id: 'c1', actor: 'A', at: 't1' }] });
    expect(() => update('samples', 's1', { status: 'collected', custody: [] })).toThrow(
      /append-only/,
    );
    expect(() =>
      update('samples', 's1', {
        status: 'collected',
        custody: [{ id: 'c1', actor: 'B', at: 't1' }],
      }),
    ).toThrow(/append-only/);
    expect(() =>
      update('samples', 's1', {
        status: 'received',
        custody: [
          { id: 'c1', actor: 'A', at: 't1' },
          { id: 'c2', actor: 'B', at: 't2' },
        ],
      }),
    ).not.toThrow();

    insert('auditEvents', 'a1', { action: 'report.issued', actor: 'A' });
    expect(() => update('auditEvents', 'a1', { action: 'changed', actor: 'B' })).toThrow(
      /append-only/,
    );
  });
});
