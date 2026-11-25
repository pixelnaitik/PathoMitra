import { describe, it, expect, beforeEach } from 'vitest';
import { DesktopRepository } from './desktopRepository';
import type { DesktopBridge } from '../lib/desktop-bridge';
import { applyQuery, makeDoc } from './query';
import type { ListOptions } from './types';

/**
 * P0.4 / P0.5 — the desktop `transaction()` is a real atomic unit.
 *
 * The repository is exercised against a fake Electron bridge that mimics the
 * main process: document/query IPC for ordinary writes and a `commit` that
 * applies several collections as ONE all-or-nothing batch. A transaction issues
 * exactly one commit and never a per-document write; any failure leaves the
 * database untouched.
 */

type Collections = Map<string, string>;

function makeBridge(failCommitOn?: (entity: string) => boolean) {
  const collections: Collections = new Map();
  const calls = {
    saves: [] as string[],
    queries: [] as Array<{ entity: string; options?: ListOptions }>,
    commits: 0,
    committedEntities: [] as string[],
  };
  const bridge = {
    kind: 'desktop',
    version: 'test',
    db: {
      init: async () => {},
      load: async (entity: string) => collections.get(entity) ?? null,
      get: async (entity: string, id: string) => {
        const store = JSON.parse(collections.get(entity) ?? '{}') as Record<
          string,
          Record<string, unknown>
        >;
        return store[id] ? JSON.stringify(store[id]) : null;
      },
      query: async (entity: string, options?: ListOptions) => {
        calls.queries.push({ entity, options });
        const store = JSON.parse(collections.get(entity) ?? '{}') as Record<
          string,
          Record<string, unknown>
        >;
        const docs = Object.entries(store).map(([id, data]) => makeDoc(id, data));
        return JSON.stringify(
          applyQuery(docs, options).map(doc => ({ id: doc.id, data: doc.data() })),
        );
      },
      count: async (entity: string, where: ListOptions['where']) => {
        const store = JSON.parse(collections.get(entity) ?? '{}') as Record<
          string,
          Record<string, unknown>
        >;
        return applyQuery(
          Object.entries(store).map(([id, data]) => makeDoc(id, data)),
          { where },
        ).length;
      },
      set: async (entity: string, id: string, json: string) => {
        calls.saves.push(entity);
        const store = JSON.parse(collections.get(entity) ?? '{}') as Record<
          string,
          Record<string, unknown>
        >;
        store[id] = JSON.parse(json) as Record<string, unknown>;
        collections.set(entity, JSON.stringify(store));
      },
      update: async (entity: string, id: string, patchJson: string) => {
        calls.saves.push(entity);
        const store = JSON.parse(collections.get(entity) ?? '{}') as Record<
          string,
          Record<string, unknown>
        >;
        if (!store[id]) throw new Error('missing');
        store[id] = { ...store[id], ...(JSON.parse(patchJson) as Record<string, unknown>) };
        collections.set(entity, JSON.stringify(store));
      },
      delete: async (entity: string, id: string) => {
        const store = JSON.parse(collections.get(entity) ?? '{}') as Record<
          string,
          Record<string, unknown>
        >;
        delete store[id];
        collections.set(entity, JSON.stringify(store));
      },
      save: async (entity: string, json: string) => {
        calls.saves.push(entity);
        collections.set(entity, json);
      },
      clear: async () => {
        collections.clear();
      },
      commit: async (entries: Array<{ entity: string; json: string }>) => {
        calls.commits += 1;
        calls.committedEntities.push(...entries.map(e => e.entity));
        // The main process runs this inside BEGIN/COMMIT: a refusal applies
        // NOTHING, so model that here by throwing before the writes.
        if (failCommitOn && entries.some(e => failCommitOn(e.entity))) {
          throw new Error('commit refused');
        }
        for (const e of entries) collections.set(e.entity, e.json);
      },
    },
  } as unknown as DesktopBridge;
  return { bridge, collections, calls };
}

async function withRepo(failCommitOn?: (entity: string) => boolean) {
  const b = makeBridge(failCommitOn);
  window.pathomitraDesktop = b.bridge;
  const repo = new DesktopRepository();
  await repo.init();
  return { repo, ...b };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  delete window.pathomitraDesktop;
});

