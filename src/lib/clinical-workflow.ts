/**
 * Order and specimen lifecycle rules shared by every workflow entry point.
 *
 * Orders freeze the requisition and tariff at acceptance. Samples append custody
 * events and never rewrite history. Reports and invoices link back to these
 * aggregates so later patient edits cannot change what was ordered or collected.
 */
import { getRepository } from '../data';
import { generateId } from '../data/query';
import { findTestInfo } from './pathology-tests';
import { resolvePriceDetails } from './price-list';
import { patientMonthKey } from './patient-registry';
import {
  AuditEventSchema,
  OrderSchema,
  SampleSchema,
  roundMoney,
  type AuditEventRecord,
  type CustodyEvent,
  type OrderPriority,
  type OrderRecord,
  type OrderStatus,
  type SampleRecord,
  type SampleStatus,
} from './models';

export interface CreateOrderInput {
  patientId: string;
  doctorId?: string;
  doctorName?: string;
  priority?: OrderPriority;
  clinicalHistory?: string;
  preparationAcknowledged?: boolean;
  tests: string[];
  actor: string;
  allowDuplicate?: boolean;
  now?: Date;
}

const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  ordered: ['collected', 'cancelled', 'amended'],
  collected: ['processing', 'cancelled', 'amended'],
  processing: ['resulted', 'cancelled', 'amended'],
  resulted: ['issued', 'amended'],
  issued: ['billed', 'amended'],
  billed: ['amended'],
  cancelled: [],
  amended: [],
};

const SAMPLE_TRANSITIONS: Record<SampleStatus, readonly SampleStatus[]> = {
  expected: ['collected', 'lost'],
  collected: ['received', 'rejected', 'lost'],
  received: ['processing', 'rejected', 'lost'],
  processing: ['received', 'rejected', 'lost', 'disposed'],
  rejected: ['collected', 'disposed'],
  lost: ['collected', 'disposed'],
  disposed: [],
};

