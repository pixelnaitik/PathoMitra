/**
 * Two-store sync for lab settings and custom tests — local only.
 *
 * Despite the name, nothing here touches a network. Both stores live on the
 * device: `localStorage` (what the UI and the pre-paint theme bootstrap read)
 * and the `labSettings` table of the encrypted SQLCipher database, via the
 * `data/fs` façade.
 *
 * Settings and custom tests used to live in localStorage alone, which meant a
 * cleared app data, a new phone or a second workstation silently lost the lab's
 * name, address, print layout and every custom test definition — and, worse, a
 * JSON backup of the encrypted database contained no settings at all. Mirroring
 * one document into the database puts the lab's identity inside the backup and
 * the encryption boundary, while localStorage keeps first paint instant.
 *
 * Shape of `labSettings/current`:
 *   { settings: LabSettings, customTests: PathologyTest[], updatedAt, updatedBy }
 *
 * Conflict resolution is last-write-wins on `updatedAt`, which is an ISO string
 * and therefore sorts correctly. Writes are debounced so a slider drag does not
 * fire a document write per animation frame. The pending journal is bounded and
 * validated; corrupt entries are quarantined without copying their contents.
 */
import { db, doc, onSnapshot, setDoc } from '../data/fs';
import { z } from 'zod';
import { captureError } from './telemetry';
import {
  CUSTOM_TESTS_UPDATED_EVENT,
  SETTINGS_UPDATED_EVENT,
  readCustomTests,
  readSettings,
  reportSettingsPersistenceError,
  writeCustomTests,
  writeSettings,
  type LabSettings,
} from './settings';
import type { PathologyTest } from './pathology-tests';

export const LAB_SETTINGS_DOC_PATH = 'labSettings';
export const LAB_SETTINGS_DOC_ID = 'current';

/** Debounce window for pushing local edits into the encrypted store. */
const PUSH_DELAY_MS = 900;

/** Write-ahead journal closes the crash window while the encrypted mirror is debounced. */
const PENDING_SETTINGS_KEY = 'pathlab_settings_pending_v1';
const QUARANTINED_SETTINGS_KEY = 'pathlab_settings_pending_v1_quarantine';
const MAX_JOURNAL_CHARS = 8 * 1024 * 1024;

const SettingsMirrorSchema = z.looseObject({
  settings: z.record(z.string(), z.unknown()).default({}),
  customTests: z.array(z.record(z.string(), z.unknown())).max(400).default([]),
  updatedAt: z.string().max(64).optional(),
  updatedBy: z.string().max(128).optional(),
});

let pushTimer = 0;
/** True while a remote snapshot is being applied, to avoid echoing it back. */
let applyingRemote = false;
let persistingLocal = false;
let latestSettings: LabSettings | null = null;
let latestCustomTests: PathologyTest[] | null = null;

function buildPayload(settings: LabSettings, customTests: PathologyTest[], uid?: string) {
  const payload: Record<string, unknown> = {
    settings,
    customTests,
    updatedAt: new Date().toISOString(),
  };
  if (uid) payload.updatedBy = uid;
  return payload;
}

function journalPending(payload: Record<string, unknown>): boolean {
  try {
    const raw = JSON.stringify(payload);
    if (raw.length > MAX_JOURNAL_CHARS) {
      reportSettingsPersistenceError(
        'journal',
        'The pending settings journal is too large for this device. Save Settings again after freeing storage.',
      );
      return false;
    }
    window.localStorage.setItem(PENDING_SETTINGS_KEY, raw);
    return true;
  } catch {
    reportSettingsPersistenceError(
      'journal',
      'The pending settings journal could not be written. Keep Settings open until the encrypted save completes.',
    );
    return false;
  }
}

/** Validate and bound a journal entry before it can overwrite the encrypted mirror. */
export function parsePendingSettings(raw: string): Record<string, unknown> {
  if (raw.length > MAX_JOURNAL_CHARS)
    throw new Error('Pending settings journal exceeds the size limit.');
  const value = JSON.parse(raw) as unknown;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('settings' in value) ||
    !('customTests' in value)
  ) {
    throw new Error('Pending settings journal is malformed.');
  }
  const parsed = SettingsMirrorSchema.safeParse(value);
  if (!parsed.success) throw new Error('Pending settings journal is malformed.');
  return parsed.data as Record<string, unknown>;
}

function quarantinePendingSettings(): void {
  try {
    window.localStorage.removeItem(PENDING_SETTINGS_KEY);
    window.localStorage.setItem(
      QUARANTINED_SETTINGS_KEY,
      JSON.stringify({ at: new Date().toISOString(), reason: 'malformed-or-oversized' }),
    );
  } catch {
    /* a small marker is best-effort; the invalid entry is still refused */
  }
  reportSettingsPersistenceError(
    'journal',
    'A corrupt pending settings journal was quarantined. Review and save the current settings again.',
  );
}

/** Flush a journaled edit before a backup or a clean shutdown can omit it. */
export async function flushPendingSettings(): Promise<void> {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PENDING_SETTINGS_KEY);
  } catch {
    throw new Error('The pending settings journal could not be read.');
  }
  if (!raw) return;
  let payload: Record<string, unknown>;
  try {
    payload = parsePendingSettings(raw);
  } catch {
    quarantinePendingSettings();
    captureError(new Error('Invalid pending settings journal quarantined'), {
      scope: 'settings-sync/journal',
    });
    throw new Error(
      'The corrupt pending settings journal was quarantined; save the current settings again.',
    );
  }
  await setDoc(doc(db, LAB_SETTINGS_DOC_PATH, LAB_SETTINGS_DOC_ID), payload);
  window.localStorage.removeItem(PENDING_SETTINGS_KEY);
}

