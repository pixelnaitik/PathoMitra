/** SQLCipher database with transactional migration from collection JSON to row-level documents. */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { deleteSecret, getSecret, setSecret } from './keyring';
import { applyQuery, makeDoc } from '../src/data/query';
import { buildSqlQuery, buildWhereSql } from '../src/data/sql-query';
import type { ListOptions, WhereFilter } from '../src/data/types';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3-multiple-ciphers');
const SCHEMA_VERSION = 3;
const KEY_ACCOUNT = 'db-key';
const KDF_ITER = 256_000;

type Store = Record<string, Record<string, unknown>>;
type BulkRow = { entity: string; json: string };
type WriteOp = { entity: string; id: string; json: string | null };

interface EncDb {
  pragma(source: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: (string | number)[]): Record<string, unknown> | undefined;
    all(...params: (string | number)[]): Array<Record<string, unknown>>;
    run(...params: (string | number)[]): unknown;
  };
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

let db: EncDb | null = null;
let opening: Promise<void> | null = null;
const collections = new Map<string, Store>();

function dbFile(): string {
  return path.join(app.getPath('userData'), 'pathlab.db');
}

async function databaseKey(): Promise<string> {
  const existing = await getSecret(KEY_ACCOUNT);
  if (existing) return existing;
  const fresh = crypto.randomBytes(32).toString('hex');
  await setSecret(KEY_ACCOUNT, fresh);
  return fresh;
}

export function openDatabase(): Promise<void> {
  if (db) return Promise.resolve();
  if (!opening) {
    opening = doOpen();
    opening.catch(() => {
      if (opening) opening = null;
    });
  }
  return opening;
}

function parseStore(raw: string, entity: string): Store {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`invalid stored collection: ${entity}`);
  return parsed as Store;
}

function insertDocument(entity: string, id: string, json: string): void {
  db!
    .prepare(
      'INSERT INTO documents (entity, id, data) VALUES (?, ?, ?) ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data',
    )
    .run(entity, id, json);
}

/** Copy legacy whole-collection rows once, then drop the plaintext-shaped duplicate table. */
function migrateLegacyCollections(): void {
  if (!db) return;
  const legacy = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entities'")
    .get();
  if (!legacy) return;
  const rows = db.prepare('SELECT name, json FROM entities').all();
  const apply = db.transaction(() => {
    for (const row of rows) {
      const entity = String(row.name);
      const store = parseStore(String(row.json), entity);
      for (const [id, value] of Object.entries(store))
        insertDocument(entity, id, JSON.stringify(value));
    }
    db!.exec('DROP TABLE entities');
  });
  apply();
  collections.clear();
}

async function doOpen(): Promise<void> {
  const key = await databaseKey();
  fs.mkdirSync(path.dirname(dbFile()), { recursive: true });
  const handle = new Database(dbFile());
  try {
    handle.pragma("cipher='sqlcipher'");
    handle.pragma(`kdf_iter=${KDF_ITER}`);
    handle.pragma(`key='${key.replace(/'/g, "''")}'`);
    handle.pragma('journal_mode = WAL');
    handle.exec(
      'CREATE TABLE IF NOT EXISTS documents (entity TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (entity, id))',
    );
    for (const field of ['createdAt', 'updatedAt', 'patientId', 'status', 'orderId']) {
      try {
        handle.exec(
          `CREATE INDEX IF NOT EXISTS idx_documents_entity_${field} ON documents(entity, json_extract(data, '$.${field}'));`,
        );
      } catch {
        // JSON1-less builds retain the shared in-memory query fallback.
      }
    }
    db = handle;
    const version = Number(handle.pragma('user_version')) || 0;
    if (version > SCHEMA_VERSION)
      throw new Error('This database was created by a newer PathoMitra version.');
    migrateLegacyCollections();
    handle.pragma(`user_version=${SCHEMA_VERSION}`);
    handle.pragma('foreign_keys=ON');
  } catch (error) {
    try {
      handle.close();
    } catch {
      /* preserve the useful failure */
    }
    db = null;
    throw error;
  }
}

function readCollection(entity: string): Store {
  if (!db) throw new Error('database opened late');
  const cached = collections.get(entity);
  if (cached) return cached;
  const store: Store = {};
  for (const row of db.prepare('SELECT id, data FROM documents WHERE entity = ?').all(entity)) {
    store[String(row.id)] = JSON.parse(String(row.data)) as Record<string, unknown>;
  }
  collections.set(entity, store);
  return store;
}

