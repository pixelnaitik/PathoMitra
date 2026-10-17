/**
 * SQLCipher-backed {@link DataRepository} — the on-device store for the APK.
 *
 * Model: a generic *document store*. Each collection is one table with an
 * `id` primary key and a `data` column holding the JSON document. That keeps
 * the SQL trivial and lets the existing Zod readers in `lib/models.ts` parse
 * rows exactly as they parsed Firestore snapshots. Filtering/sorting/paging
 * happen in JS (`data/query.ts`) — fine for a single-device lab store, and it
 * means the SQLite and web adapters share one query implementation. Counts go
 * to SQL, because a count is the one thing that must not materialise the table.
 *
 * Encryption: the database is opened with `encrypted = true, mode = "secret"`,
 * which makes SQLCipher use the passphrase held in the plugin's secure store.
 * (The `"encryption"` mode is a one-time migration that re-encrypts an existing
 * plaintext file — using it on every open would fail on an already-encrypted
 * DB.) On the very first run we generate a random passphrase and
 * hand it to the plugin's secure store via `setEncryptionSecret`; the plugin
 * persists it (Keystore/Keychain-backed) and reuses it automatically after
 * that, so the key never lives in our code or in plaintext prefs.
 *
 * Concurrency: every mutation runs on one chain, and `transaction()` holds that
 * chain for its whole body. Without the chain, `update()` was a read-copy-write
 * that two callers could interleave — the slower one wrote the pre-mutation
 * document back and the faster one's change vanished. This is the same lost
 * update that was fixed on the desktop adapter in the 2.6.0 audit; the native
 * adapter is the one most labs actually run.
 */
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { DataRepository, EntityName, ListOptions, LocalDoc, WhereFilter } from './types';
import { applyQuery, generateId, generateSecret, makeDoc } from './query';

const DB_NAME = 'pathlab';
const DB_VERSION = 1;

/** Fixed union of table names — safe to interpolate into DDL. */
const ENTITIES: EntityName[] = [
  'users',
  'patients',
  'doctors',
  'reports',
  'reportNotes',
  'reportVersions',
  'invoices',
  'labSettings',
  'notificationState',
  'meta',
];

const SCHEMA = ENTITIES.map(
  table => `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL);`,
).join('\n');

type Row = { id: string; data: string };
type Subscriber = (docs: LocalDoc[]) => void;

function toDoc(row: Row): LocalDoc {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return makeDoc(row.id, parsed);
}

/** JSON path for a document field, with anything but an identifier removed. */
function jsonPath(field: string): string {
  return `$."${field.replace(/[^A-Za-z0-9_]/g, '')}"`;
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * SQL translation of the in-memory filter set, for `count()` only.
 *
 * Counting does not need the documents, and reading them to length an array
 * turned every Overview refresh into a full-table parse of a lab's whole
 * history. When a filter cannot be expressed here — a non-identifier field, an
 * unknown operator, a nested value — the caller falls back to the JS path, so
 * the answer is always the one `applyQuery` would have given.
 */
function buildCountQuery(
  entity: EntityName,
  where?: WhereFilter[],
): { sql: string; params: unknown[] } | null {
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const filter of where ?? []) {
    const field = jsonPath(filter.field);
    if (!field.startsWith('$."') || field === '$.""') return null;
    const extract = `json_extract(data, '${field}')`;

    switch (filter.op) {
      case '==':
      case '!=':
      case '<':
      case '<=':
      case '>':
      case '>=': {
        if (!isScalar(filter.value)) return null;
        clauses.push(`${extract} ${filter.op} ?`);
        params.push(filter.value);
        break;
      }
      case 'contains': {
        if (typeof filter.value !== 'string') return null;
        clauses.push(`LOWER(${extract}) LIKE '%' || LOWER(?) || '%'`);
        params.push(filter.value);
        break;
      }
      case 'in': {
        if (!Array.isArray(filter.value) || filter.value.length === 0) return null;
        if (!filter.value.every(isScalar)) return null;
        clauses.push(`${extract} IN (${filter.value.map(() => '?').join(', ')})`);
        params.push(...filter.value);
        break;
      }
      case 'array-contains': {
        if (!isScalar(filter.value)) return null;
        clauses.push(`EXISTS (SELECT 1 FROM json_each(${extract}) WHERE value = ?)`);
        params.push(filter.value);
        break;
      }
      default:
        return null;
    }
  }

  const whereSql = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  return { sql: `SELECT COUNT(*) AS n FROM ${entity}${whereSql};`, params };
}

