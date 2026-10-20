import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The store is faked: what is worth pinning here is the *arithmetic* — which line
 * a bill gets, and at what price — because that arithmetic decides what a patient
 * is charged. The read/write plumbing is the same document shim every other lib
 * uses and is covered at the repository layer.
 */
const store = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  writes: [] as { path: string; id: string; data: Record<string, unknown> }[],
}));

vi.mock('../data/fs', () => ({
  db: {},
  doc: (_db: unknown, path: string, id: string) => ({ path, id }),
  getDoc: async (ref: { path: string; id: string }) => {
    const found = store.documents.get(`${ref.path}/${ref.id}`);
    return { exists: () => found !== undefined, data: () => found ?? {} };
  },
  setDoc: async (ref: { path: string; id: string }, data: Record<string, unknown>) => {
    store.documents.set(`${ref.path}/${ref.id}`, data);
    store.writes.push({ path: ref.path, id: ref.id, data });
  },
}));

vi.mock('./telemetry', () => ({ captureError: vi.fn() }));

import {
  billLinesFrom,
  billableTests,
  bulkAdjustPrices,
  clearPrice,
  DEFAULT_BILLING_PREFS,
  getBillingPrefs,
  getPriceList,
  isOrderable,
  loadPriceList,
  priceKey,
  resolveKind,
  resolvePrice,
  saveBillingPrefs,
  sanitizeBillingPrefs,
  sanitizePriceList,
  setOrderable,
  unpricedNames,
  upsertPrice,
  BILLING_PREFS_DOC_ID,
  PRICE_LIST_DOC_ID,
  resetPriceListCache,
  type PriceList,
} from './price-list';
import { DEFAULT_PATHOLOGY_TESTS, type PathologyTest } from './pathology-tests';
import { writeCustomTests } from './settings';

/** The catalogue's real CBC panel — the case that overcharges if pricing is naive. */
const CBC = 'CBC (COMPLETE BLOOD COUNT)';
const CBC_MEMBERS = [
  'WHITE CELL COUNT(TC)',
  'HB (HAEMOGLOBIN)',
  'RBC (RED BLOOD CELLS)',
  'PLATELET COUNT',
];

/**
 * A package the lab made itself, with two components nobody can buy alone.
 *
 * Since 2026-10-17 every built-in catalogue entry carries a suggested market
 * rate, so a *lab-made* panel is the only way to reach the "package with no
 * price" branch any more — and that branch still has to hold: one flagged line,
 * never a wall of unpriced components. `findTestInfo` reads the catalogue plus
 * whatever `readCustomTests()` returns from localStorage, which `beforeEach`
 * clears, so this has to be seeded inside the test that uses it.
 */
const OWN_PANEL = 'MY LAB PANEL';
const OWN_MEMBER_ONE = 'LAB ASSAY ONE';
const OWN_MEMBER_TWO = 'LAB ASSAY TWO';

function seedOwnPanel() {
  writeCustomTests([
    {
      id: 'custom_own_panel',
      name: OWN_PANEL,
      category: 'CUSTOM',
      isGroup: true,
      includedTests: [OWN_MEMBER_ONE, OWN_MEMBER_TWO],
    },
  ]);
}

type EntryInput = number | { price: number; active?: boolean; kind?: 'test' | 'panel' };

function list(entries: Record<string, EntryInput>): PriceList {
  const built: PriceList = { version: 1, entries: {}, updatedAt: '', updatedBy: 'tester' };
  for (const [name, value] of Object.entries(entries)) {
    const entry: { price: number; active?: boolean; kind?: 'test' | 'panel' } =
      typeof value === 'number' ? { price: value } : value;
    built.entries[priceKey(name)] = {
      name,
      price: entry.price,
      active: entry.active !== false,
      kind: entry.kind ?? resolveKind(name),
      effectiveFrom: '2026-10-01T00:00:00.000Z',
    };
  }
  return built;
}

beforeEach(() => {
  store.documents.clear();
  store.writes.length = 0;
  localStorage.clear();
  resetPriceListCache();
});

describe('priceKey', () => {
  it('folds punctuation, case and spelling variants like the catalogue does', () => {
    expect(priceKey('  H.D.L. ')).toBe(priceKey('hdl'));
    expect(priceKey('Haemoglobin')).toBe(priceKey('hemoglobin'));
    expect(priceKey('Platelets')).toBe(priceKey('PLATELET'));
  });

  it('is empty for nothing to key on', () => {
    expect(priceKey('   ')).toBe('');
  });
});

