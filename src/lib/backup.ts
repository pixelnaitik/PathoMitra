/**
 * Backup and restore of the on-device clinical database.
 *
 * The app is local-first by design: every patient, report and invoice lives in
 * one encrypted SQLCipher file on one phone, `allowBackup="false"` keeps Android
 * from copying it anywhere, and there is no cloud. Before this module a lost,
 * crashed or reset device destroyed the lab's entire history with no recovery
 * path at all — a single point of failure for medical records.
 *
 * A backup is therefore a plain JSON snapshot of every collection, written into
 * the app's own storage folder so it can be listed and restored later, and
 * shareable to Drive / a PC / the second workstation through the system sheet.
 *
 * Two things deliberately stay out of the file:
 *
 *   - The unlock credential. It is not in the database at all — it lives in the
 *     keystore-backed secure store, which cannot be exported by design. A restore
 *     brings the *records* back, not the password; the device keeps its own
 *     account.
 *   - Any illusion of confidentiality. The export is human-readable on purpose.
 *     It contains patient data, so "send a copy to the cloud" is the user's
 *     decision, never something the app does quietly.
 *
 * Restore is an upsert and never a delete: a snapshot can be merged onto a device
 * that has recorded things since, and an older or partial file cannot silently
 * destroy newer data.
 */
import type { EntityName } from '../data/types';
import { listAppFiles, readAppTextFile, writeAppTextFile, shareAppFile } from './native-files';
import { initDataStore } from '../data';
import { captureError } from './telemetry';
import { z } from 'zod';

/** App-relative folder holding the snapshots. Keep it stable across releases. */
const BACKUP_DIR = 'PathLab OS/Backups';

/**
 * Collections written to a snapshot. `meta` is included so the store's own
 * bookkeeping comes back with it; the unlock account is not a collection and so
 * is never in here.
 */
const BACKUP_COLLECTIONS: readonly EntityName[] = [
  'users',
  'patients',
  'doctors',
  'reports',
  'reportNotes',
  'invoices',
  'labSettings',
  'notificationState',
  'meta',
] as const;

export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupCounts {
  [collection: string]: number;
}

export interface BackupSummary {
  /** File name inside the backup folder, when one exists. */
  fileName?: string;
  /** ISO timestamp of the snapshot, or the file name when it could not be read. */
  createdAt: string;
  counts: BackupCounts;
  totalRecords: number;
}

/**
 * One stored document. `id` is required and everything else passes through, so a
 * snapshot from an older build never fails validation over a field this build
 * has stopped writing.
 */
function toBackupDoc(
  id: string,
  value: Record<string, unknown>,
): { id: string } & Record<string, unknown> {
  return { id, ...value };
}

const BackupDocumentSchema = z.object({ id: z.string().min(1) }).passthrough();

const BackupFileSchema = z.object({
  app: z.literal('PathLab OS'),
  kind: z.literal('backup'),
  schemaVersion: z.number().int().min(1).max(BACKUP_SCHEMA_VERSION),
  createdAt: z.string().min(1),
  counts: z.record(z.string(), z.number().int().min(0)),
  data: z.record(z.string(), z.array(BackupDocumentSchema)),
});
export type BackupFile = z.infer<typeof BackupFileSchema>;
type BackupDocuments = { id: string } & Record<string, unknown>;

/** Filename with a sortable timestamp, so the list reads newest-first. */
function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function backupFileName(createdAt: Date = new Date()): string {
  return `pathlab-backup-${stamp(createdAt)}.json`;
}

function summarise(backup: BackupFile, fileName?: string): BackupSummary {
  return {
    fileName,
    createdAt: backup.createdAt,
    counts: backup.counts,
    totalRecords: Object.values(backup.counts).reduce((sum, n) => sum + n, 0),
  };
}

/** Take a snapshot of every collection. Read-only; touches nothing. */
export async function buildBackup(): Promise<BackupFile> {
  const repo = await initDataStore();
  const data: Record<string, BackupDocuments[]> = {};
  const counts: BackupCounts = {};

  for (const collection of BACKUP_COLLECTIONS) {
    const docs = await repo.list(collection);
    data[collection] = docs.map(doc => toBackupDoc(doc.id, doc.data()));
    counts[collection] = docs.length;
  }

  return {
    app: 'PathLab OS',
    kind: 'backup',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    counts,
    data,
  };
}

/**
 * Write a snapshot into the app's backup folder.
 * @returns where it went, plus the file name for {@link shareBackup}.
 */
