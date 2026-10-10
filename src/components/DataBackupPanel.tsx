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
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FolderOpen,
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
  restoreBackupByName,
  shareBackup,
  type BackupSummary,
} from '../lib/backup';
import { clearCrashLog, formatCrashLog, readCrashLog, type CrashEntry } from '../lib/crash-log';
import { readSettings, writeSettings } from '../lib/settings';
import { isNative } from '../data';
import { saveTextDocument, describeSavedLocation } from '../lib/native-files';
import { captureError } from '../lib/telemetry';
import { downloadCsv } from '../lib/export-csv';

type Pending =
  | { kind: 'restore'; file: BackupSummary }
  | { kind: 'delete'; file: BackupSummary }
  | { kind: 'clearLog' }
  | null;

export default function DataBackupPanel() {
  const toast = useToast();
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [records, setRecords] = useState<number | null>(null);
  const [crashes, setCrashes] = useState<CrashEntry[]>([]);
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
  /** Bumped after any mutation; the effect below is the only place that writes state. */
  const [reloadToken, setReloadToken] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  // Reading the backups folder, the row counts and the crash log is three
  // awaits, so state is set once they have all landed rather than
  // synchronously in the effect body — and a stale response cannot overwrite a
  // fresher one after a remount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [snapshots, total, log] = await Promise.all([
          listBackups(),
          countRecords(),
          readCrashLog(),
        ]);
        if (cancelled) return;
        setBackups(snapshots);
        setRecords(total);
        setCrashes(log);
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
      console.error(`Settings → Data: ${label} failed`, err);
      toast.error(err instanceof Error ? `${label} failed — ${err.message}` : `${label} failed.`);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateBackup = () =>
    run('Backup', async () => {
      const { summary } = await createBackup();
      await refresh();
      toast.success(
        `Backup written — ${summary.totalRecords} records. Keep a copy off this device.`,
      );
    });

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
        const result = await restoreBackupByName(file.fileName!);
        toast.success(
          `Restored ${result.totalRecords} records from ${file.fileName}` +
            (result.skipped.length ? ` (skipped ${result.skipped.join(', ')})` : ''),
        );
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
      const result = await restoreBackupByName(file.name).catch(async () => {
        // The picker hands us the bytes, not a path — read the text directly.
        const { restoreBackupFromText } = await import('../lib/backup');
        return restoreBackupFromText(await file.text());
      });
      toast.success(`Restored ${result.totalRecords} records from ${file.name}.`);
      await refresh();
    });

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
      const name = `pathlab-diagnostics-${Date.now()}.txt`;
      if (isNative) {
        const saved = await saveTextDocument(name, text);
        toast.success(`Log saved as ${describeSavedLocation(saved)}.`);
      } else {
        await downloadCsv(name, text);
        toast.success('Diagnostics log downloaded.');
      }
    });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-primary mb-1">Data &amp; Diagnostics</h3>
        <p className="text-sm text-on-surface-variant">
          Everything in PathLab OS is stored on this device only. Back it up yourself — there is no
          server that can restore it for you.
        </p>
      </div>

      {/* ---------------- Backup ---------------- */}
      <Card pad="lg">
        <SectionTitle title="Backup" />
        <div className="flex items-start gap-3 rounded-2xl bg-surface-container-low p-4">
          <ShieldCheck className="w-5 h-5 shrink-0 text-success" aria-hidden="true" />
          <p className="text-sm text-on-surface-variant leading-relaxed">
            A snapshot is a readable JSON file holding patients, reports, notes, invoices, doctors,
            settings and alert state. It deliberately does{' '}
            <strong className="text-on-surface">not</strong> contain your unlock password — that
            lives in the device&apos;s encrypted keystore and can never be exported.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="md"
            onClick={handleCreateBackup}
            disabled={busy || records === 0}
          >
            <DatabaseBackup className="w-4 h-4" aria-hidden="true" />
            Back up now
          </Button>
          <Button
            variant="outline"
            size="md"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
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
        </div>

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
                {isNative ? (
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
                  ? 'Report PDFs, CSVs and logs are copied into /Documents/PathLab OS, where file managers and other apps can read them.'
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
            disabled={!isNative}
            onChange={enabled =>
              enabled ? setConfirmingPublicOn(true) : applyPublicExports(false)
            }
            label="Save exports to the shared Documents folder"
          />
        </div>
        {!isNative && (
          <p className="mt-3 text-xs text-on-surface-variant">
            This setting only applies in the mobile app.
          </p>
        )}
      </Card>

      {/* ---------------- Diagnostics ---------------- */}
      <Card pad="lg">
        <SectionTitle title="Diagnostics" />
        <p className="text-sm text-on-surface-variant leading-relaxed">
          The app keeps the last {crashes.length > 0 ? crashes.length : 'up to 50'} captured
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
                          {entry.url ? ` · ${entry.url}` : ''}
                          {entry.name ? ` · ${entry.name}` : ''}
                        </p>
                        {entry.stack ? (
                          <pre className="mt-2 max-h-32 overflow-auto rounded-xl bg-surface-container-low p-2 text-[11px] leading-snug text-on-surface-variant whitespace-pre-wrap">
                            {entry.stack}
                          </pre>
                        ) : null}
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
