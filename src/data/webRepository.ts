/** localStorage repository for browser development/tests; production clinical persistence is blocked. */
import type { DataRepository, EntityName, ListOptions, LocalDoc, WhereFilter } from './types';
import { applyQuery, generateId, makeDoc } from './query';
import { ENTITY_NAMES } from './entities';

const PREFIX = 'pathlab:';
const LOCK_NAME = 'pathlab:clinical-store';

export function clinicalPersistenceAllowed(production = import.meta.env.PROD): boolean {
  return !production;
}

type Store = Record<string, Record<string, unknown>>;

export class WebRepository implements DataRepository {
  private memory = new Map<EntityName, Store>();
  private listeners = new Map<
    EntityName,
    Map<(docs: LocalDoc[]) => void, ListOptions | undefined>
  >();
  private failures = new Map<EntityName, Set<(error: unknown) => void>>();
  private ready: Promise<void> | null = null;
  private lockDepth = 0;

  constructor(private allowPersistence = clinicalPersistenceAllowed()) {
    if (typeof window !== 'undefined') window.addEventListener('storage', this.onStorage);
  }

  /** Useful for tests; the application keeps one repository for its whole session. */
  dispose(): void {
    if (typeof window !== 'undefined') window.removeEventListener('storage', this.onStorage);
  }

  private get storage(): Storage | null {
    if (!this.allowPersistence) return null;
    try {
      const probe = '__pathlab_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch {
      return null;
    }
  }

  init(): Promise<void> {
    if (!this.ready) this.ready = Promise.resolve();
    return this.ready;
  }

  private parseStore(entity: EntityName, raw: string | null): Store {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('not an object');
      return parsed as Store;
    } catch (error) {
      throw new Error(`Stored ${entity} data is unreadable. It was not overwritten.`, {
        cause: error,
      });
    }
  }

  private readStore(entity: EntityName): Store {
    if (this.memory.has(entity)) return this.memory.get(entity)!;
    const store = this.parseStore(entity, this.storage?.getItem(PREFIX + entity) ?? null);
    this.memory.set(entity, store);
    return store;
  }

  /** Read the latest tab's value while holding the cross-tab write lock. */
  private freshStore(entity: EntityName): Store {
    const storage = this.storage;
    if (!storage) return this.readStore(entity);
    return this.parseStore(entity, storage.getItem(PREFIX + entity));
  }

  private assertPersistence(): void {
    if (!this.allowPersistence)
      throw new Error('Production web is demo-only and cannot persist clinical records.');
  }

  private writeStore(entity: EntityName, store: Store): void {
    this.assertPersistence();
    const serialized = JSON.stringify(store);
    const storage = this.storage;
    if (!storage) throw new Error('Browser storage is unavailable. The change was not saved.');
    try {
      storage.setItem(PREFIX + entity, serialized);
    } catch (error) {
      throw new Error(
        'Browser storage rejected the change (quota or private mode). Nothing was saved.',
        { cause: error },
      );
    }
    this.memory.set(entity, store);
  }

  private async withLock<T>(task: () => Promise<T>): Promise<T> {
    if (this.lockDepth > 0) return task();
    this.lockDepth += 1;
    try {
      if (navigator.locks?.request) return await navigator.locks.request(LOCK_NAME, task);
      return await task();
    } finally {
      this.lockDepth -= 1;
    }
  }

  private toDocs(entity: EntityName): LocalDoc[] {
    return Object.keys(this.readStore(entity)).map(id => makeDoc(id, this.readStore(entity)[id]));
  }

  async list(entity: EntityName, options: ListOptions = {}): Promise<LocalDoc[]> {
    return applyQuery(this.toDocs(entity), options);
  }

  async get(entity: EntityName, id: string): Promise<LocalDoc | null> {
    const store = this.readStore(entity);
    return store[id] ? makeDoc(id, store[id]) : null;
  }

  private async mutate(entity: EntityName, transform: (store: Store) => void): Promise<void> {
    await this.withLock(async () => {
      const store = { ...this.freshStore(entity) };
      transform(store);
      this.writeStore(entity, store);
      await this.emit(entity);
    });
  }

  async set(entity: EntityName, id: string, value: Record<string, unknown>): Promise<void> {
    await this.mutate(entity, store => {
      store[id] = value;
    });
  }

  async add(entity: EntityName, value: Record<string, unknown>): Promise<string> {
    const id = (value.id as string) || generateId();
    await this.set(entity, id, value);
    return id;
  }

  async update(entity: EntityName, id: string, patch: Record<string, unknown>): Promise<void> {
    await this.mutate(entity, store => {
      if (!store[id]) throw new Error(`Cannot update missing ${entity} document: ${id}`);
      store[id] = { ...store[id], ...patch };
    });
  }

  async delete(entity: EntityName, id: string): Promise<void> {
    await this.mutate(entity, store => {
      delete store[id];
    });
  }

  async count(entity: EntityName, where?: WhereFilter[]): Promise<number> {
    return applyQuery(this.toDocs(entity), { where }).length;
  }

  subscribe(
    entity: EntityName,
    cb: (docs: LocalDoc[]) => void,
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
    try {
      cb(applyQuery(this.toDocs(entity), options));
    } catch (error) {
      onError?.(error);
      cb([]);
    }
    return () => {
      set?.delete(cb);
      if (onError) this.failures.get(entity)?.delete(onError);
    };
  }

  private readonly onStorage = (event: StorageEvent): void => {
    if (!this.allowPersistence) return;
    if (event.key && !event.key.startsWith(PREFIX)) return;
    for (const entity of ENTITY_NAMES) {
      const key = PREFIX + entity;
      if (event.key && event.key !== key) continue;
      try {
        const store = this.parseStore(entity, event.newValue);
        this.memory.set(entity, store);
        void this.emit(entity);
      } catch (error) {
        this.failures.get(entity)?.forEach(cb => cb(error));
      }
    }
    if (event.key === null) {
      this.memory.clear();
      for (const entity of ENTITY_NAMES) void this.emit(entity);
    }
  };

  private async emit(entity: EntityName): Promise<void> {
    const set = this.listeners.get(entity);
    if (!set || set.size === 0) return;
    const groups = new Map<
      string,
      { options?: ListOptions; callbacks: Array<(docs: LocalDoc[]) => void> }
    >();
    for (const [callback, options] of set) {
      const key = JSON.stringify(options ?? {});
      const group = groups.get(key) ?? { options, callbacks: [] };
      group.callbacks.push(callback);
      groups.set(key, group);
    }
    try {
      for (const group of groups.values()) {
        const docs = applyQuery(this.toDocs(entity), group.options);
        group.callbacks.forEach(callback => callback(docs));
      }
    } catch (error) {
      this.failures.get(entity)?.forEach(cb => cb(error));
    }
  }

  async transaction(fn: (tx: DataRepository) => Promise<void>): Promise<void> {
    await this.withLock(() => fn(this));
  }

  async clearAll(): Promise<void> {
    await this.withLock(async () => {
      for (const entity of ENTITY_NAMES) {
        this.writeStore(entity, {});
        await this.emit(entity);
      }
    });
  }
}
