/**
 * CommandSearch — global search overlay (Ctrl+K / Cmd+K).
 * Searches across patients, reports, and doctors with keyboard navigation.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Search, Users, FileText, Stethoscope, ArrowRight, CornerDownLeft, X } from 'lucide-react';
import { collection, getDocs, query, limit, orderBy, db } from '../data/fs';
import { cn } from '../lib/utils';
import { BACK_PRIORITY, useBackHandler } from '../lib/back-button';
import { useAuth } from '../contexts/AuthContext';

interface SearchResult {
  id: string;
  type: 'patient' | 'report' | 'doctor';
  title: string;
  subtitle: string;
}

const TYPE_ICONS = {
  patient: Users,
  report: FileText,
  doctor: Stethoscope,
};

const TYPE_LABELS = {
  patient: 'Patient',
  report: 'Report',
  doctor: 'Doctor',
};

export function CommandSearch({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: string, id?: string) => void;
}) {
  const { role } = useAuth();
  const [search, setSearch] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load all searchable data on open
  const [allData, setAllData] = useState<SearchResult[]>([]);

  useEffect(() => {
    if (!open || role === 'guest') return;
    let cancelled = false;
    setLoading(true);

    Promise.all([
      getDocs(query(collection(db, 'patients'), orderBy('createdAt', 'desc'), limit(200))).catch(
        () => ({ docs: [] }),
      ),
      getDocs(query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(200))).catch(
        () => ({ docs: [] }),
      ),
      getDocs(query(collection(db, 'doctors'), orderBy('createdAt', 'desc'), limit(200))).catch(
        () => ({ docs: [] }),
      ),
    ]).then(([patients, reports, doctors]) => {
      if (cancelled) return;
      const items: SearchResult[] = [
        ...patients.docs.map(d => ({
          id: d.id,
          type: 'patient' as const,
          title: d.data().name || 'Unknown Patient',
          subtitle: `${d.data().age || '?'}y · ${d.data().gender || '—'}`,
        })),
        ...reports.docs.map(d => ({
          id: d.id,
          type: 'report' as const,
          title: d.data().patientName || 'Report',
          subtitle: `Signed ${d.data().createdAt ? new Date(d.data().createdAt).toLocaleDateString() : '—'}`,
        })),
        ...doctors.docs.map(d => ({
          id: d.id,
          type: 'doctor' as const,
          title: d.data().name || 'Unknown Doctor',
          subtitle: d.data().phone || 'No phone',
        })),
      ];
      setAllData(items);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, role]);

  // Filter results based on search
  const filtered = useMemo(() => {
    if (!search.trim()) return allData.slice(0, 8);
    const q = search.toLowerCase();
    return allData
      .filter(
        r =>
          r.title.toLowerCase().includes(q) ||
          r.subtitle.toLowerCase().includes(q) ||
          r.type.includes(q),
      )
      .slice(0, 12);
  }, [search, allData]);

  useEffect(() => {
    setActiveIdx(0);
  }, [filtered.length]);
  useEffect(() => {
    if (open) {
      setSearch('');
      setActiveIdx(0);
    }
  }, [open]);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  const navigate = useCallback(
    (result: SearchResult) => {
      const tabMap = { patient: 'patients', report: 'reports', doctor: 'doctors' };
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
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && filtered[activeIdx]) {
      e.preventDefault();
      navigate(filtered[activeIdx]);
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
        // by 80dvh with the results list taking the slack.
        <motion.div
          className="fixed inset-0 z-[9998] flex items-start justify-center pt-[min(15vh,9rem)] px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onKeyDown={handleKeyDown}
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
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="relative flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-[var(--elevated-border)] bg-surface shadow-float"
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
                placeholder="Search patients, reports, doctors…"
                aria-label="Search query"
                role="combobox"
                aria-expanded={filtered.length > 0}
                aria-controls="command-search-results"
                aria-autocomplete="list"
                aria-activedescendant={
                  filtered.length ? `command-search-opt-${activeIdx}` : undefined
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
                <kbd className="hidden shrink-0 rounded-md border border-outline-variant px-1.5 py-0.5 text-[10px] font-bold text-on-surface-variant sm:keyboard-only:block">
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
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                </div>
              )}
              {!loading && filtered.length === 0 && (
                <div className="py-8 text-center">
                  <p className="text-sm font-medium text-on-surface-variant">
                    {search ? 'No results found' : 'Start typing to search'}
                  </p>
                  {search && (
                    <p className="mt-1 text-xs text-outline">Try a different name or keyword</p>
                  )}
                </div>
              )}
              {!loading &&
                filtered.map((result, idx) => {
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
                      <span className="shrink-0 rounded-md bg-surface-container-high px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">
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
                <kbd className="rounded border border-outline-variant px-1 py-0.5 text-[9px] font-bold">
                  ↑↓
                </kbd>{' '}
                navigate
              </span>
              <span className="hidden keyboard-only:flex items-center gap-1.5 text-[11px] text-on-surface-variant">
                <kbd className="rounded border border-outline-variant px-1 py-0.5 text-[9px] font-bold">
                  ↵
                </kbd>{' '}
                open
              </span>
              <span className="ml-auto flex items-center gap-1 text-[11px] text-on-surface-variant">
                <ArrowRight className="h-3 w-3" /> {filtered.length} result
                {filtered.length !== 1 && 's'}
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
