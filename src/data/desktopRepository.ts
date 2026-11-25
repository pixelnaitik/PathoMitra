/** Electron repository: document/query IPC outside explicit bulk transactions. */
import { desktopBridge, type DesktopBridge } from '../lib/desktop-bridge';
import { applyQuery, generateId, makeDoc } from './query';
import { ENTITY_NAMES, type EntityName } from './entities';
import type {
  DataRepository,
  ListOptions,
  LocalDoc,
  RepositoryPrincipal,
  WhereFilter,
} from './types';

type Store = Record<string, Record<string, unknown>>;
type Subscriber = (docs: LocalDoc[]) => void;
const ALL_ENTITIES: readonly EntityName[] = ENTITY_NAMES;

function docsFromJson(json: string): LocalDoc[] {
  const rows = JSON.parse(json) as Array<{ id: string; data: Record<string, unknown> }>;
  return rows.map(row => makeDoc(row.id, row.data));
}

function storeDocs(store: Store): LocalDoc[] {
  return Object.entries(store).map(([id, data]) => makeDoc(id, data));
}

export class DesktopRepository implements DataRepository {
  private readonly bridge: DesktopBridge;
  private readonly queues = new Map<EntityName, Promise<void>>();
  private readonly listeners = new Map<EntityName, Map<Subscriber, ListOptions | undefined>>();
  private readonly failures = new Map<EntityName, Set<(error: unknown) => void>>();
  private ready: Promise<void> | null = null;
  private tx: { buffers: Map<EntityName, Store>; touched: Set<EntityName> } | null = null;
  private transactionUnitActive = false;

  constructor() {
    const bridge = desktopBridge();
    if (!bridge) throw new Error('DesktopRepository requires the Electron bridge');
    this.bridge = bridge;
  }

  init(): Promise<void> {
    if (!this.ready) this.ready = this.bridge.db.init();
    return this.ready;
  }

