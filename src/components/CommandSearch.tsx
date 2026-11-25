/**
 * CommandSearch — global search overlay (Ctrl+K / Cmd+K).
 * Searches patients, reports, doctors, orders, and samples with keyboard navigation.
 *
 * What it searches: every record the store holds, matched on every field a
 * person at a counter would actually type — a patient's registration number, a
 * phone number in any formatting, a test or panel name, not just display names.
 * It used to load the 200 newest of each collection and search only those, so a
 * lab with any history got "No results found" for a patient who plainly existed.
 * The local store materialises the whole collection on any read anyway, so the
 * ceiling was costing correctness and buying nothing.
 */
import { useState, useEffect, useRef, useCallback, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Search,
  Users,
  FileText,
  Stethoscope,
  ArrowRight,
  CornerDownLeft,
  X,
  AlertTriangle,
  ClipboardList,
  TestTubeDiagonal,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { SPRING } from '../lib/motion';
import { BACK_PRIORITY, useBackHandler } from '../lib/back-button';
import { useModalFocus } from '../hooks/useModalFocus';
import {
  querySearchIndex,
  subscribeSearchIndex,
  type SearchFilterResult,
  type SearchIndexState,
  type SearchResult,
} from '../lib/search-index';

const TYPE_ICONS = {
  patient: Users,
  report: FileText,
  doctor: Stethoscope,
  order: ClipboardList,
  sample: TestTubeDiagonal,
};

const TYPE_LABELS = {
  patient: 'Patient',
  report: 'Report',
  doctor: 'Doctor',
  order: 'Order',
  sample: 'Sample',
};

// Token-AND matching and indexing live in lib/search-index.
/*
 * Plain `includes` made "rao asha" miss "Asha Rao" — the word order a lab
 * assistant types in is frequently not the order the record was entered in.
 */
export function CommandSearch({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: string, id?: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState<SearchIndexState>({
    items: [],
    loading: false,
    failedSources: 0,
  });
  const { onKeyDown: onModalKeyDown } = useModalFocus({
    open,
    onClose,
    panelRef,
    initialFocusRef: inputRef,
  });

  // The index is built once per app session and reconciled from repository
  // subscriptions. Reopening the palette never rereads or reindexes every row.
  useEffect(() => subscribeSearchIndex(setIndex), []);
  const deferredSearch = useDeferredValue(search);
  const [filtered, setFiltered] = useState<SearchFilterResult>({
    items: [],
    totalMatches: 0,
    omitted: 0,
  });
  useEffect(() => {
    let active = true;
    void querySearchIndex(deferredSearch).then(result => {
      if (active) setFiltered(result);
    });
    return () => {
      active = false;
    };
  }, [index.items, deferredSearch]);

  useEffect(() => {
    queueMicrotask(() => setActiveIdx(0));
  }, [filtered.items.length]);
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setSearch('');
      setActiveIdx(0);
    });
  }, [open]);
  const navigate = useCallback(
    (result: SearchResult) => {
      const tabMap = {
        patient: 'patients',
        report: 'reports',
        doctor: 'doctors',
        order: 'orders',
        sample: 'samples',
      };
      onNavigate(tabMap[result.type], result.id);
      onClose();
    },
    [onNavigate, onClose],
  );

  // Same contract as Escape: Back leaves the palette, not the page behind it.
  useBackHandler(
    useCallback(() => {
      if (!open) return false;
      onClose();
      return true;
    }, [open, onClose]),
    open,
    BACK_PRIORITY.OVERLAY,
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, filtered.items.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && filtered.items[activeIdx]) {
      e.preventDefault();
      navigate(filtered.items[activeIdx]);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        // The 15vh inset is a desktop nicety; on a short viewport (landscape phone,
        // a foldable propped half-open, the APK with the IME raised) it pushed the
        // panel off the bottom edge, so the inset is capped and the panel is bounded
        // by 80% of the viewport height with the results list taking the slack
        // (`overlay-max-h` in src/index.css, which keeps a `vh` fallback for a
        // WebView that has no `dvh`).
        <motion.div
          className="fixed inset-0 z-[9998] flex items-start justify-center pt-[min(15vh,9rem)] px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[4px]"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
            ref={panelRef}
            tabIndex={-1}
            onKeyDown={event => {
              onModalKeyDown(event);
              handleKeyDown(event);
            }}
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={SPRING.sheet}
            className="relative flex overlay-max-h [--dvh-max:80] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-[var(--elevated-border)] bg-surface shadow-float"
          >
            {/* Search input. The app-wide `input:focus` glow + `:focus-visible`
                outline are designed for bordered form fields; here they render as
                a halo clipped by this panel's overflow-hidden, so the input opts
                out and the row itself carries the focus affordance instead. */}
            <div className="group/search flex shrink-0 items-center gap-3 border-b border-outline-variant/60 px-5 transition-colors focus-within:border-accent/40">
              <Search
                className="h-5 w-5 shrink-0 text-on-surface-variant transition-colors group-focus-within/search:text-accent"
                aria-hidden="true"
              />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search patients, reports, orders, samples…"
                aria-label="Search query"
                role="combobox"
                aria-expanded={filtered.items.length > 0}
                aria-controls="command-search-results"
                aria-autocomplete="list"
                aria-activedescendant={
                  filtered.items.length ? `command-search-opt-${activeIdx}` : undefined
                }
                className="h-14 min-w-0 flex-1 border-0 bg-transparent text-[15px] text-on-surface caret-accent placeholder:text-on-surface-variant focus:outline-none focus:shadow-none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    inputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="shrink-0 rounded-full p-1.5 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : (
                /* Both gates have to hold: a keyboard must be plausible, and the row
                   must be wide enough to spare the chip next to the placeholder. */
                <kbd className="hidden shrink-0 rounded-md border border-outline-variant px-1.5 py-0.5 text-[0.6875rem] font-bold text-on-surface-variant sm:keyboard-only:block">
                  ESC
                </kbd>
              )}
            </div>

            {/* Results. `scrollbar-gutter: stable` keeps the slim scrollbar from
                riding over the type badges of the last visible row. */}
            <div
              id="command-search-results"
              ref={listRef}
              role="listbox"
              aria-label="Search results"
              className="max-h-[50vh] min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 [scrollbar-gutter:stable]"
            >
              {index.loading && (
                <div className="flex items-center justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                </div>
              )}
              {!index.loading && filtered.items.length === 0 && (
                <div className="py-8 text-center">
                  <p className="text-sm font-medium text-on-surface-variant">
                    {search ? 'No results found' : 'Start typing to search'}
                  </p>
                  {search ? (
                    <p className="mt-1 text-xs text-on-surface-variant">
                      Searched all {index.items.length} record{index.items.length === 1 ? '' : 's'}{' '}
                      — try fewer letters, a patient number, or a test name
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-on-surface-variant">
                      Try a name, a patient number or a test
                    </p>
                  )}
                </div>
              )}
              {!index.loading && index.failedSources > 0 && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-xl bg-error/10 px-3.5 py-2.5 text-xs font-medium text-error"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">
                    {index.failedSources} record{' '}
                    {index.failedSources === 1 ? 'source could' : 'sources could'}
                    not be read, so it is missing from these results. This is not "no matches".
                  </span>
                </p>
              )}
              {!index.loading && filtered.omitted > 0 && (
                <p role="status" className="px-3.5 py-2 text-xs text-on-surface-variant">
                  Showing the best {filtered.items.length} of {filtered.totalMatches} matches;{' '}
                  {filtered.omitted} more omitted by the per-type display limit.
                </p>
              )}
              {!index.loading &&
                filtered.items.map((result, idx) => {
                  const Icon = TYPE_ICONS[result.type];
                  return (
                    <button
                      key={`${result.type}-${result.id}`}
                      id={`command-search-opt-${idx}`}
                      type="button"
                      role="option"
                      aria-selected={idx === activeIdx}
                      onClick={() => navigate(result)}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors',
                        idx === activeIdx
                          ? 'bg-accent/10 text-on-surface'
                          : 'text-on-surface-variant hover:bg-surface-container-high',
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          idx === activeIdx
                            ? 'bg-accent/15 text-accent'
                            : 'bg-surface-container-high text-on-surface-variant',
                        )}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-on-surface">
                          {result.title}
                        </p>
                        <p className="truncate text-xs text-on-surface-variant">
                          {result.subtitle}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md bg-surface-container-high px-1.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-on-surface-variant">
                        {TYPE_LABELS[result.type]}
                      </span>
                      {/* The "press Enter" slot is always present on a keyboard —
                        toggling visibility instead of mounting keeps the badge from
                        jumping on the active row. On touch it is gone for every row,
                        so the badge stays put either way. */}
                      <CornerDownLeft
                        className={cn(
                          'hidden keyboard-only:block h-3.5 w-3.5 shrink-0 text-accent transition-opacity',
                          idx === activeIdx ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
            </div>

            {/* Footer hints. The keyboard half of the row only means something with
                a physical keyboard; on touch the row keeps the result count alone. */}
            <div className="flex shrink-0 items-center gap-4 border-t border-outline-variant/60 px-5 py-2.5">
              <span className="hidden keyboard-only:flex items-center gap-1.5 text-[11px] text-on-surface-variant">
                <kbd className="rounded border border-outline-variant px-1 py-0.5 text-[0.6875rem] font-bold">
                  ↑↓
                </kbd>{' '}
                navigate
              </span>
              <span className="hidden keyboard-only:flex items-center gap-1.5 text-[11px] text-on-surface-variant">
                <kbd className="rounded border border-outline-variant px-1 py-0.5 text-[0.6875rem] font-bold">
                  ↵
                </kbd>{' '}
                open
              </span>
              <span className="ml-auto flex items-center gap-1 text-[11px] text-on-surface-variant">
                <ArrowRight className="h-3 w-3" /> {filtered.totalMatches} result
                {filtered.totalMatches !== 1 && 's'}
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
