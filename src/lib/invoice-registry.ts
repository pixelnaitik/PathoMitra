/**
 * Bill numbers.
 *
 * A printed bill needs a number the lab can quote six months later, and a
 * duplicate or blank number on a commercial document is worse than none — two
 * receipts reading `IN2610-0007` is the shape of a dispute nobody can settle.
 *
 * The scheme is the one `patient-registry.ts` already proved out on this device:
 * a per-month counter document in `meta`, walked forward and probed against the
 * records that exist. The counter makes numbers sequential (so the day book
 * reads in order), and the probe makes collisions impossible even when the
 * counter and the records disagree after a partial restore.
 *
 * Format: `IN` + `YYMM` + a 4-digit sequence → `IN2610-0042`. Six digits of
 * month-space per lab is 9,999 bills a month, which is beyond any single-pathology
 * counter, and the suffix width matches registration numbers so staff read both
 * the same way.
 */
import { db, doc, getDoc, setDoc } from '../data/fs';
import { patientMonthKey } from './patient-registry';

/** Digits after the `YYMM` prefix. */
const SEQUENCE_WIDTH = 4;

/** How many consecutive numbers to try before giving up (see patient-registry). */
const MAX_PROBE_STEPS = 100;

const COUNTER_DOC = (month: string) => `invoice-id-${month}`;

/** `IN2610` for October 2026 — the local month, the one the lab closes on. */
export function invoiceMonthPrefix(at: Date = new Date()): string {
  return `IN${patientMonthKey(at)}`;
}

function formatInvoiceNo(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(SEQUENCE_WIDTH, '0')}`;
}

async function readCounter(ref: ReturnType<typeof doc>): Promise<number> {
  const snap = await getDoc(ref);
  if (!snap.exists()) return 0;
  const stored = Number(snap.data().value);
  return Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0;
}

/**
 * Hand out the next bill number for the current month.
 *
 * @throws when no free number is found in `MAX_PROBE_STEPS`. The honest answer to
 *   a counter that disagrees with the records is to say so and change nothing —
 *   never to write over a bill that already left the lab.
 */
export async function allocateInvoiceNo(now: Date = new Date()): Promise<string> {
  const prefix = invoiceMonthPrefix(now);
  const counterRef = doc(db, 'meta', COUNTER_DOC(prefix));
  const cursor = await readCounter(counterRef);

  for (let step = 1; step <= MAX_PROBE_STEPS; step++) {
    const sequence = cursor + step;
    const candidate = formatInvoiceNo(prefix, sequence);
    const taken = await getDoc(doc(db, 'invoices', candidate));
    if (!taken.exists()) {
      await setDoc(counterRef, {
        value: sequence,
        allocatedAt: new Date().toISOString(),
      });
      return candidate;
    }
  }

  throw new Error(
    `Bill numbers for ${prefix} could not be advanced past ${formatInvoiceNo(prefix, cursor)}. ` +
      'Open Settings → Data & Diagnostics and report this — no bill was created.',
  );
}

/**
 * The sequence part of a stored bill number, or `null` if it is not ours.
 *
 * Used to sort bills by number rather than by timestamp when two are raised in
 * the same second, and to detect a legacy `invoices/{id}` document that carries
 * no number at all.
 */
export function invoiceSequenceOf(invoiceNo: string): number | null {
  const match = /-(\d{4})$/.exec(String(invoiceNo ?? '').trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/** Sort comparator: newest month first, then highest number first. */
export function byBillNumber(a: string, b: string): number {
  const sa = invoiceSequenceOf(a) ?? -1;
  const sb = invoiceSequenceOf(b) ?? -1;
  if (sa !== sb) return sb - sa;
  return String(b ?? '').localeCompare(String(a ?? ''));
}

/**
 * A stand-in number for a bill that predates numbering.
 *
 * Never blank on paper: an unnumbered receipt is the one a patient cannot quote
 * and a lab cannot find. This is deliberately obviously synthetic so nobody
 * mistakes it for an allocated number.
 */
export function legacyInvoiceNo(invoiceId: string): string {
  return `— (no number · ${invoiceId.slice(0, 6)})`;
}