export class SqliteRepository implements DataRepository {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db: SQLiteDBConnection | null = null;
  private initPromise: Promise<void> | null = null;
  private listeners = new Map<EntityName, Set<Subscriber>>();
  private failures = new Map<EntityName, Set<(error: unknown) => void>>();
  /** Tail of the mutation chain — see `enqueue`. */
  private chain: Promise<void> = Promise.resolve();
  /** True while a transaction owns the chain and suppresses listener traffic. */
  private inTransaction = false;
  private touched = new Set<EntityName>();

  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.bootstrap();
    return this.initPromise;
  }

  /**
   * A failed bootstrap is not cached.
   *
   * The desktop adapter learned this the hard way: caching a rejected open meant
   * every later database call reused the same rejected promise, so the app was
   * permanently dead even after the thing that broke was fixed. Dropping the
   * cached promise keeps a retry possible.
   */
  private async bootstrap(): Promise<void> {
    // Ensure an encryption secret exists before opening an encrypted DB.
    const stored = await this.sqlite.isSecretStored();
    if (!stored.result) {
      // `generateSecret`, not `generateId`: this string is the SQLCipher passphrase
      // for every patient record on the device, and generateId has a `Math.random`
      // fallback for platforms with no Web Crypto. 32 bytes = 256 bits, hex encoded.
      await this.sqlite.setEncryptionSecret(generateSecret(32));
    }

    const isConn = (await this.sqlite.isConnection(DB_NAME, false)).result;
    this.db = isConn
      ? await this.sqlite.retrieveConnection(DB_NAME, false)
      : await this.sqlite.createConnection(DB_NAME, true, 'secret', DB_VERSION, false);

    try {
      await this.db.open();
    } catch (error) {
      this.db = null;
      // The lab's records have not been lost — the key cannot open the file.
      // Saying so is the difference between "restore from backup" and "the app
      // deleted my lab", and the original error stays attached for diagnostics.
      throw new Error(
        'The encrypted clinical database could not be opened on this device. ' +
          'Your records have not been removed — open Settings → Data & Diagnostics and restore from a backup.',
        { cause: error },
      );
    }
    await this.db.execute(SCHEMA);
  }

  private conn(): SQLiteDBConnection {
    if (!this.db) throw new Error('SqliteRepository used before init()');
    return this.db;
  }

  /**
   * Run `task` after every mutation already queued.
   *
   * Inside a transaction the chain is already held by the transaction body, so
   * its own statements run straight away — re-queueing them would wait on the
   * very task executing them. Nothing can tell a call made by that body from a
   * call that arrived from elsewhere while the transaction was open, so a
   * concurrent writer is folded into the open transaction too: it lands or is
   * rolled back with it. That is the honest contract of one connection; what it
   * must never do is try to BEGIN a second transaction (see `transaction`).
   * Failures do not poison the chain.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.inTransaction) return task();
    const run = this.chain.then(task, task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
    await this.enqueue(() => this.applySet(entity, id, value));
  }

  /** The write itself, with no queueing — used by both `set` and transactions. */
  private async applySet(
    entity: EntityName,
    id: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    // `transaction = false`: the native plugin wraps a `run()` in its own
    // BEGIN/COMMIT whenever the third argument is left at its `true` default.
    // Inside `transaction()` the connection is already inside a BEGIN, so that
    // second BEGIN throws "Already in transaction" — and the failed run's own
    // rollback then ends the OUTER transaction, discarding the batch in flight.
    // This was the "Could not issue the report / Run: Failed in beginTransaction"
    // failure. A single statement is already atomic in autocommit; multi-statement
    // atomicity is `transaction()`'s job, and it owns the native BEGIN.
    await this.conn().run(
      `INSERT INTO ${entity} (id, data) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data;`,
      [id, JSON.stringify(value)],
      false,
    );
    await this.emit(entity);
  }

  async add(entity: EntityName, value: Record<string, unknown>): Promise<string> {
    const id = (value.id as string) || generateId();
    await this.set(entity, id, value);
    return id;
  }

  async update(entity: EntityName, id: string, patch: Record<string, unknown>): Promise<void> {
    await this.init();
    // Read and write together, on the same link of the chain: splitting them is
    // what let a concurrent write to the same document disappear.
    await this.enqueue(async () => {
      const found = await this.rows(entity, 'id = ?', [id]);
      const existing = found.length > 0 ? toDoc(found[0]).data() : {};
      await this.applySet(entity, id, { ...existing, ...patch });
    });
  }

  async delete(entity: EntityName, id: string): Promise<void> {
    await this.init();
    await this.enqueue(async () => {
      // See `applySet`: never let the plugin open a nested transaction here.
      await this.conn().run(`DELETE FROM ${entity} WHERE id = ?;`, [id], false);
      await this.emit(entity);
    });
  }

  async count(entity: EntityName, where?: WhereFilter[]): Promise<number> {
    await this.init();
    const translated = buildCountQuery(entity, where);
    if (translated) {
      try {
        const res = await this.conn().query(translated.sql, translated.params);
        const first = (res.values ?? [])[0] as { n?: number | string } | undefined;
        const value = Number(first?.n);
        if (Number.isFinite(value)) return value;
      } catch (error) {
        // Older SQLCipher builds can ship without the JSON functions. The answer
        // must not depend on that, so fall through to the in-memory path.
        console.warn('PathoMitra: SQL count unavailable, counting in memory', error);
      }
    }
    return (await this.list(entity, { where })).length;
  }

  subscribe(entity: EntityName, cb: Subscriber, onError?: (error: unknown) => void): () => void {
    let set = this.listeners.get(entity);
    if (!set) {
      set = new Set();
      this.listeners.set(entity, set);
    }
    set.add(cb);
    if (onError) {
      let failed = this.failures.get(entity);
      if (!failed) {
        failed = new Set();
        this.failures.set(entity, failed);
      }
      failed.add(onError);
    }
    // Emit the current state immediately so callers render without waiting.
    // A failure is reported twice on purpose: once to `onError` (so the page can
    // say "these records could not be read") and once as an empty replay (so no
    // screen can hang in "loading" forever). Empty is never presented as truth.
    void this.list(entity)
      .then(cb)
      .catch(error => {
        if (onError) onError(error);
        cb([]);
      });
    return () => {
      set?.delete(cb);
      if (onError) this.failures.get(entity)?.delete(onError);
    };
  }

  private reportFailure(entity: EntityName, error: unknown): void {
    this.failures.get(entity)?.forEach(cb => cb(error));
  }

  private async emit(entity: EntityName): Promise<void> {
    // Inside a transaction, listeners hear nothing until the outcome is known —
    // a rollback must not leave a UI showing rows that no longer exist.
    if (this.inTransaction) {
      this.touched.add(entity);
      return;
    }
    const set = this.listeners.get(entity);
    if (!set || set.size === 0) return;
    try {
      const docs = await this.list(entity);
      set.forEach(cb => cb(docs));
    } catch (error) {
      this.reportFailure(entity, error);
    }
  }

  /**
   * BEGIN on a connection that is not already inside a transaction.
   *
   * The native connection outlives the JavaScript context: when Android
   * recreates the activity while a batch is open, the plugin keeps its database
   * object — transaction and all — while the rebuilt app believes nothing is
   * running. Every BEGIN after that failed with "Already in transaction" and the
   * lab could not save a single document until the process was killed. Clear the
   * abandoned transaction and retry once rather than staying dead.
   */
  private async startNativeTransaction(conn: SQLiteDBConnection): Promise<void> {
    try {
      await conn.beginTransaction();
      return;
    } catch (error) {
      let active: boolean;
      try {
        active = (await conn.isTransactionActive()).result ?? false;
      } catch {
        active = false;
      }
      if (!active) throw error;
      console.warn('PathoMitra: discarding a transaction left open by an earlier run', error);
      await conn.rollbackTransaction();
      await conn.beginTransaction();
    }
  }

  /**
   * One SQLCipher transaction, holding the mutation chain for its whole body.
   *
   * This is what the delete cascades were always claiming to be: a patient and
   * their reports either all go, or none of them do. Before this, a crash or a
   * kill halfway through a cascade left the lab with a patient whose reports were
   * partly gone — and the copy on screen promised otherwise.
   *
   * A call that arrives while a transaction is already open JOINS it instead of
   * starting a second one: Android's `beginTransaction()` throws
   * "Already in transaction" rather than nesting, and the failed call then ran
   * its own rollback, which ended the *other* caller's transaction and threw away
   * the writes that were in flight. Issuing a report twice in quick succession
   * therefore issued nothing at all. Joining is the same rule the desktop
   * adapter applies, and the outcome still belongs to whoever began the unit.
   */
  async transaction(fn: (tx: DataRepository) => Promise<void>): Promise<void> {
    await this.init();
    if (this.inTransaction) {
      await fn(this);
      return;
    }
    await this.enqueue(async () => {
      const conn = this.conn();
      this.inTransaction = true;
      this.touched = new Set();
      let committed = false;
      try {
        await this.startNativeTransaction(conn);
        await fn(this);
        await conn.commitTransaction();
        committed = true;
      } catch (error) {
        try {
          if ((await conn.isTransactionActive()).result) await conn.rollbackTransaction();
        } catch (rollbackError) {
          console.error('PathoMitra: rollback failed', rollbackError);
        }
        throw error;
      } finally {
        const entities = [...this.touched];
        this.inTransaction = false;
        this.touched = new Set();
        // Notify whatever the outcome — after a commit the rows are the new ones,
        // after a rollback the listeners must drop the rows that were never
        // written. Either way they re-read from the database.
        for (const entity of entities) await this.emit(entity);
        if (!committed) {
          for (const entity of ENTITIES) await this.emit(entity);
        }
      }
    });
  }

  async clearAll(): Promise<void> {
    await this.init();
    for (const entity of ENTITIES) {
      await this.enqueue(async () => {
        // `transaction = false` for the same reason as `applySet`, and because
        // `VACUUM` below cannot run inside a transaction at all.
        await this.conn().run(`DELETE FROM ${entity};`, [], false);
        await this.emit(entity);
      });
    }
    // "Erase everything" is a promise about the bytes, not just the rows: DELETE
    // leaves the pages in the file, so the clinical documents a lab believes it
    // destroyed stay recoverable from the database file until it is rebuilt.
    try {
      await this.conn().run('VACUUM;', [], false);
    } catch (error) {
      console.error('PathoMitra: could not compact the database after erasing', error);
    }
  }
}
