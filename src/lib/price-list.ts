/**
 * Per-lab test price list and ordering availability.
 *
 * Why this is its own store and not a field on the catalogue:
 *
 *  - `DEFAULT_PATHOLOGY_TESTS` (src/lib/pathology-tests.ts) is a hard-coded
 *    source array of 163 entries. A price edited in the UI cannot live there —
 *    it would need a rebuild, a re-sign and a re-deploy of the APK and the MSI
 *    every time the lab changed a tariff.
 *  - `custom_pathology_tests` (localStorage) only ever holds the *lab's own*
 *    additions, so the built-in catalogue could never be priced.
 *  - A tariff is commercial data the lab must not lose: it goes in the
 *    encrypted store, in the `meta` collection, which `BACKUP_COLLECTIONS`
 *    already snapshots and `planRestore` already replays. One document,
 *    `meta/price-list`, whole-list read and write.
 *
 * `localStorage` keeps a mirror of the same payload for the synchronous readers
 * (the live total under the test chips in the registration form, the pre-JS
 * bootstrap). The encrypted document is the authority; the mirror is a cache and
 * is overwritten by it on every load.
 *
 * Keys are the folded test name (`normalizeSearchTerm`), because every other
 * lookup in this app resolves a catalogue entry *by name* — `findTestInfo`,
 * `expandTestSelection`, the report table. Keying prices any other way would
 * mean two catalogue-join rules drifting apart. Known consequence, inherited
 * from the catalogue rather than invented here: `Albumin` is both a serum (LFT)
 * and a urine record name, so the two share one price entry.
 */
import { db, doc, getDoc, setDoc } from '../data/fs';
import {
  findTestInfo,
  normalizeSearchTerm,
  panelOwnedMemberNames,
  type PathologyTest,
} from './pathology-tests';
import { captureError } from './telemetry';
import { computeInvoiceTotals, roundMoney, type InvoiceItem } from './models';

/** The single document id this list lives under in the `meta` collection. */
export const PRICE_LIST_DOC_ID = 'price-list';

/** localStorage mirror key — a cache, never the authority. */
export const PRICE_LIST_STORAGE_KEY = 'pathologyos_price_list';

/** Dispatched after every successful write so open screens re-read. */
export const PRICE_LIST_UPDATED_EVENT = 'price-list-updated';

/** Bounded so one document cannot grow past the store's comfort. */
const HISTORY_LIMIT = 12;
const MAX_ENTRIES = 800;

export interface PriceChange {
  price: number;
  changedAt: string;
  changedBy: string;
}

export interface PriceEntry {
  /** Display name — what the bill prints, kept so the list is readable. */
  name: string;
  /** Rupees. `0` is a real price (a free govt. scheme test); absent is unset. */
  price: number;
  /** False = not orderable any more. Past bills still render it. */
  active: boolean;
  /** `panel` prices a profile/package as one charge. */
  kind: 'test' | 'panel';
  /** Category snapshot, so the Manage Tests list can group without a join. */
  category?: string;
  /** ISO date the price was set. */
  effectiveFrom: string;
  note?: string;
  /** Newest-first trail of previous prices — "what did we charge in March?". */
  history?: PriceChange[];
}

export interface PriceList {
  version: 1;
  entries: Record<string, PriceEntry>;
  updatedAt: string;
  updatedBy: string;
}

/** Tax defaults for the lab, edited in Settings → Manage Tests. */
export interface BillingPrefs {
  /** Percent added to a bill. `0` = no tax line printed. */
  taxPercent: number;
  /** Percent credited to a referring doctor when the register has no rate. */
  defaultReferralPercent: number;
  /** ISO currency symbol used on printed bills. */
  currency: string;
  /** Round the printed grand total up to the nearest rupee. */
  roundToRupee: boolean;
  /**
   * Who last saved these prefs, and when. Audit only — no arithmetic reads
   * them. Tax rate, currency and rounding move what every future bill charges,
   * so they need the same attribution a price change already carries; these two
   * fields are the whole of it, which is why they are optional and why nothing
   * downstream trusts them for anything but display.
   */
  updatedBy?: string;
  updatedAt?: string;
}

export const BILLING_PREFS_DOC_ID = 'billing-prefs';
export const DEFAULT_BILLING_PREFS: BillingPrefs = {
  taxPercent: 0,
  defaultReferralPercent: 0,
  currency: '₹',
  roundToRupee: true,
};

