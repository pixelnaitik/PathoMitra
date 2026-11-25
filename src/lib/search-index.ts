import { getRepository, type EntityName, type LocalDoc } from '../data';
import {
  indexRecord,
  searchIndex,
  type IndexedResult,
  type SearchFilterResult,
  type SearchRecordType,
} from './search-index-core';

export { filterSearchResults, indexRecord, PER_TYPE_LIMIT } from './search-index-core';
export type {
  IndexedResult,
  SearchFilterResult,
  SearchRecordType,
  SearchResult,
} from './search-index-core';

export interface SearchIndexState {
  items: IndexedResult[];
  loading: boolean;
  failedSources: number;
}

const SOURCES: EntityName[] = ['patients', 'reports', 'doctors', 'orders', 'samples'];
type CollectionState = Map<string, { hash: string; item: IndexedResult }>;
type WorkerMessage =
  | { type: 'ready' }
  | { type: 'indexed'; entity: EntityName; generation: number; items: IndexedResult[] }
  | { type: 'filtered'; requestId: number; result: SearchFilterResult };

const collections = new Map<EntityName, CollectionState>();
const latestDocs = new Map<EntityName, LocalDoc[]>();
const pendingWorkerDocs = new Map<EntityName, LocalDoc[]>();
const listeners = new Set<(state: SearchIndexState) => void>();
const failedSources = new Set<EntityName>();
const filterWaiters = new Map<number, (result: SearchFilterResult) => void>();
let state: SearchIndexState = { items: [], loading: false, failedSources: 0 };
let starting: Promise<void> | null = null;
let generation = 0;
let unsubscribers: Array<() => void> = [];
let worker: Worker | null = null;
let workerReady = false;
const workerGenerations = new Map<EntityName, number>();
let filterRequestId = 0;

function collectionType(entity: EntityName): SearchRecordType | null {
  if (entity === 'patients') return 'patient';
  if (entity === 'reports') return 'report';
  if (entity === 'doctors') return 'doctor';
  if (entity === 'orders') return 'order';
  if (entity === 'samples') return 'sample';
  return null;
}

function allItems(): IndexedResult[] {
  return SOURCES.flatMap(entity =>
    Array.from(collections.get(entity)?.values() ?? [], entry => entry.item),
  );
}

function publish(patch: Partial<SearchIndexState>): void {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener(state));
}

function reconcileFallback(entity: EntityName, docs: LocalDoc[]): void {
  const type = collectionType(entity);
  if (!type) return;
  const previous = collections.get(entity) ?? new Map();
  const next: CollectionState = new Map();
  for (const doc of docs) {
    const hash = JSON.stringify(doc.data());
    const existing = previous.get(doc.id);
    next.set(doc.id, existing?.hash === hash ? existing : { hash, item: indexRecord(type, doc) });
  }
  collections.set(entity, next);
  publish({ items: allItems() });
}

function postReplace(entity: EntityName, docs: LocalDoc[]): void {
  if (!workerReady || !worker) return;
  worker.postMessage({
    type: 'replace',
    entity,
    docs: docs.map(doc => ({ id: doc.id, data: doc.data() })),
    generation: (workerGenerations.get(entity) ?? 0) + 1,
  });
  workerGenerations.set(entity, (workerGenerations.get(entity) ?? 0) + 1);
}

function reconcile(entity: EntityName, docs: LocalDoc[]): void {
  latestDocs.set(entity, docs);
  if (workerReady) postReplace(entity, docs);
  else if (worker) pendingWorkerDocs.set(entity, docs);
  else reconcileFallback(entity, docs);
}

function stopWorker(): void {
  worker?.terminate();
  worker = null;
  workerReady = false;
  pendingWorkerDocs.clear();
  filterWaiters.forEach(resolve => resolve({ items: [], totalMatches: 0, omitted: 0 }));
  filterWaiters.clear();
}

function ensureWorker(): void {
  if (worker || typeof Worker === 'undefined') return;
  try {
    worker = new Worker(new URL('./search-index.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'ready') {
        workerReady = true;
        for (const [entity, docs] of pendingWorkerDocs) postReplace(entity, docs);
        pendingWorkerDocs.clear();
      } else if (message.type === 'indexed') {
        if (message.generation !== workerGenerations.get(message.entity)) return;
        publish({ items: message.items });
      } else {
        const resolve = filterWaiters.get(message.requestId);
        if (resolve) {
          filterWaiters.delete(message.requestId);
          resolve(message.result);
        }
      }
    };
    worker.onerror = () => {
      stopWorker();
      for (const [entity, docs] of latestDocs) reconcileFallback(entity, docs);
    };
  } catch {
    stopWorker();
  }
}

async function start(): Promise<void> {
  if (starting) return starting;
  const currentGeneration = ++generation;
  ensureWorker();
  starting = (async () => {
    publish({ loading: true, failedSources: 0 });
    failedSources.clear();
    const repo = getRepository();
    await repo.init();
    const outcomes = await Promise.allSettled(
      SOURCES.map(async entity => ({ entity, docs: await repo.list(entity) })),
    );
    if (currentGeneration !== generation || listeners.size === 0) return;
    let failed = 0;
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status === 'fulfilled') reconcile(outcome.value.entity, outcome.value.docs);
      else {
        failed += 1;
        failedSources.add(SOURCES[index]);
      }
    }
    if (currentGeneration !== generation || listeners.size === 0) return;
    unsubscribers = SOURCES.map(entity =>
      repo.subscribe(
        entity,
        docs => {
          failedSources.delete(entity);
          reconcile(entity, docs);
          publish({ failedSources: failedSources.size });
        },
        () => {
          failedSources.add(entity);
          publish({ failedSources: failedSources.size });
        },
      ),
    );
    publish({ loading: false, failedSources: failed });
  })()
    .catch(() => {
      if (currentGeneration === generation && listeners.size > 0) {
        publish({ loading: false, failedSources: SOURCES.length });
      }
    })
    .finally(() => {
      if (currentGeneration === generation) starting = null;
    });
  return starting;
}

/** Query the worker when available; tests and older WebViews use the same pure core. */
export function querySearchIndex(query: string): Promise<SearchFilterResult> {
  if (!workerReady || !worker) return Promise.resolve(searchIndex(state.items, query));
  const requestId = ++filterRequestId;
  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      filterWaiters.delete(requestId);
      resolve(searchIndex(state.items, query));
    }, 2_000);
    filterWaiters.set(requestId, result => {
      window.clearTimeout(timer);
      resolve(result);
    });
    worker?.postMessage({ type: 'filter', query, requestId });
  });
}

/** One in-memory index per app session; no patient data is written to browser storage. */
export function subscribeSearchIndex(listener: (state: SearchIndexState) => void): () => void {
  listeners.add(listener);
  listener(state);
  if (!starting) void start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      generation += 1;
      unsubscribers.forEach(unsubscribe => unsubscribe());
      unsubscribers = [];
      stopWorker();
      starting = null;
      collections.clear();
      latestDocs.clear();
      failedSources.clear();
      state = { items: [], loading: false, failedSources: 0 };
    }
  };
}
