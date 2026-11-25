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
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  countDocuments,
  deleteDocument,
  eraseDatabase,
  getDocument,
  loadEntity,
  openDatabase,
  queryDocuments,
  saveDocument,
  saveEntitiesBulk,
  saveEntity,
  updateDocument,
} from './db';
import { deleteSecret, getSecret, setSecret } from './keyring';
import { isRendererCredentialAccount } from '../src/lib/renderer-credentials';
import { isEntityName, type EntityName } from '../src/data/entities';
import { printPdfFile } from './print';
import {
  appendPrintPage,
  beginPrintJob,
  cancelPrintJob,
  commitPrintJob,
  type PrintJobRequest,
  type PrintJobResult,
  type PrintJobStartRequest,
  listPrinters,
  printJob,
} from './print-window';
import {
  closeDesktopSession,
  getDesktopPrincipal,
  openBiometricSession,
  openDesktopSession,
  type DesktopPrincipal,
} from './session';
import { can } from '../src/lib/permissions';
import { repositoryPermission } from '../src/lib/repository-permissions';
import { desktopReportPublicKey, signDesktopReport, verifyDesktopReport } from './report-signing';
import {
  backupDestinationStatus,
  chooseBackupDestination,
  copyBackupToDestination,
} from './backup-destination';
import { canonicalReportManifest } from '../src/lib/report-manifest';
import type { ReportRecord } from '../src/lib/models';
import type { ListOptions, WhereFilter } from '../src/data/types';