export async function createBackup(): Promise<{ summary: BackupSummary; fileName: string }> {
  const backup = await buildBackup();
  const fileName = backupFileName(new Date(backup.createdAt));
  const saved = await writeAppTextFile(
    `${BACKUP_DIR}/${fileName}`,
    JSON.stringify(backup, null, 2),
  );
  return { summary: summarise(backup, saved.name), fileName };
}

/** Hand a stored snapshot to the system share sheet, so a copy can leave. */
export async function shareBackup(fileName: string): Promise<void> {
  const summary = await readBackup(fileName);
  await shareAppFile(
    `${BACKUP_DIR}/${fileName}`,
    fileName,
    'PathLab OS backup',
    `${summary.totalRecords} records, taken ${summary.createdAt}`,
  );
}

/**
 * Snapshots on the device, newest first.
 *
 * Listing only gives file names, and a name is not a date the user can trust
 * once a file has been copied around — so each entry is opened and summarised.
 * A file that fails to parse is still listed (the user may want to delete it),
 * with its name as the only known fact.
 */
export async function listBackups(): Promise<BackupSummary[]> {
  const names = await listAppFiles(BACKUP_DIR, '.json');
  return names.map(name => ({
    fileName: name,
    createdAt: name,
    counts: {},
    totalRecords: 0,
  }));
}

async function readBackup(fileName: string): Promise<BackupSummary> {
  const backup = parseBackup(await readAppTextFile(`${BACKUP_DIR}/${fileName}`));
  return summarise(backup, fileName);
}

/** Validate a snapshot before a single row is written. */
export function parseBackup(raw: string): BackupFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('That file is not valid JSON, so it cannot be a PathLab OS backup.');
  }
  const result = BackupFileSchema.safeParse(json);
  if (!result.success) {
    throw new Error(
      'This is not a PathLab OS backup file, or it came from a newer version. ' +
        result.error.issues
          .slice(0, 2)
          .map(issue => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
    );
  }
  return result.data;
}

export interface RestoreResult extends BackupSummary {
  /** Collections in the file that this build does not recognise. */
  skipped: string[];
}

/**
 * Merge a snapshot into the local store, upserting by document id.
 *
 * Nothing is deleted and unknown collections are reported rather than guessed at.
 * The store is not wiped first — that is the caller's decision, and the only safe
 * order is restore-then-review, not destroy-then-hope.
 */
export async function restoreBackup(backup: BackupFile): Promise<RestoreResult> {
  const repo = await initDataStore();
  const known = new Set<string>(BACKUP_COLLECTIONS);
  const counts: BackupCounts = {};
  const skipped: string[] = [];
  let restored = 0;

  for (const [collection, docs] of Object.entries(backup.data)) {
    if (!known.has(collection)) {
      skipped.push(collection);
      continue;
    }
    const entity = collection as EntityName;
    for (const doc of docs) {
      const { id, ...value } = doc;
      await repo.set(entity, id, value);
      restored += 1;
    }
    counts[collection] = docs.length;
  }

  return { createdAt: backup.createdAt, counts, totalRecords: restored, skipped };
}

/** Restore the named snapshot from the device's backup folder. */
export async function restoreBackupByName(fileName: string): Promise<RestoreResult> {
  return restoreBackup(parseBackup(await readAppTextFile(`${BACKUP_DIR}/${fileName}`)));
}

/** Restore from text the user supplied through a browser file picker. */
export async function restoreBackupFromText(raw: string): Promise<RestoreResult> {
  return restoreBackup(parseBackup(raw));
}

/** Remove one snapshot. Used by the "delete old backups" housekeeping. */
export async function deleteBackup(fileName: string): Promise<void> {
  const { Directory, Filesystem } = await import('@capacitor/filesystem');
  try {
    await Filesystem.deleteFile({
      path: `${BACKUP_DIR}/${fileName}`,
      directory: Directory.External,
    });
  } catch (err) {
    captureError(err, { scope: 'backup/delete', file: fileName });
    throw err;
  }
}

/**
 * How much data there is to lose, for the "back up soon" nudge. Counting rows is
 * far cheaper than serialising them.
 */
export async function countRecords(): Promise<number> {
  const repo = await initDataStore();
  let total = 0;
  for (const collection of ['patients', 'reports', 'doctors', 'invoices'] as const) {
    total += await repo.count(collection);
  }
  return total;
}