function changesFor(entity: string, incoming: Store, current = readCollection(entity)): WriteOp[] {
  const ops: WriteOp[] = [];
  for (const id of Object.keys(current)) {
    if (!(id in incoming)) ops.push({ entity, id, json: null });
  }
  for (const [id, value] of Object.entries(incoming)) {
    const json = JSON.stringify(value);
    if (!current[id] || JSON.stringify(current[id]) !== json) ops.push({ entity, id, json });
  }
  return ops;
}

function applyOps(ops: WriteOp[]): void {
  if (!db) throw new Error('database opened late');
  if (ops.length === 0) return;
  const upsert = db.prepare(
    'INSERT INTO documents (entity, id, data) VALUES (?, ?, ?) ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data',
  );
  const remove = db.prepare('DELETE FROM documents WHERE entity = ? AND id = ?');
  const apply = db.transaction(() => {
    for (const op of ops) {
      if (op.json === null) remove.run(op.entity, op.id);
      else upsert.run(op.entity, op.id, op.json);
    }
  });
  apply();
  for (const op of ops) {
    const store = collections.get(op.entity) ?? readCollection(op.entity);
    if (op.json === null) delete store[op.id];
    else store[op.id] = JSON.parse(op.json) as Record<string, unknown>;
    collections.set(op.entity, store);
  }
}

export function loadEntity(entity: string): string | null {
  const store = readCollection(entity);
  return Object.keys(store).length ? JSON.stringify(store) : null;
}

function readDocument(entity: string, id: string): Record<string, unknown> | null {
  if (!db) throw new Error('database opened late');
  const row = db.prepare('SELECT data FROM documents WHERE entity = ? AND id = ?').get(entity, id);
  return row ? (JSON.parse(String(row.data)) as Record<string, unknown>) : null;
}

