/**
 * SQLCipher-backed {@link DataRepository} — the on-device store for the APK.
 *
 * Model: a generic *document store*. Each collection is one table with an
 * `id` primary key and a `data` column holding the JSON document. That keeps
 * the SQL trivial and lets the existing Zod readers in `lib/models.ts` parse
 * rows exactly as they parsed Firestore snapshots. Filtering/sorting/paging
 * happen in JS (`data/query.ts`) — fine for a single-device lab store, and it
 * means the SQLite and web adapters share one query implementation.
 *
 * Encryption: the database is opened with `encrypted = true, mode = "secret"`,
 * which makes SQLCipher use the passphrase held in the plugin's secure store.
 * (The `"encryption"` mode is a one-time migration that re-encrypts an existing
 * plaintext file — using it on every open would fail on an already-encrypted
 * DB.) On the very first run we generate a random passphrase and
 * hand it to the plugin's secure store via `setEncryptionSecret`; the plugin
 * persists it (Keystore/Keychain-backed) and reuses it automatically after
 * that, so the key never lives in our code or in plaintext prefs.
 */
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { DataRepository, EntityName, ListOptions, LocalDoc, WhereFilter } from './types';
import { applyQuery, generateId, makeDoc } from './query';

const DB_NAME = 'pathlab';
const DB_VERSION = 1;

/** Fixed union of table names — safe to interpolate into DDL. */
const ENTITIES: EntityName[] = [
  'users',
  'patients',
  'doctors',
  'reports',
  'reportNotes',
  'invoices',
  'labSettings',
  'notificationState',
  'meta',
];

const SCHEMA = ENTITIES.map(
  table => `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL);`,
).join('\n');

type Row = { id: string; data: string };

function toDoc(row: Row): LocalDoc {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return makeDoc(row.id, parsed);
}

export class SqliteRepository implements DataRepository {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db: SQLiteDBConnection | null = null;
  private initPromise: Promise<void> | null = null;
  private listeners = new Map<EntityName, Set<(docs: LocalDoc[]) => void>>();

  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.bootstrap();
    return this.initPromise;
  }

  private async bootstrap(): Promise<void> {
    // Ensure an encryption secret exists before opening an encrypted DB.
    const stored = await this.sqlite.isSecretStored();
    if (!stored.result) {
      await this.sqlite.setEncryptionSecret(`${generateId()}${generateId()}`);
    }

    const isConn = (await this.sqlite.isConnection(DB_NAME, false)).result;
    this.db = isConn
      ? await this.sqlite.retrieveConnection(DB_NAME, false)
      : await this.sqlite.createConnection(DB_NAME, true, 'secret', DB_VERSION, false);

    await this.db.open();
    await this.db.execute(SCHEMA);
  }

  private conn(): SQLiteDBConnection {
    if (!this.db) throw new Error('SqliteRepository used before init()');
    return this.db;
  }

  private async rows(entity: EntityName, where?: string, params?: unknown[]): Promise<Row[]> {
    const sql = `SELECT id, data FROM ${entity}${where ? ` WHERE ${where}` : ''};`;
    const res = await this.conn().query(sql, params ?? []);
    return (res.values ?? []) as Row[];
  }

  async list(entity: EntityName, options: ListOptions = {}): Promise<LocalDoc[]> {
    await this.init();
    const docs = (await this.rows(entity)).map(toDoc);
    return applyQuery(docs, options);
  }

  async get(entity: EntityName, id: string): Promise<LocalDoc | null> {
    await this.init();
    const found = await this.rows(entity, 'id = ?', [id]);
    return found.length > 0 ? toDoc(found[0]) : null;
  }

  async set(entity: EntityName, id: string, value: Record<string, unknown>): Promise<void> {
    await this.init();
    await this.conn().run(
      `INSERT INTO ${entity} (id, data) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data;`,
      [id, JSON.stringify(value)],
    );
    await this.emit(entity);
  }

  async add(entity: EntityName, value: Record<string, unknown>): Promise<string> {
    const id = (value.id as string) || generateId();
    await this.set(entity, id, value);
    return id;
  }

  async update(entity: EntityName, id: string, patch: Record<string, unknown>): Promise<void> {
    const existing = await this.get(entity, id);
    const merged = { ...(existing ? existing.data() : {}), ...patch };
    await this.set(entity, id, merged);
  }

  async delete(entity: EntityName, id: string): Promise<void> {
    await this.init();
    await this.conn().run(`DELETE FROM ${entity} WHERE id = ?;`, [id]);
    await this.emit(entity);
  }

  async count(entity: EntityName, where?: WhereFilter[]): Promise<number> {
    const docs = await this.list(entity, { where });
    return docs.length;
  }

  subscribe(entity: EntityName, cb: (docs: LocalDoc[]) => void): () => void {
    let set = this.listeners.get(entity);
    if (!set) {
      set = new Set();
      this.listeners.set(entity, set);
    }
    set.add(cb);
    // Emit the current state immediately so callers render without waiting.
    void this.list(entity)
      .then(cb)
      .catch(() => cb([]));
    return () => {
      set?.delete(cb);
    };
  }

  private async emit(entity: EntityName): Promise<void> {
    const set = this.listeners.get(entity);
    if (!set || set.size === 0) return;
    const docs = await this.list(entity);
    set.forEach(cb => cb(docs));
  }

  async transaction(fn: (tx: DataRepository) => Promise<void>): Promise<void> {
    await this.init();
    // Individual statements auto-commit; the report path no longer spans
    // multiple collections (QR/mirror/invoice writes were removed), so a
    // sequential best-effort transaction is sufficient here.
    await fn(this);
  }

  async clearAll(): Promise<void> {
    await this.init();
    for (const entity of ENTITIES) {
      await this.conn().run(`DELETE FROM ${entity};`);
      await this.emit(entity);
    }
  }
}
