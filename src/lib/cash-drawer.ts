import { getRepository } from '../data';
import { generateId } from '../data/query';
import { AuditEventSchema, PaymentLedgerSchema, roundMoney } from './models';

const SHIFT_PREFIX = 'cash-shift:';

export interface CashShift {
  version: 1;
  id: string;
  status: 'open' | 'closed';
  openingFloat: number;
  openedAt: string;
  openedBy: string;
  closedAt?: string;
  closedBy?: string;
  countedCash?: number;
  expectedCash?: number;
  difference?: number;
}

function parseShift(id: string, raw: Record<string, unknown>): CashShift | null {
  if (raw.version !== 1 || raw.id !== id) return null;
  if (raw.status !== 'open' && raw.status !== 'closed') return null;
  const openingFloat = Number(raw.openingFloat);
  if (!Number.isFinite(openingFloat) || openingFloat < 0) return null;
  return {
    version: 1,
    id,
    status: raw.status,
    openingFloat: roundMoney(openingFloat),
    openedAt: String(raw.openedAt ?? ''),
    openedBy: String(raw.openedBy ?? ''),
    ...(typeof raw.closedAt === 'string' ? { closedAt: raw.closedAt } : {}),
    ...(typeof raw.closedBy === 'string' ? { closedBy: raw.closedBy } : {}),
    ...(typeof raw.countedCash === 'number' ? { countedCash: raw.countedCash } : {}),
    ...(typeof raw.expectedCash === 'number' ? { expectedCash: raw.expectedCash } : {}),
    ...(typeof raw.difference === 'number' ? { difference: raw.difference } : {}),
  };
}

export async function openCashShift(openingFloat: number, actor: string): Promise<CashShift> {
  if (!Number.isFinite(openingFloat) || openingFloat < 0) throw new Error('Opening float must be non-negative.');
  if (!actor.trim()) throw new Error('A cash shift requires an operator identity.');
  const repo = getRepository();
  const active = await repo.list('meta', { where: [{ field: 'status', op: '==', value: 'open' }] });
  const openShift = active.map(doc => parseShift(doc.id, doc.data())).find(shift => shift?.id.startsWith(SHIFT_PREFIX));
  if (openShift) throw new Error('A cash drawer shift is already open. Close it before opening another.');
  const id = `${SHIFT_PREFIX}${generateId()}`;
  const shift: CashShift = {
    version: 1,
    id,
    status: 'open',
    openingFloat: roundMoney(openingFloat),
    openedAt: new Date().toISOString(),
    openedBy: actor.trim(),
  };
  await repo.set('meta', id, shift as unknown as Record<string, unknown>);
  return shift;
}

export async function getOpenCashShift(): Promise<CashShift | null> {
  const docs = await getRepository().list('meta', { where: [{ field: 'status', op: '==', value: 'open' }] });
  for (const doc of docs) {
    if (!doc.id.startsWith(SHIFT_PREFIX)) continue;
    const shift = parseShift(doc.id, doc.data());
    if (shift) return shift;
  }
  return null;
}

export async function closeCashShift(
  shiftId: string,
  countedCash: number,
  actor: string,
): Promise<CashShift> {
  if (!Number.isFinite(countedCash) || countedCash < 0) throw new Error('Counted cash must be non-negative.');
  if (!actor.trim()) throw new Error('Closing a cash shift requires an operator identity.');
  const repo = getRepository();
  let closed: CashShift | null = null;
  await repo.transaction(async tx => {
    const doc = await tx.get('meta', shiftId);
    const shift = doc ? parseShift(shiftId, doc.data()) : null;
    if (!shift) throw new Error('That cash shift could not be found.');
    if (shift.status !== 'open') throw new Error('That cash shift is already closed.');
    const entries = await tx.list('payments', {
      where: [
        { field: 'mode', op: '==', value: 'cash' },
        { field: 'at', op: '>=', value: shift.openedAt },
      ],
    });
    let cashMovement = 0;
    for (const entryDoc of entries) {
      const entry = PaymentLedgerSchema.parse({ id: entryDoc.id, ...entryDoc.data() });
      if (entry.type === 'payment') cashMovement += entry.amount;
      else if (entry.type === 'refund') cashMovement -= entry.amount;
      else if (entry.reversesType === 'payment') cashMovement -= entry.amount;
      else if (entry.reversesType === 'refund') cashMovement += entry.amount;
    }
    const expectedCash = roundMoney(shift.openingFloat + cashMovement);
    const at = new Date().toISOString();
    closed = {
      ...shift,
      status: 'closed',
      closedAt: at,
      closedBy: actor.trim(),
      countedCash: roundMoney(countedCash),
      expectedCash,
      difference: roundMoney(countedCash - expectedCash),
    };
    await tx.set('meta', shiftId, closed as unknown as Record<string, unknown>);
    await tx.add('auditEvents', AuditEventSchema.parse({
      action: 'cash.drawer_closed',
      entity: 'meta',
      entityId: shiftId,
      actor: actor.trim(),
      at,
      details: { expectedCash, countedCash: roundMoney(countedCash), difference: closed.difference },
    }));
  });
  if (!closed) throw new Error('The cash shift could not be closed.');
  return closed;
}
