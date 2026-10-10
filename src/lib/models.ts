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

export const InvoiceStatusSchema = z.enum(['pending', 'paid']);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

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
  createdAt: timestampString.default(''),
});
export type PatientRecord = z.infer<typeof PatientSchema> & { id: string };

/** Numeric age, or `undefined` when the stored value is not a sane number. */
export function ageAsNumber(patient: Pick<PatientRecord, 'age'>): number | undefined {
  const n = typeof patient.age === 'number' ? patient.age : parseInt(patient.age, 10);
  return Number.isFinite(n) && n >= 0 && n <= 150 ? n : undefined;
}

// ---------------------------------------------------------------------------
// Doctors (referral register)
// ---------------------------------------------------------------------------

export const DoctorSchema = z.looseObject({
  name: z.string().max(100).default(''),
  phone: z.string().max(20).optional(),
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
  status: ReportStatusSchema.default('final'),
  createdAt: timestampString.default(''),
  createdBy: z.string().max(128).default(''),
  testType: z.string().max(128).optional(),
  testSelection: z.array(z.string().max(128)).max(200).optional(),

  /** Audit trail: set when a final report is amended. */
  version: z.number().int().min(1).default(1),
  updatedBy: z.string().max(128).optional(),
  updatedAt: timestampString.optional(),
  amendReason: z.string().max(500).optional(),
});
export type ReportRecord = z.infer<typeof ReportSchema> & { id: string };

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

export const InvoiceSchema = z.looseObject({
  reportId: z.string().max(128).default(''),
  patientId: z.string().max(128).default(''),
  patientName: z.string().max(100).default(''),
  amount: z.coerce.number().min(0).max(10_000_000).default(0),
  status: InvoiceStatusSchema.default('pending'),
  createdAt: timestampString.default(''),
});
export type InvoiceRecord = z.infer<typeof InvoiceSchema> & { id: string };

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
    createdAt: '',
  });
}

export function readReport(id: string, data: unknown): ReportRecord {
  return readAtBoundary(ReportSchema, 'report', id, data, {
    patientId: '',
    patientName: `Report ${id.slice(0, 6)}`,
    resultData: {},
    signature: '',
    status: 'final',
    createdAt: '',
    createdBy: '',
    version: 1,
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