describe('DesktopRepository.transaction (P0.4)', () => {
  it('buffers every write and issues ONE commit — never a per-collection save', async () => {
    const { repo, calls, collections } = await withRepo();
    await repo.transaction(async tx => {
      await tx.set('patients', 'p1', { name: 'Asha' });
      await tx.set('patients', 'p2', { name: 'Bilal' });
      await tx.set('reports', 'r1', { status: 'final' });
    });

    expect(calls.commits).toBe(1);
    expect(calls.saves).toEqual([]);
    expect([...calls.committedEntities].sort()).toEqual(['patients', 'reports']);

    const patients = JSON.parse(collections.get('patients') ?? '{}') as Record<string, unknown>;
    expect(Object.keys(patients).sort()).toEqual(['p1', 'p2']);
    const p = await repo.get('patients', 'p1');
    expect(p?.data()).toMatchObject({ name: 'Asha' });
  });

  it('discards all buffered writes when the body throws — the database is untouched', async () => {
    const { repo, calls, collections } = await withRepo();
    await expect(
      repo.transaction(async tx => {
        await tx.set('patients', 'p1', { name: 'X' });
        await tx.set('reports', 'r1', { status: 'final' });
        throw new Error('domain check failed');
      }),
    ).rejects.toThrow('domain check failed');

    expect(calls.commits).toBe(0);
    expect(calls.saves).toEqual([]);
    expect(collections.size).toBe(0);
    expect(await repo.get('patients', 'p1')).toBeNull();
  });

  it('leaves the cache intact when the atomic commit itself fails', async () => {
    const { repo } = await withRepo(entity => entity === 'reports');
    await expect(
      repo.transaction(async tx => {
        await tx.set('patients', 'p1', { name: 'Asha' });
        await tx.set('reports', 'r1', { status: 'final' });
      }),
    ).rejects.toThrow('commit refused');
    // Nothing was promoted, so a later read sees the pre-transaction store (empty).
    expect(await repo.get('patients', 'p1')).toBeNull();
  });

  it('applies a report-amendment pair (history row + live report) together', async () => {
    const { repo, calls, collections } = await withRepo();
    await repo.transaction(async tx => {
      await tx.set('reportVersions', 'r1:v1', { snapshot: 'old' });
      await tx.set('reports', 'r1', { status: 'draft', version: 1 });
      await tx.update('reports', 'r1', { status: 'final', version: 2 });
    });
    expect(calls.commits).toBe(1);
    expect(collections.has('reportVersions')).toBe(true);
    expect(collections.has('reports')).toBe(true);
  });

  it('rejects a nested transaction instead of sharing the outer rollback boundary', async () => {
    const { repo, calls } = await withRepo();
    await expect(
      repo.transaction(async tx => {
        await tx.set('patients', 'p1', { name: 'Asha' });
        await repo.transaction(async inner => {
          await inner.set('reports', 'r1', { status: 'final' });
        });
      }),
    ).rejects.toThrow(/already active/);
    expect(calls.commits).toBe(0);
    expect(await repo.get('patients', 'p1')).toBeNull();
  });

  it('uses paged document queries and server-side counts for ordinary reads', async () => {
    const { repo, calls } = await withRepo();
    await repo.set('patients', 'p1', { name: 'A', createdAt: '2026-01-01' });
    await repo.set('patients', 'p2', { name: 'B', createdAt: '2026-01-03' });
    await repo.set('patients', 'p3', { name: 'C', createdAt: '2026-01-02' });
    const page = await repo.list('patients', {
      orderBy: 'createdAt',
      direction: 'desc',
      limit: 1,
      offset: 1,
    });
    expect(page.map(doc => doc.id)).toEqual(['p3']);
    expect(calls.queries.at(-1)).toMatchObject({
      entity: 'patients',
      options: { limit: 1, offset: 1 },
    });
    expect(await repo.count('patients', [{ field: 'name', op: 'contains', value: 'A' }])).toBe(1);
  });

  it('does not promote a single write into the cache before IPC persistence succeeds', async () => {
    const { repo, bridge } = await withRepo();
    bridge.db.set = async () => {
      throw new Error('IPC write failed');
    };
    await expect(repo.set('patients', 'p1', { name: 'Asha' })).rejects.toThrow(/IPC write failed/);
    expect(await repo.get('patients', 'p1')).toBeNull();
  });

  it('never notifies a listener with a partial transaction', async () => {
    const { repo } = await withRepo();
    const snapshots: string[][] = [];
    const unsub = repo.subscribe('patients', docs => snapshots.push(docs.map(d => d.id).sort()));
    await tick(); // let the subscribe's initial async replay settle

    await repo.transaction(async tx => {
      await tx.set('patients', 'p1', { name: 'A' });
      await tx.set('patients', 'p2', { name: 'B' });
    });
    await tick(); // let the post-commit emit settle
    unsub();

    // Any view that shows p1 must show both — a mid-transaction emit would have
    // shown exactly one, which the suppressed-listeners design forbids.
    for (const snap of snapshots) {
      if (snap.includes('p1')) expect(snap).toEqual(['p1', 'p2']);
    }
    expect(snapshots).toContainEqual(['p1', 'p2']);
  });
});
