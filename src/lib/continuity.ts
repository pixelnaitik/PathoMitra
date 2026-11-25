export const RPO_TARGET_MS = 8 * 60 * 60 * 1000;
export const RTO_TARGET_MS = 24 * 60 * 60 * 1000;

export interface RestoreDrillSnapshot {
  createdAt: string;
  totalRecords: number;
  fileName?: string;
  safetySnapshot?: string;
}

/** Measured recovery-point age and recovery time for one successful restore. */
export function measureRestoreDrill(
  snapshot: RestoreDrillSnapshot,
  startedAt: number,
  completedAt = Date.now(),
): {
  durationMs: number;
  rpoMs: number;
  records: number;
  snapshot: string;
  outcome: 'passed';
} {
  const snapshotAt = Date.parse(snapshot.createdAt);
  return {
    durationMs: Math.max(0, completedAt - startedAt),
    rpoMs: Number.isFinite(snapshotAt) ? Math.max(0, completedAt - snapshotAt) : 0,
    records: Math.max(0, Math.floor(snapshot.totalRecords)),
    snapshot: snapshot.fileName ?? snapshot.safetySnapshot ?? 'imported snapshot',
    outcome: 'passed',
  };
}
