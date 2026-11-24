import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  enabled: true,
}));

vi.mock('../data', () => {
  const repo = {
    get: async (_entity: string, id: string) => {
      const value = h.docs.get(id);
      return value ? { id, data: () => value } : null;
    },
    list: async (_entity: string, options?: { where?: Array<{ field: string; value: unknown }> }) =>
      [...h.docs.entries()]
        .filter(([, value]) => (options?.where ?? []).every(filter => value[filter.field] === filter.value))
        .map(([id, value]) => ({ id, data: () => value })),
    set: async (_entity: string, id: string, value: Record<string, unknown>) => { h.docs.set(id, value); },
    add: async (_entity: string, value: Record<string, unknown>) => { h.docs.set(`audit:${value.action}`, value); return String(value.action); },
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(repo),
  };
  return { getRepository: () => repo };
});

vi.mock('../data/query', () => ({ generateId: () => 'payout-1' }));
vi.mock('./price-list', () => ({ getBillingPrefs: () => ({ referralCompliance: { mode: h.enabled ? 'payout-enabled' : 'tracking-only' } }) }));

import { payoutsForDoctor, recordReferralPayout, referralLedgerBalance } from './referral-payouts';

beforeEach(() => {
  h.docs.clear();
  h.enabled = true;
  h.docs.set('d1', { name: 'Dr Rao' });
});

describe('referral payouts', () => {
  it('records an attributed payout and computes the remaining balance', async () => {
    await recordReferralPayout({ doctor: { id: 'd1', name: 'Dr Rao' }, type: 'payout', amount: 400, mode: 'cash', actor: 'Cashier' });
    const entries = await payoutsForDoctor('d1');
    expect(entries).toHaveLength(1);
    expect(referralLedgerBalance(1000, entries)).toEqual({ paid: 400, balance: 600 });
  });

  it('refuses payouts while compliance mode is tracking-only', async () => {
    h.enabled = false;
    await expect(recordReferralPayout({ doctor: { id: 'd1', name: 'Dr Rao' }, type: 'payout', amount: 400, mode: 'cash', actor: 'Cashier' })).rejects.toThrow(/disabled/);
  });
});
