import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordOutputAudit } from './output-audit';

const { set, repo } = vi.hoisted(() => {
  const set = vi.fn(
    async (_entity: string, _id: string, _value: Record<string, unknown>) => undefined,
  );
  return { set, repo: { set } };
});

vi.mock('../data', () => ({
  getRepository: () => repo,
  isShell: true,
}));

vi.mock('./settings', () => ({
  readSettings: () => ({ allowPublicExports: false }),
}));

beforeEach(() => {
  set.mockClear();
});

describe('output audit', () => {
  it('stores uid attribution, entity type, actual destination, outcome, and only a content hash', async () => {
    await recordOutputAudit({
      actor: 'Asha Operator [operator-7]',
      actorUid: 'operator-7',
      actorRole: 'admin',
      entityType: 'invoices',
      recordId: 'INV-42',
      recordVersion: 2,
      action: 'download',
      format: 'pdf',
      destination: 'public',
      destinationDetail: 'C:\\Users\\lab\\Documents\\PathoMitra\\Bill-42.pdf',
      content: 'synthetic-pdf-bytes',
    });

    const [entity, id, value] = set.mock.calls[0];
    expect(entity).toBe('auditEvents');
    expect(id).toMatch(/^output-/);
    expect(value).toMatchObject({
      action: 'output.download',
      entity: 'invoices',
      entityId: 'INV-42',
      actor: 'operator-7',
      actorName: 'Asha Operator [operator-7]',
      actorRole: 'admin',
      detail: {
        format: 'pdf',
        entityType: 'invoices',
        recordVersion: 2,
        destination: 'public',
        destinationDetail: 'C:\\Users\\lab\\Documents\\PathoMitra\\Bill-42.pdf',
        outcome: 'completed',
      },
    });
    expect((value.detail as Record<string, unknown>).contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(value)).not.toContain('synthetic-pdf-bytes');
  });

  it('records cancellation as an append-only outcome', async () => {
    await recordOutputAudit({
      actor: 'Operator',
      actorUid: 'operator-1',
      entityType: 'reports',
      recordId: 'report-1',
      action: 'share',
      format: 'pdf',
      destination: 'share-sheet',
      destinationDetail: '/private/PathoMitra/report.pdf',
      outcome: 'cancelled',
      content: 'synthetic',
    });
    expect((set.mock.calls[0][2].detail as Record<string, unknown>).outcome).toBe('cancelled');
  });

  it('refuses an unattributed output event', async () => {
    await expect(
      recordOutputAudit({
        actor: 'Operator',
        actorUid: '',
        action: 'export',
        format: 'csv',
        content: 'synthetic',
      }),
    ).rejects.toThrow(/operator uid/);
    expect(set).not.toHaveBeenCalled();
  });
});