/** Persist settings/custom tests durably, then update the fast local cache. */
export async function persistSettingsNow(
  settings: LabSettings,
  customTests: PathologyTest[],
  uid?: string,
): Promise<void> {
  const payload = buildPayload(settings, customTests, uid);
  persistingLocal = true;
  try {
    await setDoc(doc(db, LAB_SETTINGS_DOC_PATH, LAB_SETTINGS_DOC_ID), payload);
    const updatedBy = typeof payload.updatedBy === 'string' ? payload.updatedBy : undefined;
    writeSettings({
      ...settings,
      updatedAt: String(payload.updatedAt),
      ...(updatedBy ? { updatedBy } : {}),
    });
    writeCustomTests(customTests);
    window.localStorage.removeItem(PENDING_SETTINGS_KEY);
  } finally {
    persistingLocal = false;
  }
}

/** Queue a debounced push of the current local state to the encrypted store. */
function queuePush(uid?: string, settings?: LabSettings, customTests?: PathologyTest[]): void {
  if (applyingRemote || persistingLocal) return;
  const nextSettings = settings ?? latestSettings ?? readSettings();
  const nextTests = customTests ?? latestCustomTests ?? readCustomTests();
  window.clearTimeout(pushTimer);
  journalPending(buildPayload(nextSettings, nextTests, uid));
  pushTimer = window.setTimeout(async () => {
    try {
      await persistSettingsNow(nextSettings, nextTests, uid);
    } catch {
      reportSettingsPersistenceError(
        'journal',
        'Settings could not be mirrored into encrypted storage. Keep this screen open and retry Save.',
      );
      captureError(new Error('Settings mirror write failed'), { scope: 'settings-sync/persist' });
    }
  }, PUSH_DELAY_MS);
}

/**
 * Start the two-way local mirror for the signed-in operator.
 *
 * Returns a cleanup function. Remote-side updates are applied through
 * `writeSettings`, which keeps the theme and every already-mounted component in
 * sync via the usual `settings-updated` event.
 */
export function startSettingsSync(uid?: string): () => void {
  void flushPendingSettings().catch(error =>
    captureError(error, { scope: 'settings-sync/recover-journal' }),
  );
  const pushLocal = (event: Event) => {
    const detail = (event as CustomEvent<{ settings?: LabSettings; customTests?: PathologyTest[] }>)
      .detail;
    if (detail?.settings) latestSettings = detail.settings;
    if (detail?.customTests) latestCustomTests = detail.customTests;
    queuePush(uid, latestSettings ?? undefined, latestCustomTests ?? undefined);
  };
  window.addEventListener(SETTINGS_UPDATED_EVENT, pushLocal);
  window.addEventListener(CUSTOM_TESTS_UPDATED_EVENT, pushLocal);

  const stopWatching = onSnapshot(
    doc(db, LAB_SETTINGS_DOC_PATH, LAB_SETTINGS_DOC_ID),
    snapshot => {
      // Our own write landing optimistically — do not re-apply it.
      if (
        !snapshot.exists() ||
        snapshot.metadata.hasPendingWrites ||
        applyingRemote ||
        persistingLocal
      )
        return;

      const parsed = SettingsMirrorSchema.safeParse(snapshot.data());
      if (!parsed.success) {
        captureError(new Error('Malformed labSettings document'), {
          scope: 'settings-sync',
          issues: parsed.error.issues
            .slice(0, 3)
            .map(i => i.message)
            .join('; '),
        });
        return;
      }

      const remote = parsed.data;
      const local = readSettings();
      // Last-write-wins: ISO timestamps compare correctly as strings.
      if (local.updatedAt && remote.updatedAt && remote.updatedAt <= local.updatedAt) return;

      applyingRemote = true;
      try {
        const { sharingTemplateImage: _localImage, ...localRest } = local;
        const remoteSettings = remote.settings as Partial<LabSettings>;
        writeSettings({
          ...localRest,
          ...remoteSettings,
          // Artwork that only exists locally must not be wiped by a remote
          // document that never carried it.
          sharingTemplateImage:
            (remoteSettings.sharingTemplateImage as string | undefined) ??
            local.sharingTemplateImage,
          updatedAt: remote.updatedAt ?? local.updatedAt,
          updatedBy: remote.updatedBy ?? local.updatedBy,
        } as LabSettings);

        const remoteTests = remote.customTests as unknown as PathologyTest[];
        latestSettings = readSettings();
        latestCustomTests = remoteTests;
        if (remoteTests.length > 0 || readCustomTests().length === 0) {
          writeCustomTests(remoteTests);
        }
      } catch (err) {
        captureError(err, { scope: 'settings-sync/apply' });
      } finally {
        applyingRemote = false;
      }
    },
    err => {
      // Guests and demo accounts cannot read this collection; that is expected
      // and must not be reported as an application failure.
      const code = (err as { code?: string }).code;
      if (code !== 'permission-denied' && code !== 'unauthenticated') {
        captureError(err, { scope: 'settings-sync/watch' });
      }
    },
  );

  return () => {
    void flushPendingSettings().catch(error =>
      captureError(error, { scope: 'settings-sync/flush' }),
    );
    window.clearTimeout(pushTimer);
    window.removeEventListener(SETTINGS_UPDATED_EVENT, pushLocal);
    window.removeEventListener(CUSTOM_TESTS_UPDATED_EVENT, pushLocal);
    stopWatching();
  };
}
