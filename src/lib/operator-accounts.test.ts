import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredOperator } from './operator-accounts';

const mocks = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  repo: {
    set: vi.fn(async () => {}),
  },
}));
vi.mock('./secure-store', () => ({
  secureGet: async <T>(key: string): Promise<T | null> =>
    mocks.store.has(key) ? (mocks.store.get(key) as T) : null,
  secureSet: async <T>(key: string, value: T): Promise<void> => {
    mocks.store.set(key, value);
  },
  secureRemove: async (key: string): Promise<void> => {
    mocks.store.delete(key);
  },
}));
vi.mock('../data', () => ({ getRepository: () => mocks.repo }));

const { createAccountWithRecovery } = await import('./local-account');
const { createOperator, listOperatorProfiles, updateOperator, verifyOperatorPassword } =
  await import('./operator-accounts');

describe('operator accounts', () => {
  beforeEach(() => {
    mocks.store.clear();
    mocks.repo.set.mockClear();
  });

  it('creates role-scoped operators and verifies their own credentials', async () => {
    await createAccountWithRecovery('Primary Admin', '4417', false);
    const created = await createOperator(
      { name: 'Asha Tech', username: 'asha.tech', password: '9012', role: 'technologist' },
      { uid: 'local-admin', role: 'admin' },
    );
    expect(created.role).toBe('technologist');
    expect(await verifyOperatorPassword('asha.tech', '9012')).toEqual({ ok: true });
    expect((await verifyOperatorPassword('asha.tech', '0000')).ok).toBe(false);
    expect((await listOperatorProfiles()).map(profile => profile.username)).toEqual([
      'admin',
      'asha.tech',
    ]);
    await updateOperator(created.uid, { disabled: true }, { uid: 'local-admin', role: 'admin' });
    expect((await verifyOperatorPassword('asha.tech', '9012')).ok).toBe(false);
  });

  it('serializes concurrent failed unlocks so no attempt is lost', async () => {
    await createAccountWithRecovery('Primary Admin', '4417', false);
    const created = await createOperator(
      { name: 'Asha Tech', username: 'asha.tech', password: '9012', role: 'technologist' },
      { uid: 'local-admin', role: 'admin' },
    );
    await Promise.all([
      verifyOperatorPassword('asha.tech', '0000'),
      verifyOperatorPassword('asha.tech', '1111'),
    ]);
    const stored = (mocks.store.get('operators') as StoredOperator[]).find(
      item => item.uid === created.uid,
    );
    expect(stored?.failedAttempts).toBe(2);
  });

  it('rejects operator management outside an administrator role', async () => {
    await createAccountWithRecovery('Primary Admin', '4417', false);
    await expect(
      createOperator(
        { name: 'Cashier', username: 'cashier', password: '9012', role: 'cashier' },
        { uid: 'op-cashier', role: 'cashier' },
      ),
    ).rejects.toThrow(/administrator/);
  });
});
