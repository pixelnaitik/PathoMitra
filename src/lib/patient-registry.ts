/**
 * Patient registration numbers and the duplicate guard.
 *
 * Two failure modes this replaces:
 *
 *  1. The old id was `YYMM` + three random digits — 1,000 numbers a month,
 *     drawn with `Math.random()` and probed up to ten times. At a few hundred
 *     registrations a month the birthday paradox makes collisions routine, and
 *     when the ten probes ran out the lab got "Could not allocate a unique
 *     patient id" while trying to admit a patient. Numbers also arrived in no
 *     order, so the counter could not tell today's queue from yesterday's.
 *  2. Nothing stopped the same patient being registered twice. A duplicate MRN
 *     is how a lab ends up with two half-histories for one person, which is a
 *     clinical problem before it is a data problem.
 *
 * The id is now a per-month sequence stored in the `meta` collection, still
 * prefixed with `YYMM` so it reads the way staff already read them. Allocation,
 * patient insertion, and the counter update run in one repository transaction,
 * so a crash cannot burn a number or leave a patient without its MRN.
 * Legacy `YYMM###` ids already in the store stay valid; the two formats never
 * collide because the new one is always six digits after the prefix… except when
 * a legacy id happens to match, which is exactly what the probe catches.
 */
import { getRepository } from '../data';
import { toPatientDoc, type PatientDraftInput, type PatientRecord } from './models';

/** Digits after the `YYMM` prefix. */
const SEQUENCE_WIDTH = 4;

/**
 * How many consecutive numbers to try before giving up. A fresh month always
 * finds room on the first probe; this only matters if the counter doc and the
 * records disagree, and then walking forward is still cheaper than failing.
 */
const MAX_PROBE_STEPS = 100;

const COUNTER_DOC = (month: string) => `patient-id-${month}`;

/** `2610` for October 2026 — local month, the one the lab closes on. */
export function patientMonthKey(at: Date = new Date()): string {
  const yy = String(at.getFullYear()).slice(-2);
  const mm = String(at.getMonth() + 1).padStart(2, '0');
  return `${yy}${mm}`;
}

/** Sequence → zero-padded suffix. */
function formatPatientId(month: string, sequence: number): string {
  return `${month}${String(sequence).padStart(SEQUENCE_WIDTH, '0')}`;
}

/**
 * Register a patient and allocate its MRN in one atomic unit.
 *
 * @throws when no free number is found in `MAX_PROBE_STEPS` — which means the
 *   counter document and the records disagree, and the honest answer is to say
 *   so rather than write over someone's record.
 */
export async function registerPatient(
  input: PatientDraftInput,
  now: Date = new Date(),
): Promise<PatientRecord> {
  const value = toPatientDoc({ ...input, createdAt: input.createdAt ?? now.toISOString() });
  const month = patientMonthKey(now);
  const counterId = COUNTER_DOC(month);
  let created: PatientRecord | null = null;

  await getRepository().transaction(async tx => {
    const counter = await tx.get('meta', counterId);
    const stored = Number(counter?.data().value);
    const cursor = Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0;

    for (let step = 1; step <= MAX_PROBE_STEPS; step++) {
      const sequence = cursor + step;
      const candidate = formatPatientId(month, sequence);
      if (await tx.get('patients', candidate)) continue;

      await tx.set('patients', candidate, value);
      await tx.set('meta', counterId, {
        value: sequence,
        allocatedAt: now.toISOString(),
      });
      created = { ...value, id: candidate } as PatientRecord;
      return;
    }

    throw new Error(
      `Registration numbers for ${month} could not be advanced past ${formatPatientId(month, cursor)}. ` +
        'Open Settings → Data & Diagnostics and report this — no record was changed.',
    );
  });

  if (!created) throw new Error('The patient could not be registered.');
  return created;
}

