import { describe, it, expect } from 'vitest';
import {
  findMissingResults,
  isReportContentChanged,
  planReportWrite,
  type ReportContent,
  type StoredReport,
} from './report-workflow';

// A tiny catalogue stand-in: "CBC" is a panel whose members are Hb and WBC; any
// other name is its own leaf. The module is pure, so the expansion is injected.
const expandNames = (names: readonly string[]): string[] => {
  const out: string[] = [];
  for (const n of names) {
    if (n === 'CBC') out.push('Hb', 'WBC');
    else out.push(n);
  }
  return out;
};

const reviewer = { uid: 'pathologist-1', name: 'Dr Reviewer', role: 'pathologist' as const };

const base = {
  patientId: 'p1',
  patientName: 'Asha Rao',
  signature: 'Dr Who',
  createdAt: '2026-10-14T00:00:00.000Z',
  createdBy: 'Dr Who',
  issuanceSnapshot: {
    version: 1 as const,
    createdAt: '2026-10-14T00:00:00.000Z',
    patient: {
      id: 'p1',
      name: 'Asha Rao',
      age: 30,
      gender: 'female',
      createdAt: '2026-10-14T00:00:00.000Z',
    },
    settings: {},
    tests: [],
  },
};

function content(resultData: Record<string, unknown>, testSelection: string[]): ReportContent {
  return { ...base, resultData, testSelection };
}

function stored(overrides: Partial<StoredReport> = {}): StoredReport {
  return {
    id: 'r1',
    ...base,
    resultData: { Hb: '12', WBC: '7' },
    testSelection: ['CBC'],
    status: 'final',
    version: 1,
    ...overrides,
  };
}

describe('findMissingResults (P0.5)', () => {
  it('treats a blank string as missing, not as a completed result', () => {
    const missing = findMissingResults(content({ Hb: '', WBC: '7' }, ['CBC']), expandNames);
    expect(missing).toEqual(['Hb']);
  });

  it('expands an ordered panel to its members', () => {
    expect(findMissingResults(content({}, ['CBC']), expandNames).sort()).toEqual(['Hb', 'WBC']);
  });

  it('accepts zero and non-empty strings as recorded', () => {
    expect(findMissingResults(content({ Hb: 0, WBC: 'none' }, ['CBC']), expandNames)).toEqual([]);
  });
});

