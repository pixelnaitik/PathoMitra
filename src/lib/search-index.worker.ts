/// <reference lib="webworker" />

import {
  indexRecord,
  searchIndex,
  type IndexedResult,
  type SearchFilterResult,
  type SearchRecordType,
} from './search-index-core';
import type { EntityName } from '../data/entities';

type WireDoc = { id: string; data: Record<string, unknown> };
type InMessage =
  | { type: 'replace'; entity: EntityName; docs: WireDoc[]; generation: number }
  | { type: 'filter'; query: string; requestId: number };

type CollectionState = Map<string, { hash: string; item: IndexedResult }>;
const collections = new Map<EntityName, CollectionState>();
const sourceOrder: EntityName[] = ['patients', 'reports', 'doctors', 'orders', 'samples'];
const replacementGenerations = new Map<EntityName, number>();

function collectionType(entity: EntityName): SearchRecordType | null {
  if (entity === 'patients') return 'patient';
  if (entity === 'reports') return 'report';
  if (entity === 'doctors') return 'doctor';
  if (entity === 'orders') return 'order';
  if (entity === 'samples') return 'sample';
  return null;
}

function allItems(): IndexedResult[] {
  return sourceOrder.flatMap(entity =>
    Array.from(collections.get(entity)?.values() ?? [], entry => entry.item),
  );
}

const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<InMessage>) => void) | null;
  postMessage: (message: unknown) => void;
};

workerSelf.onmessage = async (event: MessageEvent<InMessage>) => {
  const message = event.data;
  if (message.type === 'filter') {
    const result: SearchFilterResult = searchIndex(allItems(), message.query);
    workerSelf.postMessage({ type: 'filtered', requestId: message.requestId, result });
    return;
  }

  const generation = (replacementGenerations.get(message.entity) ?? 0) + 1;
  replacementGenerations.set(message.entity, generation);
  const type = collectionType(message.entity);
  if (!type) return;
  const previous = collections.get(message.entity) ?? new Map();
  const next: CollectionState = new Map();
  for (let index = 0; index < message.docs.length; index += 1) {
    if (generation !== replacementGenerations.get(message.entity)) return;
    const doc = message.docs[index];
    const hash = JSON.stringify(doc.data);
    const existing = previous.get(doc.id);
    next.set(
      doc.id,
      existing?.hash === hash
        ? existing
        : { hash, item: indexRecord(type, { id: doc.id, data: () => doc.data }) },
    );
    if (index % 500 === 499) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (generation !== replacementGenerations.get(message.entity)) return;
  collections.set(message.entity, next);
  workerSelf.postMessage({
    type: 'indexed',
    entity: message.entity,
    generation,
    items: allItems(),
  });
};

workerSelf.postMessage({ type: 'ready' });