describe('sanitizePriceList', () => {
  it('accepts a well-formed document', () => {
    const input = {
      version: 1,
      entries: { hb: { name: 'HB', price: 250, active: true, kind: 'test', effectiveFrom: 'x' } },
      updatedAt: 'u',
      updatedBy: 'admin',
    };
    expect(sanitizePriceList(input).entries.hb?.price).toBe(250);
  });

  it('drops a non-object, a list with no entries, and unknown entry shapes', () => {
    expect(sanitizePriceList(null).entries).toEqual({});
    expect(sanitizePriceList({}).entries).toEqual({});
    expect(sanitizePriceList({ entries: { a: 'nope' } }).entries).toEqual({});
  });

  it('clamps a hostile stored price instead of trusting it', () => {
    const result = sanitizePriceList({
      entries: {
        big: { name: 'big', price: 9e12 },
        neg: { name: 'neg', price: -500 },
        nan: { name: 'nan', price: 'abc' },
      },
    });
    expect(result.entries.big?.price).toBe(1_000_000);
    expect(result.entries.neg?.price).toBe(0);
    expect(result.entries.nan?.price).toBe(0);
  });

  it('bounds the stored history and keeps only usable rows', () => {
    const result = sanitizePriceList({
      entries: {
        hb: {
          name: 'HB',
          price: 100,
          history: Array.from({ length: 40 }, (_, i) => ({
            price: i,
            changedAt: 'x',
            changedBy: 'y',
          })),
        },
      },
    });
    expect(result.entries.hb?.history ?? []).toHaveLength(12);
  });

  it('keeps a restored entry whose history is malformed', () => {
    const result = sanitizePriceList({
      entries: { hb: { name: 'HB', price: 100, history: 'no' } },
    });
    expect(result.entries.hb?.price).toBe(100);
    expect(result.entries.hb?.history).toBeUndefined();
  });
});

describe('resolvePrice', () => {
  it('returns null, not 0, when neither the lab nor the catalogue has a rate', () => {
    expect(resolvePrice(OWN_MEMBER_ONE, list({}))).toBeNull();
  });

  it("falls back to the catalogue's suggested rate for a name the lab never priced", () => {
    // The bill an unconfigured lab prints used to be ₹0 with "not priced" on
    // every line. The suggested tariff is what fixed that, so it is asserted.
    expect(resolvePrice('HB (HAEMOGLOBIN)', list({}))).toBe(80);
    expect(resolvePrice(CBC, list({}))).toBe(300);
  });

  it("keeps the lab's own figure over the suggested one", () => {
    expect(resolvePrice('HB (HAEMOGLOBIN)', list({ 'HB (HAEMOGLOBIN)': 120 }))).toBe(120);
  });

  it('falls back to the suggested rate once the lab clears its own price', async () => {
    await upsertPrice({ name: 'HB (HAEMOGLOBIN)', price: 120, actor: 'a' });
    expect(resolvePrice('HB (HAEMOGLOBIN)')).toBe(120);
    await clearPrice('HB (HAEMOGLOBIN)', 'a');
    // The lab's entry is gone, so the bill prints the catalogue suggestion —
    // clearing a price is not the same as making a test free, and "not priced"
    // is reserved for a line nothing at all backs.
    expect(resolvePrice('HB (HAEMOGLOBIN)')).toBe(80);
  });

  it('finds the entry through the folded name, not only the exact spelling', () => {
    const prices = list({ 'HB (HAEMOGLOBIN)': 300 });
    expect(resolvePrice('hb (hemoglobin)', prices)).toBe(300);
  });

  it('treats a set zero as a real price', () => {
    expect(resolvePrice('HB (HAEMOGLOBIN)', list({ 'HB (HAEMOGLOBIN)': 0 }))).toBe(0);
  });

  it('prices a package, not the sum of its parts', () => {
    const cbc = DEFAULT_PATHOLOGY_TESTS.find(t => t.name === CBC);
    const memberSum = (cbc?.includedTests ?? []).reduce(
      (sum, member) => sum + (resolvePrice(member, list({})) ?? 0),
      0,
    );
    // A panel is sold as one job on one analyser: the rate has to sit under the
    // components' total, or the "package" line would be the expensive option.
    expect(memberSum).toBeGreaterThan(0);
    expect(resolvePrice(CBC, list({}))).toBeLessThan(memberSum);
  });
});

describe('isOrderable', () => {
  it('defaults to orderable when nothing is recorded', () => {
    expect(isOrderable('Serum Creatinine', list({}))).toBe(true);
  });

  it('blocks only an explicit pause, and keeps the price', () => {
    const prices = list({ 'Serum Creatinine': { price: 400, active: false } });
    expect(isOrderable('Serum Creatinine', prices)).toBe(false);
    expect(resolvePrice('Serum Creatinine', prices)).toBe(400);
  });
});

