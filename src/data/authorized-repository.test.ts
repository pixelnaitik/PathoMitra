import { describe, expect, it, vi } from 'vitest';
import { AuthorizedRepository, AuthorizationError } from './authorized-repository';
import type { DataRepository, LocalDoc } from './types';

function fakeRepository(): DataRepository {
  const rows = new Map<string, Record<string, Record<string, unknown>>>();
  const repo: DataRepository = {
    init: async () => {},
    list: async entity =>
      Object.entries(rows.get(entity) ?? {}).map(
        ([id, data]) => ({ id, data: () => data }) as LocalDoc,
      ),
    get: async (entity, id) =>
      rows.get(entity)?.[id] ? { id, data: () => rows.get(entity)![id] } : null,
    set: vi.fn(async (entity, id, value) => {
      rows.set(entity, { ...(rows.get(entity) ?? {}), [id]: value });
    }),
    add: vi.fn(async (entity, value) => {
      const id = String(value.id ?? 'generated');
      rows.set(entity, { ...(rows.get(entity) ?? {}), [id]: value });
      return id;
    }),
    update: vi.fn(async (entity, id, patch) => {
      const current = rows.get(entity)?.[id];
      if (!current) throw new Error('missing');
      rows.set(entity, { ...(rows.get(entity) ?? {}), [id]: { ...current, ...patch } });
    }),
    delete: vi.fn(async (entity, id) => {
      const next = { ...(rows.get(entity) ?? {}) };
      delete next[id];
      rows.set(entity, next);
    }),
    count: async entity => Object.keys(rows.get(entity) ?? {}).length,
    subscribe: () => () => {},
    transaction: async fn => fn(repo),
    clearAll: vi.fn(async () => rows.clear()),
  };
  return repo;
}

describe('AuthorizedRepository', () => {
  it('denies every mutation without an authenticated actor', async () => {
    const repo = new AuthorizedRepository(fakeRepository());
    await expect(repo.set('patients', 'p1', { name: 'Test' })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(repo.clearAll()).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('enforces entity permissions and records actor-attributed audit events', async () => {
    const inner = fakeRepository();
    const repo = new AuthorizedRepository(inner, { uid: 'staff-1', role: 'staff' });
    await repo.set('patients', 'p1', { name: 'Test Patient' });
    await expect(repo.set('doctors', 'd1', { name: 'Dr Test' })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    const audit = await inner.list('auditEvents');
    expect(audit).toHaveLength(1);
    expect(audit[0].data()).toMatchObject({
      entity: 'patients',
      entityId: 'p1',
      actor: 'staff-1',
      actorRole: 'staff',
    });
  });

  it('keeps the actor bound inside transactions', async () => {
    const repo = new AuthorizedRepository(fakeRepository(), { uid: 'cashier-1', role: 'cashier' });
    await expect(
      repo.transaction(async tx => {
        await tx.set('patients', 'p1', { name: 'Allowed' });
        await tx.set('doctors', 'd1', { name: 'Denied' });
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('allows administrator-only doctor and settings writes', async () => {
    const repo = new AuthorizedRepository(fakeRepository(), { uid: 'admin-1', role: 'admin' });
    await expect(repo.set('doctors', 'd1', { name: 'Dr Test' })).resolves.toBeUndefined();
    await repo.set('labSettings', 'main', { labName: 'Old Lab' });
    await expect(
      repo.update('labSettings', 'main', { labName: 'Test Lab' }),
    ).resolves.toBeUndefined();
  });
});
