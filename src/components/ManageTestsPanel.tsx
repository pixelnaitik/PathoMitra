/**
 * <ManageTestsPanel> — the Settings → Manage Tests screen.
 *
 * It replaces the old "Custom Tests" block, which could only add a hand-typed
 * test to a private list: it showed *only* the lab's own additions (so the 163
 * catalogue tests could never be priced), it had no edit path at all (a typo in a
 * reference range meant delete and retype), and the "included tests" field for a
 * group was free text the assistant had to spell exactly right.
 *
 * This screen merges the built-in catalogue with the lab's own tests and puts the
 * two commercial controls — price and availability — on every row. Editing the
 * *clinical* record of a built-in test (unit, reference ranges) is deliberately
 * not offered: those live in `DEFAULT_PATHOLOGY_TESTS` in source, and a UI that
 * appeared to edit them while silently not saving would be worse than not offering
 * the field. Built-ins are editable in price, availability and note only; a lab
 * that needs a different reference range adds its own test.
 *
 * Prices are written immediately rather than on the page's "Save changes" button:
 * they live in their own encrypted document (`meta/price-list`), and a lab that
 * set a tariff and then left without pressing Save would otherwise lose it — the
 * most expensive possible outcome for a two-tap edit.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgePercent,
  Eye,
  EyeOff,
  FileDown,
  FolderPlus,
  Pencil,
  Plus,
  Printer,
  Search,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import {
  Button,
  Card,
  Combobox,
  ConfirmSheet,
  Disclosure,
  EmptyState,
  Field,
  IconButton,
  ListGroup,
  ListRow,
  SearchField,
  SectionTitle,
  Select,
  Sheet,
  StatusPill,
  Switch,
  TextInput,
  useToast,
} from './ui';
import { cn } from '../lib/utils';
import {
  DEFAULT_PATHOLOGY_TESTS,
  findTestInfo,
  getStandaloneTests,
  searchPathologyTests,
  type PathologyTest,
  type ReferenceRange,
} from '../lib/pathology-tests';
import { readSettings, writeCustomTests } from '../lib/settings';
import {
  PRICE_LIST_UPDATED_EVENT,
  billableTests,
  bulkAdjustPrices,
  clearPrice,
  formatMoney,
  getBillingPrefs,
  getPriceList,
  loadPriceList,
  priceKey,
  resolveKind,
  resolvePrice,
  saveBillingPrefs,
  setOrderable,
  upsertPrice,
  type BillingPrefs,
  type PriceList,
} from '../lib/price-list';
import { buildPriceListPdf, outputInvoicePdf } from '../lib/invoice-pdf';
import { downloadCsv, toCsv } from '../lib/export-csv';
import type { PrintJob } from './PrintDialog';
import { PrintDialog } from './PrintDialog';

interface Props {
  /** The lab's own tests — owned by SettingsPage's save flow. */
  customTests: PathologyTest[];
  onCustomTestsChange: (next: PathologyTest[]) => void;
  /** `operatorStamp(user)` — stamped on every price change. */
  actor: string;
}

type Filter = 'all' | 'priced' | 'unpriced' | 'hidden' | 'custom';

const CATEGORY_ORDER = [
  'HAEMATOLOGY',
  'BIOCHEMISTRY',
  'PATHOLOGY',
  'MICROBIOLOGY',
  'SEROLOGY',
  'URINE',
  'HORMONE',
  'DIABETES',
  'CARDIAC',
  'LIVER',
  'KIDNEY',
  'THYROID',
  'VITAMIN',
  'COAGULATION',
  'CYTOLOGY',
  'IMMUNOLOGY',
];

/** Sort so the biggest groups read first and unknown categories keep their order. */
function categoryRank(category: string): number {
  const idx = CATEGORY_ORDER.indexOf(category.toUpperCase().trim());
  return idx === -1 ? CATEGORY_ORDER.length : idx;
}

