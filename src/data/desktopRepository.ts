/**
 * Electron-backed {@link DataRepository} — the desktop counterpart of the
 * APK's `SqliteRepository`.
 *
 * Query semantics are identical to {@link WebRepository} on purpose: the same
 * `applyQuery`/`makeDoc` helpers run in the renderer, so a filter or an
 * `orderBy` can never disagree between platforms — only *where the JSON
 * lives* changes. Reads are served from a renderer-side cache; every mutation
 * writes the collection back through the IPC bridge, where the main process
 * stores it in the SQLCipher file (`electron/db.ts`, key in Windows Credential
 * Manager). The renderer never sees the key or the raw file.
 *
 * v1 granularity is one row per collection (see electron/db.ts). If a lab's
 * report count ever makes whole-collection JSON writes heavy, the upgrade is
 * row-level statements in the main process — the DataRepository contract here
 * does not change.
 */
import { desktopBridge, type DesktopBridge } from '../lib/desktop-bridge';
import type { DataRepository, EntityName, ListOptions, LocalDoc, WhereFilter } from './types';
import { applyQuery, generateId, makeDoc } from './query';

type Store = Record<string, Record<string, unknown>>;

const ALL_ENTITIES: EntityName[] = [
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

export class DesktopRepository implements DataRepository {
  private bridge: DesktopBridge;
  private memory = new Map<EntityName, Promise<Store>>();
  private listeners = new Map<EntityName, Set<(docs: LocalDoc[]) => void>>();
  private ready: Promise<void> | null = null;
  /** Tail of the per-entity mutation chain (see `queue`). */
  private queues = new Map<EntityName, Promise<void>>();
  /** Error callbacks registered alongside listeners (see `subscribe`). */
  private failures = new Map<EntityName, Set<(error: unknown) => void>>();

  constructor() {
    const bridge = desktopBridge();
    if (!bridge) throw new Error('DesktopRepository requires the Electron bridge');
    this.bridge = bridge;
  }

  init(): Promise<void> {
    if (!this.ready) this.ready = this.bridge.db.init();
    return this.ready;
  }

  /**
   * The collection's store, loaded once and cached for the session.
   *
   * A failed load is NOT cached as an empty store: the next mutation would
   * then persist `{}` + its own document over the collection and silently
   * destroy everything else in it. Dropping the cache entry on failure keeps
   * the error honest for the caller and lets a later call retry the read.
   */
  private store(entity: EntityName): Promise<Store> {
    let cached = this.memory.get(entity);
    if (!cached) {
      cached = this.bridge.db.load(entity).then(raw => (raw ? (JSON.parse(raw) as Store) : {}));
      cached = cached.catch((err: unknown) => {
        if (this.memory.get(entity) === cached) this.memory.delete(entity);
        throw err;
      });
      this.memory.set(entity, cached);
    }
    return cached;
  }

  private async persist(entity: EntityName, store: Store): Promise<void> {
    this.memory.set(entity, Promise.resolve(store));
    await this.bridge.db.save(entity, JSON.stringify(store));
  }

  /**
   * Run one mutation for `entity` after every mutation already queued for it.
   *
   * Whole-collection writes are read-copy-persist; two that interleave (a
   * report save racing a note write) would each copy the pre-mutation store
   * and the slower one would roll the faster one's document back out of the
   * database. Chaining per entity makes the read and its write atomic
   * against sibling mutations, and failures do not poison the chain.
   */
  private queue<T>(entity: EntityName, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(entity) ?? Promise.resolve();
    const run = prev.then(task, task);
    this.queues.set(
      entity,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async toDocs(entity: EntityName): Promise<LocalDoc[]> {
    const store = await this.store(entity);
    return Object.keys(store).map(id => makeDoc(id, store[id]));
  }

  async list(entity: EntityName, options: ListOptions = {}): Promise<LocalDoc[]> {
    return applyQuery(await this.toDocs(entity), options);
  }

  async get(entity: EntityName, id: string): Promise<LocalDoc | null> {
    const store = await this.store(entity);
    return store[id] ? makeDoc(id, store[id]) : null;
  }

  async set(entity: EntityName, id: string, value: Record<string, unknown>): Promise<void> {
    await this.queue(entity, async () => {
      const store = { ...(await this.store(entity)) };
      store[id] = value;
      await this.persist(entity, store);
      await this.emit(entity);
    });
  }

  async add(entity: EntityName, value: Record<string, unknown>): Promise<string> {
    const id = (value.id as string) || generateId();
    await this.set(entity, id, value);
    return id;
  }

  async update(entity: EntityName, id: string, patch: Record<string, unknown>): Promise<void> {
    await this.queue(entity, async () => {
      const store = { ...(await this.store(entity)) };
      store[id] = { ...(store[id] ?? {}), ...patch };
      await this.persist(entity, store);
      await this.emit(entity);
    });
  }

  async delete(entity: EntityName, id: string): Promise<void> {
    await this.queue(entity, async () => {
      const store = { ...(await this.store(entity)) };
      delete store[id];
      await this.persist(entity, store);
      await this.emit(entity);
    });
  }

  async count(entity: EntityName, where?: WhereFilter[]): Promise<number> {
    return applyQuery(await this.toDocs(entity), { where }).length;
  }

  /**
   * Like the other two repositories, listeners fire after local mutations —
   * but the initial replay is async because the first read hits the main
   * process. Unsubscribe stays synchronous, matching Firestore's contract.
   */
  subscribe(
    entity: EntityName,
    cb: (docs: LocalDoc[]) => void,
    onError?: (error: unknown) => void,
  ): () => void {
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
    // The first read is async — drop the replay if the caller already
    // unsubscribed (component gone). A failed first read replays an empty list
    // *and* reports the error: the UI must never hang in "loading", but an empty
    // list must never be presented as "the lab has no records" either.
    void this.toDocs(entity)
      .then(docs => {
        if (set?.has(cb)) cb(docs);
      })
      .catch(error => {
        if (set?.has(cb)) {
          onError?.(error);
          cb([]);
        }
      });
    return () => {
      set?.delete(cb);
      if (onError) this.failures.get(entity)?.delete(onError);
    };
  }

  private async emit(entity: EntityName): Promise<void> {
    const set = this.listeners.get(entity);
    if (!set || set.size === 0) return;
    try {
      const docs = await this.toDocs(entity);
      set.forEach(cb => cb(docs));
    } catch (error) {
      this.failures.get(entity)?.forEach(cb => cb(error));
    }
  }

  /**
   * Sequential execution against this repository, matching WebRepository's
   * honesty: SQLite atomicity arrives with the row-level main-process API;
   * callers (the report save path) already tolerate replay between steps.
   */
  async transaction(fn: (tx: DataRepository) => Promise<void>): Promise<void> {
    await fn(this);
  }

  /** Resolve when every mutation queued for `entity` has settled. */
  private drain(entity: EntityName): Promise<void> {
    return (this.queues.get(entity) ?? Promise.resolve()).then(
      () => undefined,
      () => undefined,
    );
  }

  /**
   * Drop every collection — "erase all data". Queued mutations are drained
   * first: a write still in the chain must not re-persist its stale store
   * (from the memory cache) after the database rows are gone.
   */
  async clearAll(): Promise<void> {
    await Promise.all(ALL_ENTITIES.map(entity => this.drain(entity)));
    await this.bridge.db.clear();
    for (const entity of ALL_ENTITIES) {
      await this.queue(entity, async () => {
        await this.persist(entity, {});
        await this.emit(entity);
      });
    }
  }
}
