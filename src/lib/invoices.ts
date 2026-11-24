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
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from '../data/fs';
import {
  isInvoiceOutstanding,
  readInvoice,
  readInvoices,
  readPatients,
  roundMoney,
  toInvoiceDoc,
  toInvoicePaymentDoc,
  type DoctorRecord,
  type InvoiceItem,
  type InvoiceRecord,
  type InvoiceReferral,
  type InvoiceTaxDetails,
  type OrderRecord,
  type PatientRecord,
  type PaymentMode,
  type Role,
  type ReportRecord,
  OrderSchema,
  AuditEventSchema,
  PaymentLedgerSchema,
} from './models';
import { getRepository } from '../data';
import { generateId } from '../data/query';
import { allocateInvoiceNoInTransaction } from './invoice-registry';
import { billLinesFrom, getBillingPrefs, getPriceList, type PriceList } from './price-list';
import { resolveReferral } from './referrals';
import { expandTestSelection } from './pathology-tests';
import { can } from './permissions';

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

function assertBillingRole(role?: Role): void {
  if (role && !can(role, 'manageBilling')) throw new Error('The signed-in operator role cannot manage billing.');
}

/** What a bill is raised for: a patient's order, optionally a specific report. */
export interface RaiseInvoiceInput {
  patient: Pick<PatientRecord, 'id' | 'name' | 'doctorName' | 'doctorId' | 'createdAt' | 'testSelection'>;
  /** Lines come from here when given, else from the patient's own order. */
  testSelection?: readonly string[];
  /** Frozen requisition to bill; its items and tariff win over live patient data. */
  order?: Pick<OrderRecord, 'id' | 'items' | 'doctorName' | 'doctorId'>;
  orderId?: string;
  reportId?: string;
  /** Rupees off the subtotal, or a percent — `discountPercent` wins if both. */
  discount?: number;
  discountPercent?: number;
  /** Override the lab's saved tax rate for this one bill. */
  taxPercent?: number;
  /** Jurisdictional identity and GST split; defaults to billing preferences. */
  taxDetails?: InvoiceTaxDetails;
  /** Money already taken at the counter. */
  paidAmount?: number;
  paymentMode?: PaymentMode;
  doctors?: readonly DoctorRecord[];
  /** `operatorStamp(user)`. */
  issuedBy: string;
  actorRole?: Role;
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
  taxDetails?: InvoiceTaxDetails;
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
  const taxDetails = input.taxDetails ?? prefs.taxDetails;
  const list = input.priceList ?? getPriceList();
  const names = input.testSelection ?? input.order?.items.map(item => item.name) ?? input.patient.testSelection ?? [];
  const lines = input.order
    ? input.order.items.map(item => ({
        name: item.name,
        kind: item.isGroup ? 'panel' as const : 'test' as const,
        detail: item.specimen ?? '',
        qty: item.qty,
        unitPrice: item.priceApproved ? item.unitPrice : 0,
        lineTotal: roundMoney(item.qty * (item.priceApproved ? item.unitPrice : 0)),
        unpriced: !item.priceApproved,
        ...(item.priceSource ? { priceSource: item.priceSource } : {}),
        covers: item.isGroup ? expandTestSelection([item.name]) : [item.name],
      }))
    : billLinesFrom(names, list);
  const items = taxDetails?.hsnSac
    ? rawItemsForTax(lines, taxDetails.hsnSac)
    : lines;

  const base = totalsOf(items, 0, input.taxPercent ?? prefs.taxPercent);
  // A percent discount *replaces* a rupee one rather than stacking on it — the
  // rule this field documents. Summing them lets a ₹ figure left in the form
  // behind a percentage edit deepen the discount the operator meant, on a
  // document the patient keeps.
  const requestedDiscount =
    input.discountPercent != null && input.discountPercent > 0
      ? roundMoney((base.subtotal * Math.min(100, Math.max(0, input.discountPercent))) / 100)
      : roundMoney(Math.max(0, input.discount ?? 0));
  const totals = totalsOf(items, requestedDiscount, input.taxPercent ?? prefs.taxPercent);

