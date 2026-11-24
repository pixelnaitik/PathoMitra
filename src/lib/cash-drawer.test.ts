import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>() }));

vi.mock('../data', () => {
  const matches = (data: Record<string, unknown>, filters: Array<{ field: string; op: string; value: unknown }> = []) =>
    filters.every(filter => filter.op === '>=' ? String(data[filter.field] ?? '') >= String(filter.value) : data[filter.field] === filter.value);
  const repo = {
    get: async (_entity: string, id: string) => {
      const value = h.docs.get(id);
      return value ? { id, data: () => value } : null;
    },
    list: async (entity: string, options?: { where?: Array<{ field: string; op: string; value: unknown }> }) =>
      [...h.docs.entries()]
        .filter(([id]) => entity === 'meta' ? id.startsWith('cash-shift:') : id.startsWith('payments/'))
        .filter(([, value]) => matches(value, options?.where))
        .map(([id, value]) => ({ id: id.split('/').at(-1)!, data: () => value })),
    set: async (_entity: string, id: string, value: Record<string, unknown>) => { h.docs.set(id, value); },
    add: async (_entity: string, value: Record<string, unknown>) => { h.docs.set(`audit/${value.action}`, value); return String(value.action); },
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(repo),
  };
  return { getRepository: () => repo };
});

vi.mock('../data/query', () => ({ generateId: () => 'shift-1' }));

import { closeCashShift, getOpenCashShift, openCashShift } from './cash-drawer';

beforeEach(() => h.docs.clear());

describe('cash drawer shifts', () => {
  it('opens one active shift and reconciles cash receipts and refunds', async () => {
    const shift = await openCashShift(500, 'Cashier');
    h.docs.set('payments/p1', { invoiceId: 'i1', type: 'payment', amount: 200, mode: 'cash', actor: 'Cashier', at: shift.openedAt });
    h.docs.set('payments/p2', { invoiceId: 'i1', type: 'refund', amount: 50, mode: 'cash', actor: 'Cashier', at: shift.openedAt });
    expect((await getOpenCashShift())?.id).toBe(shift.id);
    const closed = await closeCashShift(shift.id, 645, 'Cashier');
    expect(closed).toMatchObject({ expectedCash: 650, countedCash: 645, difference: -5, status: 'closed' });
  });

  it('refuses a second open shift', async () => {
    await openCashShift(500, 'Cashier');
    await expect(openCashShift(100, 'Cashier')).rejects.toThrow(/already open/);
  });
});
