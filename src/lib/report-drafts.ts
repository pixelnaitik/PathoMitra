import { getRepository } from '../data';

const DRAFT_PREFIX = 'report-draft:';
const MAX_RESULTS = 500;
const MAX_VALUE_LENGTH = 500;

export interface ReportDraftAutosave {
  version: 1;
  reportId: string;
  baseVersion: number;
  baseUpdatedAt?: string;
  resultData: Record<string, string>;
  savedAt: string;
}

const draftId = (reportId: string) => `${DRAFT_PREFIX}${reportId}`;

function readDraft(reportId: string, raw: Record<string, unknown>): ReportDraftAutosave | null {
  if (raw.version !== 1 || raw.reportId !== reportId) return null;
  const baseVersion = Number(raw.baseVersion);
  if (!Number.isInteger(baseVersion) || baseVersion < 1) return null;
  if (typeof raw.resultData !== 'object' || raw.resultData === null || Array.isArray(raw.resultData)) {
    return null;
  }
  const resultData: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw.resultData).slice(0, MAX_RESULTS)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
    resultData[name] = String(value).slice(0, MAX_VALUE_LENGTH);
  }
  return {
    version: 1,
    reportId,
    baseVersion,
    ...(typeof raw.baseUpdatedAt === 'string' ? { baseUpdatedAt: raw.baseUpdatedAt } : {}),
    resultData,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
  };
}

/** Persist unsaved result edits in the encrypted repository, never localStorage. */
export async function saveReportDraft(
  input: Omit<ReportDraftAutosave, 'version' | 'savedAt'>,
): Promise<ReportDraftAutosave> {
  if (!input.reportId.trim()) throw new Error('A report draft needs a report id.');
  const value: ReportDraftAutosave = {
    version: 1,
    reportId: input.reportId,
    baseVersion: input.baseVersion,
    ...(input.baseUpdatedAt ? { baseUpdatedAt: input.baseUpdatedAt } : {}),
    resultData: input.resultData,
    savedAt: new Date().toISOString(),
  };
  await getRepository().set('meta', draftId(input.reportId), value as unknown as Record<string, unknown>);
  return value;
}

export async function loadReportDraft(reportId: string): Promise<ReportDraftAutosave | null> {
  const doc = await getRepository().get('meta', draftId(reportId));
  return doc ? readDraft(reportId, doc.data()) : null;
}

export async function clearReportDraft(reportId: string): Promise<void> {
  await getRepository().delete('meta', draftId(reportId));
}