  const referral = resolveReferral(
    input.order?.doctorName ?? input.patient.doctorName,
    input.doctors ?? [],
    prefs,
    input.order?.doctorId ?? input.patient.doctorId,
  );
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
    ...(taxDetails ? { taxDetails } : {}),
    unpriced: items.filter(item => item.unpriced).map(item => item.name),
  };
}

/** The single arithmetic used by preview, write, and reprint alike. */
function rawItemsForTax(items: InvoiceItem[], hsnSac: string): InvoiceItem[] {
  return items.map(item => item.hsnSac ? item : { ...item, hsnSac });
}

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
  assertBillingRole(input.actorRole);
  const draft = buildInvoiceDraft(input);
  if (draft.items.length === 0) {
    throw new Error('This order has no billable tests — nothing to print.');
  }
  const at = input.at || new Date().toISOString();
  const referral = draft.referral
    ? {
        ...draft.referral,
        commission: commissionOn(draft.totals.taxableBase, draft.referral.percent),
      }
    : undefined;
  let created: InvoiceRecord | null = null;

  await getRepository().transaction(async tx => {
    if ((Number(input.paidAmount) || 0) > 0 && !input.paymentMode) {
      throw new Error('A payment mode is required when money is taken while raising the bill.');
    }
    const invoiceNo = await allocateInvoiceNoInTransaction(tx, new Date(at));
    const value = toInvoiceDoc({
      id: invoiceNo,
      invoiceNo,
      orderId: input.order?.id ?? input.orderId,
      reportId: input.reportId ?? '',
      patientId: input.patient.id,
      patientName: input.patient.name,
      items: draft.items,
      discount: draft.totals.discount,
      taxPercent: draft.totals.taxPercent,
      taxDetails: draft.taxDetails,
      paidAmount: input.paidAmount,
      paymentMode: input.paymentMode,
      ...(referral ? { referral } : {}),
      doctorName: input.order?.doctorName ?? input.patient.doctorName ?? '',
      issuedBy: input.issuedBy,
      notes: input.notes,
      createdAt: at,
    });
    const paidAmount = Number(value.paidAmount) || 0;

    await tx.set('invoices', invoiceNo, value);
    await tx.add('auditEvents', AuditEventSchema.parse({
      action: 'invoice.raised',
      entity: 'invoices',
      entityId: invoiceNo,
      actor: input.issuedBy,
      at,
      details: { orderId: input.order?.id ?? input.orderId, amount: draft.totals.amount },
    }));
    if (paidAmount > 0) {
      const paymentId = generateId();
      const payment = PaymentLedgerSchema.parse({
        id: paymentId,
        invoiceId: invoiceNo,
        type: 'payment',
        amount: paidAmount,
        mode: input.paymentMode!,
        actor: input.issuedBy,
        at,
        note: 'Collected while raising the invoice',
      });
      await tx.set('payments', paymentId, payment);
      await tx.add('auditEvents', AuditEventSchema.parse({
        action: 'payment.received',
        entity: 'payments',
        entityId: paymentId,
        actor: input.issuedBy,
        at,
        details: { invoiceId: invoiceNo, amount: paidAmount, mode: payment.mode },
      }));
    }
    created = readInvoice(invoiceNo, value);
  });
  if (!created) throw new Error('The invoice could not be created.');
  return created;
}

/**
 * Raise the bill for a report the lab has just issued.
 *
 * Uses the *report's* test list rather than the patient's current one: an issued
 * report is the document that says what was actually done, and a patient edited
 * afterwards must not silently change what a handed-over report was charged for.
 */
