import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataRepository } from '../data/types';

const h = vi.hoisted(() => ({
  docs: new Map<string, Map<string, Record<string, unknown>>>(),
  transactions: 0,
  failSampleWrite: false,
}));

vi.mock('../data', () => {
  const collection = (name: string) => {
    let map = h.docs.get(name);
    if (!map) {
      map = new Map();
      h.docs.set(name, map);
    }
    return map;
  };
  const repo = {
    get: async (name: string, id: string) => {
      const value = collection(name).get(id);
      return value ? { id, data: () => value } : null;
    },
    list: async (
      name: string,
      options?: { where?: Array<{ field: string; op: string; value: unknown }> },
    ) =>
      [...collection(name)]
        .map(([id, value]) => ({ id, data: () => value }))
        .filter(doc =>
          (options?.where ?? []).every(filter => {
            const actual = doc.data()[filter.field];
            if (filter.op === '==') return actual === filter.value;
            if (filter.op === 'in')
              return Array.isArray(filter.value) && filter.value.includes(actual);
            return true;
          }),
        ),
    set: async (name: string, id: string, value: Record<string, unknown>) => {
      if (name === 'samples' && h.failSampleWrite) throw new Error('sample write failed');
      collection(name).set(id, value);
    },
    add: async (name: string, value: Record<string, unknown>) => {
      const id = String(value.id ?? `id-${collection(name).size + 1}`);
      collection(name).set(id, value);
      return id;
    },
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      h.transactions += 1;
      const snapshot = new Map([...h.docs].map(([name, values]) => [name, new Map(values)]));
      try {
        await fn(repo);
      } catch (error) {
        h.docs.clear();
        snapshot.forEach((values, name) => h.docs.set(name, values));
        throw error;
      }
    },
  };
  return { getRepository: () => repo };
});

vi.mock('./price-list', () => ({
  resolvePriceDetails: (name: string) =>
    name.includes('HB ')
      ? { price: 120, source: 'lab', approved: true }
      : name.includes('SUGGESTED')
        ? { price: 300, source: 'suggested', approved: false }
        : null,
}));

import {
  amendOrder,
  collectionToReceiptHours,
  createOrder,
  createOrderWithSamples,
  createRecollection,
  createSamplesForOrder,
  hoursSinceCollection,
  recordCustodyEvent,
  transitionOrder,
  transitionSample,
  verifyCustodyChain,
} from './clinical-workflow';

const NOW = new Date('2026-11-24T10:00:00.000Z');

beforeEach(() => {
  h.docs.clear();
  h.transactions = 0;
  h.failSampleWrite = false;
  h.docs.set(
    'patients',
    new Map([
      [
        'p1',
        {
          id: 'p1',
          name: 'Asha Rao',
          age: 30,
          gender: 'female',
          createdAt: NOW.toISOString(),
        },
      ],
    ]),
  );
});