function stamp(date = new Date()): string {
  return date.toISOString();
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function randomSuffix(): string {
  return generateId().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

type CustodyEventInput = Pick<CustodyEvent, 'id' | 'action' | 'actor' | 'at' | 'from' | 'to' | 'location' | 'note'>;

async function custodyHash(event: CustodyEventInput & { previousHash?: string }): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(event)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function chainedCustodyEvent(
  previous: CustodyEvent | undefined,
  event: CustodyEventInput,
): Promise<CustodyEvent> {
  const previousHash = previous?.eventHash;
  const value = { ...event, previousHash };
  return { ...value, eventHash: await custodyHash(value) };
}

export async function verifyCustodyChain(
  sample: Pick<SampleRecord, 'custody'>,
): Promise<{ valid: boolean; reason?: string }> {
  let previousHash: string | undefined;
  for (const event of sample.custody) {
    if (!event.eventHash) return { valid: false, reason: 'A legacy custody event is not hash-chained.' };
    if ((event.previousHash ?? '') !== (previousHash ?? '')) {
      return { valid: false, reason: 'Custody hash chain is broken.' };
    }
    const { eventHash: _eventHash, ...unsigned } = event;
    if ((await custodyHash(unsigned)) !== event.eventHash) {
      return { valid: false, reason: 'A custody event was modified after recording.' };
    }
    previousHash = event.eventHash;
  }
  return { valid: true };
}

async function allocateOrderNoInTransaction(tx: RepositoryTx, now: Date): Promise<string> {
  const prefix = `ORD-${patientMonthKey(now)}`;
  const counterId = `order-no-${patientMonthKey(now)}`;
  const counter = await tx.get('meta', counterId);
  const stored = Number(counter?.data().value);
  const cursor = Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0;
  for (let step = 1; step <= 100; step += 1) {
    const sequence = cursor + step;
    const candidate = `${prefix}-${String(sequence).padStart(4, '0')}`;
    const existing = await tx.list('orders', { where: [{ field: 'orderNo', op: '==', value: candidate }] });
    if (existing.length > 0) continue;
    await tx.set('meta', counterId, { value: sequence, allocatedAt: now.toISOString() });
    return candidate;
  }
  throw new Error('Order numbers could not be advanced safely. No order was created.');
}

function parseOrder(data: Record<string, unknown>): OrderRecord {
  return OrderSchema.parse(data) as OrderRecord;
}

function parseSample(data: Record<string, unknown>): SampleRecord {
  return SampleSchema.parse(data) as SampleRecord;
}

async function appendAudit(
  tx: {
    add: (entity: 'auditEvents', value: Record<string, unknown>) => Promise<string>;
  },
  action: string,
  entity: string,
  entityId: string,
  actor: string,
  at: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const value = AuditEventSchema.parse({ action, entity, entityId, actor, at, details });
  await tx.add('auditEvents', value);
}

type RepositoryTx = Parameters<Parameters<ReturnType<typeof getRepository>['transaction']>[0]>[0];

/** Create a stable requisition with frozen test metadata and tariff. */
async function createOrderInternal(
  input: CreateOrderInput,
  includeSamples: boolean,
): Promise<{ order: OrderRecord; samples: SampleRecord[] }> {
  const repo = getRepository();
  const now = stamp(input.now);
  const tests = [...new Set(input.tests.map(name => name.trim()).filter(Boolean))];
  if (tests.length === 0) throw new Error('Select at least one test for this order.');
  if (!input.actor.trim()) throw new Error('An order requires an operator identity.');
  if (input.priority === 'stat' && !input.preparationAcknowledged) {
    throw new Error('Acknowledge specimen preparation before accepting a STAT order.');
  }

  const id = generateId();
  let result: { order: OrderRecord; samples: SampleRecord[] } | null = null;

  await repo.transaction(async tx => {
    const patient = await tx.get('patients', input.patientId);
    if (!patient) throw new Error('The patient for this order no longer exists.');
    const patientName = String(patient.data().name ?? '').trim();
    if (!patientName) throw new Error('The patient for this order has no registered name.');

    if (!input.allowDuplicate) {
      const active = await tx.list('orders', {
        where: [
          { field: 'patientId', op: '==', value: input.patientId },
          { field: 'status', op: 'in', value: ['ordered', 'collected', 'processing', 'resulted', 'issued'] },
        ],
      });
      const wanted = [...tests].sort().join('\u0000');
      const duplicate = active.some(doc => {
        const names = (doc.data().items as Array<{ name?: string }> | undefined) ?? [];
        return [...names.map(item => item.name ?? '')].sort().join('\u0000') === wanted;
      });
      if (duplicate) {
        throw new Error('An active order already contains these tests. Open it or explicitly allow a duplicate.');
      }
    }

    const orderNo = await allocateOrderNoInTransaction(tx, input.now ?? new Date());
    const items = tests.map((name, index) => {
      const info = findTestInfo(name);
      const resolved = resolvePriceDetails(name);
      const price = resolved?.approved ? resolved.price : null;
      return {
        id: `${id}-item-${index + 1}`,
        testId: info?.id ?? '',
        name,
        qty: 1,
        unit: info?.unit,
        method: info?.method,
        specimen: info?.specimen,
        container: info?.container,
        preparation: info?.preparation,
        category: info?.category,
        kind: info?.kind,
        isGroup: info?.isGroup,
        unitPrice: price ?? 0,
        priceApproved: resolved?.approved === true,
        ...(resolved ? { priceSource: resolved.source } : {}),
      };
    });

    const value = OrderSchema.parse({
      id,
      orderNo,
      patientId: input.patientId,
      patientName,
      doctorId: input.doctorId,
      doctorName: input.doctorName,
      priority: input.priority ?? 'routine',
      status: 'ordered',
      clinicalHistory: input.clinicalHistory?.trim(),
      preparationAcknowledged: input.preparationAcknowledged ?? false,
      approvedBy: input.actor.trim(),
      approvedAt: now,
      revision: 1,
      items,
      createdBy: input.actor.trim(),
      createdAt: now,
      updatedAt: now,
    });
    await tx.set('orders', id, value);
    await appendAudit(tx, 'order.created', 'orders', id, input.actor, now, {
      orderNo,
      patientId: input.patientId,
      testCount: items.length,
    });
    const order = { ...value, id } as OrderRecord;
    const samples = includeSamples
      ? await createSamplesInTransaction(tx, order, input.actor, now)
      : [];
    result = { order, samples };
  });

  if (!result) throw new Error('The order could not be created.');
  return result;
}

export async function createOrder(input: CreateOrderInput): Promise<OrderRecord> {
  return (await createOrderInternal(input, false)).order;
}

/** Create the requisition and all expected specimens in one transaction. */
export async function createOrderWithSamples(
  input: CreateOrderInput,
): Promise<{ order: OrderRecord; samples: SampleRecord[] }> {
  return createOrderInternal(input, true);
}

/** Supersede an order with a linked replacement while retaining the original. */
export async function amendOrder(
  orderId: string,
  actor: string,
  reason: string,
): Promise<{ original: OrderRecord; replacement: OrderRecord; samples: SampleRecord[] }> {
  if (!actor.trim()) throw new Error('An amendment requires an operator identity.');
  if (!reason.trim()) throw new Error('An order amendment requires a reason.');
  const repo = getRepository();
  let result: { original: OrderRecord; replacement: OrderRecord; samples: SampleRecord[] } | null = null;
  await repo.transaction(async tx => {
    const doc = await tx.get('orders', orderId);
    if (!doc) throw new Error('This order no longer exists.');
    const original = parseOrder({ id: orderId, ...doc.data() });
    if (original.status === 'cancelled' || original.status === 'amended') {
      throw new Error(`A ${original.status} order cannot be amended again.`);
    }
    const nowDate = new Date();
    const now = stamp(nowDate);
    const replacementId = generateId();
    const orderNo = await allocateOrderNoInTransaction(tx, nowDate);
    const replacementValue = OrderSchema.parse({
      ...original,
      id: replacementId,
      orderNo,
      status: 'ordered',
      supersedesOrderId: original.id,
      revision: original.revision + 1,
      items: original.items.map((item, index) => ({ ...item, id: `${replacementId}-item-${index + 1}` })),
      cancelledReason: undefined,
      createdBy: actor.trim(),
      createdAt: now,
      updatedAt: now,
      approvedBy: actor.trim(),
      approvedAt: now,
    });
    const originalValue = OrderSchema.parse({
      ...original,
      status: 'amended',
      amendReason: reason.trim(),
      updatedAt: now,
    });
    await tx.set('orders', orderId, originalValue);
    await tx.set('orders', replacementId, replacementValue);
    await appendAudit(tx, 'order.amended', 'orders', orderId, actor, now, { replacementId, orderNo, reason: reason.trim() });
    await appendAudit(tx, 'order.created', 'orders', replacementId, actor, now, { supersedesOrderId: orderId, revision: replacementValue.revision });
    const replacement = { ...replacementValue, id: replacementId } as OrderRecord;
    const samples = await createSamplesInTransaction(tx, replacement, actor, now);
    result = {
      original: { ...originalValue, id: orderId } as OrderRecord,
      replacement,
      samples,
    };
  });
  if (!result) throw new Error('The order amendment could not be created.');
  return result;
}

/** Apply an allowed lifecycle transition and append an immutable audit event. */
export async function transitionOrder(
  orderId: string,
  nextStatus: OrderStatus,
  actor: string,
  reason?: string,
): Promise<OrderRecord> {
  const repo = getRepository();
  let updated: OrderRecord | null = null;
  await repo.transaction(async tx => {
    const doc = await tx.get('orders', orderId);
    if (!doc) throw new Error('This order no longer exists.');
    const order = parseOrder({ id: orderId, ...doc.data() });
    if (!ORDER_TRANSITIONS[order.status].includes(nextStatus)) {
      throw new Error(`An order cannot move from ${order.status} to ${nextStatus}.`);
    }
    if ((nextStatus === 'cancelled' || nextStatus === 'amended') && !reason?.trim()) {
      throw new Error(`A reason is required to mark an order ${nextStatus}.`);
    }
    if (!actor.trim()) throw new Error('An operator identity is required for this transition.');
    const now = stamp();
    const value = OrderSchema.parse({
      ...order,
      status: nextStatus,
      cancelledReason: nextStatus === 'cancelled' ? reason?.trim() : order.cancelledReason,
      updatedAt: now,
    });
    await tx.set('orders', orderId, value);
    await appendAudit(tx, `order.${nextStatus}`, 'orders', orderId, actor, now, {
      from: order.status,
      to: nextStatus,
      reason: reason?.trim(),
    });
    updated = { ...value, id: orderId } as OrderRecord;
  });
  if (!updated) throw new Error('The order transition could not be saved.');
  return updated;
}

/** Materialize expected specimens inside an existing transaction; safe to retry. */
async function createSamplesInTransaction(
  tx: RepositoryTx,
  order: OrderRecord,
  actor: string,
  now: string,
): Promise<SampleRecord[]> {
  if (!['ordered', 'collected'].includes(order.status)) {
    throw new Error(`Specimens cannot be created while the order is ${order.status}.`);
  }
  const existing = await tx.list('samples', { where: [{ field: 'orderId', op: '==', value: order.id }] });
  const byItem = new Set(existing.map(doc => String(doc.data().orderItemId)));
  const accessions = new Set(existing.map(doc => String(doc.data().accessionNo)));
  const created: SampleRecord[] = [];

  for (const item of order.items) {
    if (byItem.has(item.id)) continue;
    const id = generateId();
    let accessionNo = `ACC-${dayKey(new Date(now))}-${randomSuffix()}`;
    while (accessions.has(accessionNo)) accessionNo = `ACC-${dayKey(new Date(now))}-${randomSuffix()}`;
    accessions.add(accessionNo);
    const value = SampleSchema.parse({
      id,
      accessionNo,
      barcode: accessionNo,
      orderId: order.id,
      orderItemId: item.id,
      patientId: order.patientId,
      specimen: item.specimen,
      container: item.container,
      source: '',
      status: 'expected',
      aliquots: [],
      custody: [],
      createdAt: now,
      updatedAt: now,
    });
    await tx.set('samples', id, value);
    await appendAudit(tx, 'sample.expected', 'samples', id, actor, now, { orderId: order.id, accessionNo });
    created.push({ ...value, id } as SampleRecord);
  }
  return created;
}

/** Materialize expected specimens for every order item; safe to retry. */
export async function createSamplesForOrder(orderId: string, actor: string): Promise<SampleRecord[]> {
  const repo = getRepository();
  let created: SampleRecord[] = [];
  await repo.transaction(async tx => {
    const orderDoc = await tx.get('orders', orderId);
    if (!orderDoc) throw new Error('This order no longer exists.');
    const order = parseOrder({ id: orderId, ...orderDoc.data() });
    created = await createSamplesInTransaction(tx, order, actor, stamp());
  });
  return created;
}

/** Append a custody event and apply the corresponding specimen transition. */
export async function transitionSample(
  sampleId: string,
  nextStatus: SampleStatus,
  actor: string,
  options: { reason?: string; location?: string; from?: string; to?: string; note?: string; source?: string; collectionSite?: string; temperatureC?: number; container?: string } = {},
): Promise<SampleRecord> {
  const repo = getRepository();
  let updated: SampleRecord | null = null;
  await repo.transaction(async tx => {
    const doc = await tx.get('samples', sampleId);
    if (!doc) throw new Error('This sample no longer exists.');
    const sample = parseSample({ id: sampleId, ...doc.data() });
    if (!SAMPLE_TRANSITIONS[sample.status].includes(nextStatus)) {
      throw new Error(`A sample cannot move from ${sample.status} to ${nextStatus}.`);
    }
    if ((nextStatus === 'rejected' || nextStatus === 'lost') && !options.reason?.trim()) {
      throw new Error(`A reason is required to mark a sample ${nextStatus}.`);
    }
    if (!actor.trim()) throw new Error('An operator identity is required for custody changes.');
    const now = stamp();
    const action = (
      nextStatus === 'collected'
        ? 'collected'
        : nextStatus === 'received'
          ? 'received'
          : nextStatus === 'processing'
            ? 'centrifuged'
            : nextStatus) as CustodyEvent['action'];
    const event = await chainedCustodyEvent(sample.custody.at(-1), {
      id: generateId(),
      action,
      actor: actor.trim(),
      at: now,
      from: options.from,
      to: options.to,
      location: options.location,
      note: options.reason ?? options.note,
    });
    const custody = [...sample.custody, event];
    const value = SampleSchema.parse({
      ...sample,
      status: nextStatus,
      collector: nextStatus === 'collected' ? actor.trim() : sample.collector,
      collectedAt: nextStatus === 'collected' ? now : sample.collectedAt,
      receivedAt: nextStatus === 'received' ? now : sample.receivedAt,
      storageLocation: options.location ?? sample.storageLocation,
      source: options.source ?? sample.source,
      collectionSite: options.collectionSite ?? sample.collectionSite,
      temperatureC: options.temperatureC ?? sample.temperatureC,
      container: options.container ?? sample.container,
      rejectionReason: nextStatus === 'rejected' ? options.reason?.trim() : sample.rejectionReason,
      custody,
      updatedAt: now,
    });
    await tx.set('samples', sampleId, value);
    await appendAudit(tx, `sample.${nextStatus}`, 'samples', sampleId, actor, now, {
      from: sample.status,
      to: nextStatus,
      reason: options.reason,
      location: options.location,
    });
    updated = { ...value, id: sampleId } as SampleRecord;
  });
  if (!updated) throw new Error('The sample transition could not be saved.');
  return updated;
}

/** Create a replacement specimen while preserving the rejected/lost original. */
export async function createRecollection(
  originalSampleId: string,
  actor: string,
  reason: string,
): Promise<SampleRecord> {
  if (!reason.trim()) throw new Error('A recollection reason is required.');
  const repo = getRepository();
  let replacement: SampleRecord | null = null;
  await repo.transaction(async tx => {
    const originalDoc = await tx.get('samples', originalSampleId);
    if (!originalDoc) throw new Error('The original sample no longer exists.');
    const original = parseSample({ id: originalSampleId, ...originalDoc.data() });
    if (!['rejected', 'lost'].includes(original.status)) {
      throw new Error('Only rejected or lost samples can be recollected.');
    }
    const now = stamp();
    const id = generateId();
    const accessionNo = `ACC-${dayKey(new Date(now))}-${randomSuffix()}`;
    const value = SampleSchema.parse({
      ...original,
      id,
      accessionNo,
      barcode: accessionNo,
      status: 'expected',
      collector: undefined,
      collectedAt: undefined,
      receivedAt: undefined,
      storageLocation: undefined,
      rejectionReason: undefined,
      recollectionOfSampleId: originalSampleId,
      aliquots: [],
      custody: [await chainedCustodyEvent(undefined, {
        id: generateId(),
        action: 'recollected',
        actor: actor.trim(),
        at: now,
        note: reason.trim(),
      })],
      createdAt: now,
      updatedAt: now,
    });
    await tx.set('samples', id, value);
    await appendAudit(tx, 'sample.recollected', 'samples', id, actor, now, {
      originalSampleId,
      reason: reason.trim(),
    });
    replacement = { ...value, id } as SampleRecord;
  });
  if (!replacement) throw new Error('The recollection could not be created.');
  return replacement;
}

/** Append a transfer/aliquot/storage event without changing specimen status. */
export async function recordCustodyEvent(
  sampleId: string,
  action: 'transferred' | 'aliquoted' | 'stored',
  actor: string,
  options: { location?: string; note?: string } = {},
): Promise<SampleRecord> {
  const repo = getRepository();
  let updated: SampleRecord | null = null;
  await repo.transaction(async tx => {
    const doc = await tx.get('samples', sampleId);
    if (!doc) throw new Error('This sample no longer exists.');
    const sample = parseSample({ id: sampleId, ...doc.data() });
    if (['disposed', 'rejected', 'lost'].includes(sample.status)) {
      throw new Error(`Custody actions are not allowed while a sample is ${sample.status}.`);
    }
    if (!actor.trim()) throw new Error('An operator identity is required for custody changes.');
    const now = stamp();
    const aliquots = action === 'aliquoted'
      ? [...sample.aliquots, { id: generateId(), label: `Aliquot ${sample.aliquots.length + 1}`, location: options.location }]
      : sample.aliquots;
    const value = SampleSchema.parse({
      ...sample,
      storageLocation: action === 'stored' ? options.location ?? sample.storageLocation : sample.storageLocation,
      aliquots,
      custody: [
        ...sample.custody,
        await chainedCustodyEvent(sample.custody.at(-1), {
          id: generateId(),
          action,
          actor: actor.trim(),
          at: now,
          to: options.location,
          note: options.note,
        }),
      ],
      updatedAt: now,
    });
    await tx.set('samples', sampleId, value);
    await appendAudit(tx, `sample.${action}`, 'samples', sampleId, actor, now, { location: options.location });
    updated = { ...value, id: sampleId } as SampleRecord;
  });
  if (!updated) throw new Error('The custody event could not be saved.');
  return updated;
}

/** Record a non-clinical output/financial action in the append-only audit log. */
export async function recordAuditEvent(event: {
  action: string;
  entity: string;
  entityId: string;
  actor: string;
  details?: Record<string, unknown>;
}): Promise<AuditEventRecord> {
  const repo = getRepository();
  const id = generateId();
  const value = AuditEventSchema.parse({ ...event, id, at: stamp() });
  await repo.set('auditEvents', id, value);
  return { ...value, id } as AuditEventRecord;
}

/** Hours from collection to receipt; null until both milestones exist. */
export function collectionToReceiptHours(sample: SampleRecord): number | null {
  if (!sample.collectedAt || !sample.receivedAt) return null;
  const hours = (Date.parse(sample.receivedAt) - Date.parse(sample.collectedAt)) / 3_600_000;
  return Number.isFinite(hours) ? roundMoney(hours) : null;
}

/** Hours since collection for TAT alerts; never falls back to registration time. */
export function hoursSinceCollection(sample: SampleRecord, now = new Date()): number | null {
  if (!sample.collectedAt) return null;
  const hours = (now.getTime() - Date.parse(sample.collectedAt)) / 3_600_000;
  return Number.isFinite(hours) ? roundMoney(hours) : null;
}
