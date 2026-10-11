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

  constructor() {
    const bridge = desktopBridge();
    if (!bridge) throw new Error('DesktopRepository requires the Electron bridge');
    this.bridge = bridge;
  }

  init(): Promise<void> {
    if (!this.ready) this.ready = this.bridge.db.init();
    return this.ready;
  }

  /** The collection's store, loaded once and cached for the session. */
  private store(entity: EntityName): Promise<Store> {
    let cached = this.memory.get(entity);
    if (!cached) {
      cached = this.bridge.db
        .load(entity)
        .then(raw => (raw ? (JSON.parse(raw) as Store) : {}))
        .catch(() => ({}));
      this.memory.set(entity, cached);
    }
    return cached;
  }

  private async persist(entity: EntityName, store: Store): Promise<void> {
    this.memory.set(entity, Promise.resolve(store));
    await this.bridge.db.save(entity, JSON.stringify(store));
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
    const store = { ...(await this.store(entity)) };
    store[id] = value;
    await this.persist(entity, store);
    await this.emit(entity);
  }

  async add(entity: EntityName, value: Record<string, unknown>): Promise<string> {
    const id = (value.id as string) || generateId();
    await this.set(entity, id, value);
    return id;
  }

  async update(entity: EntityName, id: string, patch: Record<string, unknown>): Promise<void> {
    const store = { ...(await this.store(entity)) };
    store[id] = { ...(store[id] ?? {}), ...patch };
    await this.persist(entity, store);
    await this.emit(entity);
  }

  async delete(entity: EntityName, id: string): Promise<void> {
    const store = { ...(await this.store(entity)) };
    delete store[id];
    await this.persist(entity, store);
    await this.emit(entity);
  }

  async count(entity: EntityName, where?: WhereFilter[]): Promise<number> {
    return applyQuery(await this.toDocs(entity), { where }).length;
  }

  /**
   * Like the other two repositories, listeners fire after local mutations —
   * but the initial replay is async because the first read hits the main
   * process. Unsubscribe stays synchronous, matching Firestore's contract.
   */
  subscribe(entity: EntityName, cb: (docs: LocalDoc[]) => void): () => void {
    let set = this.listeners.get(entity);
    if (!set) {
      set = new Set();
      this.listeners.set(entity, set);
    }
    set.add(cb);
    void this.toDocs(entity).then(docs => cb(docs));
    return () => {
      set?.delete(cb);
    };
  }

  private async emit(entity: EntityName): Promise<void> {
    const set = this.listeners.get(entity);
    if (!set || set.size === 0) return;
    const docs = await this.toDocs(entity);
    set.forEach(cb => cb(docs));
  }

  /**
   * Sequential execution against this repository, matching WebRepository's
   * honesty: SQLite atomicity arrives with the row-level main-process API;
   * callers (the report save path) already tolerate replay between steps.
   */
  async transaction(fn: (tx: DataRepository) => Promise<void>): Promise<void> {
    await fn(this);
  }

  async clearAll(): Promise<void> {
    await this.bridge.db.clear();
    for (const entity of ALL_ENTITIES) {
      await this.persist(entity, {});
      await this.emit(entity);
    }
  }
}