describe('order lifecycle', () => {
  it('creates the order and expected specimens in one transaction', async () => {
    const { order, samples } = await createOrderWithSamples({
      patientId: 'p1',
      tests: ['HB (HAEMOGLOBIN)'],
      actor: 'Tech One',
      now: NOW,
    });
    expect(h.transactions).toBe(1);
    expect(samples).toHaveLength(1);
    expect(samples[0].orderId).toBe(order.id);
    expect([...h.docs.get('auditEvents')!.values()].map(event => event.action)).toEqual([
      'order.created',
      'sample.expected',
    ]);
  });

  it('runs an aggregate callback once and returns the committed result on retry', async () => {
    let callbackCalls = 0;
    const input = {
      patientId: 'p1',
      tests: ['HB (HAEMOGLOBIN)'],
      actor: 'Tech One',
      now: NOW,
      allowDuplicate: true,
    };
    const hooks = {
      id: 'order-fixed',
      operationId: 'report-create-r1',
      afterCreate: async (tx: DataRepository) => {
        callbackCalls += 1;
        await tx.set('reports', 'r1', { status: 'draft', orderId: 'order-fixed' });
      },
    };
    const first = await createOrderWithSamples(input, hooks);
    const second = await createOrderWithSamples(input, hooks);
    expect(callbackCalls).toBe(1);
    expect(second.order.id).toBe(first.order.id);
    expect(second.samples.map(sample => sample.id)).toEqual(first.samples.map(sample => sample.id));
    expect(h.docs.get('orders')?.size).toBe(1);
    expect(h.docs.get('reports')?.has('r1')).toBe(true);
  });

  it('rolls back the order and audit events when specimen creation fails', async () => {
    h.failSampleWrite = true;
    await expect(
      createOrderWithSamples({
        patientId: 'p1',
        tests: ['HB (HAEMOGLOBIN)'],
        actor: 'Tech One',
        now: NOW,
      }),
    ).rejects.toThrow(/sample write failed/);
    expect(h.docs.get('orders')?.size ?? 0).toBe(0);
    expect(h.docs.get('samples')?.size ?? 0).toBe(0);
    expect(h.docs.get('auditEvents')?.size ?? 0).toBe(0);
  });

  it('allocates database-unique monthly order numbers', async () => {
    const first = await createOrder({
      patientId: 'p1',
      tests: ['HB (HAEMOGLOBIN)'],
      actor: 'Tech One',
      now: NOW,
    });
    const second = await createOrder({
      patientId: 'p1',
      tests: ['HB (HAEMOGLOBIN)'],
      actor: 'Tech One',
      now: NOW,
      allowDuplicate: true,
    });
    expect(first.orderNo).toBe('ORD-2611-0001');
    expect(second.orderNo).toBe('ORD-2611-0002');
  });

  it('supersedes an order with a linked replacement and retains the original', async () => {
    const original = await createOrder({
      patientId: 'p1',
      tests: ['HB (HAEMOGLOBIN)'],
      actor: 'Tech One',
      now: NOW,
    });
    const amended = await amendOrder(original.id, 'Tech One', 'Correct specimen instruction');
    expect(amended.original.status).toBe('amended');
    expect(amended.replacement).toMatchObject({
      status: 'ordered',
      supersedesOrderId: original.id,
      revision: 2,
    });
    expect(amended.replacement.id).not.toBe(original.id);
    expect(amended.samples).toHaveLength(1);
    expect(h.docs.get('orders')?.has(original.id)).toBe(true);
  });

  it('freezes approved tariffs and rejects an unreviewed duplicate active order', async () => {
    const order = await createOrder({
      patientId: 'p1',
      tests: ['HB (HAEMOGLOBIN)'],
      actor: 'Tech One',
      now: NOW,
    });
    expect(order.items[0]).toMatchObject({
      name: 'HB (HAEMOGLOBIN)',
      unitPrice: 120,
      priceApproved: true,
      priceSource: 'lab',
    });
    expect(order.status).toBe('ordered');
    await expect(
      createOrder({ patientId: 'p1', tests: ['HB (HAEMOGLOBIN)'], actor: 'Tech One', now: NOW }),
    ).rejects.toThrow(/active order/);
    const duplicate = await createOrder({
      patientId: 'p1',
      tests: ['HB (HAEMOGLOBIN)'],
      actor: 'Tech One',
      allowDuplicate: true,
      now: NOW,
    });
    expect(duplicate.id).not.toBe(order.id);
  });

  it('does not turn an unapproved suggestion into an order charge', async () => {
    const order = await createOrder({
      patientId: 'p1',
      tests: ['SUGGESTED TEST'],
      actor: 'Tech One',
      now: NOW,
    });
    expect(order.items[0]).toMatchObject({
      unitPrice: 0,
      priceApproved: false,
      priceSource: 'suggested',
    });
  });

  it('enforces transitions and requires cancellation attribution', async () => {
    const order = await createOrder({
      patientId: 'p1',
      tests: ['HB (HAEMOGLOBIN)'],
      actor: 'Tech One',
      now: NOW,
    });
    await expect(transitionOrder(order.id, 'issued', 'Tech One')).rejects.toThrow(/cannot move/);
    await expect(transitionOrder(order.id, 'cancelled', 'Tech One')).rejects.toThrow(/reason/);
    const cancelled = await transitionOrder(
      order.id,
      'cancelled',
      'Tech One',
      'Duplicate requisition',
    );
    expect(cancelled.cancelledReason).toBe('Duplicate requisition');
    expect([...h.docs.get('auditEvents')!.values()].at(-1)?.action).toBe('order.cancelled');
  });
});

