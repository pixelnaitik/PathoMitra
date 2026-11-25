import type { ReportRecord } from './models';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

/** Stable, externally reproducible manifest covered by the issuance signature. */
export function canonicalReportManifest(report: ReportRecord): string {
  return JSON.stringify(
    canonicalize({
      id: report.id,
      version: report.version,
      status: report.status,
      patientId: report.patientId,
      patientName: report.patientName,
      resultData: report.resultData,
      testSelection: report.testSelection,
      createdAt: report.createdAt,
      createdBy: report.createdBy,
      updatedAt: report.updatedAt,
      amendReason: report.amendReason,
      issuanceSnapshot: report.issuanceSnapshot,
      issuerUid: report.issuerUid,
      verification: report.verification,
      criticalReview: report.criticalReview,
      deltaReview: report.deltaReview,
    }),
  );
}