describe('billLinesFrom — the panel double-count guard', () => {
  /**
   * `PatientsPage.addTest` stores the panel AND every member in `testSelection`,
   * so a naive price pass charges the CBC panel plus its ~20 components. These
   * tests are the reason the pricing walk reads the raw order, not the leaves.
   */
  it('charges a priced panel once and never again for its members', () => {
    const order = [CBC, ...CBC_MEMBERS, 'HB (HAEMOGLOBIN)'];
    const lines = billLinesFrom(order, list({ [CBC]: 350, 'HB (HAEMOGLOBIN)': 100 }));

    const cbc = lines.find(line => line.name === CBC);
    expect(cbc?.kind).toBe('panel');
    expect(cbc?.lineTotal).toBe(350);
    expect(lines.some(line => line.name === 'HB (HAEMOGLOBIN)')).toBe(false);

    const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    expect(total).toBe(350);
  });

  it('records the absorbed members on the panel line', () => {
    const lines = billLinesFrom([CBC, ...CBC_MEMBERS], list({ [CBC]: 350 }));
    const cbc = lines.find(line => line.name === CBC);
    expect(cbc?.covers).toEqual(expect.arrayContaining(CBC_MEMBERS));
    expect(cbc?.covers.length).toBeGreaterThan(3);
  });

  it('keeps a lone test that belongs to no ordered panel', () => {
    const lines = billLinesFrom(['Serum Creatinine'], list({ 'Serum Creatinine': 400 }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'test', unitPrice: 400, lineTotal: 400 });
  });

  it('charges an unpriced package as one flagged line, not as its components', () => {
    // A lab's own panel is the only unpriced package left in the app now that
    // every built-in entry carries a suggested rate. The rule is unchanged: the
    // lab sells the package, not "ABSOLUTE BASOPHIL COUNT", so itemising an
    // unpriced panel would bury the one useful fact — "this panel has no rate" —
    // under a wall of lines the lab cannot act on individually.
    seedOwnPanel();
    const lines = billLinesFrom(
      [OWN_PANEL, OWN_MEMBER_ONE, OWN_MEMBER_TWO],
      list({ [OWN_MEMBER_ONE]: 100 }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      name: OWN_PANEL,
      kind: 'panel',
      unpriced: true,
      lineTotal: 0,
    });
    // Members are absorbed either way, so none of them can be charged twice.
    expect(lines[0]?.covers).toEqual([OWN_MEMBER_ONE, OWN_MEMBER_TWO]);
  });

  it('absorbs a member whose stored spelling differs from the catalogue', () => {
    // Every other catalogue join in the app folds the name first (`priceKey`,
    // `findTestInfo`, `mergeDuplicateLines`), so an order carrying
    // `lab assay one` instead of `LAB ASSAY ONE` used to slip past the raw-string
    // absorption check — the member was absorbed *and* charged, which is exactly
    // the double-count this walk exists to prevent.
    seedOwnPanel();
    const lines = billLinesFrom(
      [OWN_PANEL, OWN_MEMBER_ONE.toLowerCase()],
      list({ [OWN_PANEL]: 500, [OWN_MEMBER_ONE]: 200 }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ name: OWN_PANEL, kind: 'panel', lineTotal: 500 });
  });

  it('charges the built-in package at its suggested rate when the lab set none', () => {
    const lines = billLinesFrom([CBC, ...CBC_MEMBERS], list({}));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ name: CBC, kind: 'panel', unpriced: false, lineTotal: 300 });
  });

  it('still charges a lone test that belongs to no ordered package', () => {
    const lines = billLinesFrom(
      ['Serum Creatinine', 'HB (HAEMOGLOBIN)'],
      list({ 'HB (HAEMOGLOBIN)': 100 }),
    );
    expect(lines).toHaveLength(2);
    expect(lines.find(l => l.name === 'HB (HAEMOGLOBIN)')?.lineTotal).toBe(100);
  });

  it('marks an unpriced line rather than printing it as ₹0', () => {
    const lines = billLinesFrom(['Serum Creatinine'], list({}));
    expect(lines[0]).toMatchObject({ unpriced: true, unitPrice: 0, lineTotal: 0 });
  });

  it('collapses the same test ordered twice into one line with a quantity', () => {
    const lines = billLinesFrom(
      ['Serum Creatinine', 'Serum Creatinine'],
      list({ 'Serum Creatinine': 400 }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ qty: 2, unitPrice: 400, lineTotal: 800 });
  });

  it('never bills a section header', () => {
    // `PHYSICAL EXAMINATION` is a printed group label in the catalogue, not a test.
    const lines = billLinesFrom(
      ['PHYSICAL EXAMINATION', 'Serum Creatinine'],
      list({ 'Serum Creatinine': 400 }),
    );
    expect(lines.map(line => line.name)).toEqual(['Serum Creatinine']);
  });

  it('tolerates an empty order and blank names', () => {
    expect(billLinesFrom([], list({}))).toEqual([]);
    expect(billLinesFrom(['', '  ', undefined as unknown as string], list({}))).toEqual([]);
  });

  it('unpricedNames names the package, not its components', () => {
    expect(
      unpricedNames([CBC, 'Serum Creatinine'], list({ [CBC]: 350, 'Serum Creatinine': 400 })),
    ).toEqual([]);
    seedOwnPanel();
    // Only the unpriced *billable unit* is named — a panel's parts are not units.
    expect(unpricedNames([OWN_PANEL, OWN_MEMBER_ONE, OWN_MEMBER_TWO], list({}))).toEqual([
      OWN_PANEL,
    ]);
    expect(unpricedNames(['Serum Creatinine'], list({}))).toEqual(['Serum Creatinine']);
  });
});

