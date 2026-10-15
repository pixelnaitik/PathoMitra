/**
 * The billing service — every write to `invoices/` goes through here.
 *
 * `invoices` was already a first-class collection (its SQLCipher table, its IPC
 * allowlist entry, its backup coverage, its delete cascades and its unpaid-alert
 * consumer all shipped before this file), but nothing in the app ever created a
 * document in it. This is that missing half, and the reason the feature was
 * mostly wired rather than mostly built.
 *
 * Two invariants this layer owns, because no screen can be trusted with them:
 *
 *  1. **A bill is a frozen document.** Its `items[]` carry the price *as charged*,
 *     so reprinting a March bill in June shows March. Nothing here ever re-reads
 *     the live price list for a stored invoice.
 *  2. **The document id is the bill number.** `invoices/IN2610-0042` rather than a
 *     random id, so the uniqueness probe in `invoice-registry.ts` is enforced by
 *     the primary key instead of by hope — and quoting a number reaches the record
 *     in one read.
 *
 * Money is never taken from a form field: totals are recomputed from the lines by
 * `toInvoiceDoc` (lib/models.ts), so an alert title, a printed grand total, and a
 * day-book sum are three views of one arithmetic.
 */
import {
  collection,
  db,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from '../data/fs';
import {
  isInvoiceOutstanding,
  readInvoice,
  roundMoney,
  toInvoiceDoc,
  toInvoicePaymentDoc,
  type DoctorRecord,
  type InvoiceItem,
  type InvoiceRecord,
  type InvoiceReferral,
  type PatientRecord,
  type PaymentMode,
  type ReportRecord,
} from './models';
import { allocateInvoiceNo } from './invoice-registry';
import { billLinesFrom, getBillingPrefs, getPriceList, type PriceList } from './price-list';
import { resolveReferral } from './referrals';

/**
 * Commission on a base at a rate, rounded to paise.
 *
 * One expression used by the bill stamp and by the statement builder, so the
 * figure written on a bill and the figure paid at month end are the same
 * arithmetic rather than two places that happen to agree today.
 */
function commissionOn(base: number, percent: number): number {
  if (!(percent > 0) || !(base > 0)) return 0;
  return roundMoney((base * Math.min(100, percent)) / 100);
}

/** What a bill is raised for: a patient's order, optionally a specific report. */
export interface RaiseInvoiceInput {
  patient: Pick<PatientRecord, 'id' | 'name' | 'doctorName' | 'createdAt' | 'testSelection'>;
  /** Lines come from here when given, else from the patient's own order. */
  testSelection?: readonly string[];
  reportId?: string;
  /** Rupees off the subtotal, or a percent — `discountPercent` wins if both. */
  discount?: number;
  discountPercent?: number;
  /** Override the lab's saved tax rate for this one bill. */
  taxPercent?: number;
  /** Money already taken at the counter. */
  paidAmount?: number;
  paymentMode?: PaymentMode;
  doctors?: readonly DoctorRecord[];
  /** `operatorStamp(user)`. */
  issuedBy: string;
  notes?: string;
  /** Prices to bill against — defaults to the saved list. */
  priceList?: PriceList;
  at?: string;
}

/** A bill computed but not written — what a preview screen shows. */
export interface InvoiceDraft {
  invoiceNo: string;
  items: InvoiceItem[];
  totals: {
    subtotal: number;
    discount: number;
    tax: number;
    taxPercent: number;
    taxableBase: number;
    amount: number;
  };
  referral?: InvoiceReferral;
  unpriced: string[];
}

/**
 * Compute a bill from an order without writing it.
 *
 * `invoiceNo` is a placeholder here (`—`), because allocating a real number burns
 * a sequence slot; preview must not consume one. The number is allocated in
 * {@link raiseInvoice} at the moment the document is created.
 */
export function buildInvoiceDraft(input: RaiseInvoiceInput): InvoiceDraft {
  const prefs = getBillingPrefs();
  const list = input.priceList ?? getPriceList();
  const names = input.testSelection ?? input.patient.testSelection ?? [];
  const items = billLinesFrom(names, list);

  const base = totalsOf(items, 0, input.taxPercent ?? prefs.taxPercent);
  const percentDiscount =
    input.discountPercent != null && input.discountPercent > 0
      ? roundMoney((base.subtotal * Math.min(100, Math.max(0, input.discountPercent))) / 100)
      : 0;
  const discount = roundMoney(Math.min(base.subtotal, (input.discount ?? 0) + percentDiscount));
  const totals = totalsOf(items, discount, input.taxPercent ?? prefs.taxPercent);

  const referral = resolveReferral(input.patient.doctorName, input.doctors ?? [], prefs);
  // The commission figure is stamped at bill time from the base this bill
  // actually has — after the doc is built, `referral.commission` is the number a
  // statement may pay out, and nothing recomputes it afterwards.
  const stamp: InvoiceReferral | undefined = referral
    ? { ...referral, commission: commissionOn(totals.taxableBase, referral.percent) }
    : undefined;

  return {
    invoiceNo: '',
    items,
    totals,
    ...(stamp ? { referral: stamp } : {}),
    unpriced: items.filter(item => item.unpriced).map(item => item.name),
  };
}

/** The single arithmetic used by preview, write, and reprint alike. */
function totalsOf(items: readonly InvoiceItem[], discount: number, taxPercent: number) {
  const charges = items.filter(item => item.lineTotal > 0);
  const subtotal = roundMoney(charges.reduce((sum, item) => sum + item.lineTotal, 0));
  const applied = roundMoney(Math.min(subtotal, Math.max(0, discount)));
  const taxableBase = roundMoney(subtotal - applied);
  const pct = Math.min(100, Math.max(0, taxPercent));
  const tax = roundMoney((taxableBase * pct) / 100);
  return {
    subtotal,
    discount: applied,
    tax,
    taxPercent: pct,
    taxableBase,
    amount: roundMoney(taxableBase + tax),
  };
}

/**
 * Write the bill.
 *
 * @returns the stored invoice, id = bill number.
 * @throws when the order has no billable lines — an empty bill printed to a
 *   patient's name is not a document, and silently creating one gives the lab a
 *   record that owes ₹0 and alerts nobody.
 */
export async function raiseInvoice(input: RaiseInvoiceInput): Promise<InvoiceRecord> {
  const draft = buildInvoiceDraft(input);
  if (draft.items.length === 0) {
    throw new Error('This order has no billable tests — nothing to print.');
  }
  const invoiceNo = await allocateInvoiceNo();
  const at = input.at || new Date().toISOString();
  const referral = draft.referral
    ? {
        ...draft.referral,
        commission: commissionOn(draft.totals.taxableBase, draft.referral.percent),
      }
    : undefined;

  const value = toInvoiceDoc({
    id: invoiceNo,
    invoiceNo,
    reportId: input.reportId ?? '',
    patientId: input.patient.id,
    patientName: input.patient.name,
    items: draft.items,
    discount: draft.totals.discount,
    taxPercent: draft.totals.taxPercent,
    paidAmount: input.paidAmount,
    paymentMode: input.paymentMode,
    ...(referral ? { referral } : {}),
    doctorName: input.patient.doctorName ?? '',
    issuedBy: input.issuedBy,
    notes: input.notes,
    createdAt: at,
  });

  await setDoc(doc(db, 'invoices', invoiceNo), value);
  return readInvoice(invoiceNo, value);
}

/**
 * Raise the bill for a report the lab has just issued.
 *
 * Uses the *report's* test list rather than the patient's current one: an issued
 * report is the document that says what was actually done, and a patient edited
 * afterwards must not silently change what a handed-over report was charged for.
 */
export async function raiseInvoiceForReport(
  report: Pick<ReportRecord, 'id' | 'patientId' | 'patientName' | 'testSelection' | 'createdAt'>,
  patient: PatientRecord | undefined,
  options: Omit<RaiseInvoiceInput, 'patient' | 'testSelection' | 'reportId'>,
): Promise<InvoiceRecord> {
  return raiseInvoice({
    ...options,
    patient: patient ?? {
      id: report.patientId,
      name: report.patientName,
      doctorName: undefined,
      createdAt: report.createdAt,
      testSelection: report.testSelection ?? [],
    },
    testSelection: report.testSelection ?? patient?.testSelection ?? [],
    reportId: report.id,
  });
}

/** A bill already raised for this report, if any. */
export async function invoiceForReport(reportId: string): Promise<InvoiceRecord | null> {
  if (!reportId) return null;
  const snap = await getDocs(query(collection(db, 'invoices'), where('reportId', '==', reportId)));
  const first = snap.docs[0];
  return first ? readInvoice(first.id, first.data()) : null;
}

/** Every bill for one patient, newest first. */
export async function invoicesForPatient(patientId: string): Promise<InvoiceRecord[]> {
  if (!patientId) return [];
  const snap = await getDocs(
    query(collection(db, 'invoices'), where('patientId', '==', patientId)),
  );
  return snap.docs
    .map(d => readInvoice(d.id, d.data()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getInvoice(id: string): Promise<InvoiceRecord | null> {
  if (!id) return null;
  const snap = await getDoc(doc(db, 'invoices', id));
  return snap.exists() ? readInvoice(snap.id, snap.data()) : null;
}

/**
 * Record money coming in.
 *
 * `amount === 0` on an outstanding bill is a full waiver and is recorded as
 * settled rather than left pending, because the alternative is a lab that closes
 * its day book every evening and cannot. The bill's own total is never rewritten
 * — the waiver is the payment, and the paper keeps saying what was charged.
 */
export async function recordPayment(
  invoiceId: string,
  options: { amount: number; mode: PaymentMode; at?: string },
): Promise<InvoiceRecord> {
  const existing = await getInvoice(invoiceId);
  if (!existing) throw new Error('That bill could not be found — no payment was recorded.');
  if (existing.status === 'void') {
    throw new Error('A voided bill cannot take a payment. Raise a new bill instead.');
  }

  const requested = roundMoney(Math.max(0, options.amount));
  // Partial payment of an already-partial bill accumulates; overpayment clamps to
  // the bill, because "the patient gave ₹1,300 for a ₹1,200 bill" is a cash-drawer
  // question, not a billing record to distort.
  const applied = roundMoney(Math.min(requested, existing.amount));
  const patch = toInvoicePaymentDoc(
    existing,
    roundMoney((existing.paidAmount ?? 0) + applied),
    options.at || new Date().toISOString(),
    options.mode,
  );

  await updateDoc(doc(db, 'invoices', invoiceId), patch);
  const updated = await getInvoice(invoiceId);
  if (!updated) throw new Error('The payment was written but the bill could not be re-read.');
  return updated;
}

/**
 * Cancel a bill, keeping it.
 *
 * Deletion is not cancellation: a bill that was printed and then withdrawn still
 * happened, and the day book needs the entry or the totals will not reconcile
 * against the paper the patient walked out with. `void` keeps the audit trail and
 * drops it from every money total.
 */
export async function voidInvoice(
  invoiceId: string,
  reason: string,
  actor: string,
): Promise<InvoiceRecord> {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error('A voided bill needs a reason — otherwise it looks like a gap.');
  await updateDoc(doc(db, 'invoices', invoiceId), {
    status: 'void',
    voidReason: trimmed.slice(0, 500),
    updatedBy: actor.slice(0, 128),
    updatedAt: new Date().toISOString(),
  });
  const updated = await getInvoice(invoiceId);
  if (!updated) throw new Error('The bill could not be re-read after voiding.');
  return updated;
}

/** Remove a bill that was created in error and never printed. */
export async function deleteInvoice(invoiceId: string): Promise<void> {
  await deleteDoc(doc(db, 'invoices', invoiceId));
}

// ---------------------------------------------------------------------------
// Aggregations the money screens read
// ---------------------------------------------------------------------------

export interface MoneySummary {
  bills: number;
  /** Raised value, including unpaid bills. */
  billed: number;
  collected: number;
  outstanding: number;
  discount: number;
  tax: number;
  /** Commission owed across these bills. */
  commission: number;
  unpaidBills: number;
  /** Bills with at least one line the lab never priced. */
  unpricedBills: number;
}

export function summarise(invoices: readonly InvoiceRecord[]): MoneySummary {
  let billed = 0;
  let collected = 0;
  let discount = 0;
  let tax = 0;
  let commission = 0;
  let unpaidBills = 0;
  let unpricedBills = 0;

  for (const invoice of invoices) {
    if (invoice.status === 'void') continue;
    billed += invoice.amount;
    collected += Math.max(0, invoice.paidAmount ?? 0);
    discount += Math.max(0, invoice.discount ?? 0);
    tax += Math.max(0, invoice.tax ?? 0);
    commission += Math.max(0, invoice.referral?.commission ?? 0);
    if (isInvoiceOutstanding(invoice.status)) unpaidBills += 1;
    if (invoice.items.some(item => item.unpriced)) unpricedBills += 1;
  }

  return {
    bills: invoices.filter(i => i.status !== 'void').length,
    billed: roundMoney(billed),
    collected: roundMoney(collected),
    outstanding: roundMoney(billed - collected),
    discount: roundMoney(discount),
    tax: roundMoney(tax),
    commission: roundMoney(commission),
    unpaidBills,
    unpricedBills,
  };
}

/** Bills whose lines are missing prices — the "finish your tariff" list. */
export function billsWithUnpricedLines(invoices: readonly InvoiceRecord[]): InvoiceRecord[] {
  return invoices.filter(invoice => invoice.items.some(item => item.unpriced));
}

/** Balance still owed on a bill, never negative. */
export function balanceOf(
  invoice: Pick<InvoiceRecord, 'amount' | 'paidAmount' | 'status'>,
): number {
  if (invoice.status === 'void') return 0;
  return roundMoney(Math.max(0, invoice.amount - Math.max(0, invoice.paidAmount ?? 0)));
}