export function countDocuments(entity: string, where?: WhereFilter[]): number {
  if (!db) throw new Error('database opened late');
  const translated = buildWhereSql(
    [{ field: 'entity', op: '==', value: entity }, ...(where ?? [])],
    'documents',
  );
  if (translated) {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM documents${translated.sql}`)
      .get(...translated.params.map(value => (typeof value === 'boolean' ? Number(value) : value)));
    return Number(row?.n) || 0;
  }
  return JSON.parse(queryDocuments(entity, { where })).length;
}

export function getDocument(entity: string, id: string): string | null {
  const value = readDocument(entity, id);
  return value ? JSON.stringify(value) : null;
}

export function queryDocuments(entity: string, options: ListOptions = {}): string {
  if (!db) throw new Error('database opened late');
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit < 0 || options.limit > 10_000)
  ) {
    throw new Error('List limit must be between 0 and 10000.');
  }
  const translated = buildSqlQuery(entity, options, 'documents');
  if (translated) {
    const rows = db
      .prepare(translated.sql)
      .all(...translated.params.map(value => (typeof value === 'boolean' ? Number(value) : value)));
    return JSON.stringify(
      rows.map(row => ({
        id: String(row.id),
        data: JSON.parse(String(row.data)) as Record<string, unknown>,
      })),
    );
  }
  const rows = db.prepare('SELECT id, data FROM documents WHERE entity = ?').all(entity);
  const docs = rows.map(row =>
    makeDoc(String(row.id), JSON.parse(String(row.data)) as Record<string, unknown>),
  );
  return JSON.stringify(applyQuery(docs, options).map(doc => ({ id: doc.id, data: doc.data() })));
}

function assertDocumentChange(
  entity: string,
  id: string,
  next: Record<string, unknown> | null,
): void {
  const current = readDocument(entity, id);
  const appendOnly = new Set(['reportVersions', 'payments', 'referralPayouts', 'auditEvents']);
  if (
    appendOnly.has(entity) &&
    current &&
    (!next || JSON.stringify(next) !== JSON.stringify(current))
  ) {
    throw new Error(`${entity} entries are append-only`);
  }
  if ((entity === 'samples' || entity === 'invoices') && current && !next) {
    throw new Error(`${entity} records cannot be deleted`);
  }
  if (
    entity !== 'reports' ||
    !current ||
    current.status !== 'final' ||
    !next ||
    JSON.stringify(next) === JSON.stringify(current)
  )
    return;
  if (
    !next.status ||
    next.status !== 'final' ||
    Number(next.version) <= Number(current.version) ||
    !String(next.amendReason ?? '').trim()
  ) {
    throw new Error('issued reports require an authenticated amendment');
  }
  const priorId = `${id}__v${String(current.version ?? 1)}`;
  if (!readDocument('reportVersions', priorId))
    throw new Error('issued reports require a retained prior version');
}

export function saveDocument(entity: string, id: string, json: string | null): void {
  if (!db) throw new Error('database opened late');
  const next = json === null ? null : (JSON.parse(json) as Record<string, unknown>);
  if (next !== null && (!next || typeof next !== 'object' || Array.isArray(next)))
    throw new Error('invalid document');
  assertDocumentChange(entity, id, next);
  if (next === null)
    db.prepare('DELETE FROM documents WHERE entity = ? AND id = ?').run(entity, id);
  else
    db.prepare(
      'INSERT INTO documents (entity, id, data) VALUES (?, ?, ?) ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data',
    ).run(entity, id, JSON.stringify(next));
  collections.delete(entity);
}

export function updateDocument(entity: string, id: string, patchJson: string): void {
  const current = readDocument(entity, id);
  if (!current) throw new Error(`Cannot update missing ${entity} document: ${id}`);
  const patch = JSON.parse(patchJson) as Record<string, unknown>;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    throw new Error('invalid document patch');
  saveDocument(entity, id, JSON.stringify({ ...current, ...patch }));
}

export function deleteDocument(entity: string, id: string): void {
  saveDocument(entity, id, null);
}

function assertProtectedChanges(rows: BulkRow[]): void {
  const incoming = new Map(rows.map(row => [row.entity, parseStore(row.json, row.entity)]));
  const protectedAppendOnly = new Set([
    'reportVersions',
    'payments',
    'referralPayouts',
    'auditEvents',
  ]);
  for (const entity of protectedAppendOnly) {
    if (!incoming.has(entity)) continue;
    const current = readCollection(entity);
    const next = incoming.get(entity);
    for (const [id, value] of Object.entries(current)) {
      if (!next || !(id in next)) throw new Error(`${entity} entries cannot be deleted`);
      if (next[id] && JSON.stringify(next[id]) !== JSON.stringify(value))
        throw new Error(`${entity} entries are append-only`);
    }
  }
  if (incoming.has('samples')) {
    const current = readCollection('samples');
    const next = incoming.get('samples');
    for (const id of Object.keys(current)) {
      if (!next || !(id in next))
        throw new Error('sample records and custody history cannot be deleted');
    }
  }
  if (incoming.has('invoices')) {
    const currentInvoices = readCollection('invoices');
    const nextInvoices = incoming.get('invoices');
    for (const id of Object.keys(currentInvoices)) {
      if (!nextInvoices || !(id in nextInvoices)) throw new Error('invoices cannot be deleted');
    }
  }
  if (!incoming.has('reports')) return;
  const currentReports = readCollection('reports');
  const nextReports = incoming.get('reports');
  const versions = new Map(Object.entries(readCollection('reportVersions')));
  for (const [id, value] of Object.entries(incoming.get('reportVersions') ?? {}))
    versions.set(id, value);
  for (const [id, current] of Object.entries(currentReports)) {
    if (!nextReports || !(id in nextReports)) throw new Error('issued reports cannot be deleted');
    if (current.status !== 'final' || JSON.stringify(nextReports[id]) === JSON.stringify(current))
      continue;
    const next = nextReports[id];
    const priorVersionId = `${id}__v${String(current.version ?? 1)}`;
    if (
      next.status !== 'final' ||
      Number(next.version) <= Number(current.version) ||
      !String(next.amendReason ?? '').trim() ||
      !versions.has(priorVersionId)
    ) {
      throw new Error('issued reports require an amendment and retained prior version');
    }
  }
}

/** Diff the incoming collection and persist only added/changed/deleted documents. */
export function saveEntity(entity: string, json: string): void {
  const row = { entity, json };
  assertProtectedChanges([row]);
  applyOps(changesFor(entity, parseStore(json, entity)));
}

/** Apply all collection diffs in one SQLite transaction. */
export function saveEntitiesBulk(rows: BulkRow[]): void {
  assertProtectedChanges(rows);
  const ops = rows.flatMap(row => changesFor(row.entity, parseStore(row.json, row.entity)));
  applyOps(ops);
}

export function clearEntities(): void {
  if (!db) throw new Error('database opened late');
  db.exec('PRAGMA secure_delete=ON;');
  const erase = db.transaction(() => {
    db!.exec('DELETE FROM documents;');
  });
  erase();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
  collections.clear();
}

export async function eraseDatabase(): Promise<void> {
  if (!db) await openDatabase();
  clearEntities();
  db?.close();
  db = null;
  opening = null;
  await deleteSecret(KEY_ACCOUNT);
}
