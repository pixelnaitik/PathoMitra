import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  report: null as Record<string, unknown> | null,
  reports: [] as Array<{ data: () => Record<string, unknown> }>,
  invoices: [] as Array<{ data: () => Record<string, unknown> }>,
  versions: [] as Array<{ data: () => Record<string, unknown>; ref: unknown }>,
  deleted: vi.fn(),
  updated: vi.fn(),
}));

vi.mock('../data/fs', () => ({
  db: {},
  collection: (_db: unknown, path: string) => ({ path }),
  doc: (_db: unknown, path: string, id: string) => ({ path, id }),
  query: (collection: unknown) => collection,
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  getDoc: async () => ({
    exists: () => h.report !== null,
    data: () => h.report ?? {},
  }),
  updateDoc: h.updated,
  getDocs: async (query: { path: string }) => {
    const docs =
      query.path === 'reports' ? h.reports : query.path === 'invoices' ? h.invoices : h.versions;
    return { docs, size: docs.length };
  },
}));

vi.mock('./firestore-batch', () => ({ deleteInChunks: h.deleted }));

import { archivePatient, deletePatientCascade, deleteReportCascade } from './cascades';

beforeEach(() => {
  h.report = null;
  h.reports = [];
  h.invoices = [];
  h.versions = [];
  h.deleted.mockReset();
  h.updated.mockReset();
});

describe('retention-safe cascades', () => {
  it('archives a patient while retaining related history', async () => {
    h.report = { name: 'Asha Rao' };
    await archivePatient('p1', 'Ashu', 'Duplicate registration');
    expect(h.updated).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        archivedBy: 'Ashu',
        archivedReason: 'Duplicate registration',
        archivedAt: expect.any(String),
      }),
    );
    expect(h.deleted).not.toHaveBeenCalled();
  });

  it('refuses to hard-delete an issued report', async () => {
    h.report = { status: 'final' };
    await expect(deleteReportCascade('r1')).rejects.toThrow(/Issued reports cannot be deleted/);
    expect(h.deleted).not.toHaveBeenCalled();
  });

  it('refuses to delete a report linked to a financial document', async () => {
    h.report = { status: 'draft' };
    h.invoices = [{ data: () => ({ status: 'paid' }) }];
    await expect(deleteReportCascade('r1')).rejects.toThrow(/linked to an invoice/);
    expect(h.deleted).not.toHaveBeenCalled();
  });

  it('still deletes an unissued, unbilled draft', async () => {
    h.report = { status: 'draft' };
    await deleteReportCascade('r1');
    expect(h.deleted).toHaveBeenCalledOnce();
  });

  it('refuses patient hard-delete when clinical or financial history exists', async () => {
    h.reports = [{ data: () => ({ status: 'final' }) }];
    await expect(deletePatientCascade('p1')).rejects.toThrow(/cannot be hard-deleted/);
    expect(h.deleted).not.toHaveBeenCalled();
  });
});
