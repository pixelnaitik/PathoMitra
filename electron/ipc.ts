/**
 * The IPC surface between the sandboxed renderer and the main process.
 *
 * Every channel is allow-listed here — the preload only exposes these shapes,
 * never raw ipcRenderer. Paths are validated in the MAIN process (the renderer
 * is the untrusted side in Electron's threat model): anything filesystem-ish
 * must resolve inside an app-owned root, so a compromised page cannot ask for
 * `C:\Users\...\Desktop\...` or walk out with `..`.
 *
 * Roots mirror the Android storage policy in `src/lib/native-files.ts`:
 *   private → app userData (the only root when public exports are off),
 *   public  → Documents/PathoMitra (opt-in per lab, world-readable).
 * The app-relative layout (`PathoMitra/Backups/...`) is kept identical so the
 * backup picker code paths look the same on both platforms.
 */
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { eraseDatabase, loadEntity, openDatabase, saveEntitiesBulk, saveEntity } from './db';
import { deleteSecret, getSecret, setSecret } from './keyring';
import { isRendererCredentialAccount } from '../src/lib/renderer-credentials';
import { isEntityName } from '../src/data/entities';
import { printPdfFile } from './print';
import { type PrintJobRequest, type PrintJobResult, listPrinters, printJob } from './print-window';