export function ManageTestsPanel({ customTests, onCustomTestsChange, actor }: Props) {
  const toast = useToast();
  const [priceList, setPriceList] = useState<PriceList>(() => getPriceList());
  const [prefs, setPrefs] = useState<BillingPrefs>(() => getBillingPrefs());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);

  /** Editing sheet: null closed, otherwise the row being edited. */
  const [editing, setEditing] = useState<PathologyTest | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PathologyTest | null>(null);

  /** Pull the cached list + prefs back into view after any write. */
  const refresh = useCallback(() => {
    setPriceList(getPriceList());
    setPrefs(getBillingPrefs());
  }, []);

  // The price list is written by this screen and read by the bills screen, so it
  // re-reads whenever anything dispatches an update. The first read goes to the
  // encrypted store asynchronously: `loadPriceList()` may still be in flight when
  // this screen opens, and setting state synchronously here would paint the
  // mirror before the authority has answered.
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      refresh();
    };
    void loadPriceList().then(apply, apply);
    window.addEventListener(PRICE_LIST_UPDATED_EVENT, apply);
    return () => {
      cancelled = true;
      window.removeEventListener(PRICE_LIST_UPDATED_EVENT, apply);
    };
  }, [refresh]);

  /** Every catalogue entry the lab can bill for, built-ins first. */
  const allTests = useMemo<PathologyTest[]>(
    () => [...DEFAULT_PATHOLOGY_TESTS, ...customTests],
    [customTests],
  );

  /**
   * What this screen asks a price for: packages and standalone tests, with a
   * package's own components filtered out. `ABSOLUTE BASOPHIL COUNT` is one of the
   * 27 measurements inside CBC — nobody sells it on its own, so a "not priced"
   * badge against it is a question with no answer. The package is the unit that
   * gets priced, and the bill charges exactly that unit (`billLinesFrom`).
   */
  const priceableUnits = useMemo(() => billableTests(allTests), [allTests]);

  /** How many components are hidden because a package bills for them. */
  const absorbedCount = allTests.length - priceableUnits.length;

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const test of priceableUnits) if (test.category) set.add(test.category);
    return [...set].sort((a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b));
  }, [priceableUnits]);

  const rows = useMemo(() => {
    const searched = query.trim()
      ? searchPathologyTests(query.trim(), priceableUnits)
      : priceableUnits;
    const filtered = searched.filter(test => {
      if (category && test.category !== category) return false;
      const price = resolvePrice(test.name, priceList);
      const entry = priceList.entries[priceKey(test.name)];
      const isCustom = !entry && customTests.some(c => c.name === test.name);
      switch (filter) {
        case 'priced':
          return price !== null;
        case 'unpriced':
          return price === null;
        case 'hidden':
          return entry ? !entry.active : false;
        case 'custom':
          return customTests.some(c => c.name === test.name) || isCustom;
        default:
          return true;
      }
    });
    return filtered.sort(
      (a, b) => categoryRank(a.category) - categoryRank(b.category) || a.name.localeCompare(b.name),
    );
  }, [category, customTests, filter, priceList, priceableUnits, query]);

  const stats = useMemo(() => {
    let priced = 0;
    let own = 0;
    let hidden = 0;
    let value = 0;
    for (const test of priceableUnits) {
      const price = resolvePrice(test.name, priceList);
      const entry = priceList.entries[priceKey(test.name)];
      if (price !== null) {
        priced += 1;
        value += price;
        // "Own" = the lab wrote this number. Everything else priced is the
        // catalogue's suggested market rate, and the two must not read the same
        // on a screen the lab uses to decide what to charge a patient.
        if (entry) own += 1;
      }
      if (entry?.active === false) hidden += 1;
    }
    return { total: priceableUnits.length, priced, own, suggested: priced - own, hidden, value };
  }, [priceList, priceableUnits]);

  /* ------------------------------ price edits ------------------------------ */

  const commitPrice = async (name: string, price: number) => {
    setSaving(true);
    try {
      await upsertPrice({
        name,
        price,
        kind: resolveKind(name),
        category: findTestInfo(name)?.category,
        actor,
      });
      refresh();
    } catch (err) {
      console.error('Price save failed:', err);
      toast.error('The price was not saved — try again.');
    } finally {
      setSaving(false);
    }
  };

  const commitAvailability = async (name: string, active: boolean) => {
    setSaving(true);
    try {
      await setOrderable(name, active, actor);
      refresh();
    } catch (err) {
      console.error('Availability save failed:', err);
      toast.error('Could not change availability.');
    } finally {
      setSaving(false);
    }
  };

  const commitClear = async (name: string) => {
    try {
      await clearPrice(name, actor);
      refresh();
      toast.info(`${name} is unpriced again.`);
    } catch (err) {
      console.error('Clear price failed:', err);
      toast.error('Could not clear that price.');
    }
  };

  /* ------------------------------ exports --------------------------------- */

  const printPriceList = async () => {
    try {
      const built = await buildPriceListPdf(
        rows.map(test => ({
          name: test.name,
          category: test.category || '',
          price: resolvePrice(test.name, priceList),
          active: priceList.entries[priceKey(test.name)]?.active !== false,
        })),
        readSettings(),
      );
      const { printJob: job, message } = await outputInvoicePdf(
        built,
        `PathoMitra price list ${new Date().toISOString().slice(0, 10)}.pdf`,
        'print',
        'Price list',
      );
      if (job) setPrintJob(job);
      else if (message) toast.info(message);
    } catch (err) {
      console.error('Price list PDF failed:', err);
      toast.error('Could not build the price list PDF.');
    }
  };

  const exportCsv = async () => {
    const csv = toCsv(
      [
        { label: 'Test', value: (t: PathologyTest) => t.name },
        { label: 'Category', value: (t: PathologyTest) => t.category },
        { label: 'Type', value: (t: PathologyTest) => (t.isGroup ? 'profile' : 'test') },
        { label: 'Price', value: (t: PathologyTest) => resolvePrice(t.name, priceList) ?? '' },
        {
          label: 'Available',
          value: (t: PathologyTest) =>
            priceList.entries[priceKey(t.name)]?.active === false ? 'no' : 'yes',
        },
        { label: 'Specimen', value: (t: PathologyTest) => t.specimen ?? '' },
        {
          label: 'Members',
          value: (t: PathologyTest) => (t.includedTests ?? []).join(' | '),
        },
      ],
      rows,
    );
    const saved = await downloadCsv(`pathomitra-price-list-${Date.now()}.csv`, csv);
    toast.success(saved ?? 'Price list exported.');
  };

  const updatePrefs = async (patch: Partial<BillingPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      await saveBillingPrefs(next, actor);
      refresh();
    } catch (err) {
      console.error('Billing prefs save failed:', err);
      toast.error('Could not save the billing defaults.');
    }
  };

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-xl font-bold text-primary">Manage Tests</h3>
        <p className="text-sm text-on-surface-variant">
          Every test and package the lab can bill for, with its price and whether it may still be
          ordered. {stats.priced} of {stats.total} priced — {stats.own} at your own rate,
          {stats.suggested > 0
            ? ` ${stats.suggested} still on the app's suggested market rate.`
            : ' none left on the suggested rate.'}
          {stats.hidden > 0 ? ` ${stats.hidden} hidden from new orders.` : ''}
        </p>
        {absorbedCount > 0 && (
          <p className="mt-1 text-xs text-on-surface-variant">
            The {absorbedCount} component tests inside packages are not listed — a package is billed
            as one test, so price the package (CBC, WIDAL, LIPID PROFILE …) rather than its parts.
            They stay searchable inside each package's own editor.
          </p>
        )}
      </div>

      {/* Toolbar */}
      <Card pad="sm">
        <div className="flex flex-col gap-3 fold:flex-row fold:items-center">
          <SearchField
            className="flex-1"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onClear={() => setQuery('')}
            placeholder="Search tests — H.D.L., hemoglobin, typhoid…"
            aria-label="Search tests"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="brand" size="md" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add test
            </Button>
            <Button variant="outline" size="md" onClick={() => setProfileOpen(true)}>
              <FolderPlus className="h-4 w-4" aria-hidden="true" />
              New profile
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SegmentedFilter filter={filter} onChange={setFilter} />
          <Select
            aria-label="Filter by category"
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="h-9 w-auto text-xs"
          >
            <option value="">All categories</option>
            {categories.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setBulkOpen(true)}>
            <BadgePercent className="h-4 w-4" aria-hidden="true" />
            Bulk price
          </Button>
          <Button variant="ghost" size="sm" onClick={printPriceList}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print list
          </Button>
          <Button variant="ghost" size="sm" onClick={exportCsv}>
            <FileDown className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </Card>

      {/* Billing defaults */}
      <Disclosure
        title="Billing defaults"
        summary="Tax rate · referral fallback · currency"
        icon={<Tags className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="grid grid-cols-1 gap-4 p-4 fold:grid-cols-3">
          <Field label="Tax / GST (%)" hint="Applied after discount. 0 prints no tax line.">
            <TextInput
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={String(prefs.taxPercent)}
              onChange={e => updatePrefs({ taxPercent: Number(e.target.value) || 0 })}
              inputMode="decimal"
            />
          </Field>
          <Field
            label="Default referral (%)"
            hint="Used only when a referrer is not in the doctor register."
          >
            <TextInput
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={String(prefs.defaultReferralPercent)}
              onChange={e => updatePrefs({ defaultReferralPercent: Number(e.target.value) || 0 })}
              inputMode="decimal"
            />
          </Field>
          <Field label="Currency symbol" hint="Printed on screen; bills print as Rs.">
            <TextInput
              value={prefs.currency}
              maxLength={4}
              onChange={e => updatePrefs({ currency: e.target.value })}
            />
          </Field>
          <div className="fold:col-span-3">
            <Switch
              label="Round bills to the whole rupee"
              checked={prefs.roundToRupee}
              onChange={checked => updatePrefs({ roundToRupee: checked })}
            />
          </div>
        </div>
      </Disclosure>

      {/* The list */}
      {rows.length === 0 ? (
        <Card pad="none">
          <EmptyState
            icon={<Search className="h-7 w-7" aria-hidden="true" />}
            title="No test matches this filter"
            description={`${allTests.length} tests in the catalogue. Clear the search or the filter to see them.`}
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                  setCategory('');
                }}
              >
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <ListGroup>
          {rows.slice(0, 400).map(test => (
            <TestRow
              key={`${test.id}-${test.name}`}
              test={test}
              price={resolvePrice(test.name, priceList)}
              suggested={!priceList.entries[priceKey(test.name)]}
              active={priceList.entries[priceKey(test.name)]?.active !== false}
              isCustom={customTests.some(c => c.name === test.name)}
              historyCount={priceList.entries[priceKey(test.name)]?.history?.length ?? 0}
              disabled={saving}
              onPrice={price => commitPrice(test.name, price)}
              onToggle={active => commitAvailability(test.name, active)}
              onEdit={() => setEditing(test)}
              onDelete={
                customTests.some(c => c.name === test.name)
                  ? () => setDeleteTarget(test)
                  : undefined
              }
              onClearPrice={() => commitClear(test.name)}
            />
          ))}
        </ListGroup>
      )}
      {rows.length > 400 && (
        <p className="text-center text-xs text-on-surface-variant">
          Showing the first 400 of {rows.length} — narrow the search or category to see the rest.
        </p>
      )}

      <TestFormSheet
        key={
          addOpen || profileOpen || editing
            ? `open:${editing?.name ?? (profileOpen ? 'profile' : 'create')}`
            : 'closed'
        }
        open={addOpen || profileOpen || !!editing}
        mode={editing ? 'edit' : profileOpen ? 'profile' : 'create'}
        initial={editing}
        catalogue={allTests}
        customNames={customTests.map(c => c.name)}
        onClose={() => {
          setAddOpen(false);
          setProfileOpen(false);
          setEditing(null);
        }}
        onSubmit={test => {
          const withoutDup = customTests.filter(c => c.name !== test.name);
          const next = [...withoutDup, test];
          onCustomTestsChange(next);
          // Persist immediately: a lab that adds a test, prices it, and leaves
          // without pressing the page's Save must not lose the test it just typed.
          writeCustomTests(next);
          setAddOpen(false);
          setProfileOpen(false);
          setEditing(null);
          toast.success(`“${test.name}” saved.`);
        }}
      />

      <BulkPriceSheet
        open={bulkOpen}
        rows={rows}
        categories={categories}
        priceList={priceList}
        actor={actor}
        onClose={() => setBulkOpen(false)}
        onApplied={count => {
          setBulkOpen(false);
          refresh();
          toast.success(`Updated ${count} price${count === 1 ? '' : 's'}.`);
        }}
      />

      <ConfirmSheet
        open={!!deleteTarget}
        title="Remove test"
        confirmLabel="Remove"
        message={`Remove “${deleteTarget?.name}” from the lab's own tests? Bills already printed keep their lines; the price entry stays unless you clear it.`}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const next = customTests.filter(c => c.name !== deleteTarget.name);
          onCustomTestsChange(next);
          writeCustomTests(next);
          setDeleteTarget(null);
          toast.info(`${deleteTarget.name} removed.`);
        }}
      />

      <PrintDialog
        open={!!printJob}
        job={printJob}
        onClose={() => setPrintJob(null)}
        onPrinted={() => toast.success('Price list sent to the printer.')}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Row                                      */
