/**
 * SQLCipher-backed {@link DataRepository} — the on-device store for the APK.
 *
 * Model: a generic *document store*. Each collection is one table with an
 * `id` primary key and a `data` column holding the JSON document. That keeps
 * the SQL trivial and lets the existing Zod readers in `lib/models.ts` parse
 * rows exactly as they parsed Firestore snapshots. Common filters, ordering and
 * paging are translated to indexed SQL; unsupported expressions retain the
 * shared in-memory fallback. Counts never materialise the table.
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
import type {
  DataRepository,
  EntityName,
  ListOptions,
  LocalDoc,
  RepositoryPrincipal,
  WhereFilter,
} from './types';
import { applyQuery, generateId, generateSecret, makeDoc } from './query';
import { buildSqlQuery, buildWhereSql } from './sql-query';
import { ENTITY_NAMES } from './entities';
import { nativeReportSigning } from '../lib/report-signing-native';
import { canonicalReportManifest } from '../lib/report-manifest';
import { captureError } from '../lib/telemetry';
import type { ReportRecord } from '../lib/models';

const DB_NAME = 'pathlab';
const DB_VERSION = 5;
const MAX_LIST_LIMIT = 10_000;

/** Fixed union of table names — safe to interpolate into DDL. */
const ENTITIES: readonly EntityName[] = ENTITY_NAMES;

export const SQLITE_UPGRADES = [
  {
    fromVersion: 3,
    toVersion: 4,
    statements: [
      'DROP TRIGGER IF EXISTS reports_final_insert_guard;',
      'DROP TRIGGER IF EXISTS reports_final_update_guard;',
      'DROP TRIGGER IF EXISTS reports_final_delete_guard;',
      'DROP TRIGGER IF EXISTS report_versions_delete_guard;',
      'DROP TRIGGER IF EXISTS payments_delete_guard;',
      'DROP TRIGGER IF EXISTS referral_payouts_delete_guard;',
      'DROP TRIGGER IF EXISTS invoices_delete_guard;',
      'DROP TRIGGER IF EXISTS audit_events_delete_guard;',
      'DROP TRIGGER IF EXISTS report_versions_update_guard;',
      'DROP TRIGGER IF EXISTS payments_update_guard;',
      'DROP TRIGGER IF EXISTS referral_payouts_update_guard;',
      'DROP TRIGGER IF EXISTS samples_delete_guard;',
    ],
  },
  {
    fromVersion: 2,
    toVersion: 3,
    statements: [
      "CREATE INDEX IF NOT EXISTS idx_patients_createdAt ON patients(json_extract(data, '$.createdAt'));",
      "CREATE INDEX IF NOT EXISTS idx_reports_patientId ON reports(json_extract(data, '$.patientId'));",
      "CREATE INDEX IF NOT EXISTS idx_orders_patientId ON orders(json_extract(data, '$.patientId'));",
      "CREATE INDEX IF NOT EXISTS idx_samples_orderId ON samples(json_extract(data, '$.orderId'));",
      "CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(json_extract(data, '$.status'));",
    ],
  },
];