describe('sample lifecycle and custody', () => {
  it('creates expected specimens idempotently and records real collection milestones', async () => {
    const order = await createOrder({
      patientId: 'p1',
      tests: ['HB (HAEMOGLOBIN)'],
      actor: 'Tech One',
      now: NOW,
    });
    const first = await createSamplesForOrder(order.id, 'Tech One');
    const second = await createSamplesForOrder(order.id, 'Tech One');
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(first[0].accessionNo).toMatch(/^ACC-\d{8}-\d{6}$/);
    const collected = await transitionSample(first[0].id, 'collected', 'Collector One', {
      source: 'Peripheral blood',
      collectionSite: 'OPD 2',
      temperatureC: 22,
      container: 'EDTA tube',
    });
    expect(collected.collectedAt).toBeTruthy();
    expect(collected).toMatchObject({
      source: 'Peripheral blood',
      collectionSite: 'OPD 2',
      temperatureC: 22,
      container: 'EDTA tube',
    });
    expect(collected.custody[0]).toMatchObject({
      action: 'collected',
      actor: 'Collector One',
      eventHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(await verifyCustodyChain(collected)).toEqual({ valid: true });
    collected.custody[0].note = 'Modified after recording';
    expect((await verifyCustodyChain(collected)).valid).toBe(false);
    expect(hoursSinceCollection(collected, new Date(collected.collectedAt!))).toBe(0);
  });

  it('allocates globally unique accessions across orders', async () => {
    const first = await createOrderWithSamples({
      patientId: 'p1',
      tests: ['HB (HAEMOGLOBIN)'],
      actor: 'Tech One',
      now: NOW,
      allowDuplicate: true,
    });
    const second = await createOrderWithSamples({
      patientId: 'p1',
      tests: ['HB (HAEMOGLOBIN)'],
      actor: 'Tech One',
      now: NOW,
      allowDuplicate: true,
    });
    expect(first.samples[0].accessionNo).not.toBe(second.samples[0].accessionNo);
  });

  it('requires rejection reasons and links a recollection to the original', async () => {
    const order = await createOrder({
      patientId: 'p1',
      tests: ['HB (HAEMOGLOBIN)'],
      actor: 'Tech One',
      now: NOW,
    });
    const [sample] = await createSamplesForOrder(order.id, 'Tech One');
    await transitionSample(sample.id, 'collected', 'Collector One');
    await expect(transitionSample(sample.id, 'rejected', 'Tech One')).rejects.toThrow(/reason/);
    await transitionSample(sample.id, 'rejected', 'Tech One', { reason: 'Clotted' });
    const replacement = await createRecollection(
      sample.id,
      'Collector One',
      'Repeat draw from opposite arm',
    );
    expect(replacement.recollectionOfSampleId).toBe(sample.id);
    expect(replacement.status).toBe('expected');
    expect(replacement.custody[0]).toMatchObject({ action: 'recollected', actor: 'Collector One' });
  });

  it('appends transfer, aliquot, and storage events without erasing prior custody', async () => {
    const order = await createOrder({
      patientId: 'p1',
      tests: ['HB (HAEMOGLOBIN)'],
      actor: 'Tech One',
      now: NOW,
    });
    const [sample] = await createSamplesForOrder(order.id, 'Tech One');
    await transitionSample(sample.id, 'collected', 'Collector One');
    await transitionSample(sample.id, 'received', 'Receiver One');
    await recordCustodyEvent(sample.id, 'transferred', 'Tech One', { location: 'Chemistry bench' });
    const aliquoted = await recordCustodyEvent(sample.id, 'aliquoted', 'Tech One', {
      location: 'Rack A',
    });
    const stored = await recordCustodyEvent(sample.id, 'stored', 'Tech One', {
      location: 'Rack A / Shelf 2',
    });
    expect(stored.custody.map(event => event.action)).toEqual([
      'collected',
      'received',
      'transferred',
      'aliquoted',
      'stored',
    ]);
    expect(stored.aliquots).toHaveLength(1);
    expect(stored.storageLocation).toBe('Rack A / Shelf 2');
    expect(aliquoted.aliquots[0].location).toBe('Rack A');
  });

  it('computes transit only from collection and receipt, never registration', () => {
    const base = {
      id: 's1',
      accessionNo: 'ACC-1',
      barcode: 'ACC-1',
      orderId: 'o1',
      orderItemId: 'i1',
      patientId: 'p1',
      specimen: 'Blood',
      container: 'EDTA',
      source: '',
      status: 'received' as const,
      aliquots: [],
      custody: [],
      createdAt: '2026-11-24T10:00:00.000Z',
      updatedAt: '2026-11-24T10:00:00.000Z',
    };
    expect(hoursSinceCollection(base as never, NOW)).toBeNull();
    expect(collectionToReceiptHours(base as never)).toBeNull();
    expect(
      collectionToReceiptHours({
        ...base,
        collectedAt: '2026-11-24T10:00:00.000Z',
        receivedAt: '2026-11-24T12:30:00.000Z',
      } as never),
    ).toBe(2.5);
  });
});