describe('planReportWrite — blank results never block a write (owner, 2026-10-15)', () => {
  it('issues a draft whose panel members are blank instead of refusing', () => {
    const plan = planReportWrite({
      existing: stored({ status: 'draft', resultData: { Hb: '', WBC: '' } }),
      next: { ...content({ Hb: '', WBC: '' }, ['CBC']), status: 'final' },
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(plan.ok).toBe(true);
    expect(plan.issuing).toBe(true);
    expect(plan.ops).toHaveLength(1);
  });

  it('lets an incomplete DRAFT be saved', () => {
    const plan = planReportWrite({
      existing: stored({ status: 'draft', resultData: { Hb: '', WBC: '' } }),
      next: { ...content({ Hb: '', WBC: '' }, ['CBC']), status: 'draft' },
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(plan.ok).toBe(true);
    expect(plan.ops[0].entity).toBe('reports');
  });

  it('allows issuing once every ordered test has a value', () => {
    const plan = planReportWrite({
      existing: stored({ status: 'draft', resultData: { Hb: '12', WBC: '7' } }),
      next: { ...content({ Hb: '12', WBC: '7' }, ['CBC']), status: 'final' },
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(plan.ok).toBe(true);
    expect(plan.issuing).toBe(true);
  });
});

describe('planReportWrite — immutable issued report (P0.4)', () => {
  it('requires an amendment reason when editing an issued report', () => {
    const plan = planReportWrite({
      existing: stored(),
      next: { ...content({ Hb: '11', WBC: '7' }, ['CBC']), status: 'final' },
      reason: '   ',
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/must state a reason/);
  });

  it('retains the prior version as reportVersions before bumping the report', () => {
    const plan = planReportWrite({
      existing: stored(),
      next: { ...content({ Hb: '11', WBC: '7' }, ['CBC']), status: 'final' },
      reason: 'Result transcription error',
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(plan.ok).toBe(true);
    expect(plan.amended).toBe(true);
    // History is written FIRST so the only prior copy survives even on a
    // non-transactional store.
    expect(plan.ops[0].entity).toBe('reportVersions');
    expect(plan.ops[0].id).toBe('r1__v1');
    expect(plan.ops[0].value).toMatchObject({
      version: 1,
      supersededReason: 'Result transcription error',
    });
    expect('Hb' in plan.ops[0].value).toBe(false); // prior results live under resultData
    const prior = plan.ops[0].value.resultData as Record<string, unknown>;
    expect(prior.Hb).toBe('12'); // the value BEFORE the edit is preserved
    expect(plan.ops[1].entity).toBe('reports');
    expect(plan.ops[1].value.version).toBe(2);
    expect('createdBy' in plan.ops[1].value).toBe(false); // author immutable
  });

  it('refuses to revert an issued report to a draft', () => {
    const plan = planReportWrite({
      existing: stored(),
      next: { ...content({ Hb: '12', WBC: '7' }, ['CBC']), status: 'draft' },
      reason: 'undo it',
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/cannot be turned back/);
  });

  it('treats an unchanged issued report as a no-op (no spurious version)', () => {
    const plan = planReportWrite({
      existing: stored(),
      next: { ...content({ Hb: '12', WBC: '7' }, ['CBC']), status: 'final' },
      reason: '',
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(plan.ok).toBe(true);
    expect(plan.ops).toHaveLength(0);
    expect(plan.amended).toBe(false);
  });
});

describe('planReportWrite — independent verification', () => {
  it('requires a pathologist different from the issuing operator', () => {
    const plan = planReportWrite({
      existing: null,
      newId: 'r-new',
      next: { ...content({ Hb: '12' }, ['CBC']), status: 'final' },
      reviewer: { uid: 'issuer-1', name: 'Dr Who', role: 'pathologist' },
      actor: { uid: 'issuer-1', role: 'pathologist' },
      operator: 'Dr Who',
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/independent pathologist/);
  });

  it('retains the independent reviewer on the issued version', () => {
    const plan = planReportWrite({
      existing: null,
      newId: 'r-new',
      next: { ...content({ Hb: '12' }, ['CBC']), status: 'final' },
      reviewer,
      operator: 'Dr Who',
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(plan.verification).toMatchObject({
      reviewedBy: 'Dr Reviewer',
      reviewerUid: 'pathologist-1',
      role: 'pathologist',
    });
    expect(plan.ops[0].value.verification).toEqual(plan.verification);
  });
});

describe('planReportWrite — clinical result preflight', () => {
  it('rejects non-numeric values for numeric tests before issue', () => {
    const plan = planReportWrite({
      existing: null,
      newId: 'r-new',
      next: { ...content({ Sodium: 'high' }, ['Sodium']), status: 'final' },
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/Result validation failed/);
  });

  it('requires an attributed reason for a material delta from the previous issued report', () => {
    const next = { ...content({ Sodium: '150' }, ['Sodium']), status: 'final' as const };
    const blocked = planReportWrite({
      existing: null,
      newId: 'r-new',
      next,
      previousResults: { Sodium: '100' },
      previousReportId: 'r-old',
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/delta review reason/);
    const reviewed = planReportWrite({
      existing: null,
      newId: 'r-new',
      next,
      previousResults: { Sodium: '100' },
      previousReportId: 'r-old',
      deltaReviewReason: 'Expected rise after treatment',
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(reviewed.ok).toBe(true);
    expect(reviewed.deltaReview).toMatchObject({
      reason: 'Expected rise after treatment',
      previousReportId: 'r-old',
      tests: ['Sodium'],
    });
  });

  it('requires an explicit review reason for a critical screening excursion', () => {
    const next = { ...content({ Sodium: '180' }, ['Sodium']), status: 'final' as const };
    const blocked = planReportWrite({
      existing: null,
      newId: 'r-new',
      next,
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/critical screening/);
    const reviewed = planReportWrite({
      existing: null,
      newId: 'r-new',
      next,
      criticalOverrideReason: 'Reviewed against analyser trace',
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(reviewed.ok).toBe(true);
    expect(reviewed.criticalReview).toEqual({
      reason: 'Reviewed against analyser trace',
      reviewedBy: 'Dr Who',
      reviewedAt: '2026-10-14T10:00:00.000Z',
      tests: ['Sodium'],
    });
    expect(reviewed.ops[0].value.criticalReview).toEqual(reviewed.criticalReview);
  });
});

describe('planReportWrite — new reports', () => {
  it('creates a complete new final report in one op', () => {
    const plan = planReportWrite({
      existing: null,
      newId: 'r-new',
      next: { ...content({ Hb: '12', WBC: '7' }, ['CBC']), status: 'final' },
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(plan.ok).toBe(true);
    expect(plan.ops).toEqual([expect.objectContaining({ entity: 'reports', id: 'r-new' })]);
  });

  it('creates a new final report with blank members — the count is advisory', () => {
    const plan = planReportWrite({
      existing: null,
      newId: 'r-new',
      next: { ...content({ Hb: '' }, ['CBC']), status: 'final' },
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(plan.ok).toBe(true);
    expect(plan.issuing).toBe(true);
    // The blanks themselves are still reportable, via the pure helper.
    expect(findMissingResults(content({ Hb: '' }, ['CBC']), expandNames)).toContain('WBC');
  });

  it('needs an id when there is no existing report', () => {
    const plan = planReportWrite({
      existing: null,
      next: { ...content({ Hb: '12', WBC: '7' }, ['CBC']), status: 'draft' },
      operator: 'Dr Who',
      reviewer,
      now: '2026-10-14T10:00:00.000Z',
    });
    expect(plan.ok).toBe(false);
  });
});

describe('isReportContentChanged', () => {
  it('flags a changed result value', () => {
    expect(isReportContentChanged(stored(), content({ Hb: '99', WBC: '7' }, ['CBC']))).toBe(true);
  });
  it('ignores a metadata-only difference on the same values', () => {
    expect(
      isReportContentChanged(
        stored({ signature: 'someone else' }),
        content({ Hb: '12', WBC: '7' }, ['CBC']),
      ),
    ).toBe(false);
  });
});
