/**
 * Settings → Data & Diagnostics.
 *
 * Two things a local-first clinical app owes its users and had neither of:
 *
 *   1. A way out of the database. Everything lives on one phone, so without an
 *      export the lab's whole history dies with that device. This panel writes a
 *      JSON snapshot into the app's own storage, lists the ones already there,
 *      shares a copy to whatever destination the lab trusts, and merges one back.
 *   2. A way to see what broke. A release APK has no console and must never reach
 *      the network, so failures captured by lib/telemetry.ts now accumulate in an
 *      on-device ring buffer (lib/crash-log.ts) that staff can read, save as a
 *      file for support, or clear.
 *
 * Nothing here transmits anything by itself: every exit from the device — a
 * shared backup, a saved log — is a user action with the system sheet in front of
 * them, because a backup file holds patient data.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FolderOpen,
  Lock,
  RefreshCw,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  SectionTitle,
  StatusPill,
  Switch,
  useToast,
} from './ui';
import {
  countRecords,
  createBackup,
  deleteBackup,
  listBackups,
  readBackupPayload,
  restoreBackupByName,
  restoreBackupFromText,
  RestoreConflictError,
  type RestoreConflict,
  type RestoreResult,
  shareBackup,
  type BackupSummary,
} from '../lib/backup';
import {
  MIN_BACKUP_PASSPHRASE,
  PassphraseRequiredError,
  validateBackupPassphrase,
} from '../lib/backup-crypto';
import { clearCrashLog, formatCrashLog, readCrashLog, type CrashEntry } from '../lib/crash-log';
import { readSettings, writeSettings } from '../lib/settings';
import { isShell } from '../data';
import { useAuth } from '../contexts/AuthContext';
import { saveTextDocument, describeSavedLocation } from '../lib/native-files';
import { captureError } from '../lib/telemetry';
import { downloadCsv } from '../lib/export-csv';
import { auditDataIntegrity, type IntegrityReport } from '../lib/data-integrity';
import { enableSafeMode } from '../lib/safe-mode';
import { can } from '../lib/permissions';
import {
  backupDestinationStatus,
  chooseBackupDestination,
  copyBackupToDestination,
} from '../lib/backup-destination';
import { measureRestoreDrill } from '../lib/continuity';

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

type Pending =
  | { kind: 'restore'; file: BackupSummary }
  | { kind: 'delete'; file: BackupSummary }
  | { kind: 'clearLog' }
  | null;

export default function DataBackupPanel() {
  const toast = useToast();
  const { user, role } = useAuth();
  const canBackup = can(role, 'manageBackup');
  const canRestore = can(role, 'restoreData');
  const canDiagnostics = can(role, 'viewAudit');
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [records, setRecords] = useState<number | null>(null);
  const [crashes, setCrashes] = useState<CrashEntry[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [destination, setDestination] = useState(() => readSettings().backupDestination ?? '');
  const [destinationReady, setDestinationReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [workingFile, setWorkingFile] = useState<string | null>(null);
  /**
   * Whether exported files may be written to shared `Documents` storage. Off by
   * default — see `lib/native-files`. Turning it on is confirm-gated because the
   * files involved carry patient data.
   */
  const [publicExports, setPublicExports] = useState(() => readSettings().allowPublicExports);
  const [confirmingPublicOn, setConfirmingPublicOn] = useState(false);
  /**
   * Whether the next snapshot is sealed with a passphrase. On by default: a
   * readable JSON export of every patient in the lab is the biggest way PHI
   * leaves this app, and it usually leaves through the share sheet.
   */
  const [seal, setSeal] = useState(true);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseAgain, setPassphraseAgain] = useState('');
  /**
   * A snapshot that turned out to be sealed while restoring. Holds where the text
   * came from — a file on the device, or bytes from the browser picker, which has
   * no path to re-read — so the prompt can retry the same source with a passphrase.
   */
  const [sealed, setSealed] = useState<{
    label: string;
    source: 'file' | 'text';
    value: string;
  } | null>(null);
  const [unlock, setUnlock] = useState('');
  const [conflicts, setConflicts] = useState<RestoreConflict[]>([]);
  const [conflictRetry, setConflictRetry] = useState<
    | { kind: 'file'; fileName: string; passphrase?: string }
    | { kind: 'text'; raw: string; passphrase?: string }
    | null
  >(null);
  /** Bumped after any mutation; the effect below is the only place that writes state. */
  const [reloadToken, setReloadToken] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const fileInput = useRef<HTMLInputElement>(null);
  const backupHealth = useMemo(() => {
    const settings = readSettings();
    if (records && records > 0 && !settings.lastOffDeviceBackupAt) return 'missing';
    if (!settings.lastOffDeviceBackupAt) return 'empty';
    const timestamp = new Date(settings.lastOffDeviceBackupAt);
    if (Number.isNaN(timestamp.getTime())) return 'unknown';
    const ageDays = (clock - timestamp.getTime()) / 86_400_000;
    return ageDays > settings.backupReminderDays ? 'stale' : 'current';
  }, [clock, records, reloadToken]);
  const selectDestination = async () => {
    if (!canBackup) {
      toast.error('Only an administrator can choose a backup destination.');
      return;
    }
    try {
      const selected = await chooseBackupDestination();
      if (!selected) return;
      setDestination(selected.label.slice(0, 160));
      setDestinationReady(true);
      writeSettings({
        ...readSettings(),
        backupDestination: selected.label.slice(0, 160),
        updatedBy: user?.uid ?? 'operator',
      });
      toast.success('Off-device backup destination selected.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not select the destination.');
    }
  };

  const copyLatestOffDevice = async (fileName?: string) => {
    if (!canBackup) {
      toast.error('Only an administrator can copy a full backup.');
      return;
    }
    const target = fileName ?? backups.find(item => item.fileName)?.fileName;
    if (!target) {
      toast.error('Create a backup first.');
      return;
    }
    try {
      const copied = await copyBackupToDestination(target, await readBackupPayload(target));
      if (!copied.verified) throw new Error('The destination copy could not be verified.');
      writeSettings({
        ...readSettings(),
        lastOffDeviceBackupAt: new Date().toISOString(),
        updatedBy: user?.uid ?? 'operator',
      });
      setReloadToken(token => token + 1);
      toast.success(`Verified off-device copy: ${copied.fileName}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Off-device copy failed.');
    }
  };
  const recordRestoreDrill = (result: RestoreResult, startedAt: number) => {
    if (!canRestore) return;
    const completedAt = Date.now();
    const measured = measureRestoreDrill(result, startedAt, completedAt);
    writeSettings({
      ...readSettings(),
      lastRestoreDrillAt: new Date(completedAt).toISOString(),
      lastRestoreDrillDurationMs: measured.durationMs,
      lastRestoreDrillRpoMs: measured.rpoMs,
      lastRestoreDrillRecords: measured.records,
      lastRestoreDrillSnapshot: measured.snapshot,
      lastRestoreDrillOutcome: measured.outcome,
      updatedBy: user?.uid ?? 'operator',
    });
  };

  // Reading the backups folder, the row counts and the crash log is three
  // awaits, so state is set once they have all landed rather than
  // synchronously in the effect body — and a stale response cannot overwrite a
  // fresher one after a remount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [snapshots, total, log, selectedDestination] = await Promise.all([
          listBackups(),
          countRecords(),
          readCrashLog(),
          backupDestinationStatus(),
        ]);
        if (cancelled) return;
        setBackups(snapshots);
        setRecords(total);
        setCrashes(log);
        setClock(Date.now());
        setDestinationReady(!!selectedDestination);
        if (selectedDestination) setDestination(selectedDestination.label.slice(0, 160));
      } catch (err) {
        if (!cancelled) captureError(err, { scope: 'settings:data-refresh' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const refresh = useCallback(async () => {
    setReloadToken(token => token + 1);
  }, []);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      captureError(err, {
        scope: 'data:operation',
        operation: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      });
      toast.error(err instanceof Error ? `${label} failed — ${err.message}` : `${label} failed.`);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateBackup = () =>
    run('Backup', async () => {
      if (!canBackup) throw new Error('Only an administrator can create a full backup.');
      if (seal) {
        // Never fall back to a plaintext file because the passphrase was thin —
        // the lab would get a readable export while believing it was sealed.
        const problem = validateBackupPassphrase(passphrase);
        if (problem) throw new Error(problem);
        if (passphrase !== passphraseAgain) throw new Error('The two passphrases do not match.');
      }
      const { summary } = await createBackup({ passphrase: seal ? passphrase : '' });
      await refresh();
      if (seal) {
        setPassphrase('');
        setPassphraseAgain('');
      }
      toast.success(
        seal
          ? `Backup sealed — ${summary.totalRecords} records encrypted. That passphrase is the only key: there is no reset, so keep it somewhere separate from the file.`
          : `Backup written — ${summary.totalRecords} records as readable JSON. Keep a copy somewhere you control.`,
      );
      if (seal && destinationReady) await copyLatestOffDevice(summary.fileName);
    });

  /** Retry a sealed snapshot now that a passphrase has been supplied. */
  const handleUnlockRestore = () => {
    const target = sealed;
    if (!target) return;
    run('Restore', async () => {
      const startedAt = Date.now();
      let result;
      try {
        result =
          target.source === 'file'
            ? await restoreBackupByName(target.value, unlock)
            : await restoreBackupFromText(target.value, unlock);
      } catch (error) {
        if (error instanceof RestoreConflictError) {
          setConflicts(error.conflicts);
          setConflictRetry(
            target.source === 'file'
              ? { kind: 'file', fileName: target.value, passphrase: unlock }
              : { kind: 'text', raw: target.value, passphrase: unlock },
          );
          toast.info('Restore paused: review the records that would be overwritten.');
          return;
        }
        throw error;
      }
      setSealed(null);
      setUnlock('');
      toast.success(
        `Restored ${result.totalRecords} records from ${target.label}` +
          (result.skipped.length ? ` (skipped ${result.skipped.join(', ')})` : ''),
      );
      recordRestoreDrill(result, startedAt);
      await refresh();
    });
  };

  const handleShare = (fileName: string) =>
    run('Share', async () => {
      await shareBackup(fileName);
    });

  const handleDownloadOnWeb = (file: BackupSummary) =>
    run('Download', async () => {
      // On the browser build a snapshot is not in a browsable app folder, so the
      // list is empty and the only copy is the one the user just downloaded.
      toast.info('Use "Back up now" — the browser saves the file to your Downloads.');
      void file;
    });

  const confirmPending = async () => {
    if (!pending) return;
    if (pending.kind === 'clearLog') {
      await run('Clear log', async () => {
        await clearCrashLog();
        await refresh();
        toast.success('Diagnostics log cleared.');
      });
      setPending(null);
      return;
    }
    const file = pending.file;
    setWorkingFile(file.fileName ?? null);
    await run(pending.kind === 'restore' ? 'Restore' : 'Delete', async () => {
      if (pending.kind === 'restore') {
        const startedAt = Date.now();
        try {
          const result = await restoreBackupByName(file.fileName!);
          toast.success(
            `Restored ${result.totalRecords} records from ${file.fileName}` +
              (result.skipped.length ? ` (skipped ${result.skipped.join(', ')})` : ''),
          );
          recordRestoreDrill(result, startedAt);
        } catch (err) {
          if (err instanceof RestoreConflictError) {
            setConflicts(err.conflicts);
            setConflictRetry({ kind: 'file', fileName: file.fileName! });
            toast.info('Restore paused: review the records that would be overwritten.');
            return;
          }
          if (err instanceof PassphraseRequiredError) {
            // The file is fine — it is sealed. Ask for the passphrase instead of
            // reporting a failed restore.
            setSealed({ label: file.fileName!, source: 'file', value: file.fileName! });
            setUnlock('');
            toast.info('That backup is encrypted — enter the passphrase it was sealed with.');
            return;
          }
          throw err;
        }
      } else {
        await deleteBackup(file.fileName!);
        toast.success(`Deleted ${file.fileName}.`);
      }
      await refresh();
    });
    setWorkingFile(null);
    setPending(null);
  };

  const handleImportFile = (file: File | undefined) =>
    run('Import', async () => {
      if (!file) return;
      // The picker hands us the bytes, not a path, so the text is read once and
      // kept for the passphrase retry — a sealed file cannot be re-read by name.
      const text = await file.text();
      const startedAt = Date.now();
      try {
        const result = await restoreBackupFromText(text);
        toast.success(`Restored ${result.totalRecords} records from ${file.name}.`);
        recordRestoreDrill(result, startedAt);
      } catch (err) {
        if (err instanceof RestoreConflictError) {
          setConflicts(err.conflicts);
          setConflictRetry({ kind: 'text', raw: text });
          toast.info('Restore paused: review the records that would be overwritten.');
          return;
        }
        if (err instanceof PassphraseRequiredError) {
          setSealed({ label: file.name, source: 'text', value: text });
          setUnlock('');
          toast.info('That backup is encrypted — enter the passphrase it was sealed with.');
          return;
        }
        throw err;
      }
      await refresh();
    });

  const applyConflictRestore = () => {
    const retry = conflictRetry;
    if (!retry) return;
    return run('Restore', async () => {
      const startedAt = Date.now();
      const result =
        retry.kind === 'file'
          ? await restoreBackupByName(retry.fileName, retry.passphrase, {
              overwriteConflicts: true,
            })
          : await restoreBackupFromText(retry.raw, retry.passphrase, { overwriteConflicts: true });
      setConflictRetry(null);
      setConflicts([]);
      recordRestoreDrill(result, startedAt);
      toast.success(`Restored ${result.totalRecords} records with approved conflict overwrites.`);
      await refresh();
    });
  };

  const applyPublicExports = (enabled: boolean) => {
    // Merged over the live settings so this card cannot clobber unrelated edits
    // made elsewhere while this panel was open.
    writeSettings({ ...readSettings(), allowPublicExports: enabled });
    setPublicExports(enabled);
    setConfirmingPublicOn(false);
    toast.success(
      enabled
        ? 'Exports will be written to the shared Documents folder.'
        : "Exports stay in the app's private storage.",
    );
  };

  const handleExportLog = () =>
    run('Export log', async () => {
      const text = formatCrashLog(crashes);
      const name = `pathomitra-diagnostics-${Date.now()}.txt`;
      if (isShell) {
        const saved = await saveTextDocument(name, text);
        toast.success(`Log saved as ${describeSavedLocation(saved)}.`);
      } else {
        await downloadCsv(name, text);
        toast.success('Diagnostics log downloaded.');
      }
    });

  if (!canBackup && !canRestore && !canDiagnostics) {
    return (
      <div
        className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-5 text-sm text-on-surface-variant"
        role="status"
      >
        Full backup, restore and diagnostics are restricted to an administrator account.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-primary mb-1">Data &amp; Diagnostics</h3>
        <p className="text-sm text-on-surface-variant">
          Everything in PathoMitra is stored on this device only. Back it up yourself — there is no
          server that can restore it for you.
        </p>
      </div>

      {/* ---------------- Backup ---------------- */}
      <Card pad="lg">
        <SectionTitle title="Backup" />
        <div
          className={`mb-4 rounded-2xl border p-4 text-sm ${backupHealth === 'current' ? 'border-success/30 bg-success-container text-on-success-container' : backupHealth === 'empty' ? 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant' : 'border-warning/40 bg-warning-container text-on-warning-container'}`}
          role="status"
        >
          <strong className="font-bold">
            {backupHealth === 'current'
              ? 'Backup is current'
              : backupHealth === 'missing'
                ? 'No backup on this device'
                : backupHealth === 'stale'
                  ? `Backup is older than ${readSettings().backupReminderDays} days`
                  : backupHealth === 'unknown'
                    ? 'Backup age could not be determined'
                    : 'No clinical records to back up yet'}
          </strong>
          <p className="mt-1 text-xs leading-relaxed">
            Every new snapshot is read back and compared before success is reported. Share the
            newest encrypted snapshot to lab-controlled storage and test a restore on a second
            device; this app has no server-side recovery.
          </p>
        </div>
        <div className="mb-4 grid gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block text-xs font-semibold text-on-surface-variant">
            Off-device destination
            <input
              value={destination}
              onChange={event => setDestination(event.target.value)}
              maxLength={160}
              placeholder="Lab USB drive, encrypted NAS, second workstation…"
              className="mt-1 w-full rounded-xl border border-outline-variant/40 bg-surface px-3 py-2 text-sm text-on-surface"
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void selectDestination()}
            disabled={busy || !canBackup}
          >
            <FolderOpen className="w-4 h-4" aria-hidden="true" />
            Choose folder
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyLatestOffDevice()}
            disabled={busy || !canBackup || !destinationReady || backups.length === 0}
          >
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            Verify off-device copy
          </Button>
          <p className="text-[11px] text-on-surface-variant sm:col-span-2">
            Last restore drill:{' '}
            {readSettings().lastRestoreDrillAt
              ? new Date(readSettings().lastRestoreDrillAt!).toLocaleString()
              : 'not recorded'}
            .
            {readSettings().lastRestoreDrillAt && (
              <>
                {' '}
                Observed RTO {formatDuration(readSettings().lastRestoreDrillDurationMs ?? 0)}{' '}
                (target 24h); snapshot age{' '}
                {formatDuration(readSettings().lastRestoreDrillRpoMs ?? 0)} (target 8h);{' '}
                {readSettings().lastRestoreDrillRecords ?? 0} records reconciled.
              </>
            )}
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-2xl bg-surface-container-low p-4">
          <ShieldCheck className="w-5 h-5 shrink-0 text-success" aria-hidden="true" />
          <p className="text-sm text-on-surface-variant leading-relaxed">
            A snapshot holds patients, reports, notes, invoices, doctors, settings and alert state.
            It deliberately does <strong className="text-on-surface">not</strong> contain your
            unlock password — that lives in the device&apos;s encrypted keystore and can never be
            exported.
          </p>
        </div>

        {/* Sealing is the default because this file is the one copy of the lab that
            regularly leaves the device — and an unsealed copy is every patient in
            readable text the moment it lands in someone else&apos;s cloud or on a
            pen drive. The passphrase is not recoverable, so the trade-off is said
            out loud here rather than discovered during a restore. */}
        <div className="mt-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-bold text-primary flex items-center gap-2">
                <Lock className="w-4 h-4" aria-hidden="true" /> Encrypt this backup
              </h4>
              <p className="mt-1 text-xs text-on-surface-variant">
                Seals the file with AES-256 using a passphrase you choose.{' '}
                <strong className="text-on-surface">There is no recovery</strong> — lose the
                passphrase and the snapshot cannot be opened, so store it apart from the file.
              </p>
            </div>
            <Switch checked={seal} onChange={setSeal} label="Encrypt this backup" />
          </div>
          {seal && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-on-surface-variant">
                Passphrase
                <input
                  type="password"
                  value={passphrase}
                  onChange={e => setPassphrase(e.target.value)}
                  autoComplete="new-password"
                  aria-describedby="backup-passphrase-help"
                  className="mt-1 w-full px-3 py-2 rounded-xl bg-surface border border-outline-variant/40 text-sm text-on-surface"
                />
              </label>
              <label className="block text-xs font-semibold text-on-surface-variant">
                Repeat it
                <input
                  type="password"
                  value={passphraseAgain}
                  onChange={e => setPassphraseAgain(e.target.value)}
                  autoComplete="new-password"
                  className="mt-1 w-full px-3 py-2 rounded-xl bg-surface border border-outline-variant/40 text-sm text-on-surface"
                />
              </label>
              <p
                id="backup-passphrase-help"
                className="text-[11px] text-on-surface-variant sm:col-span-2"
              >
                At least {MIN_BACKUP_PASSPHRASE} characters. It is the only key — it is never stored
                on this device and cannot be reset.
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="md"
            onClick={handleCreateBackup}
            disabled={busy || records === 0 || !canBackup}
          >
            <DatabaseBackup className="w-4 h-4" aria-hidden="true" />
            Back up now
          </Button>
          <Button
            variant="outline"
            size="md"
            onClick={() => fileInput.current?.click()}
            disabled={busy || !canRestore}
          >
            <Upload className="w-4 h-4" aria-hidden="true" />
            Restore from file
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Choose a backup file to restore"
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void handleImportFile(file);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh().catch(() => {})}
            disabled={busy}
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void run('Integrity check', async () => {
                const report = await auditDataIntegrity();
                setIntegrity(report);
                if (report.issues.some(issue => issue.severity === 'P0'))
                  enableSafeMode(
                    'Integrity check found a release-blocking orphan, duplicate, or arithmetic issue.',
                  );
                toast[report.issues.length ? 'warning' : 'success'](
                  report.issues.length
                    ? `${report.issues.length} integrity issue(s) found.`
                    : 'Integrity check passed.',
                );
              })
            }
            disabled={busy || !canDiagnostics}
          >
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            Check integrity
          </Button>
        </div>

        {integrity && (
          <div
            className={`mt-4 rounded-2xl border p-4 ${integrity.issues.length ? 'border-error/40 bg-error-container' : 'border-success/30 bg-success-container'}`}
            role="status"
          >
            <div className="flex items-start gap-3">
              {integrity.issues.length ? (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-error" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
              )}
              <div>
                <h4 className="text-sm font-bold text-on-surface">
                  {integrity.issues.length
                    ? `${integrity.issues.length} integrity issue(s)`
                    : 'No integrity issues found'}
                </h4>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Scanned{' '}
                  {Object.values(integrity.scanned)
                    .reduce((sum, count) => sum + count, 0)
                    .toLocaleString()}{' '}
                  records across patients, orders, samples, reports, invoices, and report versions.
                </p>
                {integrity.issues.length > 0 && (
                  <ul className="mt-3 space-y-2 text-xs text-on-error-container">
                    {integrity.issues.slice(0, 20).map(issue => (
                      <li key={issue.id}>
                        <strong>
                          {issue.severity} · {issue.entity}/{issue.entityId}
                        </strong>{' '}
                        — {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
          <h4 className="text-sm font-bold text-primary">Continuity runbook</h4>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-on-surface-variant">
            <li>
              At shift close, create an encrypted backup, verify it, and copy it to the
              lab-controlled off-device destination.
            </li>
            <li>
              Record the destination and backup time above. Target RPO: one shift; target RTO: one
              working day on a replacement device.
            </li>
            <li>
              Monthly, restore that copy on a second device, run integrity checks, and record the
              drill. Never test over the only working database.
            </li>
            <li>
              If storage is nearly full or integrity fails, safe mode pauses writes. Export/backup
              first, recover or restore, then an administrator resumes writes.
            </li>
            <li>
              This edition is single-device at runtime. Staff accounts share one local database; use
              the manual backup/restore process for a second workstation, never simultaneous
              editing.
            </li>
          </ol>
        </div>

        {sealed && (
          <div
            role="group"
            aria-label="Passphrase required"
            className="mt-4 rounded-2xl border border-warning/40 bg-warning-container p-4 space-y-3"
          >
            <h4 className="text-sm font-bold text-on-warning-container flex items-center gap-2">
              <Lock className="w-4 h-4" aria-hidden="true" />
              {sealed.label} is encrypted
            </h4>
            <label className="block text-xs font-semibold text-on-warning-container">
              Passphrase
              <input
                type="password"
                value={unlock}
                onChange={e => setUnlock(e.target.value)}
                autoComplete="off"
                className="mt-1 w-full px-3 py-2 rounded-xl bg-surface border border-outline-variant/40 text-sm text-on-surface"
                onKeyDown={e => {
                  if (e.key === 'Enter' && unlock) void handleUnlockRestore();
                }}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                size="md"
                onClick={handleUnlockRestore}
                disabled={busy || !unlock}
              >
                Unlock &amp; restore
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSealed(null);
                  setUnlock('');
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
            <p className="text-[11px] text-on-warning-container">
              A wrong passphrase is rejected rather than half-restoring: nothing is written unless
              the file decrypts and verifies.
            </p>
          </div>
        )}

        {records !== null && (
          <p className="mt-3 text-xs text-on-surface-variant">
            {records.toLocaleString()} record{records === 1 ? '' : 's'} in the patients, reports,
            doctors and invoices tables.
            {records > 0 && backups.length === 0 ? (
              <span className="ml-1 font-semibold text-warning">No backup on this device yet.</span>
            ) : null}
          </p>
        )}

        {backups.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {backups.map(file => (
              <li
                key={file.fileName}
                className="flex items-center gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-3"
              >
                <Download className="w-4 h-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-on-surface">
                    {file.fileName}
                  </span>
                  <span className="block text-xs text-on-surface-variant">
                    in the app&apos;s storage folder
                  </span>
                </span>
                {workingFile === file.fileName ? (
                  <StatusPill tone="info" dot>
                    Working
                  </StatusPill>
                ) : null}
                {isShell ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleShare(file.fileName!)}
                      disabled={busy}
                      aria-label={`Share ${file.fileName}`}
                    >
                      <Share2 className="w-4 h-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPending({ kind: 'restore', file })}
                      disabled={busy}
                      aria-label={`Restore ${file.fileName}`}
                    >
                      <Upload className="w-4 h-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPending({ kind: 'delete', file })}
                      disabled={busy}
                      aria-label={`Delete ${file.fileName}`}
                    >
                      <Trash2 className="w-4 h-4 text-error" aria-hidden="true" />
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => handleDownloadOnWeb(file)}>
                    Details
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4">
            <EmptyState
              icon={<DatabaseBackup className="w-6 h-6" aria-hidden="true" />}
              title="No snapshots on this device"
              description="Backups are kept in the app's own storage so they can be restored from here. Share a copy out to keep one off the phone."
            />
          </div>
        )}
      </Card>

      {/* ---------------- Storage policy ---------------- */}
      <Card pad="lg">
        <SectionTitle title="Where exported files are written" />
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <FolderOpen
              className="mt-0.5 w-5 h-5 shrink-0 text-on-surface-variant"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-sm text-on-surface-variant leading-relaxed">
                {publicExports
                  ? 'Report PDFs, CSVs and logs are copied into /Documents/PathoMitra, where file managers and other apps can read them.'
                  : "Report PDFs, CSVs and logs stay in the app's private storage, which no other app or file manager can open. Sharing still works — the system sheet gets the file directly."}
              </p>
              <p className="mt-2 text-xs text-on-surface-variant">
                Backups listed above are always kept in private storage so they can be restored from
                here.
              </p>
            </div>
          </div>
          <Switch
            checked={publicExports}
            disabled={!isShell}
            onChange={enabled =>
              enabled ? setConfirmingPublicOn(true) : applyPublicExports(false)
            }
            label="Save exports to the shared Documents folder"
          />
        </div>
        {!isShell && (
          <p className="mt-3 text-xs text-on-surface-variant">
            This setting only applies in the mobile app.
          </p>
        )}
      </Card>

      {/* ---------------- Diagnostics ---------------- */}
      <Card pad="lg">
        <SectionTitle title="Diagnostics" />
        <p className="text-sm text-on-surface-variant leading-relaxed">
          The app keeps the last {crashes.length > 0 ? crashes.length : 'up to 20'} captured
          failures on this device — identifiers and contact details in them are redacted before they
          are stored, and nothing is ever sent anywhere.
        </p>

        {crashes.length === 0 ? (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-success-container/40 p-4">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-success" aria-hidden="true" />
            <span className="text-sm font-medium text-on-surface">
              No problems recorded on this device.
            </span>
          </div>
        ) : (
          <>
            <ul className="mt-4 space-y-2">
              {crashes
                .slice(-8)
                .reverse()
                .map(entry => (
                  <li
                    key={entry.key}
                    className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-3"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        className="mt-0.5 w-4 h-4 shrink-0 text-warning"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-on-surface break-words">
                          {entry.message}
                        </p>
                        <p className="mt-0.5 text-xs text-on-surface-variant">
                          {new Date(entry.at).toLocaleString()}
                          {entry.name ? ` · ${entry.name}` : ''}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={handleExportLog} disabled={busy}>
                <Bug className="w-4 h-4" aria-hidden="true" />
                Save full log for support
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPending({ kind: 'clearLog' })}
                disabled={busy}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                Clear log
              </Button>
            </div>
          </>
        )}
      </Card>

      <ConfirmSheet
        open={!!conflictRetry}
        onClose={() => {
          setConflictRetry(null);
          setConflicts([]);
        }}
        onConfirm={() => void applyConflictRestore()}
        title="Review restore conflicts"
        confirmLabel={`Overwrite ${conflicts.length} and restore`}
        message={
          <div className="space-y-2">
            <p>
              The backup would replace these newer or undated records. Records absent from the
              backup are kept.
            </p>
            <ul className="max-h-40 space-y-1 overflow-auto text-left">
              {conflicts.slice(0, 12).map(conflict => (
                <li
                  key={`${conflict.entity}/${conflict.id}`}
                  className="rounded-lg bg-surface-container-high px-2 py-1"
                >
                  {conflict.entity}/{conflict.id}: current {conflict.currentUpdatedAt || 'undated'},
                  backup {conflict.backupUpdatedAt || 'undated'}
                </li>
              ))}
            </ul>
            {conflicts.length > 12 && <p>…and {conflicts.length - 12} more.</p>}
          </div>
        }
      />

      <ConfirmSheet
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => void confirmPending()}
        title={
          pending?.kind === 'restore'
            ? 'Restore this backup?'
            : pending?.kind === 'delete'
              ? 'Delete this backup?'
              : 'Clear the diagnostics log?'
        }
        message={
          pending?.kind === 'restore'
            ? 'Records are matched by id and added or overwritten; nothing already on this device is deleted. If a patient or report exists with newer data, the backup replaces it.'
            : pending?.kind === 'delete'
              ? "This removes the snapshot from the app's storage. Any copy you shared elsewhere is unaffected."
              : 'Removes every recorded failure from this device. Do it after sending the log to support.'
        }
        confirmLabel={
          pending?.kind === 'restore'
            ? 'Restore records'
            : pending?.kind === 'delete'
              ? 'Delete backup'
              : 'Clear log'
        }
      />

      <ConfirmSheet
        open={confirmingPublicOn}
        onClose={() => setConfirmingPublicOn(false)}
        onConfirm={() => applyPublicExports(true)}
        title="Copy patient data out of the app?"
        message="Exports written to Documents leave the encrypted database. Any app with storage access, every file manager, and anything that indexes media on this phone can then read patient names, findings and billing amounts — and Android cloud backup services may pick the folder up. Only turn this on if you need to browse the files yourself, and keep the device locked."
        confirmLabel="Understood, use Documents"
      />
    </div>
  );
}