describe('billableTests — what the lab is asked to price', () => {
  it('drops the components of a package that bills as a unit', () => {
    const names = billableTests(DEFAULT_PATHOLOGY_TESTS).map(t => t.name);
    expect(names).toContain(CBC);
    // A CBC component is not something the lab sells on its own.
    expect(names).not.toContain('ABSOLUTE BASOPHIL COUNT');
    expect(names).not.toContain('HB (HAEMOGLOBIN)');
  });

  it('keeps a component of a package whose members stay individually orderable', () => {
    // PANCREAS PROFILE sets hideMembersFromBrowse: false — Serum Amylase was always
    // pickable alone, so it still needs its own rate.
    const names = billableTests(DEFAULT_PATHOLOGY_TESTS).map(t => t.name);
    expect(names).toContain('PANCREAS PROFILE');
    expect(names).toContain('Serum Amylase');
  });

  it('drops section headers', () => {
    const names = billableTests(DEFAULT_PATHOLOGY_TESTS).map(t => t.name);
    expect(names).not.toContain('PHYSICAL EXAMINATION');
  });

  it('leaves a lab-owned standalone test priceable', () => {
    const custom: PathologyTest = { id: 'x1', name: 'My Custom Assay', category: 'CUSTOM' };
    expect(billableTests([custom]).map(t => t.name)).toEqual(['My Custom Assay']);
  });
});

describe('upsertPrice', () => {
  it('writes through the store and keeps the previous figure in history', async () => {
    await upsertPrice({ name: 'HB (HAEMOGLOBIN)', price: 300, actor: 'Ashu' });
    await upsertPrice({ name: 'HB (HAEMOGLOBIN)', price: 350, actor: 'Ashu' });

    const stored = getPriceList();
    const entry = stored.entries[priceKey('HB (HAEMOGLOBIN)')];
    expect(entry?.price).toBe(350);
    expect(entry?.history?.[0]).toMatchObject({ price: 300, changedBy: 'Ashu' });
    expect(store.writes.some(w => w.id === PRICE_LIST_DOC_ID)).toBe(true);
  });

  it('is a no-op when the price and availability are unchanged', async () => {
    await upsertPrice({ name: 'CRP', price: 500, actor: 'Ashu' });
    const writes = store.writes.length;
    await upsertPrice({ name: 'CRP', price: 500, actor: 'Ashu' });
    expect(store.writes).toHaveLength(writes);
  });

  it('refuses a negative price and an empty name', async () => {
    await expect(upsertPrice({ name: 'CRP', price: -1, actor: 'a' })).rejects.toThrow(/negative/);
    await expect(upsertPrice({ name: '   ', price: 1, actor: 'a' })).rejects.toThrow(/name/);
  });

  it('tags a catalogue panel as a panel', async () => {
    await upsertPrice({ name: CBC, price: 350, actor: 'a' });
    expect(getPriceList().entries[priceKey(CBC)]?.kind).toBe('panel');
  });
});

describe('setOrderable', () => {
  it('pauses a priced test without erasing its price', async () => {
    await upsertPrice({ name: 'CRP', price: 500, actor: 'a' });
    await setOrderable('CRP', false, 'a');
    const entry = getPriceList().entries[priceKey('CRP')];
    expect(entry).toMatchObject({ price: 500, active: false });
  });
});