const EMPTY_LIST: PriceList = { version: 1, entries: {}, updatedAt: '', updatedBy: '' };

/**
 * Coerce a stored `history` array into bounded rows.
 *
 * Kept out of the sanitize loop because the same rules apply to a document that
 * came from the encrypted store and to one that came from a restored snapshot.
 * `changedBy` is stamped from whoever last saved the list — a restored trail does
 * not carry per-row operators, and inventing one would be worse than naming the
 * document's owner.
 */
function readHistory(raw: unknown, changedBy: string): PriceChange[] {
  if (!Array.isArray(raw)) return [];
  const owner = changedBy.slice(0, 128);
  const out: PriceChange[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const change = item as Record<string, unknown>;
    const value = Number(change.price);
    if (!Number.isFinite(value) || value < 0) continue;
    out.push({
      price: roundMoney(Math.min(value, 1_000_000)),
      changedAt: String(change.changedAt ?? '').slice(0, 64),
      changedBy: String(change.changedBy ?? owner).slice(0, 128),
    });
    if (out.length >= HISTORY_LIMIT) break;
  }
  return out;
}

/** Fold a name the way the catalogue does, so `H.D.L.` prices `HDL`. */
export function priceKey(name: string): string {
  return normalizeSearchTerm(String(name ?? '').trim());
}

/**
 * Coerce anything read from storage or a backup into a usable list.
 *
 * Deliberately not a throwing parse: this data comes back from a restored
 * snapshot and from a pre-JS bootstrap, and a rejected document must degrade to
 * "no prices yet" rather than to a settings screen that will not open. Field
 * bounds are enforced by hand for the same reason `sanitizeNotificationPrefs`
 * whitelists its channel keys — a stored document must not be able to invent a
 * field the rest of the app then trusts.
 */
export function sanitizePriceList(raw: unknown): PriceList {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_LIST };
  const source = raw as { entries?: unknown; updatedAt?: unknown; updatedBy?: unknown };
  const input = source.entries;
  if (typeof input !== 'object' || input === null) return { ...EMPTY_LIST };

  const entries: Record<string, PriceEntry> = {};
  const owner = String(source.updatedBy ?? '');
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(entries).length >= MAX_ENTRIES) break;
    const folded = priceKey(key);
    if (!folded || typeof value !== 'object' || value === null) continue;
    const e = value as Record<string, unknown>;
    const price = typeof e.price === 'number' ? e.price : Number(e.price);
    const history = readHistory(e.history, owner);

    entries[folded] = {
      name: String(e.name ?? key).slice(0, 128),
      price: Number.isFinite(price) && price >= 0 ? roundMoney(Math.min(price, 1_000_000)) : 0,
      active: e.active !== false,
      kind: e.kind === 'panel' ? 'panel' : 'test',
      ...(typeof e.category === 'string' ? { category: e.category.slice(0, 80) } : {}),
      effectiveFrom: String(e.effectiveFrom ?? '').slice(0, 64),
      ...(typeof e.note === 'string' ? { note: e.note.slice(0, 300) } : {}),
      ...(history.length > 0 ? { history } : {}),
    };
  }

  return {
    version: 1,
    entries,
    updatedAt: String(source.updatedAt ?? '').slice(0, 64),
    updatedBy: String(source.updatedBy ?? '').slice(0, 128),
  };
}

/** Fold stored billing preferences, clamping the two rates into range. */
export function sanitizeBillingPrefs(raw: unknown): BillingPrefs {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_BILLING_PREFS };
  const e = raw as Record<string, unknown>;
  const pct = (value: unknown, fallback: number) => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback;
  };
  return {
    taxPercent: pct(e.taxPercent, DEFAULT_BILLING_PREFS.taxPercent),
    defaultReferralPercent: pct(
      e.defaultReferralPercent,
      DEFAULT_BILLING_PREFS.defaultReferralPercent,
    ),
    currency:
      typeof e.currency === 'string' && e.currency.length > 0 && e.currency.length <= 4
        ? e.currency
        : DEFAULT_BILLING_PREFS.currency,
    roundToRupee: e.roundToRupee !== false,
    ...(typeof e.updatedBy === 'string' && e.updatedBy
      ? { updatedBy: e.updatedBy.slice(0, 128) }
      : {}),
    ...(typeof e.updatedAt === 'string' && e.updatedAt
      ? { updatedAt: e.updatedAt.slice(0, 64) }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Cached reads
// ---------------------------------------------------------------------------

let cachedList: PriceList = { ...EMPTY_LIST };
let cachedPrefs: BillingPrefs = { ...DEFAULT_BILLING_PREFS };
let cacheLoaded = false;

function readMirror<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (err) {
    captureError(err, { scope: 'price-list/mirror-read' });
    return fallback;
  }
}

function writeMirror(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // A full localStorage is not a reason to lose the encrypted write, which has
    // already happened by the time this runs.
    captureError(err, { scope: 'price-list/mirror-write' });
  }
}