/** Collection names from the shared entity contract — anything else is refused. */
function assertEntity(entity: unknown): EntityName {
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
async function assertClinicalPayload(
  entity: string,
  payload: unknown,
  principal: DesktopPrincipal,
): Promise<void> {
  const store = record(payload);
  if (!store) throw new Error('db payload must be a collection object');
  for (const [id, value] of Object.entries(store)) {
    const doc = record(value);
    if (!doc) throw new Error(`invalid document in ${entity}`);
    if (entity === 'reports' && doc.status === 'final') {
      const patientId = String(doc.patientId ?? '').trim();
      const patientName = String(doc.patientName ?? '')
        .trim()
        .toLowerCase();
      const tests = Array.isArray(doc.testSelection) ? doc.testSelection : [];
      const snapshot = record(doc.issuanceSnapshot);
      const verification = record(doc.verification);
      const signature = record(doc.issuanceSignature);
      if (
        !patientId ||
        !patientName ||
        patientName === 'unknown' ||
        tests.length === 0 ||
        !snapshot
      ) {
        throw new Error('invalid final report: patient, tests, and issuance snapshot are required');
      }
      const issuerUid = String(doc.issuerUid ?? '').trim();
      const reviewerUid = String(verification?.reviewerUid ?? '').trim();
      if (
        !verification ||
        verification.role !== 'pathologist' ||
        !String(verification.reviewedBy ?? '').trim() ||
        !String(verification.reviewedAt ?? '').trim() ||
        !reviewerUid
      ) {
        throw new Error('invalid final report: independent pathologist verification is required');
      }
      if (
        !issuerUid ||
        issuerUid !== principal.uid ||
        reviewerUid === issuerUid ||
        !can(principal.role, 'issueReports')
      ) {
        throw new Error(
          'invalid final report: authenticated issuer and independent reviewer are required',
        );
      }
      if (
        !signature ||
        signature.algorithm !== 'ECDSA-P256-SHA256' ||
        !record(signature.publicKey) ||
        !String(signature.signature ?? '').trim() ||
        !String(signature.keyId ?? '').trim() ||
        !/^[a-f0-9]{64}$/.test(String(signature.manifestHash ?? ''))
      ) {
        throw new Error('invalid final report: issuance signature is required');
      }
      const manifest = canonicalReportManifest({ id, ...doc } as unknown as ReportRecord);
      const hash = crypto.createHash('sha256').update(manifest).digest('hex');
      if (
        hash !== signature.manifestHash ||
        !(await verifyDesktopReport(manifest, String(signature.signature), String(signature.keyId)))
          .valid
      ) {
        throw new Error('invalid final report: issuance signature verification failed');
      }
    }
    if (entity === 'orders') {
      if (
        ![
          'ordered',
          'collected',
          'processing',
          'resulted',
          'issued',
          'billed',
          'cancelled',
          'amended',
        ].includes(String(doc.status)) ||
        !Array.isArray(doc.items) ||
        doc.items.length === 0
      ) {
        throw new Error('invalid order document');
      }
    }
    if (entity === 'samples') {
      if (
        ![
          'expected',
          'collected',
          'received',
          'processing',
          'rejected',
          'lost',
          'disposed',
        ].includes(String(doc.status)) ||
        !Array.isArray(doc.custody)
      ) {
        throw new Error('invalid sample document');
      }
      for (const event of doc.custody) {
        const custody = record(event);
        if (!custody || !String(custody.actor ?? '').trim() || !String(custody.at ?? '').trim()) {
          throw new Error('sample custody events require actor and timestamp');
        }
      }
    }
    if (
      entity === 'auditEvents' &&
      (!String(doc.action ?? '').trim() ||
        !String(doc.entity ?? '').trim() ||
        !String(doc.entityId ?? '').trim() ||
        !String(doc.actor ?? '').trim() ||
        !String(doc.at ?? '').trim())
    ) {
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
const OUTPUT_FOLDERS = new Set(['PathoMitra', 'PathLab OS']);
const MAX_COLLECTION_BYTES = 64 * 1024 * 1024;
const MAX_COMMIT_BYTES = 128 * 1024 * 1024;
const MAX_DOCUMENTS = 100_000;
const MAX_QUERY_LIMIT = 10_000;
const WHERE_OPS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in', 'array-contains', 'contains']);

function parseListOptions(value: unknown): ListOptions {
  const input = record(value);
  if (!input) return {};
  const options: ListOptions = {};
  if (input.orderBy !== undefined) {
    if (typeof input.orderBy !== 'string' || !/^[A-Za-z0-9_]+$/.test(input.orderBy))
      throw new Error('invalid order field');
    options.orderBy = input.orderBy;
  }
  if (input.direction !== undefined) {
    if (input.direction !== 'asc' && input.direction !== 'desc')
      throw new Error('invalid sort direction');
    options.direction = input.direction;
  }
  if (input.limit !== undefined) {
    if (
      !Number.isInteger(input.limit) ||
      Number(input.limit) < 0 ||
      Number(input.limit) > MAX_QUERY_LIMIT
    )
      throw new Error('invalid list limit');
    options.limit = Number(input.limit);
  }
  if (input.offset !== undefined) {
    if (
      !Number.isInteger(input.offset) ||
      Number(input.offset) < 0 ||
      Number(input.offset) > 1_000_000
    )
      throw new Error('invalid list offset');
    options.offset = Number(input.offset);
  }
  if (input.where !== undefined) {
    if (!Array.isArray(input.where) || input.where.length > 20)
      throw new Error('invalid query filters');
    options.where = input.where.map((entry): WhereFilter => {
      const filter = record(entry);
      if (
        !filter ||
        typeof filter.field !== 'string' ||
        !/^[A-Za-z0-9_]+$/.test(filter.field) ||
        typeof filter.op !== 'string' ||
        !WHERE_OPS.has(filter.op)
      )
        throw new Error('invalid query filter');
      const value = filter.value;
      const scalar = value === null || ['string', 'number', 'boolean'].includes(typeof value);
      const list =
        Array.isArray(value) &&
        value.length <= 100 &&
        value.every(item => ['string', 'number', 'boolean'].includes(typeof item));
      if (!scalar && !list) throw new Error('invalid query filter value');
      return {
        field: filter.field,
        op: filter.op as WhereFilter['op'],
        value: value as WhereFilter['value'],
      };
    });
  }
  return options;
}

function withinOutputRoot(rel: string): string {
  const normalized = rel.replaceAll('\\', '/');
  const folder = normalized.split('/')[0];
  if (!OUTPUT_FOLDERS.has(folder)) throw new Error('path is outside the app output folders');
  return within(privateRoot(), rel);
}

function assertJsonDepth(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error('database payload is nested too deeply');
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>))
      assertJsonDepth(child, depth + 1);
  }
}

function assertPayloadBudget(entity: string, json: string, payload: unknown): void {
  if (Buffer.byteLength(json, 'utf8') > MAX_COLLECTION_BYTES)
    throw new Error(`${entity} payload exceeds the 64 MB limit`);
  const store = record(payload);
  if (!store) throw new Error('db payload must be a collection object');
  if (Object.keys(store).length > MAX_DOCUMENTS)
    throw new Error(`${entity} payload contains too many documents`);
  assertJsonDepth(payload);
}

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
  const resolved = withinAppRoots(
    path.isAbsolute(value) ? value : path.resolve(privateRoot(), value),
  );
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

function validateSaveArgs(args: unknown): {
  args: SaveArgs;
  buffer: Buffer;
  folder: string;
  relative: string;
} {
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
  if (
    !APP_FOLDERS.has(folder) ||
    !relative ||
    !SAVE_EXTENSIONS.has(path.extname(relative).toLowerCase())
  ) {
    throw new Error(
      'save path must stay inside an app output folder and use a supported file type',
    );
  }
  if (base64 && !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new Error('file payload is not valid base64');
  }
  const estimatedBytes = base64
    ? Math.floor((data.length * 3) / 4)
    : Buffer.byteLength(data, 'utf8');
  if (estimatedBytes > MAX_SAVE_BYTES) {
    throw new Error(
      `file payload exceeds the ${Math.round(MAX_SAVE_BYTES / 1024 / 1024)} MB limit`,
    );
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
        try {
          fs.rmSync(temp, { force: true });
        } catch {
          /* preserve the original failure */
        }
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
type PrincipalEvent = Electron.IpcMainInvokeEvent & { principal?: DesktopPrincipal };

const PRIVILEGED_CHANNELS = new Set([
  'pm:db:load',
  'pm:db:save',
  'pm:db:clear',
  'pm:db:commit',
  'pm:db:get',
  'pm:db:query',
  'pm:db:count',
  'pm:db:set',
  'pm:db:update',
  'pm:db:delete',
  'pm:files:save',
  'pm:files:readText',
  'pm:files:rename',
  'pm:files:list',
  'pm:files:uri',
  'pm:files:delete',
  'pm:files:removeTree',
  'pm:files:print',
  'pm:print:printers',
  'pm:print:job',
  'pm:print:begin',
  'pm:print:page',
  'pm:print:commit',
  'pm:print:cancel',
  'pm:shell:show',
  'pm:report:public-key',
  'pm:report:sign',
  'pm:report:verify',
  'pm:backup:choose',
  'pm:backup:status',
  'pm:backup:copy',
]);

function principalOf(event: PrincipalEvent): DesktopPrincipal {
  if (!event.principal) throw new Error('Desktop session required.');
  return event.principal;
}

function assertPermission(event: PrincipalEvent, permission: Parameters<typeof can>[1]): void {
  if (!can(principalOf(event).role, permission))
    throw new Error(`Desktop session lacks ${permission} permission.`);
}

function assertOperator(event: PrincipalEvent): void {
  if (principalOf(event).role === 'guest')
    throw new Error('Guest sessions cannot perform this action.');
}

function handle<A extends unknown[]>(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: A) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      console.error(`PathoMitra desktop: refused ${channel} from an untrusted frame`);
      throw new Error(`Untrusted IPC sender for ${channel}.`);
    }
    if (PRIVILEGED_CHANNELS.has(channel)) {
      const [token, ...rest] = args;
      (event as PrincipalEvent).principal = getDesktopPrincipal(token);
      return listener(event, ...(rest as A));
    }
    return listener(event, ...(args as A));
  });
}