describe('bulkAdjustPrices', () => {
  it('applies a percent change and records each previous price', async () => {
    await upsertPrice({ name: 'CRP', price: 500, actor: 'a' });
    await upsertPrice({ name: 'HB (HAEMOGLOBIN)', price: 300, actor: 'a' });

    const { changed } = await bulkAdjustPrices(
      ['CRP', 'HB (HAEMOGLOBIN)'],
      { mode: 'percent', percent: 10 },
      'a',
    );
    expect(changed).toBe(2);
    expect(resolvePrice('CRP')).toBe(550);
    expect(resolvePrice('HB (HAEMOGLOBIN)')).toBe(330);
  });

  it('rounds per test so the sheet and the bill agree', async () => {
    await upsertPrice({ name: 'CRP', price: 99, actor: 'a' });
    await bulkAdjustPrices(['CRP'], { mode: 'percent', percent: 33 }, 'a');
    // 99 × 1.33 = 131.67 exactly; a per-line rounding is what a bill can add up to.
    expect(resolvePrice('CRP')).toBe(131.67);
  });

  it('never produces a negative or unbounded price', async () => {
    await upsertPrice({ name: 'CRP', price: 100, actor: 'a' });
    await bulkAdjustPrices(['CRP'], { mode: 'add', amount: -5000 }, 'a');
    expect(resolvePrice('CRP')).toBe(0);
    await bulkAdjustPrices(['CRP'], { mode: 'set', price: 1e9 }, 'a');
    expect(resolvePrice('CRP')).toBe(1_000_000);
  });

  it('creates entries for names that had none', async () => {
    const { changed } = await bulkAdjustPrices(
      ['Brand New Test'],
      { mode: 'set', price: 250 },
      'a',
    );
    expect(changed).toBe(1);
    expect(resolvePrice('Brand New Test')).toBe(250);
  });
});

describe('loadPriceList', () => {
  it('reads the encrypted document and caches it', async () => {
    store.documents.set(`meta/${PRICE_LIST_DOC_ID}`, {
      version: 1,
      entries: { crp: { name: 'CRP', price: 600, active: true, kind: 'test' } },
      updatedAt: 'u',
      updatedBy: 'a',
    });
    await loadPriceList({ force: true });
    expect(resolvePrice('CRP')).toBe(600);
  });

  it('mirrors what it read into localStorage for the synchronous readers', async () => {
    store.documents.set(`meta/${PRICE_LIST_DOC_ID}`, {
      entries: { crp: { name: 'CRP', price: 600 } },
    });
    await loadPriceList({ force: true });
    expect(
      JSON.parse(String(localStorage.getItem('pathologyos_price_list'))).entries.crp.price,
    ).toBe(600);
  });

  it('falls back to the mirror instead of claiming an empty price list', async () => {
    localStorage.setItem(
      'pathologyos_price_list',
      JSON.stringify({ entries: { crp: { name: 'CRP', price: 700, active: true } } }),
    );
    // A store that cannot answer is not a store with no prices.
    store.documents.set('meta/blocked', {});
    await loadPriceList({ force: true });
    expect(resolvePrice('CRP')).toBe(700);
  });
});

describe('saveBillingPrefs', () => {
  it('records who moved the billing numbers, and when', async () => {
    // Tax rate, currency and rounding change what *every* future bill charges.
    // Until `actor` was actually written to the document, this was the one money
    // write in the app with no trail at all, while every price change keeps a
    // `history[]` row naming who moved it.
    await saveBillingPrefs({ ...DEFAULT_BILLING_PREFS, taxPercent: 12 }, 'Ashu');

    const stored = store.documents.get(`meta/${BILLING_PREFS_DOC_ID}`);
    expect(stored).toMatchObject({ taxPercent: 12, updatedBy: 'Ashu' });
    expect(typeof stored?.updatedAt).toBe('string');
    expect(getBillingPrefs().taxPercent).toBe(12);
  });

  it('leaves the audit fields off when nobody is named', async () => {
    await saveBillingPrefs({ ...DEFAULT_BILLING_PREFS, currency: 'Rs' }, '');
    expect(store.documents.get(`meta/${BILLING_PREFS_DOC_ID}`)).not.toHaveProperty('updatedBy');
  });

  it('still clamps a hostile stored percent', () => {
    // A restored snapshot cannot invent a 5000% tax rate through this reader.
    expect(sanitizeBillingPrefs({ taxPercent: 5000 }).taxPercent).toBe(100);
  });
});
