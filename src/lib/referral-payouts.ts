import { getRepository } from '../data';
import { generateId } from '../data/query';
import { getBillingPrefs } from './price-list';
import {
  AuditEventSchema,
  ReferralPayoutSchema,
  roundMoney,
  type DoctorRecord,
  type PaymentMode,
  type ReferralPayoutRecord,
} from './models';

export interface RecordReferralPayoutInput {
  doctor: Pick<DoctorRecord, 'id' | 'name'>;
  type: 'payout' | 'credit' | 'debit';
  amount: number;
  mode: PaymentMode;
  actor: string;
  at?: string;
  reference?: string;
  note?: string;
}

export async function recordReferralPayout(input: RecordReferralPayoutInput): Promise<ReferralPayoutRecord> {
  if (getBillingPrefs().referralCompliance?.mode !== 'payout-enabled') {
    throw new Error('Referral payouts are disabled. Record the owner/legal compliance acknowledgement in Settings → Manage Tests first.');
  }
  const amount = roundMoney(input.amount);
  if (!Number.isFinite(input.amount) || amount <= 0) throw new Error('Payout amount must be positive.');
  if (!input.actor.trim()) throw new Error('A payout requires an operator identity.');
  const repo = getRepository();
  const doctor = await repo.get('doctors', input.doctor.id);
  if (!doctor) throw new Error('Register this doctor before recording a payout.');
  const id = generateId();
  const value = ReferralPayoutSchema.parse({
    id,
    doctorId: input.doctor.id,
    doctorName: String(doctor.data().name ?? input.doctor.name),
    type: input.type,
    amount,
    mode: input.mode,
    actor: input.actor.trim(),
    at: input.at || new Date().toISOString(),
    reference: input.reference?.trim(),
    note: input.note?.trim(),
  });
  await repo.transaction(async tx => {
    await tx.set('referralPayouts', id, value);
    await tx.add('auditEvents', AuditEventSchema.parse({
      action: 'referral.payout_recorded',
      entity: 'referralPayouts',
      entityId: id,
      actor: input.actor.trim(),
      at: value.at,
      details: { doctorId: value.doctorId, type: value.type, amount: value.amount, mode: value.mode },
    }));
  });
  return { ...value, id };
}

export async function payoutsForDoctor(doctorId: string): Promise<ReferralPayoutRecord[]> {
  const docs = await getRepository().list('referralPayouts', {
    where: [{ field: 'doctorId', op: '==', value: doctorId }],
  });
  return docs
    .map(doc => ({ ...ReferralPayoutSchema.parse({ id: doc.id, ...doc.data() }), id: doc.id }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Earned commission minus paid/adjusted amounts; negative means carry-forward credit. */
export function referralLedgerBalance(
  earned: number,
  entries: readonly Pick<ReferralPayoutRecord, 'type' | 'amount'>[],
): { paid: number; balance: number } {
  const paid = roundMoney(entries.reduce((sum, entry) => {
    if (entry.type === 'credit') return sum - entry.amount;
    return sum + entry.amount;
  }, 0));
  return { paid, balance: roundMoney(earned - paid) };
}