export async function raiseInvoiceForReport(
  report: Pick<ReportRecord, 'id' | 'patientId' | 'patientName' | 'testSelection' | 'createdAt' | 'orderId'>,
  patient: PatientRecord | undefined,
  options: Omit<RaiseInvoiceInput, 'patient' | 'testSelection' | 'reportId'>,
): Promise<InvoiceRecord> {
  const orderDoc = report.orderId ? await getRepository().get('orders', report.orderId) : null;
  const order = orderDoc
    ? { ...(OrderSchema.parse({ id: orderDoc.id, ...orderDoc.data() })), id: orderDoc.id }
    : undefined;
  return raiseInvoice({
    ...options,
    order,
    patient: patient ?? {
      id: report.patientId,
      name: report.patientName,
      doctorName: undefined,
      doctorId: undefined,
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
  options: { amount: number; mode: PaymentMode; actor: string; actorRole?: Role; at?: string; note?: string },
): Promise<InvoiceRecord> {
  assertBillingRole(options.actorRole);
  if (!Number.isFinite(options.amount) || options.amount < 0) {
    throw new Error('Payment amount must be a finite, non-negative number.');
  }
  if (!options.actor.trim()) throw new Error('A payment requires an operator identity.');
  const repo = getRepository();
  let updated: InvoiceRecord | null = null;

  await repo.transaction(async tx => {
    const invoiceDoc = await tx.get('invoices', invoiceId);
    if (!invoiceDoc) throw new Error('That bill could not be found — no payment was recorded.');
    const existing = readInvoice(invoiceId, invoiceDoc.data());
    if (existing.status === 'void') {
      throw new Error('A voided bill cannot take a payment. Raise a new bill instead.');
    }
    const outstanding = balanceOf(existing);
    if (outstanding <= 0) throw new Error('That bill is already settled.');

    const requested = roundMoney(options.amount);
    if (requested > outstanding) {
      throw new Error('Payment exceeds the outstanding balance. Record the exact amount or use an explicit adjustment.');
    }
    // Zero on an outstanding bill is the explicit full-waiver action.
    const applied = requested === 0 ? outstanding : requested;
    const at = options.at || new Date().toISOString();
    const patch = toInvoicePaymentDoc(
      existing,
      roundMoney((existing.paidAmount ?? 0) + applied),
      at,
      options.mode,
    );
    const { id: _id, ...invoiceValue } = existing;
    await tx.set('invoices', invoiceId, { ...invoiceValue, ...patch });

    const paymentId = generateId();
    const payment = PaymentLedgerSchema.parse({
      id: paymentId,
      invoiceId,
      type: 'payment',
      amount: applied,
      mode: options.mode,
      actor: options.actor.trim(),
      at,
      note: requested === 0 ? 'Full waiver' : options.note?.trim(),
    });
    await tx.set('payments', paymentId, payment);
    await tx.add('auditEvents', AuditEventSchema.parse({
      action: 'payment.received',
      entity: 'payments',
      entityId: paymentId,
      actor: options.actor.trim(),
      at,
      details: { invoiceId, amount: applied, mode: options.mode, waiver: requested === 0 },
    }));
    updated = readInvoice(invoiceId, { ...invoiceValue, ...patch });
  });

  if (!updated) throw new Error('The payment could not be recorded.');
  return updated;
}

/** Refund collected money without rewriting the original payment history. */
export async function refundPayment(
  invoiceId: string,
  options: { amount: number; mode: PaymentMode; actor: string; actorRole?: Role; reason: string; reference?: string; at?: string },
): Promise<InvoiceRecord> {
  assertBillingRole(options.actorRole);
  const amount = roundMoney(options.amount);
  if (!Number.isFinite(options.amount) || amount <= 0) throw new Error('Refund amount must be positive.');
  if (!options.actor.trim()) throw new Error('A refund requires an operator identity.');
  if (!options.reason.trim()) throw new Error('A refund requires a reason.');
  const repo = getRepository();
  let updated: InvoiceRecord | null = null;
  await repo.transaction(async tx => {
    const invoiceDoc = await tx.get('invoices', invoiceId);
    if (!invoiceDoc) throw new Error('That bill could not be found — no refund was recorded.');
    const existing = readInvoice(invoiceId, invoiceDoc.data());
    if (existing.status === 'void') throw new Error('A voided bill cannot be refunded.');
    if (amount > (existing.paidAmount ?? 0)) throw new Error('Refund exceeds the amount collected on this bill.');
    const at = options.at || new Date().toISOString();
    const paidAmount = roundMoney((existing.paidAmount ?? 0) - amount);
    const patch = toInvoicePaymentDoc(existing, paidAmount, at, options.mode);
    const { id: _id, ...invoiceValue } = existing;
    await tx.set('invoices', invoiceId, { ...invoiceValue, ...patch });
    const refundId = generateId();
    await tx.set('payments', refundId, PaymentLedgerSchema.parse({
      id: refundId,
      invoiceId,
      type: 'refund',
      amount,
      mode: options.mode,
      actor: options.actor.trim(),
      at,
      reference: options.reference?.trim(),
      note: options.reason.trim(),
    }));
    await tx.add('auditEvents', AuditEventSchema.parse({
      action: 'payment.refunded',
      entity: 'payments',
      entityId: refundId,
      actor: options.actor.trim(),
      at,
      details: { invoiceId, amount, mode: options.mode, reason: options.reason.trim() },
    }));
    updated = readInvoice(invoiceId, { ...invoiceValue, ...patch });
  });
  if (!updated) throw new Error('The refund could not be recorded.');
  return updated;
}

/** Reverse a payment or refund by appending a compensating ledger entry. */
export async function reverseLedgerEntry(
  entryId: string,
  actor: string,
  reason: string,
): Promise<InvoiceRecord> {
  if (!actor.trim()) throw new Error('A reversal requires an operator identity.');
  if (!reason.trim()) throw new Error('A reversal requires a reason.');
  const repo = getRepository();
  let updated: InvoiceRecord | null = null;
  await repo.transaction(async tx => {
    const entryDoc = await tx.get('payments', entryId);
    if (!entryDoc) throw new Error('That ledger entry could not be found.');
    const entry = PaymentLedgerSchema.parse({ id: entryId, ...entryDoc.data() });
    if (entry.type === 'reversal') throw new Error('A reversal cannot itself be reversed.');
    const alreadyReversed = await tx.list('payments', {
      where: [{ field: 'reversesEntryId', op: '==', value: entryId }],
    });
    if (alreadyReversed.length > 0) throw new Error('That ledger entry has already been reversed.');
    const invoiceDoc = await tx.get('invoices', entry.invoiceId);
    if (!invoiceDoc) throw new Error('The invoice for that ledger entry no longer exists.');
    const existing = readInvoice(entry.invoiceId, invoiceDoc.data());
    if (existing.status === 'void') throw new Error('A voided bill cannot be adjusted.');
    const at = new Date().toISOString();
    const delta = entry.type === 'payment' ? -entry.amount : entry.amount;
    const paidAmount = roundMoney(Math.max(0, Math.min(existing.amount, (existing.paidAmount ?? 0) + delta)));
    const patch = toInvoicePaymentDoc(existing, paidAmount, at, entry.mode);
    const { id: _id, ...invoiceValue } = existing;
    await tx.set('invoices', entry.invoiceId, { ...invoiceValue, ...patch });
    const reversalId = generateId();
    await tx.set('payments', reversalId, PaymentLedgerSchema.parse({
      id: reversalId,
      invoiceId: entry.invoiceId,
      type: 'reversal',
      amount: entry.amount,
      mode: entry.mode,
      actor: actor.trim(),
      at,
      reference: entryId,
      reversesEntryId: entryId,
      reversesType: entry.type,
      note: reason.trim(),
    }));
    await tx.add('auditEvents', AuditEventSchema.parse({
      action: 'payment.reversed',
      entity: 'payments',
      entityId: reversalId,
      actor: actor.trim(),
      at,
      details: { invoiceId: entry.invoiceId, reversedEntryId: entryId, amount: entry.amount, reason: reason.trim() },
    }));
    updated = readInvoice(entry.invoiceId, { ...invoiceValue, ...patch });
  });
  if (!updated) throw new Error('The ledger entry could not be reversed.');
  return updated;
}

export interface InvoiceReconciliation {
  invoiceId: string;
  invoicePaid: number;
  ledgerNet: number;
  difference: number;
  entries: number;
}

/** Compare the invoice snapshot with its append-only payment ledger. */
export async function reconcileInvoice(invoiceId: string): Promise<InvoiceReconciliation> {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw new Error('That bill could not be found.');
  const repo = getRepository();
  const docs = await repo.list('payments', { where: [{ field: 'invoiceId', op: '==', value: invoiceId }] });
  let ledgerNet = 0;
  for (const doc of docs) {
    const entry = PaymentLedgerSchema.parse({ id: doc.id, ...doc.data() });
    if (entry.type === 'payment') ledgerNet += entry.amount;
    else if (entry.type === 'refund') ledgerNet -= entry.amount;
    else if (entry.reversesType === 'payment') ledgerNet -= entry.amount;
    else if (entry.reversesType === 'refund') ledgerNet += entry.amount;
  }
  ledgerNet = roundMoney(ledgerNet);
  const invoicePaid = roundMoney(invoice.paidAmount ?? 0);
  return { invoiceId, invoicePaid, ledgerNet, difference: roundMoney(invoicePaid - ledgerNet), entries: docs.length };
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
  actorRole?: Role,
): Promise<InvoiceRecord> {
  assertBillingRole(actorRole);
  const trimmed = reason.trim();
  if (!trimmed) throw new Error('A voided bill needs a reason — otherwise it looks like a gap.');
  // The transaction reads before writing so a stale id cannot mint a void stub.
  if (!actor.trim()) throw new Error('Voiding a bill requires an operator identity.');
  const repo = getRepository();
  let updated: InvoiceRecord | null = null;
  await repo.transaction(async tx => {
    const invoiceDoc = await tx.get('invoices', invoiceId);
    if (!invoiceDoc) throw new Error('That bill could not be found — nothing was voided.');
    const before = readInvoice(invoiceId, invoiceDoc.data());
    if (before.status === 'void') throw new Error('That bill is already void.');
    if ((before.paidAmount ?? 0) > 0) throw new Error('Refund all collected money before voiding this bill.');
    const at = new Date().toISOString();
    const value = { ...invoiceDoc.data(), status: 'void', voidReason: trimmed.slice(0, 500), updatedBy: actor.trim(), updatedAt: at };
    await tx.set('invoices', invoiceId, value);
    await tx.add('auditEvents', AuditEventSchema.parse({
      action: 'invoice.voided',
      entity: 'invoices',
      entityId: invoiceId,
      actor: actor.trim(),
      at,
      details: { reason: trimmed },
    }));
    updated = readInvoice(invoiceId, value);
  });
  if (!updated) throw new Error('The bill could not be voided.');
  return updated;
}

/** Remove only a never-paid pending bill with no ledger history. */
export async function deleteInvoice(invoiceId: string, actor: string, actorRole?: Role): Promise<void> {
  assertBillingRole(actorRole);
  if (!actor.trim()) throw new Error('Deleting a bill requires an operator identity.');
  const repo = getRepository();
  await repo.transaction(async tx => {
    const invoiceDoc = await tx.get('invoices', invoiceId);
    if (!invoiceDoc) throw new Error('That bill could not be found.');
    const invoice = readInvoice(invoiceId, invoiceDoc.data());
    const ledger = await tx.list('payments', { where: [{ field: 'invoiceId', op: '==', value: invoiceId }] });
    if (invoice.status !== 'pending' || (invoice.paidAmount ?? 0) > 0 || ledger.length > 0) {
      throw new Error('Only a never-paid pending bill with no ledger history can be deleted. Void it instead.');
    }
    await tx.delete('invoices', invoiceId);
    await tx.add('auditEvents', AuditEventSchema.parse({
      action: 'invoice.deleted',
      entity: 'invoices',
      entityId: invoiceId,
      actor: actor.trim(),
      at: new Date().toISOString(),
      details: { invoiceNo: invoice.invoiceNo },
    }));
  });
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

/** What one patient still owes across their own bills (void excluded). */
export function outstandingForPatient(
  invoices: readonly Pick<InvoiceRecord, 'amount' | 'paidAmount' | 'status'>[],
): number {
  return roundMoney(
    invoices
      .filter(invoice => invoice.status !== 'void')
      .reduce((sum, invoice) => sum + balanceOf(invoice), 0),
  );
}

// ---------------------------------------------------------------------------
// Bulk: raise the bills that were never raised
// ---------------------------------------------------------------------------

/** A patient the bulk run will not bill, with the reason shown to the operator. */
export interface SkippedPatient {
  patientId: string;
  name: string;
  reason: string;
}

export interface MissingBillPlan {
  /** Registered patients with an order and no bill of their own yet. */
  billable: PatientRecord[];
  skipped: SkippedPatient[];
}

/**
 * Decide a bulk run without writing anything.
 *
 * The whole collection is read here rather than taken from the on-screen register:
 * the Bills list pages at 40 rows, and a patient whose only bill sits past that
 * window must not be billed a second time because the visible slice missed it.
 * A void bill does not count as "already billed" — the lab withdrew it, so the
 * patient legitimately needs a fresh one.
 */
export async function planMissingBills(): Promise<MissingBillPlan> {
  const [patientDocs, invoiceDocs] = await Promise.all([
    getDocs(collection(db, 'patients')),
    getDocs(collection(db, 'invoices')),
  ]);
  const billed = new Set(
    readInvoices(invoiceDocs.docs)
      .filter(invoice => invoice.status !== 'void')
      .map(invoice => invoice.patientId)
      .filter(Boolean),
  );

  const billable: PatientRecord[] = [];
  const skipped: SkippedPatient[] = [];
  for (const patient of readPatients(patientDocs.docs)) {
    if (billed.has(patient.id)) {
      skipped.push({ patientId: patient.id, name: patient.name, reason: 'already has a bill' });
      continue;
    }
    if ((patient.testSelection ?? []).length === 0) {
      skipped.push({ patientId: patient.id, name: patient.name, reason: 'no tests in the order' });
      continue;
    }
    billable.push(patient);
  }
  // Oldest registration first, so the bill numbers follow the order the lab took
  // the samples rather than whatever the store happened to yield.
  billable.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return { billable, skipped };
}

export interface MissingBillsResult {
  /** Patients the run attempted to bill. */
  attempted: number;
  raised: InvoiceRecord[];
  skipped: SkippedPatient[];
  /** Value of the bills this run raised. */
  billed: number;
  /** Commission stamped on them, from each doctor's rate at bill time. */
  commission: number;
}

/**
 * Raise a bill for every patient {@link planMissingBills} finds, in one pass.
 *
 * This is the counter's "bill everyone I have not got round to yet", not a
 * background job — the screen calls it from a button that has already shown the
 * operator how many bills will appear. Each bill is the ordinary
 * {@link raiseInvoice}: frozen line prices, the lab tax rate, and the referral
 * commission stamped from the referring doctor's percentage on the taxable base,
 * so a bulk run and a hand-raised bill cannot disagree about what a doctor is owed.
 *
 * A patient with no tests on the order is skipped by the plan, and a raise that
 * fails for any other reason is reported in `skipped` with the reason rather than
 * aborting the run. An order whose tests have no price still becomes a bill — with
 * `unpriced` lines, exactly as a hand-raised bill would — because the register
 * already surfaces that as "printed a test with no price"; silently dropping the
 * patient here would hide it twice.
 */
export async function generateMissingBills(input: {
  doctors?: readonly DoctorRecord[];
  issuedBy: string;
  actorRole?: Role;
  priceList?: PriceList;
}): Promise<MissingBillsResult> {
  assertBillingRole(input.actorRole);
  const plan = await planMissingBills();
  const raised: InvoiceRecord[] = [];
  const skipped = [...plan.skipped];

  // Sequential on purpose: bill numbers come from one monthly sequence, so
  // concurrent raises would race `allocateInvoiceNo` onto the same number.
  for (const patient of plan.billable) {
    try {
      raised.push(
        await raiseInvoice({
          patient,
          doctors: input.doctors,
          issuedBy: input.issuedBy,
          ...(input.actorRole ? { actorRole: input.actorRole } : {}),
          ...(input.priceList ? { priceList: input.priceList } : {}),
        }),
      );
    } catch (err) {
      skipped.push({
        patientId: patient.id,
        name: patient.name,
        reason: err instanceof Error ? err.message : 'the bill could not be raised',
      });
    }
  }

  const summary = summarise(raised);
  return {
    attempted: plan.billable.length,
    raised,
    skipped,
    billed: summary.billed,
    commission: summary.commission,
  };
}
