import { describe, expect, it } from 'vitest';
import { measureRestoreDrill, RPO_TARGET_MS, RTO_TARGET_MS } from './continuity';

describe('restore drill measurement', () => {
  it('records observed RTO, snapshot age, reconciled count, and source', () => {
    const createdAt = new Date('2026-10-15T00:00:00.000Z').toISOString();
    const startedAt = Date.parse('2026-10-15T02:00:00.000Z');
    const completedAt = Date.parse('2026-10-15T02:30:00.000Z');
    expect(
      measureRestoreDrill(
        { createdAt, totalRecords: 42, fileName: 'backup.json' },
        startedAt,
        completedAt,
      ),
    ).toEqual({
      durationMs: 30 * 60_000,
      rpoMs: 2.5 * 60 * 60_000,
      records: 42,
      snapshot: 'backup.json',
      outcome: 'passed',
    });
  });

  it('clamps clock rollback and invalid snapshot dates instead of inventing measurements', () => {
    const measured = measureRestoreDrill({ createdAt: 'invalid', totalRecords: 3.9 }, 100, 50);
    expect(measured.durationMs).toBe(0);
    expect(measured.rpoMs).toBe(0);
    expect(measured.records).toBe(3);
    expect(measured.snapshot).toBe('imported snapshot');
  });

  it('defines the runbook targets used by the UI', () => {
    expect(RPO_TARGET_MS).toBe(8 * 60 * 60_000);
    expect(RTO_TARGET_MS).toBe(24 * 60 * 60_000);
  });
});