export function registerIpc(): void {
  handle('pm:session:open', async (_event, identifier: unknown, password: unknown) => {
    if (typeof identifier !== 'string' || typeof password !== 'string')
      throw new Error('invalid session arguments');
    return openDesktopSession(identifier, password);
  });
  handle('pm:session:open-biometric', async (_event, operatorId: unknown) => {
    if (typeof operatorId !== 'string') throw new Error('invalid session arguments');
    return openBiometricSession(operatorId);
  });
  handle('pm:session:close', async (_event, token: unknown) => closeDesktopSession(token));
  handle('pm:system:storage', async () => {
    const stats = await fs.promises.statfs(app.getPath('userData'));
    const blockSize = Number(stats.bsize) || 0;
    const quota = Number(stats.blocks) * blockSize;
    const available = Number(stats.bavail) * blockSize;
    return { usage: Math.max(0, quota - available), quota };
  });
  handle('pm:backup:choose', event => {
    assertPermission(event as PrincipalEvent, 'manageBackup');
    return chooseBackupDestination(BrowserWindow.fromWebContents(event.sender));
  });
  handle('pm:backup:status', event => {
    assertPermission(event as PrincipalEvent, 'manageBackup');
    return backupDestinationStatus();
  });
  handle('pm:backup:copy', (event, fileName: unknown, payload: unknown) => {
    assertPermission(event as PrincipalEvent, 'manageBackup');
    if (
      typeof fileName !== 'string' ||
      typeof payload !== 'string' ||
      Buffer.byteLength(payload, 'utf8') > MAX_COLLECTION_BYTES
    )
      throw new Error('invalid off-device backup payload');
    return copyBackupToDestination(fileName, payload);
  });
  handle('pm:report:public-key', event => {
    assertPermission(event as PrincipalEvent, 'viewClinical');
    return desktopReportPublicKey();
  });
  handle('pm:report:sign', (event, manifest: unknown) => {
    assertPermission(event as PrincipalEvent, 'issueReports');
    if (typeof manifest !== 'string' || !manifest || manifest.length > 2_000_000)
      throw new Error('invalid report manifest');
    return signDesktopReport(manifest);
  });
  handle('pm:report:verify', (event, manifest: unknown, signature: unknown, keyId: unknown) => {
    assertPermission(event as PrincipalEvent, 'viewClinical');
    if (
      typeof manifest !== 'string' ||
      typeof signature !== 'string' ||
      (keyId !== undefined && typeof keyId !== 'string')
    )
      throw new Error('invalid signature arguments');
    return verifyDesktopReport(manifest, signature, keyId);
  });

  /* Database façade -------------------------------------------------------- */
  handle('pm:db:init', async () => {
    await openDatabase();
  });
  handle('pm:db:load', (event, entity: unknown) => {
    assertPermission(event as PrincipalEvent, 'viewClinical');
    return loadEntity(assertEntity(entity));
  });
  handle('pm:db:save', async (event, entity: unknown, json: unknown) => {
    const name = assertEntity(entity);
    if (typeof json !== 'string') throw new Error('db payload must be a JSON string');
    // Parse-on-write: the encrypted file must never hold something the
    // renderer could not have produced — cheap structural guard.
    const payload = JSON.parse(json);
    assertPayloadBudget(name, json, payload);
    await assertClinicalPayload(name, payload, principalOf(event as PrincipalEvent));
    for (const doc of Object.values(payload as Record<string, unknown>)) {
      const value = record(doc) ?? {};
      assertPermission(event as PrincipalEvent, repositoryPermission(name, 'create', value));
    }
    saveEntity(name, json);
  });
  handle('pm:db:get', (event, entity: unknown, id: unknown) => {
    assertPermission(event as PrincipalEvent, 'viewClinical');
    if (typeof id !== 'string' || !id || id.length > 256) throw new Error('invalid document id');
    return getDocument(assertEntity(entity), id);
  });
  handle('pm:db:query', (event, entity: unknown, options: unknown) => {
    assertPermission(event as PrincipalEvent, 'viewClinical');
    return queryDocuments(assertEntity(entity), parseListOptions(options));
  });
  handle('pm:db:count', (event, entity: unknown, where: unknown) => {
    assertPermission(event as PrincipalEvent, 'viewClinical');
    return countDocuments(assertEntity(entity), parseListOptions({ where }).where);
  });
  handle('pm:db:set', async (event, entity: unknown, id: unknown, json: unknown) => {
    const name = assertEntity(entity);
    if (typeof id !== 'string' || !id || id.length > 256 || typeof json !== 'string')
      throw new Error('invalid document write');
    const payload = JSON.parse(json);
    assertPayloadBudget(name, json, { [id]: payload });
    await assertClinicalPayload(name, { [id]: payload }, principalOf(event as PrincipalEvent));
    const value = record(payload) ?? {};
    assertPermission(event as PrincipalEvent, repositoryPermission(name, 'create', value));
    saveDocument(name, id, json);
  });
  handle('pm:db:update', async (event, entity: unknown, id: unknown, patchJson: unknown) => {
    const name = assertEntity(entity);
    if (typeof id !== 'string' || !id || id.length > 256 || typeof patchJson !== 'string')
      throw new Error('invalid document update');
    const patch = JSON.parse(patchJson);
    if (!record(patch)) throw new Error('invalid document patch');
    assertJsonDepth(patch);
    const current = getDocument(name, id);
    if (!current) throw new Error(`Cannot update missing ${name} document: ${id}`);
    const merged = { ...(JSON.parse(current) as Record<string, unknown>), ...patch };
    const json = JSON.stringify(merged);
    assertPayloadBudget(name, json, { [id]: merged });
    await assertClinicalPayload(name, { [id]: merged }, principalOf(event as PrincipalEvent));
    assertPermission(event as PrincipalEvent, repositoryPermission(name, 'update', merged));
    updateDocument(name, id, patchJson);
  });
  handle('pm:db:delete', (event, entity: unknown, id: unknown) => {
    const name = assertEntity(entity);
    if (typeof id !== 'string' || !id || id.length > 256) throw new Error('invalid document id');
    assertPermission(event as PrincipalEvent, repositoryPermission(name, 'delete'));
    deleteDocument(name, id);
  });
  handle('pm:db:clear', event => {
    assertPermission(event as PrincipalEvent, 'eraseData');
    return eraseDatabase();
  });
  /**
   * Atomic multi-collection write (see `saveEntitiesBulk`). Each entry is
   * validated exactly like a single `pm:db:save` — allow-listed collection name,
   * JSON string payload — and the whole batch is committed inside one SQLite
   * transaction, so the renderer's `transaction()` is only ever atomic or not at
   * all, never half-applied.
   */
  handle('pm:db:commit', async (event, entries: unknown) => {
    if (!Array.isArray(entries)) throw new Error('db commit expects an array of collections');
    if (entries.length > 16) throw new Error('db commit contains too many collections');
    let totalBytes = 0;
    const rows = await Promise.all(
      entries.map(async entry => {
        const row = entry as { entity?: unknown; json?: unknown } | null;
        const name = assertEntity(row?.entity);
        if (typeof row?.json !== 'string') throw new Error('db payload must be a JSON string');
        totalBytes += Buffer.byteLength(row.json, 'utf8');
        if (totalBytes > MAX_COMMIT_BYTES) throw new Error('db commit exceeds the 128 MB limit');
        const payload = JSON.parse(row.json);
        assertPayloadBudget(name, row.json, payload);
        await assertClinicalPayload(name, payload, principalOf(event as PrincipalEvent));
        for (const doc of Object.values(payload as Record<string, unknown>)) {
          const value = record(doc) ?? {};
          assertPermission(event as PrincipalEvent, repositoryPermission(name, 'create', value));
        }
        return { entity: name, json: row.json };
      }),
    );
    saveEntitiesBulk(rows);
  });

  /* Files ------------------------------------------------------------------ */
  handle('pm:files:rename', (event, from: unknown, to: unknown) => {
    assertPermission(event as PrincipalEvent, 'manageBackup');
    if (typeof from !== 'string' || typeof to !== 'string')
      throw new Error('invalid rename arguments');
    const source = withinOutputRoot(from);
    const target = withinOutputRoot(to);
    if (!SAVE_EXTENSIONS.has(path.extname(target).toLowerCase()))
      throw new Error('unsupported target file type');
    if (!fs.statSync(source).isFile()) throw new Error('rename source is not a file');
    fs.renameSync(source, target);
  });
  handle('pm:files:save', (event, args: SaveArgs) => {
    assertOperator(event as PrincipalEvent);
    return saveFile(args);
  });
  handle('pm:files:readText', (event, rel: unknown) => {
    assertPermission(event as PrincipalEvent, 'manageBackup');
    if (typeof rel !== 'string') throw new Error('bad path');
    return fs.readFileSync(withinOutputRoot(rel), 'utf8');
  });
  handle('pm:files:list', (event, relDir: unknown, extension: unknown) => {
    assertPermission(event as PrincipalEvent, 'manageBackup');
    if (typeof relDir !== 'string') throw new Error('bad path');
    const dir = withinOutputRoot(relDir);
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
  handle('pm:files:uri', (event, rel: unknown) => {
    assertPermission(event as PrincipalEvent, 'manageBackup');
    if (typeof rel !== 'string') throw new Error('bad path');
    return pathToFileURL(withinOutputRoot(rel)).href;
  });
  /**
   * Delete one app-owned file (the backup list's "delete old snapshots").
   * Confined to the private root like every other files channel, non-recursive
   * (a directory is refused), and narrowed further to the two backup folders
   * the renderer actually lists — a compromised page still cannot wipe the
   * Electron profile or the WAL sidecars of the database.
   */
  handle('pm:files:removeTree', (event, rel: unknown) => {
    assertPermission(event as PrincipalEvent, 'manageBackup');
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
          if (entry.isSymbolicLink())
            throw new Error('app output folder contains a symbolic link or junction');
          const real = fs.realpathSync(full);
          if (!contains(fs.realpathSync(safe), real))
            throw new Error('app output folder contains an escaping junction');
          if (entry.isDirectory()) assertNoLinks(full);
        }
      };
      assertNoLinks(safe);
      fs.rmSync(safe, { recursive: true, force: true });
    }
  });
  handle('pm:files:delete', (event, rel: unknown) => {
    assertPermission(event as PrincipalEvent, 'manageBackup');
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
    assertOperator(event as PrincipalEvent);
    const abs = resolveTarget(target, ['.pdf']);
    return printPdfFile(abs, BrowserWindow.fromWebContents(event.sender) ?? undefined);
  });
  /** Open with the user's default handler, or reveal in Explorer. */
  handle('pm:shell:show', async (event, target: unknown) => {
    assertOperator(event as PrincipalEvent);
    const abs = resolveTarget(target, ['.pdf', '.csv', '.json', '.txt']);
    const err = await shell.openPath(abs);
    if (err) throw new Error(err);
  });

  /* In-app print dialog ---------------------------------------------------- */
  /** Installed printers for the dialog's dropdown. */
  handle('pm:print:printers', event => {
    assertOperator(event as PrincipalEvent);
    return listPrinters(BrowserWindow.fromWebContents(event.sender) ?? undefined);
  });
  /**
   * Spool a job the dialog already rendered. The payload is a page list of PNG
   * data URLs — untrusted input by Electron's rules — so the shape is checked
   * here and every page is re-checked in `print-window.ts` before it reaches the
   * generated document. Failures come back as `{ ok: false }` rather than a
   * rejection: the dialog shows them inline, it does not crash on them.
   */
  handle('pm:print:job', (event, request: unknown): Promise<PrintJobResult> | PrintJobResult => {
    assertOperator(event as PrincipalEvent);
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
  });

  handle('pm:print:begin', (event, request: unknown) => {
    assertOperator(event as PrincipalEvent);
    const job = request as Partial<PrintJobStartRequest> | null;
    if (
      !job ||
      typeof job.options?.deviceName !== 'string' ||
      typeof job.sheetWidthMm !== 'number' ||
      typeof job.sheetHeightMm !== 'number'
    ) {
      return { ok: false, error: 'The print job was not well formed.' };
    }
    return beginPrintJob(
      job as PrintJobStartRequest,
      BrowserWindow.fromWebContents(event.sender) ?? undefined,
    );
  });
  handle('pm:print:page', (event, jobId: unknown, page: unknown) => {
    assertOperator(event as PrincipalEvent);
    if (typeof jobId !== 'string') return { ok: false, error: 'The print job id is invalid.' };
    return appendPrintPage(jobId, page);
  });
  handle('pm:print:commit', async (event, jobId: unknown): Promise<PrintJobResult> => {
    assertOperator(event as PrincipalEvent);
    if (typeof jobId !== 'string') return { ok: false, error: 'The print job id is invalid.' };
    return commitPrintJob(jobId);
  });
  handle('pm:print:cancel', (event, jobId: unknown) => {
    assertOperator(event as PrincipalEvent);
    if (typeof jobId !== 'string') return { ok: false, error: 'The print job id is invalid.' };
    return cancelPrintJob(jobId);
  });

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
  handle('pm:keyring:get', (_e, account: unknown) => getSecret(assertRendererAccount(account)));
  handle('pm:keyring:delete', (_e, account: unknown) =>
    deleteSecret(assertRendererAccount(account)),
  );
}