/** The synchronous view — valid once {@link loadPriceList} has resolved. */
export function getPriceList(): PriceList {
  if (!cacheLoaded) {
    // Fall back to the mirror so a render that happens before bootstrap still
    // shows yesterday's tariff instead of an alarming all-unpriced list.
    return sanitizePriceList(readMirror(PRICE_LIST_STORAGE_KEY, EMPTY_LIST));
  }
  return cachedList;
}

export function getBillingPrefs(): BillingPrefs {
  if (!cacheLoaded)
    return sanitizeBillingPrefs(readMirror(BILLING_PREFS_DOC_ID, DEFAULT_BILLING_PREFS));
  return cachedPrefs;
}

/**
 * Read the authority documents from the encrypted store into the cache.
 *
 * Failure is not silently "empty": an unreadable store returns the mirror and
 * records the fault, because showing a lab zero prices would invite them to
 * reprint every bill. Pass `{ force: true }` after a restore.
 */
export async function loadPriceList(options: { force?: boolean } = {}): Promise<PriceList> {
  if (cacheLoaded && !options.force) return cachedList;
  try {
    const snap = await getDoc(doc(db, 'meta', PRICE_LIST_DOC_ID));
    const stored = snap.exists()
      ? sanitizePriceList(snap.data())
      : sanitizePriceList(readMirror(PRICE_LIST_STORAGE_KEY, EMPTY_LIST));
    cachedList = stored;

    const prefsSnap = await getDoc(doc(db, 'meta', BILLING_PREFS_DOC_ID));
    cachedPrefs = prefsSnap.exists()
      ? sanitizeBillingPrefs(prefsSnap.data())
      : sanitizeBillingPrefs(readMirror(BILLING_PREFS_DOC_ID, DEFAULT_BILLING_PREFS));

    cacheLoaded = true;
    writeMirror(PRICE_LIST_STORAGE_KEY, cachedList);
    writeMirror(BILLING_PREFS_DOC_ID, cachedPrefs);
    window.dispatchEvent(new Event(PRICE_LIST_UPDATED_EVENT));
  } catch (err) {
    captureError(err, { scope: 'price-list/load' });
    cachedList = sanitizePriceList(readMirror(PRICE_LIST_STORAGE_KEY, EMPTY_LIST));
    cachedPrefs = sanitizeBillingPrefs(readMirror(BILLING_PREFS_DOC_ID, DEFAULT_BILLING_PREFS));
    cacheLoaded = true;
  }
  return cachedList;
}

