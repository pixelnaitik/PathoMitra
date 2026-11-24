import { describe, expect, it, vi } from 'vitest';
import type { DataRepository } from './types';
import { guardRepository, setRepositoryWriteGuard, withRecoveryWrites } from './write-guard';

function fakeRepository(): DataRepository {
  return {
    init: vi.fn(async () => {}), list: vi.fn(async () => []), get: vi.fn(async () => null),
    set: vi.fn(async () => {}), add: vi.fn(async () => 'id'), update: vi.fn(async () => {}),
    delete: vi.fn(async () => {}), count: vi.fn(async () => 0), subscribe: vi.fn(() => () => {}),
    transaction: vi.fn(async fn => { await fn(fakeRepository()); }), clearAll: vi.fn(async () => {}),
  };
}

describe('repository write guard', () => {
  it('pauses every mutation but permits reads and explicit recovery writes', async () => {
    const raw = fakeRepository();
    const repo = guardRepository(raw);
    setRepositoryWriteGuard(() => { throw new Error('safe mode'); });
    try {
      await expect(repo.set('patients', 'p1', {})).rejects.toThrow(/safe mode/);
      await expect(repo.list('patients')).resolves.toEqual([]);
      await withRecoveryWrites(async () => { await repo.set('patients', 'p1', { restored: true }); });
      expect(raw.set).toHaveBeenCalledOnce();
    } finally { setRepositoryWriteGuard(null); }
  });

  it('guards documents written inside a transaction', async () => {
    const repo = guardRepository(fakeRepository());
    setRepositoryWriteGuard(() => { throw new Error('safe mode'); });
    try {
      await expect(repo.transaction(async tx => { await tx.set('patients', 'p1', {}); })).rejects.toThrow(/safe mode/);
    } finally { setRepositoryWriteGuard(null); }
  });
});
