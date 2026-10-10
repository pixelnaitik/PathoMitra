/**
 * Notification engine — turns lab records into actionable alerts.
 *
 * The Notifications tab in Settings used to persist two booleans that nothing
 * ever read, so the app appeared to have alerts while producing none. This is
 * the missing half: a pure function of (records, preferences, clock) that the
 * `useNotifications` hook feeds to the Notification Center.
 *
 * Kept framework-free and Firebase-free on purpose — same rule as
 * `report-calculations.ts` — so every threshold and message string is unit-
 * testable without a Firestore emulator, and so the delivery helpers below can
 * be reused by a future server-side sender.
 *
 * Categories are all *operational*, never clinical: an alert says "this sample
 * has had no report for 26 hours", not "this potassium is dangerous". Panic
 * grids are a clinical configuration decision that must come from the lab's
 * own validated thresholds, so inventing them here would be worse than
 * omitting them.
 */
import type { InvoiceRecord, PatientRecord, ReportRecord } from './models';

export const NOTIFICATION_CATEGORIES = ['overdue', 'draft', 'amended', 'due'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationSeverity = 'critical' | 'warning' | 'info';

/**
 * Channel + threshold preferences. `email`/`sms` replace the legacy
 * `emailNotifications`/`smsNotifications` booleans, which are migrated into
 * this shape so an existing lab's choices survive the upgrade.
 */
export interface NotificationPrefs {
  channels: {
    email: boolean;
    sms: boolean;
    whatsapp: boolean;
    /** Browser notifications via the Notification API (foreground only). */
    desktop: boolean;
  };
  categories: Record<NotificationCategory, boolean>;
  /** Hours a sample may wait for its first report before it alerts. */
  overdueHours: number;
  /** Hours a draft may sit unissued before it alerts. */
  draftHours: number;
  /** Days an invoice may stay unpaid before it alerts. */
  dueDays: number;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  channels: { email: true, sms: false, whatsapp: false, desktop: false },
  categories: { overdue: true, draft: true, amended: true, due: true },
  overdueHours: 24,
  draftHours: 24,
  dueDays: 7,
};

export interface NotificationLink {
  /** Dashboard tab to switch to — matches App.tsx DASHBOARD_TABS. */
  tab: 'reports' | 'patients';
  /**
   * Deep-link query the DashboardShell already consumes: `report` opens the
   * report editor, `patient` starts a report for that patient.
   */
  param?: { key: 'report' | 'patient'; value: string };
}

export interface NotificationItem {
  /**
   * Stable across reloads (`category:entityId`) so "read" and "muted" state
   * still refer to the same thing after a refresh.
   */
  id: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string;
  /** Person or record the alert is about — used for delivery messaging. */
  entityName: string;
  entityId: string;
  /** Age of the underlying record, in hours, at evaluation time. */
  ageHours: number;
  timestamp: string;
  link: NotificationLink;
  /** Outstanding amount, for `due` alerts. */
  amount?: number;
  /** Set by the caller from persisted state; the engine never writes it. */
  read?: boolean;
}

export interface NotificationSource {
  patients: PatientRecord[];
  reports: ReportRecord[];
  invoices: InvoiceRecord[];
  prefs?: NotificationPrefsPatch;
  /** Injectable for tests; defaults to a fresh Date per call. */
  now?: Date;
}

const HOUR_MS = 3_600_000;

/** How far back an amendment to an issued report stays worth flagging. */
const AMENDED_WINDOW_DAYS = 7;

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  overdue: 'Awaiting report',
  draft: 'Unissued draft',
  amended: 'Amended report',
  due: 'Payment due',
};

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * A settings-form patch: any subset, with the two nested groups also partial so
 * editing one switch cannot overwrite its siblings.
 */
export interface NotificationPrefsPatch {
  channels?: Partial<NotificationPrefs['channels']>;
  categories?: Partial<NotificationPrefs['categories']>;
  overdueHours?: number;
  draftHours?: number;
  dueDays?: number;
}

/** Merge partial prefs over defaults, deep enough for the two nested groups. */
export function resolvePrefs(overrides?: NotificationPrefsPatch): NotificationPrefs {
  if (!overrides) return { ...DEFAULT_NOTIFICATION_PREFS };
  return {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...overrides,
    channels: { ...DEFAULT_NOTIFICATION_PREFS.channels, ...(overrides.channels ?? {}) },
    categories: { ...DEFAULT_NOTIFICATION_PREFS.categories, ...(overrides.categories ?? {}) },
  };
}

/**
 * Hours elapsed since an ISO timestamp, or `null` when it cannot be parsed.
 *
 * The null case matters: report/patient documents historically stored
 * client-written strings, and a `NaN` comparison would silently make a
 * malformed record look either permanently overdue or never overdue, depending
 * on which operator was used. Skipping the record is the safe answer.
 */
export function hoursBetween(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return (now.getTime() - then) / HOUR_MS;
}

