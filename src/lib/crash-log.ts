/**
 * The on-device crash log.
 *
 * A release APK cannot be debugged and has no console to read, so before this
 * module a field failure left *no* trace at all: `telemetry.ts` deliberately
 * reports nothing over the network (the app has no INTERNET permission), and its
 * `console.error` only reaches logcat while the device is plugged into a cable.
 * That is the one moment a lab is not going to catch it.
 *
 * So the scrubbed payload telemetry already builds is kept locally, in a bounded
 * ring buffer, and surfaced in Settings → Diagnostics where staff can read it,
 * save it as a file, or clear it. Nothing is ever transmitted from here; the
 * user decides whether to attach the export to a support email.
 *
 * Privacy: entries hold error messages and the first few stack frames, and a
 * message thrown while handling a patient record can echo part of that record.
 * `telemetry.ts` truncates and keeps only the leading frames; on top of that
 * this log is stripped of anything shaped like a report token or an email before
 * it is written, the buffer is capped, and it lives in the app's own private
 * storage — never in a public directory.
 */
import type { CrashPayload } from './telemetry';
import { secureGet, secureRemove, secureSet } from './secure-store';

const STORAGE_KEY = 'pathlab_crash_log_v1';
/** Enough history to cover a shift without growing without bound. */
const MAX_ENTRIES = 20;

export interface CrashEntry extends CrashPayload {
  /** Monotonic id so the UI can key a list without exposing the message. */
  key: number;
}

function sanitize(entry: CrashPayload): CrashPayload {
  const name = entry.name && /^[A-Za-z][A-Za-z0-9 _-]{0,60}$/.test(entry.name) ? entry.name : 'Error';
  const context: CrashPayload['context'] = {};
  for (const [key, value] of Object.entries(entry.context)) {
    if (!['scope', 'operation', 'entity', 'errorCode', 'retryable'].includes(key)) continue;
    if (typeof value === 'string' && /^[A-Za-z0-9:._/-]{1,80}$/.test(value)) context[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) context[key] = value;
    else if (typeof value === 'boolean') context[key] = value;
  }
  return {
    name,
    message: `${name} captured; error details redacted for privacy.`,
    context,
    userAgent: entry.userAgent?.slice(0, 200),
    correlationId: entry.correlationId,
    at: entry.at,
  };
}

/** Secure platform storage; no plaintext Preferences or crash-log mirror. */

/** In-process copy, so a burst of crashes cannot lose earlier ones to an async write. */
let buffer: CrashEntry[] = [];
let loaded = false;
let nextKey = 1;
/** Chain so concurrent appends cannot interleave a read-modify-write. */
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<CrashEntry[]> {
  if (loaded) return buffer;
  loaded = true;
  try {
    const raw = await secureGet<string>(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        buffer = parsed.filter(
          (entry): entry is CrashEntry =>
            !!entry &&
            typeof entry === 'object' &&
            typeof (entry as CrashEntry).message === 'string',
        );
        nextKey = buffer.reduce((max, entry) => Math.max(max, entry.key + 1), 1);
      }
    }
  } catch {
    // A corrupt or unreadable log must not break the app, and must not be
    // reported through the very logger that just failed.
    buffer = [];
  }
  return buffer;
}

function persist(): Promise<void> {
  const snapshot = JSON.stringify(buffer);
  writeQueue = writeQueue
    .then(async () => {
      try {
        await secureSet(STORAGE_KEY, snapshot);
      } catch {
        /* nowhere left to fall back to; the in-memory copy still serves the UI */
      }
    })
    .catch(() => {});
  return writeQueue;
}

/**
 * Append one already-built payload. Called from `telemetry.ts` on every report,
 * so it never throws, never blocks the caller, and never re-enters the logger.
 */
export function recordCrash(payload: CrashPayload): void {
  void (async () => {
    try {
      await load();
      buffer = [...buffer, { ...sanitize(payload), key: nextKey++ }].slice(-MAX_ENTRIES);
      await persist();
    } catch {
      /* a failed log write must never become a second crash */
    }
  })();
}

/** Newest last. */
export async function readCrashLog(): Promise<CrashEntry[]> {
  return [...(await load())];
}

export async function clearCrashLog(): Promise<void> {
  await load();
  buffer = [];
  try {
    await secureRemove(STORAGE_KEY);
  } catch {
    /* nothing to remove */
  }
}

/** Plain-text form for the export file — readable without a parser. */
export function formatCrashLog(entries: CrashEntry[]): string {
  const header = [
    'PathoMitra — on-device diagnostics log',
    `Exported ${new Date().toISOString()}`,
    `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (newest last)`,
    '',
  ];
  return header
    .concat(
      entries.map(entry =>
        [
          `[${entry.at}] ${entry.name ?? 'Error'}: ${entry.message}`,
          entry.url ? `  at: ${entry.url}` : '',
          entry.stack
            ? `  stack:\n${entry.stack
                .split('\n')
                .map(line => `    ${line}`)
                .join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
    )
    .join('\n\n');
}

/** Reset for tests: forget the in-memory copy and the "already loaded" flag. */
export function __resetCrashLogForTests(): void {
  buffer = [];
  loaded = false;
  nextKey = 1;
  writeQueue = Promise.resolve();
}