  private queue<T>(entity: EntityName, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(entity) ?? Promise.resolve();
    const run = previous.then(task, task);
    this.queues.set(
      entity,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private drain(entity: EntityName): Promise<void> {
    return (this.queues.get(entity) ?? Promise.resolve()).then(
      () => undefined,
      () => undefined,
    );
  }

  private async loadStore(entity: EntityName): Promise<Store> {
    const buffered = this.tx?.buffers.get(entity);
    if (buffered) return buffered;
    const json = await this.bridge.db.load(entity);
    return json ? (JSON.parse(json) as Store) : {};
  }

  private async toDocs(entity: EntityName, options: ListOptions = {}): Promise<LocalDoc[]> {
    const buffered = this.tx?.buffers.get(entity);
    if (buffered) return applyQuery(storeDocs(buffered), options);
    return docsFromJson(await this.bridge.db.query(entity, options));
  }

  async list(entity: EntityName, options: ListOptions = {}): Promise<LocalDoc[]> {
    await this.init();
    return this.toDocs(entity, options);
  }

  async get(entity: EntityName, id: string): Promise<LocalDoc | null> {
    await this.init();
    const buffered = this.tx?.buffers.get(entity);
    if (buffered) return buffered[id] ? makeDoc(id, buffered[id]) : null;
    const json = await this.bridge.db.get(entity, id);
    return json ? makeDoc(id, JSON.parse(json) as Record<string, unknown>) : null;
  }

  private async applyBufferedMutation(
    entity: EntityName,
    transform: (store: Store) => Store,
  ): Promise<void> {
    const tx = this.tx;
    if (!tx) throw new Error('No active database transaction.');
    const base = tx.buffers.get(entity) ?? (await this.loadStore(entity));
    tx.buffers.set(entity, transform({ ...base }));
    tx.touched.add(entity);
  }

  async set(entity: EntityName, id: string, value: Record<string, unknown>): Promise<void> {
    await this.init();
    if (this.tx) {
      await this.applyBufferedMutation(entity, store => {
        store[id] = value;
        return store;
      });
      return;
    }
    await this.queue(entity, async () => {
      await this.bridge.db.set(entity, id, JSON.stringify(value));
      await this.emit(entity);
    });
  }

  async add(entity: EntityName, value: Record<string, unknown>): Promise<string> {
    const id = (value.id as string) || generateId();
    await this.set(entity, id, value);
    return id;
  }

  async update(entity: EntityName, id: string, patch: Record<string, unknown>): Promise<void> {
    await this.init();
    if (this.tx) {
      await this.applyBufferedMutation(entity, store => {
        if (!store[id]) throw new Error(`Cannot update missing ${entity} document: ${id}`);
        store[id] = { ...store[id], ...patch };
        return store;
      });
      return;
    }
    await this.queue(entity, async () => {
      await this.bridge.db.update(entity, id, JSON.stringify(patch));
      await this.emit(entity);
    });
  }

  async delete(entity: EntityName, id: string): Promise<void> {
    await this.init();
    if (this.tx) {
      await this.applyBufferedMutation(entity, store => {
        delete store[id];
        return store;
      });
      return;
    }
    await this.queue(entity, async () => {
      await this.bridge.db.delete(entity, id);
      await this.emit(entity);
    });
  }

  async count(entity: EntityName, where?: WhereFilter[]): Promise<number> {
    await this.init();
    const buffered = this.tx?.buffers.get(entity);
    if (buffered) return applyQuery(storeDocs(buffered), { where }).length;
    return this.bridge.db.count(entity, where ?? []);
  }

  subscribe(
    entity: EntityName,
    cb: Subscriber,
    onError?: (error: unknown) => void,
    options?: ListOptions,
  ): () => void {
    let listeners = this.listeners.get(entity);
    if (!listeners) {
      listeners = new Map();
      this.listeners.set(entity, listeners);
    }
    listeners.set(cb, options);
    if (onError) {
      let failed = this.failures.get(entity);
      if (!failed) {
        failed = new Set();
        this.failures.set(entity, failed);
      }
      failed.add(onError);
    }
    void this.toDocs(entity, options)
      .then(docs => {
        if (listeners?.has(cb)) cb(docs);
      })
      .catch(error => {
        if (listeners?.has(cb)) {
          onError?.(error);
          cb([]);
        }
      });
    return () => {
      listeners?.delete(cb);
      if (onError) this.failures.get(entity)?.delete(onError);
    };
  }

  private async emit(entity: EntityName): Promise<void> {
    const listeners = this.listeners.get(entity);
    if (!listeners?.size) return;
    const groups = new Map<string, { options?: ListOptions; callbacks: Subscriber[] }>();
    for (const [callback, options] of listeners) {
      const key = JSON.stringify(options ?? {});
      const group = groups.get(key) ?? { options, callbacks: [] };
      group.callbacks.push(callback);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      try {
        const docs = await this.toDocs(entity, group.options);
        group.callbacks.forEach(callback => callback(docs));
      } catch (error) {
        this.failures.get(entity)?.forEach(callback => callback(error));
      }
    }
  }

  async setPrincipal(_actor: RepositoryPrincipal | null): Promise<void> {
    // Electron binds uid/role to the main-process session token, not renderer state.
  }

  /** Buffer every write and commit touched collections as one main-process unit. */
  async transaction(fn: (tx: DataRepository) => Promise<void>): Promise<void> {
    if (this.tx || this.transactionUnitActive) {
      throw new Error('A database transaction is already active; retry after it completes.');
    }
    this.transactionUnitActive = true;
    try {
      await Promise.all(ALL_ENTITIES.map(entity => this.drain(entity)));
      const tx = { buffers: new Map<EntityName, Store>(), touched: new Set<EntityName>() };
      this.tx = tx;
      try {
        await fn(this);
        const entries = [...tx.buffers.entries()].map(([entity, store]) => ({
          entity,
          json: JSON.stringify(store),
        }));
        if (entries.length > 0) await this.bridge.db.commit(entries);
      } finally {
        this.tx = null;
        for (const entity of tx.touched) await this.emit(entity);
      }
    } finally {
      this.transactionUnitActive = false;
    }
  }

  async clearAll(): Promise<void> {
    if (this.tx) throw new Error('Cannot erase data inside a transaction.');
    await Promise.all(ALL_ENTITIES.map(entity => this.drain(entity)));
    await this.bridge.db.clear();
    for (const entity of ALL_ENTITIES) await this.emit(entity);
  }
}
