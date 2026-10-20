import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The snapshot folder is a device filesystem, so it is faked here: what is worth
// pinning is which NAME a snapshot is allowed to take, not how a plugin writes
// bytes. A directory that has never been created answers `[]`, exactly as
// `listAppFiles` does on every real platform.
const files = vi.hoisted(() => ({ written: [] as { path: string; data: string }[] }));
vi.mock('./native-files', () => ({
  listAppFiles: async (dir: string) =>
    files.written
      .filter(entry => entry.path.startsWith(`${dir}/`))
      .map(entry => entry.path.slice(dir.length + 1))
      .sort()
      .reverse(),
  writeAppTextFile: async (path: string, data: string) => {
    files.written.push({ path, data });
    return { name: path.split('/').pop() as string, uri: `app://${path}`, path };
  },
  readAppTextFile: async (path: string) => files.written.find(f => f.path === path)?.data ?? '',
  deleteAppFile: async (path: string) => {
    files.written = files.written.filter(entry => entry.path !== path);
  },
  shareAppFile: async () => undefined,
}));

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

import { restoreBackup, createBackup, backupFileName, type BackupFile } from './backup';
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
    // `buildBackup` snapshots every collection through `list`.
    list: async (entity: string) =>
      Object.entries(store[entity] ?? {}).map(([id, data]) => ({ id, data: () => data })),
    // `countRecords` (the "back up soon" nudge) asks for sizes only.
    count: async (entity: string) => Object.keys(store[entity] ?? {}).length,
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
  files.written = [];
});

afterEach(() => {
  vi.useRealTimers();
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

describe('createBackup — a snapshot is never silently replaced', () => {
  /** Freeze the clock so two calls land in the same stamped minute. */
  async function twiceInOneMinute(): Promise<{ first: string; second: string }> {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T18:30:05.000Z'));
    h.repo = makeRepo(undefined, { patients: { p1: { name: 'Asha' } } });
    const first = await createBackup();
    const second = await createBackup();
    vi.useRealTimers();
    return { first: first.fileName, second: second.fileName };
  }

  it('names both snapshots when both are taken inside the same minute', async () => {
    // `stamp` only resolves to the minute and the write is a plain replace, so
    // the second "Back up now" used to overwrite the file the first one just
    // made — data loss with a success toast on it, in the one folder that may
    // hold a lab's only copy of its records.
    const { first, second } = await twiceInOneMinute();
    const stem = backupFileName(new Date('2026-10-19T18:30:05.000Z')).replace(/\.json$/, '');

    expect(first).toBe(`${stem}.json`);
    expect(second).toBe(`${stem}-2.json`);
    expect(files.written.map(entry => entry.path)).toEqual([
      `PathoMitra/Backups/${stem}.json`,
      `PathoMitra/Backups/${stem}-2.json`,
    ]);
  });

  it('keeps stepping past a name that is already taken', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T18:30:05.000Z'));
    h.repo = makeRepo();
    const stem = backupFileName(new Date('2026-10-19T18:30:05.000Z')).replace(/\.json$/, '');
    files.written.push(
      { path: `PathoMitra/Backups/${stem}.json`, data: '{}' },
      { path: `PathoMitra/Backups/${stem}-2.json`, data: '{}' },
    );

    const taken = await createBackup();
    vi.useRealTimers();
    expect(taken.fileName).toBe(`${stem}-3.json`);
  });

  it('reports the real record count on the summary it returns', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T18:31:00.000Z'));
    h.repo = makeRepo(undefined, { patients: { p1: { name: 'Asha' }, p2: { name: 'Bilal' } } });
    const { summary } = await createBackup();
    vi.useRealTimers();

    // The minute rolled over, so this one takes the plain name with no suffix —
    // the suffix is a collision rule, not a new naming scheme. `stamp` reads the
    // *local* clock (the day the lab closes on), so the expected name comes from
    // `backupFileName` itself rather than a literal that would only hold in UTC.
    expect(summary.totalRecords).toBe(2);
    expect(summary.fileName).toBe(backupFileName(new Date('2026-10-19T18:31:00.000Z')));
    expect(summary.encrypted).toBeUndefined();
  });
});
