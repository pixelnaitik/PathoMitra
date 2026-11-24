/** SQLCipher database with transactional migration from collection JSON to row-level documents. */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { deleteSecret, getSecret, setSecret } from './keyring';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3-multiple-ciphers');
const SCHEMA_VERSION = 2;
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
    opening.catch(() => { if (opening) opening = null; });
  }
  return opening;
}

function parseStore(raw: string, entity: string): Store {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`invalid stored collection: ${entity}`);
  return parsed as Store;
}

function insertDocument(entity: string, id: string, json: string): void {
  db!.prepare('INSERT INTO documents (entity, id, data) VALUES (?, ?, ?) ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data').run(entity, id, json);
}

/** Copy legacy whole-collection rows once, then drop the plaintext-shaped duplicate table. */
function migrateLegacyCollections(): void {
  if (!db) return;
  const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entities'").get();
  if (!legacy) return;
  const rows = db.prepare('SELECT name, json FROM entities').all();
  const apply = db.transaction(() => {
    for (const row of rows) {
      const entity = String(row.name);
      const store = parseStore(String(row.json), entity);
      for (const [id, value] of Object.entries(store)) insertDocument(entity, id, JSON.stringify(value));
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
    handle.exec('CREATE TABLE IF NOT EXISTS documents (entity TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (entity, id))');
    db = handle;
    const version = Number(handle.pragma('user_version')) || 0;
    if (version > SCHEMA_VERSION) throw new Error('This database was created by a newer PathoMitra version.');
    migrateLegacyCollections();
    handle.pragma(`user_version=${SCHEMA_VERSION}`);
    handle.pragma('foreign_keys=ON');
  } catch (error) {
    try { handle.close(); } catch { /* preserve the useful failure */ }
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
  const upsert = db.prepare('INSERT INTO documents (entity, id, data) VALUES (?, ?, ?) ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data');
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

/** Diff the incoming collection and persist only added/changed/deleted documents. */
export function saveEntity(entity: string, json: string): void {
  applyOps(changesFor(entity, parseStore(json, entity)));
}

/** Apply all collection diffs in one SQLite transaction. */
export function saveEntitiesBulk(rows: BulkRow[]): void {
  const ops = rows.flatMap(row => changesFor(row.entity, parseStore(row.json, row.entity)));
  applyOps(ops);
}

export function clearEntities(): void {
  if (!db) throw new Error('database opened late');
  db.exec('PRAGMA secure_delete=ON; DELETE FROM documents; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
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