/* -------------------------------------------------------------------------- */

function TestRow({
  test,
  price,
  suggested,
  active,
  isCustom,
  historyCount,
  disabled,
  onPrice,
  onToggle,
  onEdit,
  onDelete,
  onClearPrice,
}: {
  test: PathologyTest;
  price: number | null;
  /** True when no price-list entry backs `price` — it is the catalogue's suggestion. */
  suggested: boolean;
  active: boolean;
  isCustom: boolean;
  historyCount: number;
  disabled: boolean;
  onPrice: (price: number) => void;
  onToggle: (active: boolean) => void;
  onEdit: () => void;
  onDelete?: () => void;
  onClearPrice: () => void;
}) {
  // The field is uncontrolled and remounted (`key`) whenever the stored price
  // changes elsewhere — a Settings write, a bulk adjustment, a restore. Keeping a
  // local copy in state and syncing it in an effect would render the old price
  // for a frame and could have the operator overwrite a number they never saw.
  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      if (price !== null) onClearPrice();
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) return;
    if (price !== null && value === price) return;
    onPrice(value);
  };

  return (
    <ListRow
      title={
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate">{test.name}</span>
          {test.isGroup && <StatusPill tone="info">profile</StatusPill>}
          {isCustom && <StatusPill tone="neutral">lab</StatusPill>}
          {!active && <StatusPill tone="warning">hidden</StatusPill>}
          {price === null && <StatusPill tone="error">not priced</StatusPill>}
          {price !== null && suggested && <StatusPill tone="neutral">suggested rate</StatusPill>}
          {historyCount > 0 && (
            <span className="text-[11px] text-on-surface-variant">
              {historyCount} change{historyCount === 1 ? '' : 's'}
            </span>
          )}
        </span>
      }
      subtitle={[
        test.category,
        test.specimen,
        test.includedTests?.length ? `${test.includedTests.length} tests inside` : '',
      ]
        .filter(Boolean)
        .join(' · ')}
      onClick={onEdit}
      primaryLabel={`Edit ${test.name}`}
      trailing={
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant">
              ₹
            </span>
            <input
              key={`${test.name}:${price ?? 'none'}`}
              type="text"
              inputMode="decimal"
              aria-label={`Price for ${test.name}`}
              defaultValue={price === null ? '' : String(price)}
              disabled={disabled}
              placeholder="—"
              onBlur={e => commit(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit((e.target as HTMLInputElement).value);
                }
              }}
              onClick={e => e.stopPropagation()}
              className="h-9 w-20 rounded-xl border border-outline-variant/40 bg-surface-container pl-6 pr-2 text-right text-sm tabular-nums text-on-surface focus:border-accent focus:outline-none disabled:opacity-60"
            />
          </div>
          <IconButton
            label={active ? `Hide ${test.name} from new orders` : `Make ${test.name} orderable`}
            size="sm"
            className="text-on-surface-variant hover:bg-accent/12 hover:text-accent"
            onClick={e => {
              e.stopPropagation();
              onToggle(!active);
            }}
          >
            {active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </IconButton>
          <IconButton
            label={`Edit ${test.name}`}
            size="sm"
            className="text-on-surface-variant hover:bg-accent/12 hover:text-accent"
            onClick={e => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Pencil className="h-4 w-4" />
          </IconButton>
          {price !== null && (
            <IconButton
              label={`Clear the price for ${test.name}`}
              size="sm"
              className="text-on-surface-variant hover:bg-accent/12 hover:text-accent"
              onClick={e => {
                e.stopPropagation();
                onClearPrice();
              }}
            >
              <X className="h-4 w-4" />
            </IconButton>
          )}
          {onDelete && (
            <IconButton
              label={`Remove ${test.name}`}
              size="sm"
              className="text-on-surface-variant hover:bg-error-container hover:text-error"
              onClick={e => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      }
    />
  );
}

function SegmentedFilter({
  filter,
  onChange,
}: {
  filter: Filter;
  onChange: (next: Filter) => void;
}) {
  const items: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'priced', label: 'Priced' },
    { id: 'unpriced', label: 'Unpriced' },
    { id: 'hidden', label: 'Hidden' },
    { id: 'custom', label: "Lab's own" },
  ];
  return (
    <div className="flex flex-wrap gap-1 rounded-full bg-surface-container p-1">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
            filter === item.id
              ? 'bg-primary text-on-primary'
              : 'text-on-surface-variant hover:text-on-surface',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                             Add / edit sheet                               */
/* -------------------------------------------------------------------------- */

interface DraftForm {
  isGroup: boolean;
  name: string;
  category: string;
  unit: string;
  specimen: string;
  kind: string;
  rangeGeneral: string;
  rangeMale: string;
  rangeFemale: string;
  rangeInfant: string;
  includedTests: string[];
  price: string;
  hideMembers: boolean;
  synonyms: string;
}

const EMPTY_DRAFT: DraftForm = {
  isGroup: false,
  name: '',
  category: '',
  unit: '',
  specimen: '',
  kind: 'numeric',
  rangeGeneral: '',
  rangeMale: '',
  rangeFemale: '',
  rangeInfant: '',
  includedTests: [],
  price: '',
  hideMembers: false,
  synonyms: '',
};

function toDraft(test: PathologyTest): DraftForm {
  return {
    isGroup: !!test.isGroup,
    name: test.name,
    category: test.category ?? '',
    unit: test.unit ?? '',
    specimen: test.specimen ?? '',
    kind: test.kind ?? 'numeric',
    rangeGeneral: test.ranges?.general?.text ?? '',
    rangeMale: test.ranges?.male?.text ?? '',
    rangeFemale: test.ranges?.female?.text ?? '',
    rangeInfant: test.ranges?.infant?.text ?? '',
    includedTests: [...(test.includedTests ?? [])],
    price: typeof test.price === 'number' ? String(test.price) : '',
    hideMembers: test.hideMembersFromBrowse !== false,
    synonyms: (test.synonyms ?? []).join(', '),
  };
}

function TestFormSheet({
  open,
  mode,
  initial,
  catalogue,
  customNames,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: 'create' | 'profile' | 'edit';
  initial: PathologyTest | null;
  catalogue: PathologyTest[];
  customNames: string[];
  onClose: () => void;
  onSubmit: (test: PathologyTest) => void;
}) {
  // The parent keys this sheet on what is open, so entering it again always
  // starts from the record on screen rather than from a half-typed earlier draft.
  const [draft, setDraft] = useState<DraftForm>(() =>
    initial ? toDraft(initial) : { ...EMPTY_DRAFT, isGroup: mode === 'profile' },
  );
  const [error, setError] = useState('');

  const isBuiltIn = !!initial && !customNames.includes(initial.name);
  const patch = (next: Partial<DraftForm>) => setDraft(current => ({ ...current, ...next }));

  const memberOptions = useMemo(
    () =>
      getStandaloneTests(draft.includedTests)
        .filter(t => !t.isGroup)
        .map(t => t.name)
        .sort((a, b) => a.localeCompare(b)),
    [draft.includedTests],
  );

  const submit = () => {
    const name = draft.name.trim();
    if (!name) {
      setError('Give the test a name.');
      return;
    }
    // A duplicate name is not cosmetic here: prices are keyed on the name, so two
    // entries called "CRP" means two price rows for one bill line.
    const clash = catalogue.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (clash && (!initial || clash.name !== initial.name)) {
      setError(`“${clash.name}” is already in the catalogue. Edit that one instead.`);
      return;
    }
    if (draft.isGroup && draft.includedTests.length < 2) {
      setError('A profile needs at least two tests inside it.');
      return;
    }

    const ranges: ReferenceRange = {};
    if (draft.rangeGeneral.trim()) ranges.general = { text: draft.rangeGeneral.trim() };
    if (draft.rangeMale.trim()) ranges.male = { text: draft.rangeMale.trim() };
    if (draft.rangeFemale.trim()) ranges.female = { text: draft.rangeFemale.trim() };
    if (draft.rangeInfant.trim()) ranges.infant = { text: draft.rangeInfant.trim() };

    const price = draft.price.trim() === '' ? undefined : Number(draft.price);

    const test: PathologyTest = {
      ...(initial ?? {}),
      id: initial?.id ?? `custom_${priceKey(name)}_${Date.now().toString(36).slice(-5)}`,
      name,
      category: draft.category.trim() || 'CUSTOM',
      isGroup: draft.isGroup,
      ...(draft.isGroup
        ? { includedTests: draft.includedTests, hideMembersFromBrowse: draft.hideMembers }
        : {
            unit: draft.unit.trim() || undefined,
            specimen: draft.specimen.trim() || undefined,
            kind: draft.kind as PathologyTest['kind'],
            ...(Object.keys(ranges).length > 0 ? { ranges } : {}),
          }),
      ...(draft.synonyms.trim()
        ? {
            synonyms: draft.synonyms
              .split(',')
              .map(s => s.trim())
              .filter(Boolean),
          }
        : {}),
      ...(price !== undefined && Number.isFinite(price) ? { price } : {}),
    };
    onSubmit(test);

    // The price the lab typed here is a price-list write, not a catalogue write.
    if (price !== undefined && Number.isFinite(price)) {
      void upsertPrice({
        name,
        price,
        kind: test.isGroup ? 'panel' : 'test',
        category: test.category,
        actor: 'manage-tests',
      });
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        mode === 'edit'
          ? `Edit ${initial?.name ?? 'test'}`
          : mode === 'profile'
            ? 'New test profile'
            : 'Add a test'
      }
      width="lg"
      footer={
        <div className="flex gap-3">
          <Button variant="outline" size="lg" fullWidth onClick={onClose}>
            Cancel
          </Button>
          <Button variant="brand" size="lg" fullWidth onClick={submit}>
            {mode === 'edit' ? 'Save changes' : 'Add to list'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        {isBuiltIn && (
          <p className="rounded-xl bg-info-container/50 px-3 py-2 text-xs text-on-surface-variant">
            This test ships with the catalogue. Its price and availability save immediately; its
            clinical fields (unit, ranges) are fixed in the app and are shown here read-only. To
            change those, add a new test of your own.
          </p>
        )}
        {error && (
          <p className="rounded-xl bg-error-container/60 px-3 py-2 text-xs text-error">{error}</p>
        )}

        <div className="grid grid-cols-1 gap-4 fold:grid-cols-2">
          <Field label="Type">
            <Select
              value={draft.isGroup ? 'group' : 'individual'}
              disabled={isBuiltIn}
              onChange={e => patch({ isGroup: e.target.value === 'group' })}
            >
              <option value="individual">Individual test</option>
              <option value="group">Profile (two or more tests)</option>
            </Select>
          </Field>
          <Field label="Name" required>
            <TextInput
              value={draft.name}
              onChange={e => patch({ name: e.target.value })}
              placeholder={draft.isGroup ? 'Kidney Function Panel' : 'Serum Creatinine'}
            />
          </Field>
          <Field label="Category">
            <Combobox
              value={draft.category}
              options={CATEGORY_ORDER}
              onChange={value => patch({ category: value })}
              placeholder="BIOCHEMISTRY"
              ariaLabel="Category"
            />
          </Field>
          <Field label="Price (₹)" hint="Set now, or leave blank and price it later.">
            <TextInput
              type="text"
              inputMode="decimal"
              value={draft.price}
              onChange={e => patch({ price: e.target.value })}
              placeholder="350"
            />
          </Field>
        </div>

        {draft.isGroup ? (
          <>
            <Field
              label={`Member tests (${draft.includedTests.length})`}
              hint="Type to search the catalogue — pick at least two."
            >
              <Combobox
                value=""
                options={memberOptions.filter(option => !draft.includedTests.includes(option))}
                onChange={value => {
                  if (!value || draft.includedTests.includes(value)) return;
                  patch({ includedTests: [...draft.includedTests, value] });
                }}
                placeholder="Add a test to this profile…"
                ariaLabel="Add a member test"
              />
            </Field>
            {draft.includedTests.length > 0 && (
              <div className="flex flex-wrap gap-1.5 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-3">
                {draft.includedTests.map(member => (
                  <span
                    key={member}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/12 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-primary"
                  >
                    {member}
                    <button
                      type="button"
                      aria-label={`Remove ${member} from the profile`}
                      onClick={() =>
                        patch({
                          includedTests: draft.includedTests.filter(m => m !== member),
                        })
                      }
                      className="rounded-full p-0.5 hover:bg-primary/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Switch
              label="Hide the member tests from the individual-test browse list"
              checked={draft.hideMembers}
              onChange={checked => patch({ hideMembers: checked })}
            />
            <p className="text-xs text-on-surface-variant">
              Leave this off for a profile whose tests were always orderable on their own
              (creatinine, bilirubin, HbA1c) — turning it on removes those single picks from the
              registration screen.
            </p>
            <p className="text-xs text-on-surface-variant">
              Sum of members:{' '}
              {formatMoney(
                draft.includedTests.reduce((sum, member) => sum + (resolvePrice(member) ?? 0), 0),
              )}
              . Set the profile price above to charge a bundle instead — the bill then prints one
              line and does not also charge the members.
            </p>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-4 fold:grid-cols-2">
            <Field label="Unit">
              <TextInput
                value={draft.unit}
                disabled={isBuiltIn}
                onChange={e => patch({ unit: e.target.value })}
                placeholder="mg/dL"
              />
            </Field>
            <Field label="Specimen">
              <TextInput
                value={draft.specimen}
                disabled={isBuiltIn}
                onChange={e => patch({ specimen: e.target.value })}
                placeholder="Serum"
              />
            </Field>
            <Field label="Result kind">
              <Select
                value={draft.kind}
                disabled={isBuiltIn}
                onChange={e => patch({ kind: e.target.value })}
              >
                <option value="numeric">Numeric (checked against the range)</option>
                <option value="categorical">Categorical (one of a fixed list)</option>
                <option value="titer">Titer (1:160)</option>
                <option value="text">Text / qualitative</option>
              </Select>
            </Field>
            <Field label="Synonyms" hint="Comma separated — helps search find it">
              <TextInput
                value={draft.synonyms}
                onChange={e => patch({ synonyms: e.target.value })}
                placeholder="creatinine, serum creatinine"
              />
            </Field>
            <Field label="Reference range (all ages)">
              <TextInput
                value={draft.rangeGeneral}
                disabled={isBuiltIn}
                onChange={e => patch({ rangeGeneral: e.target.value })}
                placeholder="0.6 – 1.2"
              />
            </Field>
            <Field label="Adult male">
              <TextInput
                value={draft.rangeMale}
                disabled={isBuiltIn}
                onChange={e => patch({ rangeMale: e.target.value })}
                placeholder="0.7 – 1.3"
              />
            </Field>
            <Field label="Adult female">
              <TextInput
                value={draft.rangeFemale}
                disabled={isBuiltIn}
                onChange={e => patch({ rangeFemale: e.target.value })}
                placeholder="0.6 – 1.1"
              />
            </Field>
            <Field label="Infant (0–24 mo)">
              <TextInput
                value={draft.rangeInfant}
                disabled={isBuiltIn}
                onChange={e => patch({ rangeInfant: e.target.value })}
                placeholder="0.2 – 0.4"
              />
            </Field>
          </div>
        )}

        <Field label="Notes for the bench">
          <TextInput
            value={initial?.notes?.join('; ') ?? ''}
            onChange={() => undefined}
            disabled
            placeholder="Not editable from this screen"
          />
        </Field>
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Bulk price sheet                              */
/* -------------------------------------------------------------------------- */

function BulkPriceSheet({
  open,
  rows,
  categories,
  priceList,
  actor,
  onClose,
  onApplied,
}: {
  open: boolean;
  rows: PathologyTest[];
  categories: string[];
  priceList: PriceList;
  actor: string;
  onClose: () => void;
  onApplied: (count: number) => void;
}) {
  const [scopeCategory, setScopeCategory] = useState('');
  const [scope, setScope] = useState<'priced' | 'unpriced' | 'all'>('all');
  const [mode, setMode] = useState<'percent' | 'add' | 'set'>('percent');
  const [value, setValue] = useState('10');
  const [busy, setBusy] = useState(false);

  const affected = useMemo(
    () =>
      rows.filter(test => {
        if (test.isHeader) return false;
        if (scopeCategory && test.category !== scopeCategory) return false;
        const priced = resolvePrice(test.name, priceList) !== null;
        if (scope === 'priced') return priced;
        if (scope === 'unpriced') return !priced;
        return true;
      }),
    [priceList, rows, scope, scopeCategory],
  );

  const preview = useMemo(() => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    return affected.slice(0, 3).map(test => {
      const before = resolvePrice(test.name, priceList) ?? 0;
      const after =
        mode === 'set' ? amount : mode === 'add' ? before + amount : before * (1 + amount / 100);
      return { name: test.name, before, after: Math.max(0, Math.round(after * 100) / 100) };
    });
  }, [affected, mode, priceList, value]);

  const apply = async () => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return;
    setBusy(true);
    try {
      const change =
        mode === 'set'
          ? ({ mode: 'set', price: amount } as const)
          : mode === 'add'
            ? ({ mode: 'add', amount } as const)
            : ({ mode: 'percent', percent: amount } as const);
      const { changed } = await bulkAdjustPrices(
        affected.map(test => test.name),
        change,
        actor,
      );
      onApplied(changed);
    } catch (err) {
      console.error('Bulk price change failed:', err);
      onApplied(0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Bulk price change"
      width="md"
      footer={
        <div className="flex gap-3">
          <Button variant="outline" size="lg" fullWidth onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand"
            size="lg"
            fullWidth
            loading={busy}
            disabled={affected.length === 0}
            onClick={apply}
          >
            Apply to {affected.length} test{affected.length === 1 ? '' : 's'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        <p className="text-xs text-on-surface-variant">
          A tariff revision is normally a rule over the current price ("haematology up ₹50"), not 40
          separate taps. Every change is recorded in the price's history, so the previous figure
          survives.
        </p>
        <div className="grid grid-cols-1 gap-4 fold:grid-cols-2">
          <Field label="Category" hint="Leave blank for every category">
            <Select value={scopeCategory} onChange={e => setScopeCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Which tests">
            <Select value={scope} onChange={e => setScope(e.target.value as typeof scope)}>
              <option value="all">All in scope</option>
              <option value="priced">Only those already priced</option>
              <option value="unpriced">Only those not priced yet</option>
            </Select>
          </Field>
          <Field label="Change">
            <Select value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
              <option value="percent">Percent up / down</option>
              <option value="add">Add rupees</option>
              <option value="set">Set to this price</option>
            </Select>
          </Field>
          <Field label={mode === 'percent' ? 'Percent (negative to cut)' : 'Rupees'}>
            <TextInput value={value} onChange={e => setValue(e.target.value)} inputMode="decimal" />
          </Field>
        </div>

        {preview && preview.length > 0 && (
          <Card pad="sm">
            <SectionTitle title="Preview" />
            <ul className="mt-2 space-y-1 text-xs">
              {preview.map(row => (
                <li key={row.name} className="flex justify-between gap-3">
                  <span className="truncate text-on-surface">{row.name}</span>
                  <span className="shrink-0 tabular-nums text-on-surface-variant">
                    {formatMoney(row.before)} → <strong>{formatMoney(row.after)}</strong>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {affected.length === 0 && (
          <p className="rounded-xl bg-warning-container/40 px-3 py-2 text-xs text-on-surface-variant">
            Nothing in scope — widen the category or the filter.
          </p>
        )}
      </div>
    </Sheet>
  );
}

export default ManageTestsPanel;