export const SQLITE_SCHEMA = [
  ...ENTITIES.map(
    table => `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL);`,
  ),
  `CREATE TABLE IF NOT EXISTS principal_context (id INTEGER PRIMARY KEY CHECK (id = 1), uid TEXT NOT NULL, role TEXT NOT NULL, updatedAt TEXT NOT NULL);`,
  `CREATE TRIGGER IF NOT EXISTS reports_final_insert_guard
   BEFORE INSERT ON reports
   WHEN json_extract(NEW.data, '$.status') = 'final'
   BEGIN
     SELECT CASE WHEN
       COALESCE(json_extract(NEW.data, '$.patientId'), '') = '' OR
       lower(trim(COALESCE(json_extract(NEW.data, '$.patientName'), ''))) IN ('', 'unknown') OR
       json_array_length(COALESCE(json_extract(NEW.data, '$.testSelection'), '[]')) = 0 OR
       json_extract(NEW.data, '$.issuanceSnapshot') IS NULL OR
       COALESCE(json_extract(NEW.data, '$.issuanceSignature.signature'), '') = '' OR
       COALESCE(json_extract(NEW.data, '$.issuerUid'), '') = '' OR
       COALESCE(json_extract(NEW.data, '$.verification.reviewerUid'), '') = '' OR
       json_extract(NEW.data, '$.verification.reviewerUid') = json_extract(NEW.data, '$.issuerUid') OR
       (SELECT role FROM principal_context WHERE id = 1) NOT IN ('pathologist', 'admin') OR
       (SELECT uid FROM principal_context WHERE id = 1) != json_extract(NEW.data, '$.issuerUid')
     THEN RAISE(ABORT, 'invalid final report: authenticated issuance and independent verification are required') END;
   END;`,
  `CREATE TRIGGER IF NOT EXISTS reports_final_update_guard
   BEFORE UPDATE ON reports
   WHEN json_extract(OLD.data, '$.status') = 'final' AND json_extract(NEW.data, '$.status') = 'final'
   BEGIN
     SELECT CASE WHEN
       COALESCE(json_extract(NEW.data, '$.amendReason'), '') = '' OR
       json_extract(NEW.data, '$.version') <= json_extract(OLD.data, '$.version') OR
       COALESCE(json_extract(NEW.data, '$.issuerUid'), '') = '' OR
       COALESCE(json_extract(NEW.data, '$.verification.reviewerUid'), '') = '' OR
       json_extract(NEW.data, '$.verification.reviewerUid') = json_extract(NEW.data, '$.issuerUid') OR
       (SELECT role FROM principal_context WHERE id = 1) NOT IN ('pathologist', 'admin') OR
       (SELECT uid FROM principal_context WHERE id = 1) != json_extract(NEW.data, '$.issuerUid') OR
       NOT EXISTS (SELECT 1 FROM reportVersions WHERE id = NEW.id || '__v' || json_extract(OLD.data, '$.version'))
     THEN RAISE(ABORT, 'issued reports require an authenticated amendment and retained prior version') END;
   END;`,
  `CREATE TRIGGER IF NOT EXISTS reports_no_regression_guard
   BEFORE UPDATE ON reports
   WHEN json_extract(OLD.data, '$.status') = 'final' AND json_extract(NEW.data, '$.status') != 'final'
   BEGIN SELECT RAISE(ABORT, 'issued reports cannot return to draft'); END;`,
  `CREATE TRIGGER IF NOT EXISTS orders_transition_guard
   BEFORE UPDATE ON orders WHEN json_extract(OLD.data, '$.status') != json_extract(NEW.data, '$.status')
   BEGIN
     SELECT CASE WHEN NOT (
       (json_extract(OLD.data, '$.status') = 'ordered' AND json_extract(NEW.data, '$.status') IN ('collected', 'cancelled', 'amended')) OR
       (json_extract(OLD.data, '$.status') = 'collected' AND json_extract(NEW.data, '$.status') IN ('processing', 'cancelled', 'amended')) OR
       (json_extract(OLD.data, '$.status') = 'processing' AND json_extract(NEW.data, '$.status') IN ('resulted', 'cancelled', 'amended')) OR
       (json_extract(OLD.data, '$.status') = 'resulted' AND json_extract(NEW.data, '$.status') IN ('issued', 'amended')) OR
       (json_extract(OLD.data, '$.status') = 'issued' AND json_extract(NEW.data, '$.status') IN ('billed', 'amended')) OR
       (json_extract(OLD.data, '$.status') = 'billed' AND json_extract(NEW.data, '$.status') = 'amended')
     ) THEN RAISE(ABORT, 'invalid order status transition') END;
   END;`,
  `CREATE TRIGGER IF NOT EXISTS samples_transition_guard
   BEFORE UPDATE ON samples WHEN json_extract(OLD.data, '$.status') != json_extract(NEW.data, '$.status')
   BEGIN
     SELECT CASE WHEN NOT (
       (json_extract(OLD.data, '$.status') = 'expected' AND json_extract(NEW.data, '$.status') IN ('collected', 'lost')) OR
       (json_extract(OLD.data, '$.status') = 'collected' AND json_extract(NEW.data, '$.status') IN ('received', 'rejected', 'lost')) OR
       (json_extract(OLD.data, '$.status') = 'received' AND json_extract(NEW.data, '$.status') IN ('processing', 'rejected', 'lost')) OR
       (json_extract(OLD.data, '$.status') = 'processing' AND json_extract(NEW.data, '$.status') IN ('received', 'rejected', 'lost', 'disposed')) OR
       (json_extract(OLD.data, '$.status') = 'rejected' AND json_extract(NEW.data, '$.status') IN ('collected', 'disposed')) OR
       (json_extract(OLD.data, '$.status') = 'lost' AND json_extract(NEW.data, '$.status') IN ('collected', 'disposed'))
     ) THEN RAISE(ABORT, 'invalid sample status transition') END;
   END;`,
  `CREATE TRIGGER IF NOT EXISTS samples_custody_guard
   BEFORE UPDATE ON samples
   WHEN json_array_length(COALESCE(json_extract(OLD.data, '$.custody'), '[]')) >
        json_array_length(COALESCE(json_extract(NEW.data, '$.custody'), '[]'))
     OR (json_array_length(COALESCE(json_extract(OLD.data, '$.custody'), '[]')) =
         json_array_length(COALESCE(json_extract(NEW.data, '$.custody'), '[]'))
         AND json_extract(OLD.data, '$.custody') != json_extract(NEW.data, '$.custody'))
   BEGIN SELECT RAISE(ABORT, 'sample custody history is append-only'); END;`,
  `CREATE TRIGGER IF NOT EXISTS audit_events_update_guard
   BEFORE UPDATE ON auditEvents
   BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;`,
  `CREATE TRIGGER IF NOT EXISTS reports_final_delete_guard
   BEFORE DELETE ON reports WHEN json_extract(OLD.data, '$.status') = 'final'
   BEGIN SELECT RAISE(ABORT, 'issued reports cannot be deleted'); END;`,
  `CREATE TRIGGER IF NOT EXISTS report_versions_delete_guard
   BEFORE DELETE ON reportVersions
   BEGIN SELECT RAISE(ABORT, 'report versions cannot be deleted'); END;`,
  `CREATE TRIGGER IF NOT EXISTS payments_delete_guard
   BEFORE DELETE ON payments
   BEGIN SELECT RAISE(ABORT, 'payment ledger entries cannot be deleted'); END;`,
  `CREATE TRIGGER IF NOT EXISTS referral_payouts_delete_guard
   BEFORE DELETE ON referralPayouts
   BEGIN SELECT RAISE(ABORT, 'referral payout entries cannot be deleted'); END;`,
  `CREATE TRIGGER IF NOT EXISTS invoices_delete_guard
   BEFORE DELETE ON invoices
   BEGIN SELECT RAISE(ABORT, 'invoices cannot be deleted'); END;`,
  `CREATE TRIGGER IF NOT EXISTS audit_events_delete_guard
   BEFORE DELETE ON auditEvents
   BEGIN SELECT RAISE(ABORT, 'audit events cannot be deleted'); END;`,
  `CREATE TRIGGER IF NOT EXISTS report_versions_update_guard
   BEFORE UPDATE ON reportVersions
   BEGIN SELECT RAISE(ABORT, 'report versions are append-only'); END;`,
  `CREATE TRIGGER IF NOT EXISTS payments_update_guard
   BEFORE UPDATE ON payments
   BEGIN SELECT RAISE(ABORT, 'payment ledger entries are append-only'); END;`,
  `CREATE TRIGGER IF NOT EXISTS referral_payouts_update_guard
   BEFORE UPDATE ON referralPayouts
   BEGIN SELECT RAISE(ABORT, 'referral payout entries are append-only'); END;`,
  `CREATE TRIGGER IF NOT EXISTS samples_delete_guard
   BEFORE DELETE ON samples
   BEGIN SELECT RAISE(ABORT, 'sample records and custody history cannot be deleted'); END;`,
].join('\n');