/** Collection names from the shared entity contract — anything else is refused. */
function assertEntity(entity: unknown): string {
  if (!isEntityName(entity)) {
    throw new Error(`unknown collection: ${String(entity)}`);
  }
  return entity;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Clinical invariants enforced in the trusted main process, not only React. */
function assertClinicalPayload(entity: string, payload: unknown): void {
  const store = record(payload);
  if (!store) throw new Error('db payload must be a collection object');
  for (const value of Object.values(store)) {
    const doc = record(value);
    if (!doc) throw new Error(`invalid document in ${entity}`);
    if (entity === 'reports' && doc.status === 'final') {
      const patientId = String(doc.patientId ?? '').trim();
      const patientName = String(doc.patientName ?? '').trim().toLowerCase();
      const tests = Array.isArray(doc.testSelection) ? doc.testSelection : [];
      const snapshot = record(doc.issuanceSnapshot);
      const verification = record(doc.verification);
      const signature = record(doc.issuanceSignature);
      if (!patientId || !patientName || patientName === 'unknown' || tests.length === 0 || !snapshot) {
        throw new Error('invalid final report: patient, tests, and issuance snapshot are required');
      }
      if (!verification || verification.role !== 'pathologist' || !String(verification.reviewedBy ?? '').trim() || !String(verification.reviewedAt ?? '').trim()) {
        throw new Error('invalid final report: independent pathologist verification is required');
      }
      if (!signature || signature.algorithm !== 'ECDSA-P256-SHA256' || !record(signature.publicKey) || !String(signature.signature ?? '').trim() || !/^[a-f0-9]{64}$/.test(String(signature.manifestHash ?? ''))) {
        throw new Error('invalid final report: issuance signature is required');
      }
    }
    if (entity === 'orders') {
      if (!['ordered', 'collected', 'processing', 'resulted', 'issued', 'billed', 'cancelled', 'amended'].includes(String(doc.status)) || !Array.isArray(doc.items) || doc.items.length === 0) {
        throw new Error('invalid order document');
      }
    }
    if (entity === 'samples') {
      if (!['expected', 'collected', 'received', 'processing', 'rejected', 'lost', 'disposed'].includes(String(doc.status)) || !Array.isArray(doc.custody)) {
        throw new Error('invalid sample document');
      }
      for (const event of doc.custody) {
        const custody = record(event);
        if (!custody || !String(custody.actor ?? '').trim() || !String(custody.at ?? '').trim()) {
          throw new Error('sample custody events require actor and timestamp');
        }
      }
    }
    if (entity === 'auditEvents' && (!String(doc.action ?? '').trim() || !String(doc.entity ?? '').trim() || !String(doc.entityId ?? '').trim() || !String(doc.actor ?? '').trim() || !String(doc.at ?? '').trim())) {
      throw new Error('audit events require action, entity, id, actor, and timestamp');
    }
  }
}

/**
 * The renderer may only name credentials in its own namespace (see
 * `src/lib/renderer-credentials.ts`). The generic keyring channels used to
 * forward any account string, so `get('db-key')` would have handed a compromised
 * page the SQLCipher key; the allow-list refuses `db-key` and every unknown
 * name at the trusted (main-process) boundary.
 */
function assertRendererAccount(account: unknown): string {
  if (typeof account !== 'string') throw new Error('bad keyring args');
  if (!isRendererCredentialAccount(account)) {
    throw new Error(`credential not accessible from the renderer: ${account}`);
  }
  return account;
}

/** Containment test used by both guards; case-insensitive on Windows paths. */
function contains(root: string, abs: string): boolean {
  const r = process.platform === 'win32' ? root.toLowerCase() : root;
  const a = process.platform === 'win32' ? abs.toLowerCase() : abs;
  return a === r || a.startsWith(r + path.sep);
}

/**
 * Join `rel` onto `root`, refusing any escape. The first check is lexical;
 * when the target exists its *real* path is checked too, so a symlink or
 * directory junction placed inside the root cannot point out of it (this is
 * what the module header promises — the lexical check alone would not).
 */
function within(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  if (!contains(root, abs)) {
    throw new Error(`path escapes the app storage root: ${rel}`);
  }
  try {
    const real = fs.realpathSync(abs);
    if (!contains(fs.realpathSync(root), real)) {
      throw new Error(`path resolves outside the app storage root: ${rel}`);
    }
  } catch (err) {
    // "resolves outside" is a refusal; anything else (ENOENT for a file not
    // written yet, EINVAL on odd platforms) leaves the lexical guard in force.
    if (err instanceof Error && err.message.startsWith('path resolves')) throw err;
  }
  return abs;
}

const privateRoot = (): string => app.getPath('userData');

/**
 * Roots a renderer may name with an absolute path — only the folders the app
 * itself writes into (see `saveFile`). Anything else (a path to someone else's
 * document, a file on a network share) is refused: printing and `shell.openPath`
 * both launch things, so they are the most dangerous paths in the surface.
 */
function withinAppRoots(abs: string): string {
  const normalized = path.resolve(abs);
  const documents = app.getPath('documents');
  const roots = [
    path.join(privateRoot(), 'PathoMitra'),
    path.join(privateRoot(), 'PathLab OS'),
    path.join(documents, 'PathoMitra'),
    path.join(documents, 'PathLab OS'),
  ];
  const allowed = roots.some(root => {
    if (!contains(root, normalized)) return false;
    try {
      const realRoot = fs.realpathSync(root);
      const realTarget = fs.realpathSync(normalized);
      return contains(realRoot, realTarget);
    } catch {
      // A missing target is rejected by resolveTarget; a missing root cannot grant access.
      return false;
    }
  });
  if (!allowed) {
    throw new Error(`path is outside the app's own folders: ${abs}`);
  }
  return normalized;
}

/**
 * Resolve whatever the renderer named for a print/open request. `{ filePath }`
 * is the print channel's shape; a bare string still works because the file
 * helpers pass app-relative paths (`PathoMitra/Backups/x.json`) to `pm:shell:show`.
 */
function resolveTarget(target: unknown, extensions: readonly string[]): string {
  const value =
    typeof target === 'string'
      ? target
      : target && typeof target === 'object'
        ? (target as { filePath?: unknown }).filePath
        : undefined;
  if (typeof value !== 'string' || !value) throw new Error('a filePath is required');
  const resolved = withinAppRoots(path.isAbsolute(value) ? value : path.resolve(privateRoot(), value));
  if (!extensions.includes(path.extname(resolved).toLowerCase())) {
    throw new Error('This file type cannot be opened or printed by PathoMitra.');
  }
  try {
    if (!fs.statSync(resolved).isFile()) throw new Error('not a file');
  } catch {
    throw new Error('The requested file no longer exists.');
  }
  return resolved;
}

interface SaveArgs {
  /** App-relative path, e.g. `PathoMitra/Report - John.pdf`; never absolute. */
  relPath: string;
  data: string;
  base64: boolean;
  /** Mirrors candidateDirectories(): public Documents first, step down to private. */
  publicFirst: boolean;
}

const MAX_SAVE_BYTES = 64 * 1024 * 1024;
const SAVE_EXTENSIONS = new Set(['.pdf', '.csv', '.json', '.txt']);
const APP_FOLDERS = new Set(['PathoMitra', 'PathLab OS']);

function validateSaveArgs(args: unknown): { args: SaveArgs; buffer: Buffer; folder: string; relative: string } {
  const value = record(args);
  if (!value) throw new Error('invalid file save arguments');
  const { relPath, data, base64, publicFirst } = value;
  if (
    typeof relPath !== 'string' ||
    !relPath ||
    relPath.length > 260 ||
    path.isAbsolute(relPath) ||
    /^[a-zA-Z]:/.test(relPath) ||
    relPath.includes('\\') ||
    relPath.split('/').some(part => !part || part === '.' || part === '..') ||
    typeof data !== 'string' ||
    !data ||
    typeof base64 !== 'boolean' ||
    typeof publicFirst !== 'boolean'
  ) {
    throw new Error('invalid file save arguments');
  }
  const [folder, ...parts] = relPath.split('/');
  const relative = parts.join('/');
  if (!APP_FOLDERS.has(folder) || !relative || !SAVE_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
    throw new Error('save path must stay inside an app output folder and use a supported file type');
  }
  if (base64 && !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new Error('file payload is not valid base64');
  }
  const estimatedBytes = base64 ? Math.floor((data.length * 3) / 4) : Buffer.byteLength(data, 'utf8');
  if (estimatedBytes > MAX_SAVE_BYTES) {
    throw new Error(`file payload exceeds the ${Math.round(MAX_SAVE_BYTES / 1024 / 1024)} MB limit`);
  }
  const buffer = base64 ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8');
  if (buffer.length > MAX_SAVE_BYTES) throw new Error('file payload exceeds the size limit');
  return { args: { relPath, data, base64, publicFirst }, buffer, folder, relative };
}

function saveFile(args: SaveArgs): { name: string; uri: string; path: string; isPrivate: boolean } {
  const validated = validateSaveArgs(args);
  const attempts: Array<{ root: string; isPrivate: boolean }> = validated.args.publicFirst
    ? [
        { root: app.getPath('documents'), isPrivate: false },
        { root: privateRoot(), isPrivate: true },
      ]
    : [{ root: privateRoot(), isPrivate: true }];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    let temp = '';
    try {
      const appRoot = path.join(attempt.root, validated.folder);
      fs.mkdirSync(appRoot, { recursive: true, mode: 0o700 });
      if (fs.lstatSync(appRoot).isSymbolicLink()) {
        throw new Error('app output folder cannot be a symbolic link or junction');
      }
      const abs = within(appRoot, validated.relative);
      fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
      temp = `${abs}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temp, validated.buffer, { mode: 0o600 });
      fs.renameSync(temp, abs);
      return {
        name: path.basename(abs),
        uri: pathToFileURL(abs).href,
        path: abs,
        isPrivate: attempt.isPrivate,
      };
    } catch (err) {
      if (temp) {
        try { fs.rmSync(temp, { force: true }); } catch { /* preserve the original failure */ }
      }
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('could not write the file');
}

/**
 * Every `pm:*` channel can read the clinical database, write app storage, spool
 * print jobs, or touch the credential store. Only the application's top-level
 * frame may call them. Custom Electron schemes have an opaque (`null`) URL
 * origin, so compare the protocol, exact host, authority components, and frame
 * identity instead of URL.origin or a string prefix.
 */
function isTrustedSender(event: Electron.IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  try {
    const url = new URL(frame.url);
    return (
      url.protocol === 'pathomitra:' &&
      url.host === 'app' &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

/**
 * `ipcMain.handle` with the sender check welded in front of it.
 *
 * Every channel in `registerIpc()` is registered through this wrapper, so the
 * check is impossible to forget on a channel added later — which is the usual
 * way this class of hole survives review.
 *
 * Generic over the argument tuple so a channel can keep a typed signature
 * (`pm:files:save` takes a `SaveArgs`); the cast is the IPC boundary itself,
 * where the arguments arrive from the renderer as untyped JSON and every handler
 * validates them on its own.
 */
function handle<A extends unknown[]>(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: A) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      console.error(`PathoMitra desktop: refused ${channel} from an untrusted frame`);
      throw new Error(`Untrusted IPC sender for ${channel}.`);
    }
    return listener(event, ...(args as A));
  });
}

export function registerIpc(): void {
  /* Database façade -------------------------------------------------------- */
  handle('pm:db:init', async () => {
    await openDatabase();
  });
  handle('pm:db:load', (_e, entity: unknown) => loadEntity(assertEntity(entity)));
  handle('pm:db:save', (_e, entity: unknown, json: unknown) => {
    const name = assertEntity(entity);
    if (typeof json !== 'string') throw new Error('db payload must be a JSON string');
    // Parse-on-write: the encrypted file must never hold something the
    // renderer could not have produced — cheap structural guard.
    const payload = JSON.parse(json);
    assertClinicalPayload(name, payload);
    saveEntity(name, json);
  });
  handle('pm:db:clear', () => eraseDatabase());
  /**
   * Atomic multi-collection write (see `saveEntitiesBulk`). Each entry is
   * validated exactly like a single `pm:db:save` — allow-listed collection name,
   * JSON string payload — and the whole batch is committed inside one SQLite
   * transaction, so the renderer's `transaction()` is only ever atomic or not at
   * all, never half-applied.
   */
  handle('pm:db:commit', (_e, entries: unknown) => {
    if (!Array.isArray(entries)) throw new Error('db commit expects an array of collections');
    const rows = entries.map(entry => {
      const row = entry as { entity?: unknown; json?: unknown } | null;
      const name = assertEntity(row?.entity);
      if (typeof row?.json !== 'string') throw new Error('db payload must be a JSON string');
      const payload = JSON.parse(row.json);
      assertClinicalPayload(name, payload);
      return { entity: name, json: row.json };
    });
    saveEntitiesBulk(rows);
  });

  /* Files ------------------------------------------------------------------ */
  handle('pm:files:rename', (_event, from: unknown, to: unknown) => {
    if (typeof from !== 'string' || typeof to !== 'string') throw new Error('invalid rename arguments');
    const source = within(privateRoot(), from);
    const target = within(privateRoot(), to);
    if (!SAVE_EXTENSIONS.has(path.extname(target).toLowerCase())) throw new Error('unsupported target file type');
    if (!fs.statSync(source).isFile()) throw new Error('rename source is not a file');
    fs.renameSync(source, target);
  });
  handle('pm:files:save', (_e, args: SaveArgs) => saveFile(args));
  handle('pm:files:readText', (_e, rel: unknown) => {
    if (typeof rel !== 'string') throw new Error('bad path');
    return fs.readFileSync(within(privateRoot(), rel), 'utf8');
  });
  handle('pm:files:list', (_e, relDir: unknown, extension: unknown) => {
    if (typeof relDir !== 'string') throw new Error('bad path');
    const dir = within(privateRoot(), relDir);
    const ext = typeof extension === 'string' ? extension : '';
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isFile() && (!ext || entry.name.endsWith(ext)))
        .map(entry => entry.name)
        .sort((a, b) => b.localeCompare(a));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  });
  handle('pm:files:uri', (_e, rel: unknown) => {
    if (typeof rel !== 'string') throw new Error('bad path');
    return pathToFileURL(within(privateRoot(), rel)).href;
  });
  /**
   * Delete one app-owned file (the backup list's "delete old snapshots").
   * Confined to the private root like every other files channel, non-recursive
   * (a directory is refused), and narrowed further to the two backup folders
   * the renderer actually lists — a compromised page still cannot wipe the
   * Electron profile or the WAL sidecars of the database.
   */
  handle('pm:files:removeTree', (_e, rel: unknown) => {
    if (rel !== 'PathoMitra' && rel !== 'PathLab OS') {
      throw new Error('only app output folders may be removed');
    }
    const roots = [privateRoot(), app.getPath('documents')];
    for (const root of roots) {
      const target = path.join(root, rel);
      if (!fs.existsSync(target)) continue;
      if (fs.lstatSync(target).isSymbolicLink()) {
        throw new Error('app output folder cannot be a symbolic link or junction');
      }
      const safe = withinAppRoots(target);
      const assertNoLinks = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isSymbolicLink()) throw new Error('app output folder contains a symbolic link or junction');
          const real = fs.realpathSync(full);
          if (!contains(fs.realpathSync(safe), real)) throw new Error('app output folder contains an escaping junction');
          if (entry.isDirectory()) assertNoLinks(full);
        }
      };
      assertNoLinks(safe);
      fs.rmSync(safe, { recursive: true, force: true });
    }
  });
  handle('pm:files:delete', (_e, rel: unknown) => {
    if (typeof rel !== 'string') throw new Error('bad path');
    const root = privateRoot();
    const abs = within(root, rel);
    const backupDirs = ['PathoMitra/Backups', 'PathLab OS/Backups'].map(dir =>
      path.resolve(root, dir),
    );
    if (!backupDirs.some(dir => abs.startsWith(dir + path.sep))) {
      throw new Error(`only backup snapshots may be deleted here: ${rel}`);
    }
    fs.rmSync(abs, { force: true });
  });

  /* Print + shell ---------------------------------------------------------- */
  /**
   * Print a file that already exists (the saved report): the native print-or-
   * open prompt lives in `print.ts`. Window-modal, so the prompt belongs to the
   * window that asked for it.
   */
  handle('pm:files:print', (event, target: unknown) => {
    const abs = resolveTarget(target, ['.pdf']);
    return printPdfFile(abs, BrowserWindow.fromWebContents(event.sender) ?? undefined);
  });
  /** Open with the user's default handler, or reveal in Explorer. */
  handle('pm:shell:show', async (_e, target: unknown) => {
    const abs = resolveTarget(target, ['.pdf', '.csv', '.json', '.txt']);
    const err = await shell.openPath(abs);
    if (err) throw new Error(err);
  });

  /* In-app print dialog ---------------------------------------------------- */
  /** Installed printers for the dialog's dropdown. */
  handle('pm:print:printers', event =>
    listPrinters(BrowserWindow.fromWebContents(event.sender) ?? undefined),
  );
  /**
   * Spool a job the dialog already rendered. The payload is a page list of PNG
   * data URLs — untrusted input by Electron's rules — so the shape is checked
   * here and every page is re-checked in `print-window.ts` before it reaches the
   * generated document. Failures come back as `{ ok: false }` rather than a
   * rejection: the dialog shows them inline, it does not crash on them.
   */
  handle(
    'pm:print:job',
    (event, request: unknown): Promise<PrintJobResult> | PrintJobResult => {
      const job = request as Partial<PrintJobRequest> | null;
      if (
        !job ||
        !Array.isArray(job.pages) ||
        typeof job.options?.deviceName !== 'string' ||
        typeof job.sheetWidthMm !== 'number' ||
        typeof job.sheetHeightMm !== 'number'
      ) {
        return { ok: false, error: 'The print job was not well formed.' };
      }
      return printJob(
        job as PrintJobRequest,
        BrowserWindow.fromWebContents(event.sender) ?? undefined,
      );
    },
  );

  /* Secure storage (Windows Credential Manager) ---------------------------- */
  /**
   * The auth records the UI legitimately needs, all namespaced `pathlab_*`. The
   * database key is deliberately unreachable here — `assertRendererAccount`
   * denies `db-key` and any name outside the renderer namespace, so this surface
   * cannot read, overwrite or delete the SQLCipher key.
   */
  handle('pm:keyring:set', (_e, account: unknown, secret: unknown) => {
    const name = assertRendererAccount(account);
    if (typeof secret !== 'string') throw new Error('bad keyring args');
    return setSecret(name, secret);
  });
  handle('pm:keyring:get', (_e, account: unknown) =>
    getSecret(assertRendererAccount(account)),
  );
  handle('pm:keyring:delete', (_e, account: unknown) =>
    deleteSecret(assertRendererAccount(account)),
  );
}
