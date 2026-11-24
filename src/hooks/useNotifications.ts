/**
 * Live alerts for the Notification Center.
 *
 * Sits between `lib/notification-engine` (pure derivation) and the header bell:
 * it owns the bounded Firestore reads, the per-user read/mute document, the
 * lab's channel preferences and the OS-banner side effects (via
 * `lib/desktop-notifications`, which knows the difference between the app's
 * WebView and a real browser).
 *
 * Cost and correctness notes, because this hook runs once for the whole shell:
 *   - Reads are **one-shot**, not listeners. Four permanent listeners would
 *     re-bill every document they cover on every write anywhere in the lab, and
 *     an alert is a 10-minute-grain signal, not a live cursor. Refresh happens
 *     on mount, on the pull-to-refresh / `app:refresh` event, on reconnect, on
 *     the manual refresh button, and every AUTO_REFRESH_MS.
 *   - Every query is bounded, and the 30-day lookback is what makes the
 *     "no report exists" check honest: a patient is only judged against reports
 *     from the same window, and a report is always created after its patient, so
 *     a patient inside the window cannot have a report outside it.
 *   - Guests and local demo sessions are excluded: they cannot read `reports`,
 *     `patients` or `invoices` under the production rules, so the hook would
 *     only produce permission errors.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRefreshHandler } from './useRefreshHandler';
import {
  collection,
  doc,
  getDocs,
  limit as limitDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  db,
} from '../data/fs';
import {
  readInvoices,
  readOrders,
  readPatients,
  readReports,
  readSamples,
  type InvoiceRecord,
  type OrderRecord,
  type PatientRecord,
  type ReportRecord,
  type SampleRecord,
} from '../lib/models';
import { captureError } from '../lib/telemetry';
import {
  currentPermission,
  isSupported,
  pickBackend,
  requestPermission,
  scheduleDailyReminder,
  cancelDailyReminder,
  showBanner,
  type BannerPermission,
} from '../lib/desktop-notifications';
import { SETTINGS_UPDATED_EVENT, readSettings, writeSettings } from '../lib/settings';
import { expandTestSelection } from '../lib/pathology-tests';
import {
  DEFAULT_NOTIFICATION_PREFS,
  buildNotifications,
  resolvePrefs,
  safeBannerFor,
  type NotificationItem,
  type NotificationPrefs,
  type NotificationSummary,
  summarizeNotifications,
} from '../lib/notification-engine';
import {
  NOTIFICATION_STATE_COLLECTION,
  applyState,
  markRead,
  parseState,
  pruneRead,
  readLocalState,
  toggleMute as muteItem,
  unmuteAll,
  writeLocalState,
  type NotificationState,
} from '../lib/notification-state';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../lib/permissions';


/** How far back to look for un-finished work. */
const LOOKBACK_DAYS = 30;
const PATIENT_WINDOW = 1000;
const REPORT_WINDOW = 1000;
/** An old draft is still an old draft, so this window is deliberately wider. */
const DRAFT_WINDOW = 500;
const AMENDED_WINDOW = 500;
const DUE_WINDOW = 500;
const ORDER_WINDOW = 5000;
const SAMPLE_WINDOW = 10000;

/** Background re-check cadence while the dashboard stays open. */
const AUTO_REFRESH_MS = 10 * 60_000;
/** Debounce for pushing read/mute changes so a "mark all" click is one write. */
const STATE_PUSH_DELAY_MS = 600;

export interface UseNotificationsResult {
  items: NotificationItem[];
  summary: NotificationSummary;
  prefs: NotificationPrefs;
  /** True until the first load resolves. */
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastCheckedAt: string | null;
  /** Alerts the staff member silenced — surfaced so "Show muted" is honest. */
  mutedCount: number;
  /** Query windows that reached their cap, so the UI cannot imply completeness. */
  truncatedSources: string[];
  refresh: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  toggleMute: (id: string) => void;
  clearMuted: () => void;
  desktopSupported: boolean;
  desktopPermission: BannerPermission;
  requestDesktopPermission: () => Promise<BannerPermission>;
}

function isPermissionError(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === 'permission-denied' || code === 'unauthenticated';
}