/** Digits only, so `+91 98765-43210` and `9876543210` are the same number. */
export function normalisePhone(phone: string | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

/** `Asha  Rao` / ` ASHA RAO ` / `asha rao.` → one comparable key. */
export function patientNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{M}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether two digit strings are the same phone number.
 *
 * Equality is not enough in India: the counter has `+91 98765 43210` on yesterday's
 * form and types `98765 43210` today. The country code is the only part that
 * differs, so a tail match of eight digits or more counts as the same number —
 * long enough that two different subscribers cannot collide by accident.
 */
export function samePhoneNumber(a: string, b: string): boolean {
  const left = normalisePhone(a);
  const right = normalisePhone(b);
  if (left.length < 8 || right.length < 8) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

export interface DuplicateCandidate {
  id: string;
  name: string;
  age: string | number;
  phone?: string;
  dateOfBirth?: string;
  externalId?: string;
}

export interface ProbableDuplicate extends DuplicateCandidate {
  /** Why this was flagged, in the words the bench needs to act on. */
  reason: string;
}

/**
 * Records in `candidates` that look like the person being registered.
 *
 * Deliberately conservative: only an identical normalised phone, or an identical
 * name *plus* identical age, is worth interrupting a registration for. Missed
 * duplicates can be merged later; a false positive at the counter wastes the
 * whole queue's time and teaches staff to click through warnings.
 *
 * `excludeId` skips the record being edited, so saving a change to an existing
 * patient never flags that patient as their own duplicate.
 */
export function findProbableDuplicates(
  input: {
    name: string;
    age: string | number;
    phone?: string;
    dateOfBirth?: string;
    externalId?: string;
  },
  candidates: readonly DuplicateCandidate[],
  excludeId?: string,
): ProbableDuplicate[] {
  const phone = normalisePhone(input.phone);
  const nameKey = patientNameKey(input.name);
  const ageKey = String(input.age ?? '').trim();

  const found: ProbableDuplicate[] = [];
  for (const candidate of candidates) {
    if (excludeId && candidate.id === excludeId) continue;
    const samePhone = phone.length >= 8 && samePhoneNumber(phone, candidate.phone ?? '');
    const sameNameAndAge =
      nameKey.length > 0 &&
      patientNameKey(candidate.name) === nameKey &&
      String(candidate.age ?? '').trim() === ageKey;
    const sameBirthDate =
      !!input.dateOfBirth &&
      input.dateOfBirth === candidate.dateOfBirth &&
      patientNameKey(candidate.name) === nameKey;
    const sameExternalId =
      !!input.externalId &&
      input.externalId.trim().toUpperCase() === candidate.externalId?.trim().toUpperCase();

    if (samePhone || sameNameAndAge || sameBirthDate || sameExternalId) {
      found.push({
        id: candidate.id,
        name: candidate.name,
        age: candidate.age,
        phone: candidate.phone,
        reason: sameExternalId
          ? 'same external identifier'
          : sameBirthDate
            ? 'same name and date of birth'
            : samePhone
              ? `same phone number (${candidate.phone || phone})`
              : 'same name and age',
      });
    }
  }
  return found;
}

/**
 * Field-level checks for the registration form, before anything is written.
 *
 * `toPatientDoc` clamps and validates at the boundary, but a clamped value is a
 * silent correction — the bench needs to be told *why* the form was refused, in
 * the field it was typed in. Bounds mirror `PatientSchema` in lib/models.
 */
export const PATIENT_AGE_MIN = 0;
export const PATIENT_AGE_MAX = 150;
const PHONE_RE = /^[0-9+()\-\s]{6,20}$/;

export function validatePatientForm(form: {
  name: string;
  age: string | number;
  phone?: string;
  dateOfBirth?: string;
  guardianName?: string;
  guardianPhone?: string;
  externalIdType?: 'national-id' | 'birth-certificate' | 'other';
  externalId?: string;
  address?: string;
}): string | null {
  const name = String(form.name ?? '').trim();
  if (!name) return 'Patient Full Name is required.';
  if (name.length > 100) return 'Patient name must be 100 characters or fewer.';

  const rawAge = String(form.age ?? '').trim();
  if (!rawAge) return 'Patient Age is required.';
  const age = Number.parseInt(rawAge, 10);
  if (!Number.isFinite(age) || !/^\d{1,3}$/.test(rawAge)) {
    return 'Patient Age must be a whole number of years.';
  }
  if (age < PATIENT_AGE_MIN || age > PATIENT_AGE_MAX) {
    return `Patient Age must be between ${PATIENT_AGE_MIN} and ${PATIENT_AGE_MAX} years.`;
  }

  const phone = String(form.phone ?? '').trim();
  if (phone && !PHONE_RE.test(phone)) {
    return 'Phone can contain digits, spaces and + ( ) - only, up to 20 characters.';
  }
  if (phone && (normalisePhone(phone).length < 8 || normalisePhone(phone).length > 15)) {
    return 'Phone must contain 8–15 digits.';
  }

  const dateOfBirth = String(form.dateOfBirth ?? '').trim();
  if (dateOfBirth) {
    const parsed = new Date(`${dateOfBirth}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== dateOfBirth ||
      parsed.getTime() > Date.now()
    ) {
      return 'Date of birth must be a valid date that is not in the future.';
    }
  }

  const guardianName = String(form.guardianName ?? '').trim();
  if (guardianName.length > 100) return 'Guardian name must be 100 characters or fewer.';
  const guardianPhone = String(form.guardianPhone ?? '').trim();
  if (
    guardianPhone &&
    (!PHONE_RE.test(guardianPhone) ||
      normalisePhone(guardianPhone).length < 8 ||
      normalisePhone(guardianPhone).length > 15)
  ) {
    return 'Guardian phone must contain 8–15 digits and only spaces, + ( ) -.';
  }

  const externalId = String(form.externalId ?? '').trim();
  if (externalId.length > 128) return 'External identifier must be 128 characters or fewer.';
  if (!!externalId !== !!form.externalIdType) {
    return 'Choose an identifier type and enter its value, or leave both blank.';
  }

  const address = String(form.address ?? '').trim();
  if (address.length > 500) return 'Address must be 500 characters or fewer.';

  return null;
}
