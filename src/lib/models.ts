/**
 * Domain models for the Firestore documents the UI reads and writes.
 *
 * Before this layer every collection was consumed as `any[]`, so a renamed or
 * mistyped field surfaced as `undefined` somewhere deep in a table render (or,
 * for a report, silently changed the signed payload). Each entity now has:
 *
 *   - a schema, mirroring the guarantees already made in `firestore.rules`;
 *   - a `read*()` parser used at the Firestore boundary — it never throws, logs
 *     through `captureError`, and degrades to a displayable stub so one bad
 *     document cannot blank a whole list;
 *   - a `to*()` builder used on writes, so the document shape is defined once.
 *
 * The schemas are deliberately *loose* about unknown keys: legacy documents
 * carry fields that newer code no longer writes, and rejecting those would lose
 * real patient records. Known fields are still validated.
 */
import { z } from 'zod';
import { captureError } from './telemetry';

/** ISO-8601 written by the client today; see also `serverTimestamp` migration. */
const timestampString = z.string().max(64);

export const RoleSchema = z.enum(['guest', 'staff', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const GenderSchema = z.enum(['male', 'female', 'other']);
export type Gender = z.infer<typeof GenderSchema>;

/**
 * `draft` = still being composed and unsigned. `final` = signed and issued, so
 * its result table is immutable without an amendment entry. Neither is visible
 * to a patient: the app has no public read surface — a report leaves the device
 * only as a PDF a member of staff hands over.
 */
export const ReportStatusSchema = z.enum(['draft', 'final']);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

/**
 * `pending` = nothing collected yet. `partial` = money came in but the bill is
 * not discharged. `paid` = settled. `void` = cancelled, kept for the audit trail
 * rather than deleted (a printed bill that is thrown away silently is a gap in
 * the day book nobody can explain later).
 *
 * Anything that is not `paid` or `void` still counts as outstanding to the alert
 * engine — use {@link isInvoiceOutstanding} rather than comparing to `'pending'`,
 * which is how `partial` bills would otherwise stop alerting while still owing.
 */
export const InvoiceStatusSchema = z.enum(['pending', 'partial', 'paid', 'void']);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

/** Still owed money? `void` bills are closed, not owed. */
export function isInvoiceOutstanding(status: InvoiceStatus): boolean {
  return status === 'pending' || status === 'partial';
}

/** Settled enough to stop alerting and to count as collection. */
export function isInvoiceSettled(status: InvoiceStatus): boolean {
  return status === 'paid';
}

export const PaymentModeSchema = z.enum(['cash', 'upi', 'card', 'bank', 'credit', 'advance']);
export type PaymentMode = z.infer<typeof PaymentModeSchema>;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const UserSchema = z.looseObject({
  name: z.string().max(100).default(''),
  email: z.string().max(100).default(''),
  role: RoleSchema.default('guest'),
  createdAt: timestampString.default(''),
  avatarSeed: z.string().max(500).optional(),
});
export type UserProfile = z.infer<typeof UserSchema> & { id: string };

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

/**
 * `age` stays a union: historical documents store it as a string while newer
 * writes store a number. Use {@link ageAsNumber} instead of branching inline.
 */
export const PatientSchema = z.looseObject({
  name: z.string().max(100).default(''),
  age: z.union([z.number().int().min(0).max(150), z.string().max(4)]).default('0'),
  gender: z.string().max(10).default('other'),
  phone: z.string().max(20).optional(),
  doctorName: z.string().max(100).optional(),
  address: z.string().max(500).optional(),
  testSelection: z.array(z.string().max(128)).max(200).optional(),
  /**
   * Money the counter says this patient still owes, typed in by an operator.
   *
   * It is a ledger note on the person, not a bill: raising, discounting or paying
   * an invoice never touches it (see {@link toPatientDueDoc} for how it is entered
   * and why a phone number is demanded first). The Patients list shows it as a chip
   * and filters on it, because "who owes us" is a question asked at the counter
   * while the patient is standing there, not in the Bills register.
   */
  dueAmount: z.coerce.number().min(0).max(10_000_000).optional(),
  dueNote: z.string().max(200).optional(),
  dueUpdatedAt: timestampString.optional(),
  dueRecordedBy: z.string().max(128).optional(),
  createdAt: timestampString.default(''),
});
export type PatientRecord = z.infer<typeof PatientSchema> & { id: string };

/** What is owed on this patient's name, never negative. `0` = nothing recorded. */
export function dueOf(patient: Pick<PatientRecord, 'dueAmount'>): number {
  return roundMoney(Math.max(0, Number(patient.dueAmount ?? 0) || 0));
}

/** Numeric age, or `undefined` when the stored value is not a sane number. */
export function ageAsNumber(patient: Pick<PatientRecord, 'age'>): number | undefined {
  const n = typeof patient.age === 'number' ? patient.age : parseInt(patient.age, 10);
  return Number.isFinite(n) && n >= 0 && n <= 150 ? n : undefined;
}

/**
 * Who to attribute a write to.
 *
 * The local account's `uid` is the fixed string `local-admin` (AuthContext), so
 * storing it alone records nothing a human can read on an audit line — the
 * display name is the readable operator, and `uid` is the fallback for a session
 * that somehow has no name. Never write the raw `uid` at a call site again.
 */
export function operatorStamp(
  user?: { uid?: string | null; displayName?: string | null } | null,
): string {
  const name = (user?.displayName ?? '').trim();
  return name || user?.uid || 'unknown';
}

/**
 * Write builder for `patients/{id}` — the counterpart of `toReportDoc`.
 *
 * Patient writes used to persist the form object verbatim, so the shape of a
 * clinical record was decided by whichever screen saved last, and a stray form
 * field or a `NaN` age went straight into the encrypted store. Everything the
 * UI saves crosses `PatientSchema` here first, and the schema guarantees the
 * bounds the rest of the app already assumes (`age` 0-150, whole years).
 */
export interface PatientDraftInput {
  name: string;
  /** Raw form value — numeric string, number, or empty.
   */
  age: string | number;
  gender: string;
  phone?: string;
  doctorName?: string;
  address?: string;
  testSelection?: string[];
  createdAt?: string;
}

/** Input for {@link toPatientUpdateDoc} — same fields, no `createdAt`. */
export type PatientPatchInput = Omit<PatientDraftInput, 'createdAt'>;

/**
 * What the "record a due" form collects.
 *
 * `amount` is the raw form value: the dialog seeds it with the unpaid-bill balance
 * from `lib/invoices.outstandingForPatient`, and the operator confirms or edits it.
 * So the derived figure is a default, never an authority — cash taken at the
 * counter for an old debt, or a debt that predates this app, is the operator's call.
 */
export interface PatientDueInput {
  amount: string | number;
  note?: string;
  /** Typed at the counter, not read from the record — see {@link toPatientDueDoc}. */
  phone: string;
  /** `operatorStamp(user)`. */
  actor: string;
  at?: string;
}

/** Digits only — the comparison a typed number is normalised to. */
const phoneDigits = (value: string): string => String(value ?? '').replace(/\D/g, '');

/**
 * Build the patch that records (or clears, with `0`) a patient due.
 *
 * A debt is entered against a person, and two patients can share a name — so the
 * entry is gated on the phone number: it must be typed, it must be at least 10
 * digits, and where the record already carries a number it must agree with it. A
 * patient with no number on file gains the typed one, which is the counter
 * fixing the record rather than working around the check.
 *
 * @throws when the amount or the phone fails — the caller surfaces the message
 *   verbatim and writes nothing.
 */
export function toPatientDueDoc(
  input: PatientDueInput,
  patient: Pick<PatientRecord, 'phone'>,
): Record<string, unknown> {
  const typed = phoneDigits(input.phone);
  if (typed.length < 10) {
    throw new Error('Enter the 10-digit phone number of this patient to record a due.');
  }
  const onFile = phoneDigits(patient.phone ?? '');
  if (onFile && onFile !== typed) {
    throw new Error(
      'That phone number does not match the one on this patient record. The due was not saved.',
    );
  }

  const raw = typeof input.amount === 'number' ? String(input.amount) : String(input.amount).trim();
  const amount = Number(raw);
  if (raw === '' || !Number.isFinite(amount) || amount < 0 || amount > 10_000_000) {
    throw new Error('Enter the due as a rupee amount above zero (0 clears it).');
  }

  const patch: Record<string, unknown> = {
    dueAmount: roundMoney(amount),
    dueNote: (input.note ?? '').trim().slice(0, 200),
    dueUpdatedAt: input.at || new Date().toISOString(),
    dueRecordedBy: input.actor.trim().slice(0, 128),
  };
  if (!onFile) patch.phone = String(input.phone).trim().slice(0, 20);
  return patch;
}

/** Shared construction for both patient write builders. */
function patientDocFields(input: PatientDraftInput): Record<string, unknown> {
  const parsed = Number.parseInt(String(input.age ?? '').trim(), 10);
  const doc: Record<string, unknown> = {
    name: input.name.trim(),
    age: Number.isFinite(parsed) ? Math.min(150, Math.max(0, parsed)) : 0,
    gender: input.gender,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const phone = (input.phone ?? '').trim();
  if (phone) doc.phone = phone;
  const doctorName = (input.doctorName ?? '').trim();
  if (doctorName) doc.doctorName = doctorName;
  const address = (input.address ?? '').trim();
  if (address) doc.address = address;
  doc.testSelection = (input.testSelection ?? []).map(name => name.trim()).filter(Boolean);

  // Final validation against the schema; a value the schema rejects is a bug at
  // the call site, so this throws rather than writing a document the readers will
  // have to stub.
  return PatientSchema.parse(doc) as Record<string, unknown>;
}

/** Build the exact document stored in `patients/{id}`. */
export function toPatientDoc(input: PatientDraftInput): Record<string, unknown> {
  return patientDocFields({
    ...input,
    createdAt: input.createdAt || new Date().toISOString(),
  });
}

/**
 * Build the update payload for an existing patient.
 *
 * `createdAt` is dropped from the result on purpose: the registration date is
 * what the overdue alerts and the analytics window measure against, and the
 * schema's default would otherwise stamp an empty date over the real one.
 */
export function toPatientUpdateDoc(input: PatientPatchInput): Record<string, unknown> {
  const { createdAt: _registrationDate, ...editable } = patientDocFields({
    ...input,
    createdAt: '',
  });
  return editable;
}

// ---------------------------------------------------------------------------
// Doctors (referral register)
// ---------------------------------------------------------------------------

/**
 * The referral register.
 *
 * `referralPercent` is what the lab has agreed to credit this practitioner with
 * against the tests *they* send in, and it is per-doctor rather than global
 * because a register is never one rate: a referring physician, a clinic that
 * supplies its own collection facility, and an institutional contract all price
 * the same relationship differently. `0` is the default — commission is opt-in
 * per doctor, never inherited.
 *
 * ⚠ Paying a commission for a referral is regulated in India (ICMR / NMC
 * professional-conduct rules treat inducement for referrals as professional
 * misconduct, and a lab's NABH accreditation is exposed to it). The field exists
 * because the lab keeps this money book; the compliance judgement is the owner's.
 * The app never sends anything anywhere — a statement is printed or exported by
 * a member of staff, from the encrypted local store, on this device.
 */
export const DoctorSchema = z.looseObject({
  name: z.string().max(100).default(''),
  phone: z.string().max(20).optional(),
  /** Practitioner id / registration number, if the lab records one. */
  registration: z.string().max(64).optional(),
  clinic: z.string().max(120).optional(),
  address: z.string().max(500).optional(),
  /** Share of a referred patient's bill credited back, 0–100. */
  referralPercent: z.coerce.number().min(0).max(100).default(0),
  /** False = relationship ended; history and past statements stay intact. */
  active: z.boolean().default(true),
  notes: z.string().max(500).optional(),
  createdAt: timestampString.default(''),
});
export type DoctorRecord = z.infer<typeof DoctorSchema> & { id: string };

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const ReportSchema = z.looseObject({
  patientId: z.string().max(128),
  patientName: z.string().max(100).default(''),
  resultData: z.record(z.string(), z.unknown()).default({}),
  signature: z.string().max(128).default(''),
  // No default. A missing or unknown status used to fall through to `final`, so
  // a malformed historical document was silently presented — and printable — as
  // an issued clinical report. `readReport` normalises the status to a reviewable
  // draft instead; see {@link normalizeReportStatus}.
  status: ReportStatusSchema,
  createdAt: timestampString.default(''),
  createdBy: z.string().max(128).default(''),
  testType: z.string().max(128).optional(),
  testSelection: z.array(z.string().max(128)).max(200).optional(),

  /** Audit trail: set when a final report is amended. */
  version: z.number().int().min(1).default(1),
  updatedBy: z.string().max(128).optional(),
  updatedAt: timestampString.optional(),
  amendReason: z.string().max(500).optional(),

  /**
   * True when the stored status was missing or unrecognised, so the record was
   * forced into `draft` to keep it inspectable without letting it issue, share or
   * print as a validated final report. The operator must re-verify before use.
   */
  needsReview: z.boolean().optional(),
});
export type ReportRecord = z.infer<typeof ReportSchema> & { id: string };

/**
 * Coerce a stored report's `status` into the validated domain *before* parsing,
 * without throwing away the fields a malformed record still carries.
 *
 * A document whose status is absent or not a known value is not deleted or
 * stubbed — the results, patient link and timestamps are kept so the record
 * remains recoverable — but it is downgraded to `draft` and flagged
 * `needsReview`, which is the only safe reading of "we cannot tell what this
 * was." It can then never issue, share, or print as a final report until an
 * operator re-validates it. Returns the input untouched for a genuine object so
 * a valid report pays no cost.
 */
export function normalizeReportStatus(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const record = data as Record<string, unknown>;
  if (record.status === 'draft' || record.status === 'final') return record;
  return { ...record, status: 'draft', needsReview: true };
}

/** Payload accepted by the report write path. */
export interface ReportDraftInput {
  id?: string;
  patientId: string;
  patientName: string;
  resultData: Record<string, unknown>;
  signature: string;
  status: ReportStatus;
  createdAt: string;
  createdBy: string;
  testType?: string;
  testSelection?: string[];
  version?: number;
  updatedBy?: string;
  updatedAt?: string;
  amendReason?: string;
}

/** Build the exact document stored in `reports/{id}`. */
export function toReportDoc(input: ReportDraftInput): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    patientId: input.patientId,
    patientName: input.patientName,
    resultData: input.resultData,
    signature: input.signature,
    status: input.status,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    version: input.version ?? 1,
  };
  if (input.testType) doc.testType = input.testType;
  if (input.testSelection) doc.testSelection = input.testSelection;
  if (input.updatedBy) doc.updatedBy = input.updatedBy;
  if (input.updatedAt) doc.updatedAt = input.updatedAt;
  if (input.amendReason) doc.amendReason = input.amendReason;
  return doc;
}

/** The fields that may be amended on an existing report (author is immutable). */
export function toReportUpdateDoc(
  input: ReportDraftInput,
  existingVersion: number,
): Record<string, unknown> {
  const { createdBy: _createdBy, ...rest } = toReportDoc(input);
  return { ...rest, version: Math.max(1, existingVersion + 1) };
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/**
 * One printed line on a bill.
 *
 * The line lives **on the invoice**, not in the price list. A bill is a
 * commercial record the patient keeps: if it were re-derived from live prices,
 * editing a price in June would rewrite what April's paper says. So the price is
 * copied in at the moment the bill is raised, and only the bill's own `items[]`
 * are ever rendered or reprinted.
 */
export const InvoiceItemSchema = z.object({
  /** What the patient reads on the bill — panel name or test name. */
  name: z.string().max(128).default(''),
  /**
   * `panel` = one charge covering a profile and its members. `test` = a single
   * test. `adjustment` = a discount / waive / correction line.
   */
  kind: z.enum(['panel', 'test', 'adjustment']).default('test'),
  /** Specimen or short reference shown beside the name (Serum, Urine, …). */
  detail: z.string().max(80).default(''),
  qty: z.coerce.number().int().min(1).max(200).default(1),
  unitPrice: z.coerce.number().min(0).max(1_000_000).default(0),
  /** `qty × unitPrice`, rounded to paise. Negative only on an adjustment line. */
  lineTotal: z.coerce.number().min(-1_000_000).max(10_000_000).default(0),
  /**
   * True when no price existed for this entry when the bill was raised.
   * Rendered as "not priced" — never as `₹0`, which reads as a free test.
   */
  unpriced: z.boolean().default(false),
  /** Members folded into this charge; excluded from any later standalone line. */
  covers: z.array(z.string().max(128)).max(200).default([]),
});
export type InvoiceItem = z.infer<typeof InvoiceItemSchema>;

/**
 * A referral snapshot taken when the bill is raised.
 *
 * Stamped rather than joined because a doctor's `referralPercent` changes: next
 * month's rate must not silently restate what this month's commission was. What
 * was agreed at bill time lives on the bill.
 */
export const InvoiceReferralSchema = z.object({
  /** The stored spelling, as the counter typed it. */
  doctorName: z.string().max(100).default(''),
  /** `doctorNameKey()` of the matched register entry — the grouping key. */
  doctorKey: z.string().max(120).default(''),
  doctorId: z.string().max(128).default(''),
  /** Percent at bill time. */
  percent: z.coerce.number().min(0).max(100).default(0),
  /** Rupees credited on this bill, derived from `taxableBase × percent`. */
  commission: z.coerce.number().min(0).max(10_000_000).default(0),
  /** True when the bill's referrer was typed but is not in the register yet. */
  unmatched: z.boolean().default(false),
});
export type InvoiceReferral = z.infer<typeof InvoiceReferralSchema>;

export const InvoiceSchema = z.looseObject({
  reportId: z.string().max(128).default(''),
  patientId: z.string().max(128).default(''),
  patientName: z.string().max(100).default(''),
  amount: z.coerce.number().min(0).max(10_000_000).default(0),
  status: InvoiceStatusSchema.default('pending'),
  createdAt: timestampString.default(''),

  /** Human-readable bill number, e.g. `IN2610-0042`. */
  invoiceNo: z.string().max(32).default(''),
  /** Line items as they were printed. The authority for any reprint. */
  items: z.array(InvoiceItemSchema).max(200).default([]),
  /** Sum of `items[]` before discount and tax. */
  subtotal: z.coerce.number().min(0).max(10_000_000).default(0),
  discount: z.coerce.number().min(0).max(10_000_000).default(0),
  tax: z.coerce.number().min(0).max(10_000_000).default(0),
  /**
   * Percent used, kept so a statement can be reconstructed without guessing.
   * `taxableBase` is what referral commission is computed on: money the lab
   * actually kept, so a waived portion is never paid out to a referring doctor.
   */
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  taxableBase: z.coerce.number().min(0).max(10_000_000).default(0),
  /** Rupees collected so far. `paidAmount >= amount` ⇒ `status === 'paid'`. */
  paidAmount: z.coerce.number().min(0).max(10_000_000).default(0),
  paidAt: timestampString.optional(),
  paymentMode: PaymentModeSchema.optional(),
  /** Referral attribution at bill time (see {@link InvoiceReferralSchema}). */
  referral: InvoiceReferralSchema.optional(),
  /** Patient's referrer as typed — the source the referral was matched from. */
  doctorName: z.string().max(100).default(''),
  /** `operatorStamp()` — who raised the bill, never the raw `local-admin` uid. */
  issuedBy: z.string().max(128).default(''),
  notes: z.string().max(500).default(''),
  /** Set when a bill is voided; the record is kept, not deleted. */
  voidReason: z.string().max(500).optional(),
});
export type InvoiceRecord = z.infer<typeof InvoiceSchema> & { id: string };

/**
 * Round to whole paise without the `0.1 + 0.2` drift, and without letting a
 * 0.5-paise edge decide whether a printed total adds up.
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Recompute the money on a draft bill from its own lines.
 *
 * `amount` is what the alert engine prints in "₹X unpaid for <name>" and what the
 * day book sums. If a screen ever set `amount` by hand and forgot to fold in the
 * discount, the on-screen alert and the paper bill would disagree — so callers
 * pass the *components* and this derives the total. Discount can never exceed the
 * subtotal (a negative bill is not a bill), and `taxableBase` is deliberately
 * post-discount: commission is paid on money the lab kept.
 */
export interface InvoiceTotalsInput {
  items: readonly InvoiceItem[];
  discount?: number;
  taxPercent?: number;
}

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  tax: number;
  taxPercent: number;
  taxableBase: number;
  amount: number;
}

export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const rawSubtotal = input.items.reduce((sum, item) => sum + item.lineTotal, 0);
  // Adjustment lines (discounts) are folded into the discount total, not the
  // subtotal, so a bill never shows a negative item price.
  const charges = input.items.filter(item => item.lineTotal > 0);
  const adjustments = input.items
    .filter(item => item.lineTotal < 0)
    .reduce((sum, item) => sum + item.lineTotal, 0);

  const subtotal = roundMoney(charges.reduce((sum, item) => sum + item.lineTotal, 0));
  const explicitDiscount = Math.max(0, roundMoney(input.discount ?? 0));
  const discount = roundMoney(Math.min(subtotal, explicitDiscount + Math.abs(adjustments)));
  const taxableBase = roundMoney(subtotal - discount);
  const taxPercent = Math.max(0, Math.min(100, input.taxPercent ?? 0));
  const tax = roundMoney((taxableBase * taxPercent) / 100);
  const amount = roundMoney(taxableBase + tax);

  // `rawSubtotal` is only a guard against a caller mixing signed and unsigned
  // lines; it never reaches the document.
  void rawSubtotal;
  return { subtotal, discount, tax, taxPercent, taxableBase, amount };
}

