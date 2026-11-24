import { getRepository, type EntityName, type LocalDoc } from '../data';
import { normalisePhone } from './patient-registry';

export type SearchRecordType = 'patient' | 'report' | 'doctor' | 'order' | 'sample';

export interface SearchResult {
  id: string;
  type: SearchRecordType;
  title: string;
  subtitle: string;
  timestamp: number;
}

export interface IndexedResult extends SearchResult {
  haystack: string;
}

export interface SearchIndexState {
  items: IndexedResult[];
  loading: boolean;
  failedSources: number;
}

const TYPE_RANK: Record<SearchRecordType, number> = {
  patient: 0,
  report: 1,
  doctor: 2,
  order: 3,
  sample: 4,
};
const PER_TYPE_LIMIT = 6;
const SOURCES: EntityName[] = ['patients', 'reports', 'doctors', 'orders', 'samples'];

function fold(value: unknown): string {
  return String(value ?? '').toLowerCase().normalize('NFKD').replace(/\s+/g, ' ').trim();
}

function haystackOf(...parts: unknown[]): string {
  const flat: string[] = [];
  for (const part of parts) {
    if (Array.isArray(part)) flat.push(...part.map(item => fold(item)));
    else if (part !== undefined && part !== null && part !== '') flat.push(fold(part));
  }
  return flat.filter(Boolean).join(' ');
}

function timestampOf(value: unknown): number {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Convert one stored row into the display record and its folded search text. */
export function indexRecord(type: SearchRecordType, doc: LocalDoc): IndexedResult {
  const data = doc.data();
  const phone = String(data.phone ?? '');
  if (type === 'patient') {
    return {
      id: doc.id,
      type,
      title: String(data.name || 'Unknown Patient'),
      subtitle: `${data.age || '?'}y · ${data.gender || '—'} · #${doc.id}`,
      timestamp: timestampOf(data.createdAt),
      haystack: haystackOf(
        data.name, doc.id, phone, normalisePhone(phone), data.doctorName,
        data.gender, data.age, data.testSelection,
      ),
    };
  }
  if (type === 'report') {
    const issued = data.status !== 'draft';
    return {
      id: doc.id,
      type,
      title: String(data.patientName || 'Report'),
      subtitle: issued
        ? `${data.testType ? `${data.testType} · ` : ''}issued ${
            data.createdAt ? new Date(String(data.createdAt)).toLocaleDateString() : '—'
          }`
        : `Draft · ${data.testType ?? 'no panel named'}`,
      timestamp: timestampOf(data.createdAt),
      haystack: haystackOf(
        data.patientName, doc.id, data.patientId, data.testType, data.testSelection,
        data.signature, Object.keys((data.resultData as Record<string, unknown>) ?? {}),
      ),
    };
  }
  if (type === 'doctor') {
    return {
      id: doc.id,
      type,
      title: String(data.name || 'Unknown Doctor'),
      subtitle: phone || 'No phone',
      timestamp: timestampOf(data.createdAt),
      haystack: haystackOf(data.name, doc.id, phone, normalisePhone(phone), data.registrationNo),
    };
  }
  if (type === 'order') {
    return {
      id: doc.id,
      type,
      title: String(data.orderNo || doc.id),
      subtitle: `${data.patientName || 'Unknown patient'} · ${data.status || 'ordered'}`,
      timestamp: timestampOf(data.createdAt),
      haystack: haystackOf(
        data.orderNo, doc.id, data.patientName, data.patientId, data.doctorName,
        data.status, data.priority, data.clinicalHistory, (data.items as Array<{ name?: string }> | undefined)?.map(item => item.name),
      ),
    };
  }
  return {
    id: doc.id,
    type,
    title: String(data.accessionNo || data.barcode || doc.id),
    subtitle: `${data.patientName || data.patientId || 'Unknown patient'} · ${data.status || 'expected'}`,
    timestamp: timestampOf(data.createdAt),
    haystack: haystackOf(
      data.accessionNo, data.barcode, doc.id, data.orderId, data.orderItemId,
      data.patientId, data.specimen, data.container, data.source, data.status,
    ),
  };
}

export function filterSearchResults(items: IndexedResult[], query: string): IndexedResult[] {
  const terms = fold(query).split(' ').filter(Boolean);
  const pool = terms.length === 0
    ? items
    : items.filter(item => terms.every(term => item.haystack.includes(term)));
  const taken: Record<SearchRecordType, number> = { patient: 0, report: 0, doctor: 0, order: 0, sample: 0 };
  return pool
    .filter(item => {
      if (taken[item.type] >= PER_TYPE_LIMIT) return false;
      taken[item.type] += 1;
      return true;
    })
    .sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type] || b.timestamp - a.timestamp);
}

type CollectionState = Map<string, { hash: string; item: IndexedResult }>;
const collections = new Map<EntityName, CollectionState>();
const listeners = new Set<(state: SearchIndexState) => void>();
let state: SearchIndexState = { items: [], loading: false, failedSources: 0 };
let starting: Promise<void> | null = null;
let unsubscribers: Array<() => void> = [];

function collectionType(entity: EntityName): SearchRecordType | null {
  if (entity === 'patients') return 'patient';
  if (entity === 'reports') return 'report';
  if (entity === 'doctors') return 'doctor';
  if (entity === 'orders') return 'order';
  if (entity === 'samples') return 'sample';
  return null;
}

function publish(patch: Partial<SearchIndexState>): void {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener(state));
}

function reconcile(entity: EntityName, docs: LocalDoc[]): void {
  const type = collectionType(entity);
  if (!type) return;
  const previous = collections.get(entity) ?? new Map();
  const next: CollectionState = new Map();
  for (const doc of docs) {
    const hash = JSON.stringify(doc.data());
    if (previous.get(doc.id)?.hash === hash) {
      next.set(doc.id, previous.get(doc.id)!);
    } else {
      next.set(doc.id, { hash, item: indexRecord(type, doc) });
    }
  }
  collections.set(entity, next);
  const items = SOURCES.flatMap(source => Array.from(collections.get(source)?.values() ?? [], entry => entry.item));
  publish({ items });
}

async function start(): Promise<void> {
  if (starting) return starting;
  starting = (async () => {
    publish({ loading: true, failedSources: 0 });
    const repo = getRepository();
    await repo.init();
    const outcomes = await Promise.allSettled(SOURCES.map(async entity => ({ entity, docs: await repo.list(entity) })));
    let failed = 0;
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') reconcile(outcome.value.entity, outcome.value.docs);
      else failed += 1;
    }
    unsubscribers = SOURCES.map(entity => repo.subscribe(
      entity,
      docs => reconcile(entity, docs),
      () => publish({ failedSources: state.failedSources + 1 }),
    ));
    publish({ loading: false, failedSources: failed });
  })().catch(() => publish({ loading: false, failedSources: SOURCES.length }));
  return starting;
}

/** One in-memory index per app session; no patient data is written to browser storage. */
export function subscribeSearchIndex(listener: (state: SearchIndexState) => void): () => void {
  listeners.add(listener);
  listener(state);
  if (!starting) void start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      unsubscribers.forEach(unsubscribe => unsubscribe());
      unsubscribers = [];
      starting = null;
      collections.clear();
      state = { items: [], loading: false, failedSources: 0 };
    }
  };
}