export function useNotifications(): UseNotificationsResult {
  const { user, role } = useAuth();
  const active = !!role && role !== 'guest' && can(role, 'viewClinical') && Boolean(user?.uid);
  const uid = user?.uid;

  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [samples, setSamples] = useState<SampleRecord[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [drafts, setDrafts] = useState<ReportRecord[]>([]);
  const [amended, setAmended] = useState<ReportRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);

  const [loading, setLoading] = useState(active);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [truncatedSources, setTruncatedSources] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<NotificationPrefs>(() =>
    resolvePrefs(readSettings().notificationPrefs ?? DEFAULT_NOTIFICATION_PREFS),
  );

  const [state, setState] = useState<NotificationState>(() => readLocalState(uid));
  /**
   * What the OS actually allows. Async because on the app the answer comes from
   * the notification plugin, not a global — and it is re-read whenever Settings
   * changes so a grant made in the browser's site UI is picked up.
   */
  const [bannerPermission, setBannerPermission] = useState<BannerPermission>('prompt');
  /** Debounced Firestore push of the local state. */
  const pushTimer = useRef(0);
  /** One desktop banner per alert id per session — never a repeating ping. */
  const announced = useRef<Set<string>>(new Set());

  // Preferences are lab settings: re-read them whenever Settings writes.
  useEffect(() => {
    const load = () => {
      setPrefs(resolvePrefs(readSettings().notificationPrefs));
    };
    load();
    window.addEventListener(SETTINGS_UPDATED_EVENT, load);
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, load);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void currentPermission().then(value => {
      if (!cancelled) setBannerPermission(value);
    });
    return () => {
      cancelled = true;
    };
  }, [prefs.channels.desktop]);

  useEffect(() => {
    if (active && prefs.channels.desktop && bannerPermission === 'granted') {
      void scheduleDailyReminder();
    } else {
      void cancelDailyReminder();
    }
  }, [active, prefs.channels.desktop, bannerPermission]);

  const load = useCallback(async () => {
    if (!active) return;
    setRefreshing(true);
    // Cutoff is computed once so a long-lived tab cannot drift the window.
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

    const windows = await Promise.allSettled([
      getDocs(
        query(
          collection(db, 'patients'),
          where('createdAt', '>=', since),
          orderBy('createdAt', 'desc'),
          limitDocs(PATIENT_WINDOW),
        ),
      ),
      getDocs(
        query(
          collection(db, 'reports'),
          where('createdAt', '>=', since),
          orderBy('createdAt', 'desc'),
          limitDocs(REPORT_WINDOW),
        ),
      ),
      // Drafts outside the lookback are still owed an issue, so this window is
      // not date-bounded — it walks the newest drafts instead.
      getDocs(
        query(
          collection(db, 'reports'),
          where('status', '==', 'draft'),
          orderBy('createdAt', 'desc'),
          limitDocs(DRAFT_WINDOW),
        ),
      ),
      // Ordered on `updatedAt`, which only exists on edited documents, so this
      // is already exactly the set of amendments — newest first.
      getDocs(
        query(collection(db, 'reports'), orderBy('updatedAt', 'desc'), limitDocs(AMENDED_WINDOW)),
      ),
      getDocs(
        query(
          collection(db, 'invoices'),
          where('status', 'in', ['pending', 'partial']),
          orderBy('createdAt', 'desc'),
          limitDocs(DUE_WINDOW),
        ),
      ),
      getDocs(
        query(
          collection(db, 'orders'),
          where('status', 'in', ['ordered', 'collected', 'processing', 'resulted', 'issued']),
          orderBy('createdAt', 'asc'),
          limitDocs(ORDER_WINDOW),
        ),
      ),
      getDocs(
        query(
          collection(db, 'samples'),
          where('status', 'in', ['expected', 'collected', 'received', 'processing']),
          orderBy('createdAt', 'asc'),
          limitDocs(SAMPLE_WINDOW),
        ),
      ),
    ]);

    const failures: string[] = [];
    // A rejected read is only an application error when it is not an expected
    // rule denial: a misconfigured project should be visible, a guest should be
    // silent. Permission failures still count as a missing window.
    let unexpectedReason: unknown = null;
    const consume = <T>(
      outcome: PromiseSettledResult<T>,
      label: string,
      apply: (value: T) => void,
    ) => {
      if (outcome.status === 'fulfilled') {
        apply(outcome.value);
        return;
      }
      failures.push(label);
      if (!isPermissionError(outcome.reason)) unexpectedReason = outcome.reason;
    };

    const [p, r, d, a, i, o, s] = windows;
    consume(p, 'patients', snapshot => setPatients(readPatients(snapshot.docs)));
    consume(r, 'reports', snapshot => setReports(readReports(snapshot.docs)));
    consume(d, 'drafts', snapshot => setDrafts(readReports(snapshot.docs)));
    consume(a, 'amendments', snapshot => setAmended(readReports(snapshot.docs)));
    consume(i, 'invoices', snapshot => setInvoices(readInvoices(snapshot.docs)));
    consume(o, 'orders', snapshot => setOrders(readOrders(snapshot.docs)));
    consume(s, 'samples', snapshot => setSamples(readSamples(snapshot.docs)));
    const labels = ['patients', 'reports', 'drafts', 'amendments', 'invoices', 'orders', 'samples'];
    const limits = [PATIENT_WINDOW, REPORT_WINDOW, DRAFT_WINDOW, AMENDED_WINDOW, DUE_WINDOW, ORDER_WINDOW, SAMPLE_WINDOW];
    setTruncatedSources(windows.flatMap((outcome, index) =>
      outcome.status === 'fulfilled' && outcome.value.size >= limits[index] ? [labels[index]] : [],
    ));

    setLoading(false);
    setRefreshing(false);
    setLastCheckedAt(new Date().toISOString());
    if (unexpectedReason) {
      setError(`Could not refresh alerts — ${failures.join(', ')} are unavailable.`);
      captureError(unexpectedReason, { scope: 'useNotifications/load' });
    } else {
      setError(null);
    }
  }, [active]);

  // Initial load, plus the pull-to-refresh broadcast and reconnects.
  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);
  // Pull-to-refresh goes through the shared registry instead of the raw
  // `app:refresh` CustomEvent, so the gesture can await `load()` and report
  // the real outcome (all reloaded / some failed) instead of a fixed-delay
  // "You're up to date" toast that fires whether the read worked or not.
  useRefreshHandler(() => load(), active);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void load(), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, load]);

  // Cross-device read state: one document, live-listened (it changes rarely and
  // only because of this user's own clicks).
  useEffect(() => {
    if (!active || !uid) return;
    return onSnapshot(
      doc(db, NOTIFICATION_STATE_COLLECTION, uid),
      snapshot => {
        // Our own optimistic write landing — do not echo it back and stutter.
        if (snapshot.metadata.hasPendingWrites) return;
        if (!snapshot.exists()) return;
        const remote = parseState(snapshot.data());
        setState(previous => (remote.updatedAt <= previous.updatedAt ? previous : remote));
      },
      err => {
        if (!isPermissionError(err)) captureError(err, { scope: 'useNotifications/state' });
      },
    );
  }, [active, uid]);

  /** Persist locally at once, then push the debounced cloud write. */
  const commit = useCallback(
    (next: NotificationState) => {
      setState(next);
      writeLocalState(uid, next);
      if (!active || !uid) return;
      window.clearTimeout(pushTimer.current);
      pushTimer.current = window.setTimeout(async () => {
        try {
          await setDoc(doc(db, NOTIFICATION_STATE_COLLECTION, uid), {
            readIds: next.readIds,
            mutedIds: next.mutedIds,
            updatedAt: next.updatedAt,
            updatedBy: uid,
          });
        } catch (err) {
          // Offline writes are queued by the Firestore SDK; a rejected rule is
          // not worth losing the local state over.
          if (!isPermissionError(err)) {
            captureError(err, { scope: 'useNotifications/push' });
          }
        }
      }, STATE_PUSH_DELAY_MS);
    },
    [active, uid],
  );

  // Every report the windows know about, merged and de-duplicated: `drafts` and
  // `amended` overlap `reports` but reach further back.
  const allReports = useMemo(() => {
    const byId = new Map<string, ReportRecord>();
    for (const report of [...reports, ...drafts, ...amended]) byId.set(report.id, report);
    return Array.from(byId.values());
  }, [reports, drafts, amended]);

  const derived = useMemo(
    () =>
      buildNotifications({
        patients,
        orders,
        samples,
        reports: allReports,
        invoices,
        prefs,
        // Panels expand into their members on both sides of the delivered check,
        // so "CBC was ordered, hemoglobin was reported" counts as delivered while
        // the LFT ordered in the same visit still alerts. Without the expander the
        // engine would compare booking lines against result lines and could neither
        // silence a real delivery nor see a missing one.
        expandNames: expandTestSelection,
        // Minute-granularity clock: re-deriving on every render would make ages
        // (and therefore ids) unstable while a panel is open.
        now: new Date(Math.floor(Date.now() / 60_000) * 60_000),
      }),
    [patients, orders, samples, allReports, invoices, prefs],
  );

  const items = useMemo(() => applyState(derived, state), [derived, state]);
  const summary = useMemo(() => summarizeNotifications(items), [items]);

  // Forget handled alerts that no longer describe anything, so the ledger stays
  // inside its cap and recent ids are not pushed out by dead ones.
  useEffect(() => {
    if (!active) return;
    const pruned = pruneRead(
      state,
      derived.map(item => item.id),
    );
    if (pruned !== state) commit(pruned);
  }, [active, derived, state, commit]);

  // Banner for anything new that needs attention right now.
  useEffect(() => {
    if (!prefs.channels.desktop || !isSupported()) return;
    if (bannerPermission !== 'granted') return;
    for (const item of items) {
      if (item.read || announced.current.has(item.id)) continue;
      // Silence is fine for routine notices; only lateness wakes the OS.
      if (item.severity === 'info') continue;
      announced.current.add(item.id);
      // `showBanner` dedupes by alert key on every backend (the plugin's numeric
      // id on device, `tag` on web), so the same overdue patient replaces its
      // banner instead of stacking a pile of them.
      //
      // `bannerTitle` and `bannerBody`, not `title` and `body`: a banner lands in
      // the OS notification shade, which is readable on a locked screen. The
      // in-app centre keeps the name, the amendment reason and the money (the
      // operator is already authenticated); the shade sees neither.
      //
      // Only Android can be told to hide the text until unlock (`visibility: 0`
      // on the channel). Windows and the browser cannot, so the record
      // identifier goes as well — see safeBannerFor in notification-engine.ts.
      const native = pickBackend() === 'native';
      const banner = native
        ? { title: item.bannerTitle, body: item.bannerBody }
        : safeBannerFor(item);
      void showBanner({ key: item.id, ...banner });
    }
  }, [items, prefs.channels.desktop, bannerPermission]);

  const markReadOne = useCallback((id: string) => commit(markRead(state, [id])), [commit, state]);

  const markAllRead = useCallback(
    () =>
      commit(
        markRead(
          state,
          items.map(item => item.id),
        ),
      ),
    [commit, items, state],
  );

  const toggleMuteOne = useCallback((id: string) => commit(muteItem(state, id)), [commit, state]);

  const clearMutedAll = useCallback(() => commit(unmuteAll(state)), [commit, state]);

  /**
   * Ask the browser for permission and record the outcome in the lab settings.
   *
   * The grant is stored, not just held in memory: without a stored preference
   * the bell would stop banner-ing after a reload while the OS still shows the
   * site as allowed.
   */
  const requestDesktopPermission = useCallback(async () => {
    const result = await requestPermission();
    setBannerPermission(result);
    if (result === 'unsupported') return result;
    try {
      const current = readSettings();
      const nextPrefs = resolvePrefs(current.notificationPrefs);
      nextPrefs.channels = { ...nextPrefs.channels, desktop: result === 'granted' };
      writeSettings({ ...current, notificationPrefs: nextPrefs });
      setPrefs(nextPrefs);
    } catch (err) {
      captureError(err, { scope: 'useNotifications/permission' });
    }
    return result;
  }, []);

  return {
    items,
    summary,
    prefs,
    loading,
    refreshing,
    error,
        lastCheckedAt,
    mutedCount: state.mutedIds.length,
    truncatedSources,
    refresh: () => void load(),
    markRead: markReadOne,
    markAllRead,
    toggleMute: toggleMuteOne,
    clearMuted: clearMutedAll,
    desktopSupported: isSupported(),
    desktopPermission: bannerPermission,
    requestDesktopPermission,
  };
}
