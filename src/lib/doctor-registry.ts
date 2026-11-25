import { getRepository } from '../data';
import { generateId } from '../data/query';
import type { DataRepository } from '../data/types';
import { AuditEventSchema, DoctorSchema, type DoctorRecord } from './models';

/**
 * Referral identities — one comparable form for a doctor's name.
 *
 * A referral register is free text typed at a counter, and it ages like fruit:
 * `DR MANOJ KUMAR`, `DR.MANOJ KUMAR`, `Dr. Manoj Kumar (MBBS)` are one person to
 * the lab and three people to a `Map` keyed on the string. Because patients store
 * `doctorName` rather than a doctor id, every grouping in the app inherits the
 * problem: the Top Referring Doctors chart splits one doctor across three bars,
 * the referral sheet under-counts their patients, and the dropdown shows the same
 * name four times so the next registration picks whichever spelling was clicked.
 *
 * These helpers do not rewrite stored data — they only decide how records are
 * *compared and grouped*, so a lab's own capitalisation stays on the page while
 * matching becomes stable.
 */

/** A record carrying a doctor's name, in whatever shape the caller has it. */
export interface NamedRecord {
  name: string;
}

/**
 * Canonical key for comparing two referrals.
 *
 * Deliberately aggressive on punctuation and case (title dots, bracketed
 * qualifications, `{EYE}` suffixes, apostrophes) and deliberately conservative
 * on two things:
 *
 *  - word order: two names match only when they carry the same words in the same
 *    order, because "KUMAR SINGH DR" versus "DR SINGH KUMAR" is a different
 *    person often enough that sorting the words would create merges nobody asked
 *    for.
 *  - qualifications: `DR MANOJ KUMAR` and `DR MANOJ KUMAR MBBS` stay distinct.
 *    Stripping degree tokens would fold them together, and two practitioners can
 *    share a name in this register — merging two doctors' histories is a worse
 *    error than showing one doctor's referrals under two spellings.
 */
export function doctorNameKey(name: string | undefined): string {
  return String(name ?? '')
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[.,'/]/g, ' ')
    .replace(/\bDOCTOR\b/g, 'DR')
    .replace(/\bPROF\b/g, 'PROF')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Display form for a name the app has to render without a stored spelling.
 *
 * Used only where the register is being created (an autocomplete choice that is
 * not already on file); existing records keep exactly what the lab typed.
 */
export function normaliseDoctorName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  // An all-caps record from an older register stays all caps: switching it to
  // title case would make the same doctor read differently across screens.
  const shouty = trimmed === trimmed.toUpperCase();
  return shouty ? trimmed.toUpperCase() : trimmed.replace(/\b\w/g, letter => letter.toUpperCase());
}

export interface DoctorGroup<T> {
  /** The spelling shown for the group. */
  name: string;
  /** The key every member folded into. */
  key: string;
  members: T[];
}

/**
 * Group records that refer to the same doctor.
 *
 * The displayed name is the spelling recorded most often — the register's own
 * habit, not an algorithm's invention — with the shortest variant winning a tie
 * so a bare `DR X KUMAR` beats `DR X KUMAR MBBS MD` when both appear twice.
 */
export function groupByDoctorName<T>(
  records: readonly T[],
  nameOf: (record: T) => string | undefined,
): DoctorGroup<T>[] {
  const groups = new Map<string, { counts: Map<string, number>; members: T[] }>();

  for (const record of records) {
    const name = String(nameOf(record) ?? '').trim();
    if (!name) continue;
    const key = doctorNameKey(name);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = { counts: new Map(), members: [] };
      groups.set(key, group);
    }
    group.members.push(record);
    group.counts.set(name, (group.counts.get(name) ?? 0) + 1);
  }

  return [...groups.entries()].map(([key, group]) => {
    let name = '';
    let best = -1;
    for (const [candidate, count] of group.counts) {
      if (count > best || (count === best && candidate.length < name.length)) {
        name = candidate;
        best = count;
      }
    }
    return { name, key, members: group.members };
  });
}

/**
 * De-duplicate a name list, keeping the first spelling seen.
 *
 * Used where the app merges its seeded suggestions with the lab's own register:
 * without folding on the key, `DR ARVIND KUMAR` and `DR. ARVIND KUMAR` both stay
 * in the dropdown and the patient ends up attached to whichever one was tapped.
 */
export function dedupeDoctorNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const key = doctorNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Whether a typed query is asking for this doctor.
 *
 * Every word typed has to appear in the canonical name, in any position: the
 * register writes `DR SHAILENDRA KUMAR MS` and the bench types "shailendra ms".
 */
export function doctorMatchesQuery(name: string | undefined, query: string): boolean {
  const haystack = doctorNameKey(name);
  const terms = doctorNameKey(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  return terms.every(term => haystack.includes(term));
}

const phoneDigits = (value: string | undefined): string => String(value ?? '').replace(/\D/g, '');

/** Field-level validation shared by every doctor write door. */
export function validateDoctorInput(input: {
  name: string;
  phone?: string;
  registration?: string;
  clinic?: string;
  address?: string;
  referralPercent?: number;
  notes?: string;
}): string | null {
  const name = String(input.name ?? '').trim();
  if (!name) return 'Doctor name is required.';
  if (name.length > 100) return 'Doctor name must be 100 characters or fewer.';
  const phone = String(input.phone ?? '').trim();
  if (
    phone &&
    (!/^[0-9+()\-\s]{6,20}$/.test(phone) ||
      phoneDigits(phone).length < 8 ||
      phoneDigits(phone).length > 15)
  ) {
    return 'Doctor phone must contain 8–15 digits and only spaces, + ( ) -.';
  }
  if (String(input.registration ?? '').length > 64)
    return 'Registration must be 64 characters or fewer.';
  if (String(input.clinic ?? '').length > 120) return 'Clinic must be 120 characters or fewer.';
  if (String(input.address ?? '').length > 500) return 'Address must be 500 characters or fewer.';
  if (String(input.notes ?? '').length > 500) return 'Notes must be 500 characters or fewer.';
  const rate = Number(input.referralPercent ?? 0);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100)
    return 'Referral rate must be between 0 and 100.';
  return null;
}

