/**
 * Doctor referral tracking and commission computation.
 *
 * What this is for: a lab's referring-practitioner book. When a doctor sends a
 * patient in, the lab records who sent them, and at month end it needs the list
 * of patients, tests, dates, and what is owed to that practitioner under the
 * rate agreed with them.
 *
 * Three rules this module exists to enforce, because getting any of them wrong
 * quietly corrupts money:
 *
 *  1. **The rate is a snapshot.** `DoctorSchema.referralPercent` is editable, so
 *     commission is stamped onto the invoice when the bill is raised
 *     (`InvoiceReferralSchema`). A statement built from *current* rates would
 *     restate April after a June renegotiation — the lab would then pay a number
 *     that does not match any document it holds.
 *  2. **The base is what the lab kept.** Commission is computed on `taxableBase`
 *     — the subtotal *after* discount, before tax. Paying a referrer a share of a
 *     fee the lab waived, or of a GST component the lab remits onward, is money
 *     that never existed.
 *  3. **A referrer is matched on the folded name, never the raw string.**
 *     `DR NKUMAR`, `Dr. N Kumar (MBBS)` and `dr nkumar ` are one practitioner, and
 *     patients store `doctorName` rather than a doctor id. `doctorNameKey()` is
 *     already the app's grouping rule (analytics, the referral sheet, the
 *     registration dropdown) — reusing it here is what stops one doctor's
 *     commission being split across three statements.
 *
 * ⚠ Compliance note for the owner: paying a commission *for a referral* is
 * regulated in India. ICMR ethical guidelines and the NMC's professional-conduct
 * rules treat inducement for referrals as misconduct, and NABH accreditation
 * standards address it directly. Pure referral *tracking* (who sent the patient)
 * is ordinary practice; the payout is the part that needs a lawyer's view.
 * `referralPercent` therefore defaults to `0` per doctor, and nothing here ever
 * transmits a statement anywhere — a lab officer prints or exports it on this
 * device.
 */
import { doctorNameKey, groupByDoctorName } from './doctor-registry';
import {
  isInvoiceSettled,
  roundMoney,
  type DoctorRecord,
  type InvoiceRecord,
  type InvoiceReferral,
} from './models';
import { DEFAULT_BILLING_PREFS, type BillingPrefs } from './price-list';