/** Warning once past `warnHours`, critical once past double that. */
function escalate(ageHours: number, warnHours: number): NotificationSeverity | null {
  if (ageHours < warnHours) return null;
  return ageHours >= warnHours * 2 ? 'critical' : 'warning';
}

/** `₹1,20,345` — Indian grouping, matching the `en-IN` dates used elsewhere. */
export function formatAmount(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `₹${safe.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** Compact human age: `40m`, `18h`, `3d 6h`. */
export function formatAge(hours: number): string {
  if (!Number.isFinite(hours) || hours < 1) return '<1h';
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours - days * 24);
  return rest > 0 ? `${days}d ${rest}h` : `${days}d`;
}

function pluralTests(count: number): string {
  return count === 1 ? 'test' : 'tests';
}

/**
 * Build every open alert from the loaded window of records.
 *
 * Cost note: this only sees what the caller loaded (a bounded recent window),
 * so an alert can be missed for a record far outside the window. That is
 * deliberate — the alternative is a permanent listener on whole collections,
 * billed per document on every change in the lab.
 */
export function buildNotifications(source: NotificationSource): NotificationItem[] {
  const prefs = resolvePrefs(source.prefs);
  const now = source.now ?? new Date();
  const items: NotificationItem[] = [];

  // Reports that exist at all, by patient — one pass, reused by two rules.
  const patientIdsWithReport = new Set(
    source.reports.map(report => report.patientId).filter(Boolean),
  );

  if (prefs.categories.overdue) {
    for (const patient of source.patients) {
      if (!patient.testSelection || patient.testSelection.length === 0) continue;
      if (patientIdsWithReport.has(patient.id)) continue;
      const age = hoursBetween(patient.createdAt, now);
      if (age === null) continue;
      const severity = escalate(age, prefs.overdueHours);
      if (!severity) continue;
      const label = patient.testSelection.slice(0, 2).join(', ');
      const extra = patient.testSelection.length > 2 ? ` +${patient.testSelection.length - 2}` : '';
      items.push({
        id: `overdue:${patient.id}`,
        category: 'overdue',
        severity,
        title: `${patient.name} is still awaiting a report`,
        body: `${patient.testSelection.length} ${pluralTests(patient.testSelection.length)} collected ${formatAge(age)} ago (${label}${extra}). No report issued yet.`,
        entityName: patient.name,
        entityId: patient.id,
        ageHours: age,
        timestamp: patient.createdAt,
        link: { tab: 'reports', param: { key: 'patient', value: patient.id } },
      });
    }
  }

  if (prefs.categories.draft) {
    for (const report of source.reports) {
      if (report.status !== 'draft') continue;
      const age = hoursBetween(report.updatedAt ?? report.createdAt, now);
      if (age === null) continue;
      const severity = escalate(age, prefs.draftHours);
      if (!severity) continue;
      items.push({
        id: `draft:${report.id}`,
        category: 'draft',
        severity,
        title: `Draft for ${report.patientName} was never issued`,
        body: `Last edited ${formatAge(age)} ago${report.testType ? ` · ${report.testType}` : ''}. It stays invisible to the patient until it is finalized and signed.`,
        entityName: report.patientName,
        entityId: report.id,
        ageHours: age,
        timestamp: report.updatedAt ?? report.createdAt,
        link: { tab: 'reports', param: { key: 'report', value: report.id } },
      });
    }
  }

  if (prefs.categories.amended) {
    for (const report of source.reports) {
      if (report.status !== 'final' || (report.version ?? 1) < 2) continue;
      const age = hoursBetween(report.updatedAt ?? report.createdAt, now);
      if (age === null) continue;
      // Only a week back: an amendment from last year is not news anymore.
      if (age > AMENDED_WINDOW_DAYS * 24) continue;
      const reAmended = (report.version ?? 1) > 2;
      items.push({
        id: `amended:${report.id}`,
        category: 'amended',
        severity: reAmended ? 'warning' : 'info',
        title: `Issued report for ${report.patientName} was amended`,
        body: `Version ${report.version}${reAmended ? ' — changed more than once' : ''}, last edited ${formatAge(age)} ago.${report.amendReason ? ` Reason: ${report.amendReason}.` : ' No reason recorded.'}`,
        entityName: report.patientName,
        entityId: report.id,
        ageHours: age,
        timestamp: report.updatedAt ?? report.createdAt,
        link: { tab: 'reports', param: { key: 'report', value: report.id } },
      });
    }
  }

  if (prefs.categories.due) {
    for (const invoice of source.invoices) {
      if (invoice.status !== 'pending') continue;
      const age = hoursBetween(invoice.createdAt, now);
      if (age === null) continue;
      const severity = escalate(age, prefs.dueDays * 24);
      if (!severity) continue;
      items.push({
        id: `due:${invoice.id}`,
        category: 'due',
        // Never louder than warning — money is not a clinical emergency.
        severity: severity === 'critical' ? 'warning' : severity,
        title: `${formatAmount(invoice.amount)} unpaid for ${invoice.patientName}`,
        body: `Invoice raised ${formatAge(age)} ago and still marked pending.`,
        entityName: invoice.patientName,
        entityId: invoice.id,
        ageHours: age,
        timestamp: invoice.createdAt,
        amount: invoice.amount,
        // An invoice predating reportId linkage still alerts; it just cannot
        // deep-link, because `?report=` with an empty value would do nothing.
        link: invoice.reportId
          ? { tab: 'reports', param: { key: 'report', value: invoice.reportId } }
          : { tab: 'reports' },
      });
    }
  }

  return items.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.ageHours - a.ageHours,
  );
}

export interface NotificationSummary {
  total: number;
  unread: number;
  critical: number;
  warning: number;
  info: number;
  /** Total outstanding amount across `due` alerts. */
  dueAmount: number;
  byCategory: Record<NotificationCategory, number>;
}

export function summarizeNotifications(items: NotificationItem[]): NotificationSummary {
  const byCategory: Record<NotificationCategory, number> = {
    overdue: 0,
    draft: 0,
    amended: 0,
    due: 0,
  };
  let critical = 0;
  let warning = 0;
  let info = 0;
  let unread = 0;
  let dueAmount = 0;

  for (const item of items) {
    byCategory[item.category] += 1;
    if (item.severity === 'critical') critical += 1;
    else if (item.severity === 'warning') warning += 1;
    else info += 1;
    if (!item.read) unread += 1;
    if (item.category === 'due') dueAmount += item.amount ?? 0;
  }

  return { total: items.length, unread, critical, warning, info, dueAmount, byCategory };
}

// ---------------------------------------------------------------------------
// Delivery helpers
// ---------------------------------------------------------------------------

/**
 * One-line alert text for email/SMS/WhatsApp bodies.
 *
 * Kept to the record's status, never a result value: an SMS to a shared
 * phone must not carry clinical data.
 */
export function buildAlertText(item: NotificationItem, labName: string): string {
  return `${labName}: [${CATEGORY_LABEL[item.category]}] ${item.title} (${item.body})`;
}

/**
 * Plain-text daily summary — the thing the old "Receive daily summaries via
 * email" copy promised but never produced.
 */
export function buildDailySummaryText(items: NotificationItem[], labName: string): string {
  const summary = summarizeNotifications(items);
  const lines = [
    `${labName} — daily lab summary`,
    `${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
    '',
    `Open alerts: ${summary.total} (${summary.critical} critical, ${summary.warning} warning)`,
    summary.dueAmount > 0 ? `Outstanding payments: ${formatAmount(summary.dueAmount)}` : '',
    '',
  ].filter(Boolean);

  for (const category of NOTIFICATION_CATEGORIES) {
    const group = items.filter(item => item.category === category);
    if (group.length === 0) continue;
    lines.push(`${CATEGORY_LABEL[category]} (${group.length})`);
    for (const item of group.slice(0, 20)) {
      lines.push(`  • ${item.title} — ${formatAge(item.ageHours)}`);
    }
    lines.push('');
  }

  if (lines.length <= 5) lines.push('Nothing outstanding. The lab is clear.');
  return lines.join('\n');
}