export interface DoctorWriteInput {
  name: string;
  phone?: string;
  registration?: string;
  clinic?: string;
  address?: string;
  referralPercent?: number;
  active?: boolean;
  notes?: string;
}

async function assertUniqueDoctor(
  tx: DataRepository,
  input: DoctorWriteInput,
  excludeId?: string,
): Promise<void> {
  const rows = await tx.list('doctors');
  const nameKey = doctorNameKey(input.name);
  const registration = input.registration?.trim().toUpperCase();
  for (const row of rows) {
    if (row.id === excludeId) continue;
    const doctor = DoctorSchema.parse({ ...row.data(), id: row.id }) as DoctorRecord;
    if (doctorNameKey(doctor.name) === nameKey) {
      throw new Error(`A doctor named ${doctor.name} is already in the register.`);
    }
    if (registration && doctor.registration?.trim().toUpperCase() === registration) {
      throw new Error(`That practitioner registration is already used by ${doctor.name}.`);
    }
  }
}

/** Create a validated, unique and audited referral-register record. */
export async function createDoctor(input: DoctorWriteInput, actor: string): Promise<DoctorRecord> {
  const invalid = validateDoctorInput(input);
  if (invalid) throw new Error(invalid);
  if (!actor.trim()) throw new Error('An operator identity is required.');
  const id = generateId();
  const now = new Date().toISOString();
  let created: DoctorRecord | null = null;
  await getRepository().transaction(async tx => {
    await assertUniqueDoctor(tx, input);
    const value = DoctorSchema.parse({ ...input, id, createdAt: now });
    await tx.set('doctors', id, value);
    await tx.add(
      'auditEvents',
      AuditEventSchema.parse({
        action: 'doctor.created',
        entity: 'doctors',
        entityId: id,
        actor: actor.trim(),
        at: now,
        details: { name: value.name },
      }),
    );
    created = { ...value, id } as DoctorRecord;
  });
  if (!created) throw new Error('The doctor could not be registered.');
  return created;
}

/** Update a doctor without changing immutable registration provenance. */
export async function updateDoctor(
  id: string,
  input: DoctorWriteInput,
  actor: string,
): Promise<DoctorRecord> {
  const invalid = validateDoctorInput(input);
  if (invalid) throw new Error(invalid);
  if (!actor.trim()) throw new Error('An operator identity is required.');
  const now = new Date().toISOString();
  let updated: DoctorRecord | null = null;
  await getRepository().transaction(async tx => {
    const current = await tx.get('doctors', id);
    if (!current) throw new Error('This doctor no longer exists.');
    await assertUniqueDoctor(tx, input, id);
    const value = DoctorSchema.parse({
      ...current.data(),
      ...input,
      id,
      createdAt: current.data().createdAt,
    });
    await tx.set('doctors', id, value);
    await tx.add(
      'auditEvents',
      AuditEventSchema.parse({
        action: 'doctor.updated',
        entity: 'doctors',
        entityId: id,
        actor: actor.trim(),
        at: now,
        details: { name: value.name, referralPercent: value.referralPercent },
      }),
    );
    updated = { ...value, id } as DoctorRecord;
  });
  if (!updated) throw new Error('The doctor could not be updated.');
  return updated;
}

/** Delete only an unreferenced doctor; clinical history is never orphaned. */
export async function deleteDoctor(id: string, actor: string): Promise<void> {
  if (!actor.trim()) throw new Error('An operator identity is required.');
  const now = new Date().toISOString();
  await getRepository().transaction(async tx => {
    const current = await tx.get('doctors', id);
    if (!current) throw new Error('This doctor no longer exists.');
    const doctor = DoctorSchema.parse({ ...current.data(), id }) as DoctorRecord;
    const key = doctorNameKey(doctor.name);
    const patients = await tx.list('patients');
    const invoices = await tx.list('invoices');
    const referenced =
      patients.some(
        row =>
          row.data().doctorId === id ||
          (row.data().doctorId === undefined &&
            doctorNameKey(String(row.data().doctorName ?? '')) === key),
      ) ||
      invoices.some(row => {
        const referral = row.data().referral as
          { doctorId?: string; doctorName?: string } | undefined;
        return (
          referral?.doctorId === id ||
          (!referral?.doctorId && doctorNameKey(referral?.doctorName) === key)
        );
      });
    if (referenced)
      throw new Error(
        'This doctor has clinical or billing history and cannot be deleted. Edit the record instead.',
      );
    await tx.add(
      'auditEvents',
      AuditEventSchema.parse({
        action: 'doctor.deleted',
        entity: 'doctors',
        entityId: id,
        actor: actor.trim(),
        at: now,
        details: { name: doctor.name },
      }),
    );
    await tx.delete('doctors', id);
  });
}