/** `YYYY-MM` — the bucket a monthly statement is cut on. */
export function monthKey(iso: string | Date | undefined): string {
  const date = iso instanceof Date ? iso : new Date(String(iso ?? ''));
  if (Number.isNaN(date.getTime())) return '';
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${mm}`;
}

/** `2026-10` → `October 2026`, for the heading on a printed statement. */
export function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** The lab's own fiscal month — never UTC midnight (see DashboardLayout date notes). */
export function currentMonthKey(now: Date = new Date()): string {
  return monthKey(now);
}

/**
 * The referral attributed to a bill, resolved at bill-raising time.
 *
 * `percent` prefers the register's own rate for the matched doctor; a name typed
 * at the counter that matches no record is still recorded (with `unmatched: true`)
 * so the month end does not silently lose a practitioner the lab deals with but
 * never registered. That case is surfaced in the statement rather than hidden,
 * because an unregistered referrer is exactly how a payout goes missing.
 */
export function resolveReferral(
  doctorName: string | undefined,
  doctors: readonly DoctorRecord[],
  prefs: BillingPrefs = DEFAULT_BILLING_PREFS,
): InvoiceReferral | undefined {
  const name = String(doctorName ?? '').trim();
  if (!name) return undefined;
  const key = doctorNameKey(name);
  if (!key) return undefined;

  const match = doctors.find(d => doctorNameKey(d.name) === key);
  const percent = clampPercent(
    match?.referralPercent ?? (match ? 0 : prefs.defaultReferralPercent),
  );

  return {
    // The register's spelling when there is one — statements read to a person.
    doctorName: match?.name ?? name,
    doctorKey: key,
    doctorId: match?.id ?? '',
    percent,
    commission: 0,
    unmatched: !match,
  };
}

function clampPercent(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

/**
 * Commission on one bill.
 *
 * `taxableBase` is preferred; a bill written before this feature has no
 * `taxableBase`, so it falls back to `amount` — the pre-existing scalar the alert
 * engine already trusts. That fallback is deliberate and slightly generous, and it
 * is flagged by `estimated` so a statement can say "computed on the bill total"
 * rather than pretending to a precision it does not have.
 */
export interface CommissionResult {
  commission: number;
  base: number;
  percent: number;
  /** True when the bill predates line items and the base is the whole amount. */
  estimated: boolean;
}

export function commissionFor(
  invoice: Pick<InvoiceRecord, 'amount' | 'taxableBase' | 'referral'>,
  fallbackPercent = 0,
): CommissionResult {
  const percent = clampPercent(invoice.referral?.percent ?? fallbackPercent);
  const hasBase = typeof invoice.taxableBase === 'number' && invoice.taxableBase > 0;
  const base = hasBase ? invoice.taxableBase : invoice.amount;
  return {
    commission: percent > 0 ? roundMoney((base * percent) / 100) : 0,
    base,
    percent,
    estimated: !hasBase,
  };
}

/** One referred patient's bill on a statement. */
export interface StatementLine {
  invoiceId: string;
  invoiceNo: string;
  /** ISO timestamp the bill was raised — the "reference date" the lab reads. */
  billedAt: string;
  month: string;
  patientId: string;
  patientName: string;
  /** Registration number, when the bill carries one. */
  patientNo: string;
  /** Test / panel names as printed on the bill. */
  tests: string[];
  billAmount: number;
  collected: number;
  outstanding: number;
  commissionBase: number;
  percent: number;
  commission: number;
  estimated: boolean;
  /** False while the bill is unpaid — the payout may be gated on collection. */
  settled: boolean;
}

export interface DoctorStatement {
  doctorKey: string;
  doctorName: string;
  doctorId: string;
  phone?: string;
  clinic?: string;
  /** Rate applied to the lines. When doctors disagree, it is the stored snapshot. */
  percent: number;
  lines: StatementLine[];
  totals: {
    bills: number;
    patients: number;
    tests: number;
    billAmount: number;
    collected: number;
    outstanding: number;
    commissionBase: number;
    commission: number;
    /** Commission on bills that are not yet collected — reported, not assumed. */
    commissionPending: number;
  };
  unmatched: boolean;
}

export interface StatementOptions {
  /** `YYYY-MM`. Omit for all months. */
  month?: string;
  /** Group bills by the referrer stored on them (preferred) or by live matching. */
  doctors?: readonly DoctorRecord[];
  /**
   * `collected` pays commission only on money actually received; `billed` pays on
   * the bill as raised. Labs run both ways, and the difference is real cash, so it
   * is a switch rather than an assumption.
   */
  basis?: 'billed' | 'collected';
}

/**
 * Build the per-doctor monthly statement.
 *
 * Every bill is attributed to exactly one referrer (the one stamped on it), so
 * totals add rather than overlap. Doctors with no bills in the window are
 * omitted — an empty statement is noise at month end — but a bill whose referrer
 * is not in the register still produces a statement row, under the name the
 * counter typed, flagged `unmatched`.
 */
export function buildDoctorStatements(
  invoices: readonly InvoiceRecord[],
  patients: readonly { id: string; name: string; doctorName?: string }[] = [],
  options: StatementOptions = {},
): DoctorStatement[] {
  const { month, doctors = [], basis = 'billed' } = options;
  const rateByKey = new Map<string, number>();
  for (const doctor of doctors) {
    const key = doctorNameKey(doctor.name);
    if (key && !rateByKey.has(key)) rateByKey.set(key, clampPercent(doctor.referralPercent));
  }
  const byId = new Map(patients.map(p => [p.id, p]));

  const statements = new Map<string, DoctorStatement>();

  for (const invoice of invoices) {
    if (invoice.status === 'void') continue;
    const billedAt = invoice.createdAt || '';
    const bucket = monthKey(billedAt);
    if (month && bucket !== month) continue;

    // The stamp is the authority; a bill predating this feature falls back to the
    // patient's live referrer so old records are not invisible to a new statement.
    const stamped = invoice.referral;
    const livePatient = byId.get(invoice.patientId);
    const fallbackName = invoice.doctorName || livePatient?.doctorName || '';
    const key = stamped?.doctorKey || doctorNameKey(fallbackName);
    if (!key) continue;

    const fallbackPercent = rateByKey.get(key) ?? stamped?.percent ?? 0;
    const { commission, base, percent, estimated } = commissionFor(invoice, fallbackPercent);
    const paid = Math.max(0, invoice.paidAmount ?? 0);
    const outstanding = Math.max(0, roundMoney(invoice.amount - paid));
    // Under `collected`, commission is already scaled to the money in hand, so
    // none of it can still be pending. Under `billed`, the whole commission is
    // earned now and the share riding on uncollected rupees is the pending part —
    // the number that tells a lab "do not pay this out yet".
    const earned =
      basis === 'collected' && invoice.amount > 0
        ? roundMoney(commission * (paid / invoice.amount))
        : commission;
    const pendingShare =
      basis === 'collected' || invoice.amount <= 0
        ? 0
        : roundMoney(commission * (outstanding / invoice.amount));

    let statement = statements.get(key);
    if (!statement) {
      const doctor = doctors.find(d => doctorNameKey(d.name) === key);
      statement = {
        doctorKey: key,
        doctorName: stamped?.doctorName || doctor?.name || fallbackName,
        doctorId: stamped?.doctorId || doctor?.id || '',
        ...(doctor?.phone ? { phone: doctor.phone } : {}),
        ...(doctor?.clinic ? { clinic: doctor.clinic } : {}),
        percent,
        lines: [],
        totals: {
          bills: 0,
          patients: 0,
          tests: 0,
          billAmount: 0,
          collected: 0,
          outstanding: 0,
          commissionBase: 0,
          commission: 0,
          commissionPending: 0,
        },
        unmatched: stamped?.unmatched ?? !doctor,
      };
      statements.set(key, statement);
    }

    const tests = invoice.items.length > 0 ? invoice.items.map(item => item.name) : [];
    statement.lines.push({
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo || '',
      billedAt,
      month: bucket,
      patientId: invoice.patientId,
      patientName: invoice.patientName || livePatient?.name || '',
      patientNo: invoice.patientId,
      tests,
      billAmount: invoice.amount,
      collected: paid,
      outstanding,
      commissionBase: base,
      percent,
      commission: earned,
      estimated,
      settled: isInvoiceSettled(invoice.status),
    });

    const t = statement.totals;
    t.bills += 1;
    t.tests += tests.length;
    t.billAmount = roundMoney(t.billAmount + invoice.amount);
    t.collected = roundMoney(t.collected + paid);
    t.outstanding = roundMoney(t.outstanding + outstanding);
    t.commissionBase = roundMoney(t.commissionBase + base);
    t.commission = roundMoney(t.commission + earned);
    t.commissionPending = roundMoney(t.commissionPending + pendingShare);
  }

  for (const statement of statements.values()) {
    statement.lines.sort((a, b) => a.billedAt.localeCompare(b.billedAt));
    statement.totals.patients = new Set(statement.lines.map(line => line.patientId)).size;
    // The headline rate is only meaningful when every line shared it.
    const rates = new Set(statement.lines.map(line => line.percent));
    statement.percent = rates.size === 1 ? [...rates][0] : statement.percent;
  }

  return [...statements.values()].sort(
    (a, b) => b.totals.commission - a.totals.commission || a.doctorName.localeCompare(b.doctorName),
  );
}

/** One doctor's statement, filtered from the batch. */
export function statementForDoctor(
  statements: readonly DoctorStatement[],
  doctorName: string,
): DoctorStatement | undefined {
  const key = doctorNameKey(doctorName);
  return statements.find(s => s.doctorKey === key);
}

/**
 * Roll the whole register up for one month — the lab's own view: how much is
 * going out, to how many practitioners, and how much of it is on uncollected
 * bills (which is money that should not leave the lab yet).
 */
export function statementsSummary(statements: readonly DoctorStatement[]): {
  doctors: number;
  bills: number;
  patients: number;
  billAmount: number;
  commission: number;
  uncollectedCommission: number;
  unmatchedDoctors: number;
} {
  let bills = 0;
  let billAmount = 0;
  let commission = 0;
  let uncollectedCommission = 0;
  let patients = 0;
  let unmatchedDoctors = 0;
  for (const s of statements) {
    bills += s.totals.bills;
    billAmount = roundMoney(billAmount + s.totals.billAmount);
    commission = roundMoney(commission + s.totals.commission);
    uncollectedCommission = roundMoney(uncollectedCommission + s.totals.commissionPending);
    patients += s.totals.patients;
    if (s.unmatched) unmatchedDoctors += 1;
  }
  return {
    doctors: statements.length,
    bills,
    patients,
    billAmount: roundMoney(billAmount),
    commission: roundMoney(commission),
    uncollectedCommission: roundMoney(uncollectedCommission),
    unmatchedDoctors,
  };
}

/**
 * Group bills that carry no referral stamp by the patient's live referrer.
 *
 * Used to warn at month end: "these 12 bills have no referrer on file, but the
 * patients came from Dr NKUMAR". Without this, a lab that starts tracking
 * referrals mid-month sees a statement that silently omits everything before the
 * feature was switched on.
 */
export function unattributedBills(
  invoices: readonly InvoiceRecord[],
  options: { month?: string; patients?: readonly { id: string; doctorName?: string }[] } = {},
): { count: number; amount: number } {
  let count = 0;
  let amount = 0;
  const byId = new Map((options.patients ?? []).map(p => [p.id, p]));
  for (const invoice of invoices) {
    if (invoice.status === 'void') continue;
    if (options.month && monthKey(invoice.createdAt) !== options.month) continue;
    if (invoice.referral?.doctorKey) continue;
    const name = invoice.doctorName || byId.get(invoice.patientId)?.doctorName || '';
    if (doctorNameKey(name)) continue;
    count += 1;
    amount = roundMoney(amount + invoice.amount);
  }
  return { count, amount };
}

/** Names of every test referred to a doctor in a window — the "what did they send". */
export function referredTestCounts(
  statements: readonly DoctorStatement[],
): Array<{ test: string; bills: number }> {
  const counts = new Map<string, { bills: number }>();
  for (const statement of statements) {
    const seen = new Set<string>();
    for (const line of statement.lines) {
      for (const test of line.tests) {
        const folded = test.trim();
        if (!folded) continue;
        const entry = counts.get(folded) ?? { bills: 0 };
        if (!seen.has(`${line.invoiceId}:${folded}`)) {
          seen.add(`${line.invoiceId}:${folded}`);
          entry.bills += 1;
        }
        counts.set(folded, entry);
      }
    }
  }
  return [...counts.entries()]
    .map(([test, entry]) => ({ test, bills: entry.bills }))
    .sort((a, b) => b.bills - a.bills || a.test.localeCompare(b.test));
}

/** Convenience for the register list: how much each doctor earned overall. */
export function commissionByDoctor(
  invoices: readonly InvoiceRecord[],
  doctors: readonly DoctorRecord[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const statement of groupByDoctorName(doctors, d => d.name)) {
    totals.set(statement.key, 0);
  }
  for (const statement of buildDoctorStatements(invoices, [], {})) {
    totals.set(
      statement.doctorKey,
      roundMoney((totals.get(statement.doctorKey) ?? 0) + statement.totals.commission),
    );
  }
  return totals;
}