/** Digits only — `wa.me` and `sms:` both reject formatting and `+` differs per OS. */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
}

function encodeBody(body: string): string {
  return encodeURIComponent(body);
}

export interface ChannelAvailability {
  enabled: boolean;
  /** A destination exists (address/phone present in lab settings). */
  ready: boolean;
  missingHint?: string;
}

export function channelAvailability(
  channel: keyof NotificationPrefs['channels'],
  prefs: NotificationPrefs,
  destination: string | undefined,
): ChannelAvailability {
  const enabled = prefs.channels[channel];
  const ready = Boolean(destination && destination.trim().length > 0);
  if (!enabled) return { enabled: false, ready: false };
  return {
    enabled: true,
    ready,
    missingHint: ready
      ? undefined
      : `Add a ${channel === 'email' ? 'lab email' : 'lab phone'} in Settings → Lab Organization to use ${channel.toUpperCase()}.`,
  };
}

/** Opens the user's mail client with the alert composed. */
export function emailHref(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeBody(subject)}&body=${encodeBody(body)}`;
}

/** Opens the native SMS composer with the alert composed. */
export function smsHref(phone: string, body: string): string {
  return `sms:${normalizePhone(phone)}?body=${encodeBody(body)}`;
}

/**
 * Opens WhatsApp with the alert composed. `normalizePhone` strips the leading
 * `+` because wa.me expects country code without punctuation.
 */
export function whatsappHref(phone: string, body: string): string {
  const digits = normalizePhone(phone).replace(/^\+/, '');
  return `https://wa.me/${digits}?text=${encodeBody(body)}`;
}
