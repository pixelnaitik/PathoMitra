import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>() }));

vi.mock('../data', () => ({
  getRepository: () => ({
    get: async (_entity: string, id: string) => {
      const value = store.docs.get(id);
      return value ? { id, data: () => value } : null;
    },
    set: async (_entity: string, id: string, value: Record<string, unknown>) => {
      store.docs.set(id, value);
    },
    delete: async (_entity: string, id: string) => {
      store.docs.delete(id);
    },
  }),
}));

import { clearReportDraft, loadReportDraft, saveReportDraft } from './report-drafts';

beforeEach(() => store.docs.clear());

describe('report draft autosave', () => {
  it('round-trips result edits with the saved-report revision', async () => {
    await saveReportDraft({
      reportId: 'r1',
      baseVersion: 2,
      baseUpdatedAt: '2026-11-24T10:00:00.000Z',
      resultData: { Sodium: '180' },
    });
    expect(await loadReportDraft('r1')).toMatchObject({
      reportId: 'r1',
      baseVersion: 2,
      resultData: { Sodium: '180' },
      savedAt: expect.any(String),
    });
  });

  it('round-trips reviewer and clinical-review metadata with result edits', async () => {
    await saveReportDraft({
      reportId: 'r1',
      baseVersion: 2,
      resultData: { Sodium: '180' },
      reviewer: { uid: 'path-1', name: 'Dr Reviewer', role: 'pathologist', note: 'Checked trace' },
      criticalReviewReason: 'Repeat confirmed',
      amendReason: 'Transcription correction',
      deltaReviewReason: 'Expected after treatment',
    });
    expect(await loadReportDraft('r1')).toMatchObject({
      reviewer: { uid: 'path-1', name: 'Dr Reviewer', role: 'pathologist', note: 'Checked trace' },
      criticalReviewReason: 'Repeat confirmed',
      amendReason: 'Transcription correction',
      deltaReviewReason: 'Expected after treatment',
    });
  });

  it('rejects malformed or mismatched draft documents', async () => {
    store.docs.set('report-draft:r1', {
      version: 1,
      reportId: 'other',
      baseVersion: 1,
      resultData: {},
    });
    expect(await loadReportDraft('r1')).toBeNull();
    store.docs.set('report-draft:r1', {
      version: 1,
      reportId: 'r1',
      baseVersion: 0,
      resultData: {},
    });
    expect(await loadReportDraft('r1')).toBeNull();
  });

  it('clears the draft after a verified save', async () => {
    await saveReportDraft({ reportId: 'r1', baseVersion: 1, resultData: { Sodium: '140' } });
    await clearReportDraft('r1');
    expect(await loadReportDraft('r1')).toBeNull();
  });
});