/** Drop the cache — used by tests and by "erase all data". */
export function resetPriceListCache(): void {
  cacheLoaded = false;
  cachedList = { ...EMPTY_LIST };
  cachedPrefs = { ...DEFAULT_BILLING_PREFS };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function persistList(next: PriceList): Promise<void> {
  cachedList = next;
  cacheLoaded = true;
  await setDoc(doc(db, 'meta', PRICE_LIST_DOC_ID), next as unknown as Record<string, unknown>);
  writeMirror(PRICE_LIST_STORAGE_KEY, next);
  window.dispatchEvent(new Event(PRICE_LIST_UPDATED_EVENT));
}

async function persistPrefs(next: BillingPrefs): Promise<void> {
  cachedPrefs = next;
  cacheLoaded = true;
  await setDoc(doc(db, 'meta', BILLING_PREFS_DOC_ID), next as unknown as Record<string, unknown>);
  writeMirror(BILLING_PREFS_DOC_ID, next);
  window.dispatchEvent(new Event(PRICE_LIST_UPDATED_EVENT));
}

export interface PriceUpsertInput {
  name: string;
  price: number;
  active?: boolean;
  kind?: 'test' | 'panel';
  category?: string;
  note?: string;
  actor: string;
  at?: string;
}

/**
 * Set one test's price, keeping the previous value in `history`.
 *
 * An unchanged price is a no-op write: without this, re-saving the list would
 * fill the audit trail with entries that record nothing.
 */
export async function upsertPrice(input: PriceUpsertInput): Promise<PriceList> {
  const key = priceKey(input.name);
  if (!key) throw new Error('A price needs a test name.');
  const price = roundMoney(input.price);
  if (!Number.isFinite(price) || price < 0) throw new Error('A price cannot be negative.');

  const current = getPriceList();
  const existing = current.entries[key];
  if (existing && existing.price === price && existing.active === (input.active !== false)) {
    return current;
  }

  const at = input.at || new Date().toISOString();
  const history: PriceChange[] = existing
    ? [
        { price: existing.price, changedAt: existing.effectiveFrom || at, changedBy: input.actor },
        ...(existing.history ?? []),
      ].slice(0, HISTORY_LIMIT)
    : [];

  const next: PriceList = {
    version: 1,
    updatedAt: at,
    updatedBy: input.actor,
    entries: {
      ...current.entries,
      [key]: {
        name: input.name.trim().slice(0, 128),
        price,
        active: input.active !== false,
        // A panel is a panel whether or not the caller remembered to say so —
        // the alternative is a tariff sheet that labels CBC as a single test.
        kind: input.kind ?? existing?.kind ?? resolveKind(input.name),
        ...(input.category?.trim()
          ? { category: input.category.trim().slice(0, 80) }
          : existing?.category
            ? { category: existing.category }
            : {}),
        effectiveFrom: existing && existing.price !== price ? at : existing?.effectiveFrom || at,
        ...(input.note !== undefined
          ? { note: input.note.slice(0, 300) }
          : existing?.note
            ? { note: existing.note }
            : {}),
        ...(history.length > 0 ? { history } : {}),
      },
    },
  };
  await persistList(next);
  return next;
}

/** Flip availability without touching the price (a paused test keeps its rate). */
export async function setOrderable(
  name: string,
  active: boolean,
  actor: string,
): Promise<PriceList> {
  const key = priceKey(name);
  const current = getPriceList();
  const existing = current.entries[key];
  if (!existing) return upsertPrice({ name, price: 0, active, actor });

  const next: PriceList = {
    ...current,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
    entries: { ...current.entries, [key]: { ...existing, active } },
  };
  await persistList(next);
  return next;
}

/** Remove a price entry entirely — only for a test that never appeared on a bill. */
export async function clearPrice(name: string, actor: string): Promise<PriceList> {
  const key = priceKey(name);
  const current = getPriceList();
  if (!current.entries[key]) return current;
  const entries = { ...current.entries };
  delete entries[key];
  const next: PriceList = {
    version: 1,
    entries,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };
  await persistList(next);
  return next;
}

export type BulkPriceChange =
  | { mode: 'set'; price: number }
  | { mode: 'add'; amount: number }
  | { mode: 'percent'; percent: number };

/**
 * Apply one change to many tests at once.
 *
 * Prices a lab revises as a tariff sheet ("everything haematology +₹50"), so the
 * operation is expressed as a rule over the current value. `percent` rounds per
 * test, which means the sheet total is the sum of rounded lines — never a
 * rounded-up aggregate, or the bill and the price list would disagree.
 */
export async function bulkAdjustPrices(
  names: readonly string[],
  change: BulkPriceChange,
  actor: string,
): Promise<{ list: PriceList; changed: number }> {
  const current = getPriceList();
  const entries = { ...current.entries };
  const at = new Date().toISOString();
  let changed = 0;

  for (const name of names) {
    const key = priceKey(name);
    if (!key) continue;
    const existing: PriceEntry = current.entries[key] ?? {
      name: name.trim().slice(0, 128),
      price: 0,
      active: true,
      kind: resolveKind(name),
      effectiveFrom: at,
    };
    const before = existing.price;
    const after = roundMoney(Math.min(1_000_000, Math.max(0, applyPriceChange(before, change))));
    if (after === before && current.entries[key]) continue;

    entries[key] = {
      ...existing,
      price: after,
      effectiveFrom: at,
      history: [
        { price: before, changedAt: existing.effectiveFrom || at, changedBy: actor },
        ...(existing.history ?? []),
      ].slice(0, HISTORY_LIMIT),
    };
    changed += 1;
  }

  const next: PriceList = { version: 1, entries, updatedAt: at, updatedBy: actor };
  await persistList(next);
  return { list: next, changed };
}

function applyPriceChange(price: number, change: BulkPriceChange): number {
  switch (change.mode) {
    case 'set':
      return change.price;
    case 'add':
      return price + change.amount;
    case 'percent':
      return price * (1 + change.percent / 100);
  }
}

/**
 * Save the lab's billing preferences.
 *
 * `actor` is recorded on the document rather than dropped: every price change
 * keeps a `history[]` row naming who moved it, and until now the three numbers
 * that touch *every* bill — tax rate, currency, rounding — were the one money
 * write in the app with no attribution at all.
 */
export async function saveBillingPrefs(prefs: BillingPrefs, actor: string): Promise<BillingPrefs> {
  const stamped: BillingPrefs = {
    ...prefs,
    ...(actor ? { updatedBy: actor, updatedAt: new Date().toISOString() } : {}),
  };
  const sanitized = sanitizeBillingPrefs(stamped);
  await persistPrefs(sanitized);
  return sanitized;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** `panel` when the catalogue says this name is a group/profile. */
export function resolveKind(name: string): 'test' | 'panel' {
  const info = findTestInfo(name);
  return info?.isGroup ? 'panel' : 'test';
}

/** A price for display. `null` means the lab has not set one — never `0`. */
export function resolvePrice(name: string, list: PriceList = getPriceList()): number | null {
  const key = priceKey(name);
  const entry = key ? list.entries[key] : undefined;
  if (entry) return entry.price;
  // A catalogue default is a fallback only; the lab's own list always wins.
  const info = findTestInfo(name);
  const fallback = info?.price;
  return typeof fallback === 'number' && Number.isFinite(fallback) && fallback >= 0
    ? roundMoney(fallback)
    : null;
}

/**
 * Whether a test may be added to a *new* order.
 *
 * Unpriced tests stay orderable — a lab that has not finished typing its tariff
 * must still be able to admit a patient; the bill flags them instead. Only an
 * explicit pause (`active: false`) removes a name from the picker.
 */
export function isOrderable(name: string, list: PriceList = getPriceList()): boolean {
  const entry = list.entries[priceKey(name)];
  return entry ? entry.active : true;
}

/**
 * The catalogue entries the lab is asked to price.
 *
 * A package's components are removed: ABSOLUTE BASOPHIL COUNT is not a thing a
 * lab sells on its own, it is one of the 27 measurements inside CBC, and asking
 * for a price against it is a question with no answer. The package is the unit
 * that gets priced, and `billLinesFrom` charges exactly that unit.
 *
 * Members of a package that keeps them browsable (`hideMembersFromBrowse: false`)
 * stay in the list — creatinine and HbA1c were always orderable on their own, so
 * they still need their own rate.
 */
export function billableTests(tests: readonly PathologyTest[]): PathologyTest[] {
  const owned = panelOwnedMemberNames(tests as PathologyTest[]);
  return tests.filter(test => !test.isHeader && !owned.has(test.name));
}

/** Names with no price — the warning strip on the registration form. */
export function unpricedNames(
  testSelection: readonly string[],
  list: PriceList = getPriceList(),
): string[] {
  return billLinesFrom(testSelection, list)
    .filter(line => line.unpriced)
    .map(line => line.name);
}

// ---------------------------------------------------------------------------
// Bill lines — where the double-count trap lives
// ---------------------------------------------------------------------------

/**
 * Turn an order into the lines a bill prints.
 *
 * `PatientSchema.testSelection` stores **both** a panel and every one of its
 * members: picking CBC writes `['CBC', 'Haemoglobin', 'Packed Cell Volume', …]`
 * (src/pages/dashboard/PatientsPage.tsx `addTest`), because the clinical report
 * needs the members and the chip strip folds them back for display. Pricing that
 * list as written would charge the panel *and* all ~20 of its components — a
 * twenty-fold overcharge on a printed commercial document.
 *
 * The rule applied here:
 *  - a package is **one billable thing**: it is one line, priced once, and it
 *    absorbs its members whether or not a price has been set for it;
 *  - an unpriced package is one line flagged `unpriced` — NOT its 27 components
 *    itemised. The lab prices packages, so "CBC has no rate" is the single
 *    actionable fact; a wall of unpriced components would be noise that hides it
 *    (and the total is ₹0 with a loud warning either way);
 *  - a member the lab added *outside* any package it belongs to stays its own
 *    line, and so does a member of a package that keeps its members individually
 *    orderable (`hideMembersFromBrowse: false`) when that package is not ordered;
 *  - a member that arrived through a package but was also picked on its own is
 *    still absorbed — the package was ordered, and charging it twice is the bug
 *    this function exists to prevent;
 *  - section headers are never billable.
 */
export function billLinesFrom(
  testSelection: readonly string[],
  list: PriceList = getPriceList(),
): InvoiceItem[] {
  const names = testSelection.map(name => String(name ?? '').trim()).filter(Boolean);
  const lines: InvoiceItem[] = [];
  // Folded, exactly as `mergeDuplicateLines` and every price lookup folds. A raw
  // comparison here is the one way a member could be both absorbed *and* charged:
  // `hb (haemoglobin)` in the order would not match `HB (HAEMOGLOBIN)` in the
  // panel, and the twenty-fold overcharge this function exists to prevent is back.
  const absorbed = new Set<string>();

  // Panels first: they claim their members before any lone test is considered.
  for (const name of names) {
    const info = findTestInfo(name);
    if (info?.isHeader) continue;
    if (!info?.isGroup) continue;
    const members = (info.includedTests ?? []).map(m => String(m ?? '').trim()).filter(Boolean);
    const panelPrice = resolvePrice(name, list);
    if (panelPrice !== null) {
      lines.push({
        name,
        kind: 'panel',
        detail: info.specimen ? info.specimen.slice(0, 80) : '',
        qty: 1,
        unitPrice: panelPrice,
        lineTotal: panelPrice,
        unpriced: false,
        covers: members,
      });
      members.forEach(member => absorbed.add(priceKey(member)));
      continue;
    }
    // Unpriced package: still one line, flagged. Its members are absorbed all the
    // same, so they can never be charged a second time underneath it.
    members.forEach(member => absorbed.add(priceKey(member)));
    lines.push({
      name,
      kind: 'panel',
      detail: info.specimen ? info.specimen.slice(0, 80) : '',
      qty: 1,
      unitPrice: 0,
      lineTotal: 0,
      unpriced: true,
      covers: members,
    });
  }

  // Then the tests that came through no package.
  for (const name of names) {
    if (absorbed.has(priceKey(name))) continue;
    const info = findTestInfo(name);
    if (info?.isHeader) continue;
    if (info?.isGroup) continue; // already handled above, priced or itemised
    const price = resolvePrice(name, list);
    lines.push({
      name,
      kind: 'test',
      detail: info?.specimen ? info.specimen.slice(0, 80) : '',
      qty: 1,
      unitPrice: price ?? 0,
      lineTotal: price ?? 0,
      unpriced: price === null,
      covers: [],
    });
  }

  return mergeDuplicateLines(lines);
}

/** Collapse the same test ordered twice into one line with a quantity. */
function mergeDuplicateLines(lines: readonly InvoiceItem[]): InvoiceItem[] {
  const byKey = new Map<string, InvoiceItem>();
  for (const line of lines) {
    const key = `${line.kind}:${priceKey(line.name)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...line, covers: [...line.covers] });
      continue;
    }
    const qty = Math.min(200, existing.qty + line.qty);
    byKey.set(key, {
      ...existing,
      qty,
      lineTotal: roundMoney(existing.unitPrice * qty),
      unpriced: existing.unpriced || line.unpriced,
      covers: [...new Set([...existing.covers, ...line.covers])],
    });
  }
  return [...byKey.values()];
}

/** Convenience: lines + totals in one call, using the lab's saved tax rate. */
export function priceBill(
  testSelection: readonly string[],
  options: { discount?: number; taxPercent?: number; list?: PriceList } = {},
): { items: InvoiceItem[]; totals: ReturnType<typeof computeInvoiceTotals> } {
  const list = options.list ?? getPriceList();
  const items = billLinesFrom(testSelection, list);
  return {
    items,
    totals: computeInvoiceTotals({
      items,
      discount: options.discount,
      taxPercent: options.taxPercent ?? getBillingPrefs().taxPercent,
    }),
  };
}

/**
 * ₹1,20,345 with the lab's own symbol.
 *
 * `notification-engine.formatAmount` hard-codes ₹ because the unpaid alert is
 * Indian-only; bills honour `BillingPrefs.currency` so a lab that changes the
 * symbol sees it change everywhere at once. Grouping stays `en-IN` — Indian
 * lakh/crore commas are what the reader expects on a rupee amount.
 */
export function formatMoney(value: number, currency = getBillingPrefs().currency): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${currency}${safe.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(safe) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