type Row = { id: string; data: string };
type Subscriber = (docs: LocalDoc[]) => void;

function toDoc(row: Row): LocalDoc {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(row.data) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Corrupt stored record ${row.id}; restore from a verified backup before writing.`,
      { cause: error },
    );
  }
  return makeDoc(row.id, parsed);
}

export class SqliteRepository implements DataRepository {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db: SQLiteDBConnection | null = null;
  private initPromise: Promise<void> | null = null;
  private listeners = new Map<EntityName, Map<Subscriber, ListOptions | undefined>>();
  private failures = new Map<EntityName, Set<(error: unknown) => void>>();
  /** Tail of the mutation chain — see `enqueue`. */
  private chain: Promise<void> = Promise.resolve();
  private transactionUnitActive = false;
  /** True while a transaction owns the chain and suppresses listener traffic. */
  private inTransaction = false;
  private touched = new Set<EntityName>();

  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.bootstrap();
    return this.initPromise;
  }

  /** Trusted renderer principal used by SQL invariants for the current mutation. */
  async setPrincipal(actor: RepositoryPrincipal | null): Promise<void> {
    await this.init();
    if (!actor) {
      await this.conn().run('DELETE FROM principal_context WHERE id = 1;', [], false);
      return;
    }
    await this.conn().run(
      `INSERT INTO principal_context (id, uid, role, updatedAt) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET uid = excluded.uid, role = excluded.role, updatedAt = excluded.updatedAt;`,
      [actor.uid, actor.role, new Date().toISOString()],
      false,
    );
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

    await this.sqlite.addUpgradeStatement(DB_NAME, SQLITE_UPGRADES);
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
    await this.db.execute(SQLITE_SCHEMA);
    for (const entity of ENTITY_NAMES) {
      for (const field of ['createdAt', 'updatedAt', 'patientId', 'status', 'orderId']) {
        try {
          await this.db.execute(
            `CREATE INDEX IF NOT EXISTS idx_${entity}_${field} ON ${entity}(json_extract(data, '$.${field}'));`,
          );
        } catch {
          // Older SQLite builds without JSON1 keep the correct in-memory fallback.
        }
      }
    }
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
    if (
      options.limit !== undefined &&
      (!Number.isInteger(options.limit) || options.limit < 0 || options.limit > MAX_LIST_LIMIT)
    ) {
      throw new Error(`List limit for ${entity} must be between 0 and ${MAX_LIST_LIMIT}.`);
    }
    const translated = buildSqlQuery(entity, options);
    if (translated) {
      try {
        const result = await this.conn().query(translated.sql, translated.params);
        return (result.values ?? []).map(row => toDoc(row as Row));
      } catch (error) {
        captureError(error, { scope: 'sqlite:query-fallback', operation: 'list', entity });
      }
    }
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
    if (entity === 'reports' && value.status === 'final') {
      const signature = value.issuanceSignature as
        { signature?: string; keyId?: string; manifestHash?: string } | undefined;
      const native = nativeReportSigning();
      if (!native || !signature?.signature || !signature.keyId || !signature.manifestHash) {
        throw new Error('A final report requires a device-backed issuance signature.');
      }
      const manifest = canonicalReportManifest({ id, ...value } as unknown as ReportRecord);
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(manifest),
      );
      const hash = Array.from(new Uint8Array(digest), byte =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      if (hash !== signature.manifestHash) throw new Error('Final report manifest hash mismatch.');
      const verified = await native.verify({
        manifest,
        signature: signature.signature,
        keyId: signature.keyId,
      });
      if (!verified.valid) throw new Error('Final report signature verification failed.');
    }
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
      if (found.length === 0) throw new Error(`Cannot update missing ${entity} document: ${id}`);
      const existing = toDoc(found[0]).data();
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
    const translated = buildWhereSql(where);
    if (translated) {
      try {
        const res = await this.conn().query(
          `SELECT COUNT(*) AS n FROM ${entity}${translated.sql};`,
          translated.params,
        );
        const first = (res.values ?? [])[0] as { n?: number | string } | undefined;
        const value = Number(first?.n);
        if (Number.isFinite(value)) return value;
      } catch (error) {
        // Older SQLCipher builds can ship without the JSON functions. The answer
        // must not depend on that, so fall through to the in-memory path.
        captureError(error, { scope: 'sqlite:count-fallback', operation: 'count' });
      }
    }
    return (await this.list(entity, { where })).length;
  }

  subscribe(
    entity: EntityName,
    cb: Subscriber,
    onError?: (error: unknown) => void,
    options?: ListOptions,
  ): () => void {
    let set = this.listeners.get(entity);
    if (!set) {
      set = new Map();
      this.listeners.set(entity, set);
    }
    set.set(cb, options);
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
    void this.list(entity, options)
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
    const groups = new Map<string, { options?: ListOptions; callbacks: Subscriber[] }>();
    for (const [callback, options] of set) {
      const key = JSON.stringify(options ?? {});
      const group = groups.get(key) ?? { options, callbacks: [] };
      group.callbacks.push(callback);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      try {
        const docs = await this.list(entity, group.options);
        group.callbacks.forEach(callback => callback(docs));
      } catch (error) {
        this.reportFailure(entity, error);
      }
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
      captureError(error, { scope: 'sqlite:stale-transaction', operation: 'rollback' });
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
   * A call that arrives while another transaction unit is pending or active is
   * rejected. Android cannot nest transactions, and joining would make the second
   * caller report success even when the first caller rolls the shared unit back.
   */
  async transaction(fn: (tx: DataRepository) => Promise<void>): Promise<void> {
    if (this.transactionUnitActive || this.inTransaction) {
      throw new Error('A database transaction is already active; retry after it completes.');
    }
    this.transactionUnitActive = true;
    try {
      await this.init();
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
            captureError(rollbackError, { scope: 'sqlite:rollback', operation: 'rollback' });
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
    } finally {
      this.transactionUnitActive = false;
    }
  }

  async clearAll(): Promise<void> {
    await this.init();
    // One transaction over the tables, then the `VACUUM` outside it. Ten
    // independent deletes meant "erase everything" could half-apply — a lab that
    // believes it wiped the device left holding part of a database. The
    // statements still pass `transaction = false` for the same reason `applySet`
    // does: the plugin would nest a BEGIN and abort the whole unit.
    await this.conn().run('PRAGMA secure_delete=ON;', [], false);
    await this.transaction(async () => {
      for (const entity of ENTITIES) {
        await this.conn().run(`DELETE FROM ${entity};`, [], false);
        // A raw `run()` does not go through `delete()`, so the tables that
        // changed have to be named here — otherwise no listener learns the rows
        // are gone and every open screen keeps showing data that no longer exists.
        this.touched.add(entity);
      }
    });
    // `VACUUM` cannot run inside a transaction at all. "Erase everything" is a
    // promise about the bytes, not just the rows: DELETE leaves the pages in the
    // file, so the clinical documents a lab believes it destroyed stay
    // recoverable from the database file until it is rebuilt.
    await this.conn().run('VACUUM;', [], false);
  }
}