/** Payload accepted by the invoice write path. */
export interface InvoiceDraftInput {
  id?: string;
  invoiceNo?: string;
  reportId?: string;
  patientId: string;
  patientName: string;
  items: readonly InvoiceItem[];
  discount?: number;
  taxPercent?: number;
  status?: InvoiceStatus;
  paidAmount?: number;
  paidAt?: string;
  paymentMode?: PaymentMode;
  referral?: InvoiceReferral;
  doctorName?: string;
  issuedBy?: string;
  notes?: string;
  createdAt?: string;
}

/**
 * Build the exact document stored in `invoices/{id}`.
 *
 * Totals are always recomputed here from `items[]`, so no call site can put a
 * number on a bill that its own line items do not add up to.
 */
export function toInvoiceDoc(input: InvoiceDraftInput): Record<string, unknown> {
  const items = input.items.map(item => InvoiceItemSchema.parse(item));
  const totals = computeInvoiceTotals({
    items,
    discount: input.discount,
    taxPercent: input.taxPercent,
  });
  const paidAmount = roundMoney(Math.max(0, Math.min(input.paidAmount ?? 0, totals.amount)));
  const status: InvoiceStatus =
    input.status === 'void'
      ? 'void'
      : paidAmount <= 0
        ? 'pending'
        : paidAmount >= totals.amount
          ? 'paid'
          : 'partial';

  return {
    reportId: input.reportId ?? '',
    patientId: input.patientId,
    patientName: input.patientName.trim(),
    invoiceNo: input.invoiceNo ?? '',
    items,
    ...totals,
    amount: totals.amount,
    status,
    paidAmount,
    ...(input.paidAt ? { paidAt: input.paidAt } : {}),
    ...(input.paymentMode ? { paymentMode: input.paymentMode } : {}),
    ...(input.referral ? { referral: input.referral } : {}),
    doctorName: (input.doctorName ?? '').trim(),
    issuedBy: input.issuedBy ?? '',
    notes: (input.notes ?? '').trim(),
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

/**
 * The patch that records money coming in.
 *
 * A payment is applied to an existing bill's stored `amount`, never recomputed
 * from live prices — reprinting a paid bill must show what was charged then.
 */
export function toInvoicePaymentDoc(
  invoice: Pick<InvoiceRecord, 'amount'>,
  paidAmount: number,
  paidAt: string,
  paymentMode: PaymentMode,
): Record<string, unknown> {
  const applied = roundMoney(Math.max(0, Math.min(paidAmount, invoice.amount)));
  return {
    paidAmount: applied,
    paidAt,
    paymentMode,
    status: applied <= 0 ? 'pending' : applied >= invoice.amount ? 'paid' : 'partial',
  };
}

// ---------------------------------------------------------------------------
// Boundary readers
// ---------------------------------------------------------------------------

/**
 * Shared read helper: validate, and on failure log the mismatch and fall back to
 * whatever the document *did* provide so lists stay usable. A strict throw here
 * would mean one malformed record makes an entire page unusable.
 */
function readAtBoundary<T>(
  schema: z.ZodType<T>,
  label: string,
  id: string,
  data: unknown,
  fallback: T,
): T & { id: string } {
  const result = schema.safeParse(data ?? {});
  if (result.success) {
    return { ...(result.data as T), id };
  }
  captureError(new Error(`Malformed ${label} document: ${id}`), {
    scope: `models/${label}`,
    issues: result.error.issues
      .slice(0, 3)
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join('; '),
  });
  return { ...fallback, id };
}

export function readUser(id: string, data: unknown): UserProfile {
  return readAtBoundary(UserSchema, 'user', id, data, {
    name: 'Unknown user',
    email: '',
    role: 'guest',
    createdAt: '',
  });
}

export function readPatient(id: string, data: unknown): PatientRecord {
  return readAtBoundary(PatientSchema, 'patient', id, data, {
    name: `Unsaved record (${id.slice(0, 6)})`,
    age: 0,
    gender: 'other',
    createdAt: '',
  });
}

export function readDoctor(id: string, data: unknown): DoctorRecord {
  return readAtBoundary(DoctorSchema, 'doctor', id, data, {
    name: `Unknown doctor (${id.slice(0, 6)})`,
    referralPercent: 0,
    active: true,
    createdAt: '',
  });
}

export function readReport(id: string, data: unknown): ReportRecord {
  // Normalise the status first so a missing/unknown value keeps the rest of the
  // document (recoverable) and lands in a reviewable draft, never a silent final.
  const status =
    data && typeof data === 'object' && (data as { status?: unknown }).status === 'final'
      ? ('final' as const)
      : ('draft' as const);
  return readAtBoundary(ReportSchema, 'report', id, normalizeReportStatus(data), {
    patientId: '',
    patientName: `Report ${id.slice(0, 6)}`,
    resultData: {},
    signature: '',
    status,
    createdAt: '',
    createdBy: '',
    version: 1,
    needsReview: true,
  });
}

export function readInvoice(id: string, data: unknown): InvoiceRecord {
  return readAtBoundary(InvoiceSchema, 'invoice', id, data, {
    reportId: '',
    patientId: '',
    patientName: '',
    amount: 0,
    status: 'pending',
    createdAt: '',
    invoiceNo: '',
    items: [],
    subtotal: 0,
    discount: 0,
    tax: 0,
    taxPercent: 0,
    taxableBase: 0,
    paidAmount: 0,
    doctorName: '',
    issuedBy: '',
    notes: '',
  });
}

/** Convenience for `snapshot.docs.map(...)`. Accepts a Firestore doc array directly. */
type FirestoreDocs = readonly { id: string; data: () => unknown }[];

/**
 * The plural helpers are what list pages pass to `useCollectionList`'s `map`,
 * so every document crosses the schema boundary before it reaches a render.
 * Only collections that are actually listed here have a plural form: `users`
 * is read one document at a time (the caller's own profile), so it has no
 * list helper.
 */
export function readPatients(docs: FirestoreDocs): PatientRecord[] {
  return docs.map(d => readPatient(d.id, d.data()));
}
export function readReports(docs: FirestoreDocs): ReportRecord[] {
  return docs.map(d => readReport(d.id, d.data()));
}
export function readDoctors(docs: FirestoreDocs): DoctorRecord[] {
  return docs.map(d => readDoctor(d.id, d.data()));
}
export function readInvoices(docs: FirestoreDocs): InvoiceRecord[] {
  return docs.map(d => readInvoice(d.id, d.data()));
}
