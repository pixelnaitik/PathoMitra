import { describe, it, expect, vi, beforeEach } from 'vitest';

// The restore path touches the store through `initDataStore()` (and, since the
// billing feature, through the Firestore-shaped façade in `data/fs` when it
// re-reads the price list), so the whole data layer is replaced with a small
// fake whose transaction is transactional (snapshot + rollback) to mirror
// SqliteRepository's contract.
const h = vi.hoisted(() => ({ repo: null as unknown }));
vi.mock('../data', () => ({
  initDataStore: async () => h.repo,
  getRepository: () => h.repo,
  isNative: false,
  isShell: false,
}));

import { restoreBackup, type BackupFile } from './backup';
import { getPriceList, priceKey, resetPriceListCache } from './price-list';

type Store = Record<string, Record<string, unknown>>;

interface FakeRepo {
  store: Store;
  [key: string]: unknown;
}

function makeBackup(data: BackupFile['data']): BackupFile {
  return {
    app: 'PathoMitra',
    kind: 'backup',
    schemaVersion: 1,
    createdAt: '2026-10-14T00:00:00.000Z',
    counts: {},
    data,
  };
}

/** A repository whose `transaction` rolls back on any thrown failure. */
function makeRepo(failOn?: (entity: string, id: string) => boolean, seed: Store = {}): FakeRepo {
  const store: Store = structuredClone(seed);
  const repo: FakeRepo = {
    store,
    set: async (entity: string, id: string, value: Record<string, unknown>) => {
      if (failOn?.(entity, id)) throw new Error(`write refused: ${entity}/${id}`);
      (store[entity] ??= {})[id] = value;
    },
    // `data/fs` reads single documents through this — the price-list reload after
    // a restore goes here, so it has to answer like the real adapters do.
    get: async (entity: string, id: string) => {
      const value = store[entity]?.[id];
      if (!value) return null;
      return { id, data: () => value };
    },
    transaction: async (fn: (tx: FakeRepo) => Promise<void>) => {
      const snapshot = structuredClone(store);
      try {
        await fn(repo);
      } catch (error) {
        for (const key of Object.keys(store)) delete store[key];
        Object.assign(store, snapshot);
        throw error;
      }
    },
  };
  return repo;
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  resetPriceListCache();
});

describe('restoreBackup (P0.9 — atomic, validated, honest)', () => {
  it('applies every known collection and reports the real counts + skips', async () => {
    const repo = makeRepo();
    h.repo = repo;
    const result = await restoreBackup(
      makeBackup({
        patients: [
          { id: 'p1', name: 'Asha' },
          { id: 'p2', name: 'Bilal' },
        ],
        reports: [{ id: 'r1', status: 'final' }],
        billingModule: [{ id: 'x' }], // unknown -> skipped, never guessed at
      }),
    );
    expect(result.totalRecords).toBe(3);
    expect(result.counts.patients).toBe(2);
    expect(result.counts.reports).toBe(1);
    expect(result.skipped).toEqual(['billingModule']);
    expect(repo.store.patients.p1).toMatchObject({ name: 'Asha' });
    expect(repo.store.billingModule).toBeUndefined();
  });

  it('rejects a malformed document before a single write reaches the store', async () => {
    const repo = makeRepo(undefined, { patients: { existing: { name: 'Keep me' } } });
    h.repo = repo;
    await expect(
      restoreBackup(
        makeBackup({
          patients: [
            { id: 'good', name: 'Would be applied' },
            { id: '', name: 'Missing id' },
          ],
        }),
      ),
    ).rejects.toThrow(/aborted before any change/);
    // Nothing in the snapshot was applied; the pre-existing record is untouched.
    expect(repo.store.patients.good).toBeUndefined();
    expect(repo.store.patients.existing).toMatchObject({ name: 'Keep me' });
  });

  it('rolls the whole restore back when a mid write fails — never a partial success', async () => {
    const repo = makeRepo((entity, id) => entity === 'reports' && id === 'r2', {
      patients: { p0: { name: 'Original' } },
    });
    h.repo = repo;
    await expect(
      restoreBackup(
        makeBackup({
          patients: [{ id: 'p1', name: 'New' }],
          reports: [
            { id: 'r1', status: 'final' },
            { id: 'r2', status: 'final' }, // this write is refused
          ],
        }),
      ),
    ).rejects.toThrow(/write refused/);
    // The successful earlier writes were rolled back with the failure.
    expect(repo.store.patients.p1).toBeUndefined();
    expect(repo.store.reports?.r1).toBeUndefined();
    // Pre-existing data survived intact.
    expect(repo.store.patients.p0).toMatchObject({ name: 'Original' });
  });

  it('re-reads the price list after a restore, so billing resumes on restored tariffs', async () => {
    // `meta/price-list` travels inside the snapshot. Without the forced reload the
    // lab would keep charging the prices it had *before* the restore — silently
    // the wrong tariff on a printed bill.
    const repo = makeRepo();
    h.repo = repo;
    await restoreBackup(
      makeBackup({
        patients: [{ id: 'p1', name: 'Asha' }],
        meta: [
          {
            id: 'price-list',
            version: 1,
            entries: {
              [priceKey('CBC (COMPLETE BLOOD COUNT)')]: {
                name: 'CBC (COMPLETE BLOOD COUNT)',
                price: 275,
                active: true,
                kind: 'panel',
              },
            },
            updatedAt: '2026-10-01T00:00:00.000Z',
            updatedBy: 'restore',
          },
        ],
      }),
    );

    // Asserted through the entry the bill actually reads, not the map key: the
    // stored key is a folded form (`normalizeSearchTerm` drops punctuation), and
    // pinning it here would only test the folding rule, which has its own tests.
    const entry = getPriceList().entries[priceKey('CBC (COMPLETE BLOOD COUNT)')];
    expect(entry).toMatchObject({ price: 275, kind: 'panel' });
  });

  it('re-folds a stored key on restore rather than trusting the document', async () => {
    // A snapshot from an older build, or a hand-edited file, may carry a key the
    // current fold would not produce. Sanitising on read is what keeps
    // `resolvePrice` from missing an entry that is plainly in the document.
    const repo = makeRepo();
    h.repo = repo;
    await restoreBackup(
      makeBackup({
        meta: [
          {
            id: 'price-list',
            version: 1,
            entries: {
              cbc_complete_blood_count: { name: 'CBC (COMPLETE BLOOD COUNT)', price: 300 },
            },
          },
        ],
      }),
    );

    expect(getPriceList().entries[priceKey('CBC (COMPLETE BLOOD COUNT)')]?.price).toBe(300);
  });

  it('still reports a successful restore when the price list is absent', async () => {
    const repo = makeRepo();
    h.repo = repo;
    const result = await restoreBackup(makeBackup({ patients: [{ id: 'p1', name: 'Asha' }] }));
    expect(result.totalRecords).toBe(1);
    expect(getPriceList().entries).toEqual({});
  });
});
