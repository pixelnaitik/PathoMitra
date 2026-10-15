import { describe, expect, it, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  writes: [] as { path: string; id: string; data: Record<string, unknown> }[],
}));

vi.mock('../data/fs', () => ({
  db: {},
  collection: (_db: unknown, path: string) => ({ path }),
  doc: (_db: unknown, path: string, id: string) => ({ path, id }),
  query: (coll: { path: string }) => coll,
  orderBy: () => undefined,
  where: () => undefined,
  getDoc: async (ref: { path: string; id: string }) => {
    const found = store.documents.get(`${ref.path}/${ref.id}`);
    return { exists: () => found !== undefined, data: () => found ?? {} };
  },
  setDoc: async (ref: { path: string; id: string }, data: Record<string, unknown>) => {
    store.documents.set(`${ref.path}/${ref.id}`, data);
    store.writes.push({ path: ref.path, id: ref.id, data });
  },
  updateDoc: async (ref: { path: string; id: string }, patch: Record<string, unknown>) => {
    const key = `${ref.path}/${ref.id}`;
    store.documents.set(key, { ...(store.documents.get(key) ?? {}), ...patch });
  },
  deleteDoc: async (ref: { path: string; id: string }) => {
    store.documents.delete(`${ref.path}/${ref.id}`);
  },
  getDocs: async (q: { path: string }) => {
    const docs = [...store.documents.entries()]
      .filter(([key]) => key.startsWith(`${q.path}/`))
      .map(([key, data]) => ({ id: key.split('/').slice(1).join('/'), data: () => data }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  },
}));

vi.mock('./telemetry', () => ({ captureError: vi.fn() }));
vi.mock('./patient-registry', () => ({ patientMonthKey: () => '2610' }));

import {
  buildInvoiceDraft,
  raiseInvoice,
  recordPayment,
  voidInvoice,
  deleteInvoice,
  invoiceForReport,
  invoicesForPatient,
  summarise,
  balanceOf,
  billsWithUnpricedLines,
  type InvoiceDraft,
} from './invoices';
import {
  computeInvoiceTotals,
  isInvoiceOutstanding,
  isInvoiceSettled,
  readInvoice,
  roundMoney,
  toInvoiceDoc,
  toInvoicePaymentDoc,
  type InvoiceItem,
} from './models';
import { allocateInvoiceNo, byBillNumber, invoiceSequenceOf } from './invoice-registry';
import { priceKey, resetPriceListCache, upsertPrice } from './price-list';

const CBC = 'CBC (COMPLETE BLOOD COUNT)';
const CBC_MEMBERS = ['HB (HAEMOGLOBIN)', 'WHITE CELL COUNT(TC)', 'PLATELET COUNT'];

function item(name: string, price: number, kind: InvoiceItem['kind'] = 'test'): InvoiceItem {
  return {
    name,
    kind,
    detail: '',
    qty: 1,
    unitPrice: price,
    lineTotal: price,
    unpriced: false,
    covers: [],
  };
}

const PATIENT = {
  id: '26100001',
  name: 'Asha Rao',
  doctorName: 'DR N KUMAR',
  createdAt: '2026-10-05T09:00:00.000Z',
  testSelection: [CBC, ...CBC_MEMBERS],
};

beforeEach(() => {
  store.documents.clear();
  store.writes.length = 0;
  localStorage.clear();
  resetPriceListCache();
});

/* ------------------------------- arithmetic ------------------------------- */

describe('computeInvoiceTotals', () => {
  it('adds lines, applies the discount, then taxes the discounted base', () => {
    const totals = computeInvoiceTotals({
      items: [item('CRP', 500), item('HB (HAEMOGLOBIN)', 100)],
      discount: 100,
      taxPercent: 18,
    });
    expect(totals).toEqual({
      subtotal: 600,
      discount: 100,
      tax: 90,
      taxPercent: 18,
      taxableBase: 500,
      amount: 590,
    });
  });

  it('never lets a discount exceed the subtotal', () => {
    const totals = computeInvoiceTotals({ items: [item('CRP', 200)], discount: 5000 });
    expect(totals.discount).toBe(200);
    expect(totals.amount).toBe(0);
  });

  it('folds a negative adjustment line into the discount, not the subtotal', () => {
    const totals = computeInvoiceTotals({
      items: [item('CRP', 500), item('Waiver', -100, 'adjustment')],
    });
    expect(totals.subtotal).toBe(500);
    expect(totals.discount).toBe(100);
    expect(totals.amount).toBe(400);
  });

  it('clamps a hostile tax percent', () => {
    expect(computeInvoiceTotals({ items: [item('CRP', 100)], taxPercent: 5000 }).tax).toBe(100);
    expect(computeInvoiceTotals({ items: [item('CRP', 100)], taxPercent: -50 }).tax).toBe(0);
  });

  it('is zero-safe on an empty bill', () => {
    expect(computeInvoiceTotals({ items: [] })).toMatchObject({ subtotal: 0, amount: 0 });
  });

  it('rounds to paise instead of leaking float drift', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(computeInvoiceTotals({ items: [item('x', 0.1), item('y', 0.2)] }).subtotal).toBe(0.3);
  });
});

describe('invoice status helpers', () => {
  it('treats pending and partial as outstanding, paid and void as closed', () => {
    expect(isInvoiceOutstanding('pending')).toBe(true);
    expect(isInvoiceOutstanding('partial')).toBe(true);
    expect(isInvoiceOutstanding('paid')).toBe(false);
    expect(isInvoiceOutstanding('void')).toBe(false);
    expect(isInvoiceSettled('paid')).toBe(true);
    expect(isInvoiceSettled('partial')).toBe(false);
  });
});

describe('toInvoiceDoc', () => {
  it('derives the total from the lines rather than trusting a caller', () => {
    const doc = toInvoiceDoc({
      patientId: 'p1',
      patientName: 'Asha',
      items: [item('CRP', 500), item('HB (HAEMOGLOBIN)', 100)],
      discount: 100,
      taxPercent: 0,
    });
    expect(doc.amount).toBe(500);
    expect(doc.taxableBase).toBe(500);
  });

  it('keeps a bill written before line items readable', () => {
    const legacy = readInvoice('i1', {
      reportId: 'r1',
      patientId: 'p1',
      patientName: 'Old',
      amount: 350,
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(legacy).toMatchObject({ amount: 350, items: [], invoiceNo: '', paidAmount: 0 });
  });

  it('marks a malformed document as unusable rather than throwing', () => {
    const broken = readInvoice('i2', { amount: 'not-a-number' });
    expect(broken.amount).toBe(0);
  });

  it('caps a hostile amount at the schema bound', () => {
    const huge = readInvoice('i3', { amount: 1e12 });
    expect(huge.amount).toBe(0); // rejected → stubbed
  });
});

describe('toInvoicePaymentDoc', () => {
  it('settles a bill when the full amount arrives', () => {
    expect(toInvoicePaymentDoc({ amount: 500 }, 500, 'now', 'cash')).toMatchObject({
      status: 'paid',
      paidAmount: 500,
    });
  });

  it('marks a part payment as partial', () => {
    expect(toInvoicePaymentDoc({ amount: 500 }, 200, 'now', 'upi')).toMatchObject({
      status: 'partial',
      paidAmount: 200,
    });
  });

  it('never records more than the bill is worth', () => {
    expect(toInvoicePaymentDoc({ amount: 500 }, 900, 'now', 'cash').paidAmount).toBe(500);
  });

  it('returns a bill to pending on a zero payment', () => {
    expect(toInvoicePaymentDoc({ amount: 500 }, 0, 'now', 'cash').status).toBe('pending');
  });
});

/* ------------------------------ bill numbers ------------------------------ */

describe('allocateInvoiceNo', () => {
  it('is sequential within the month', async () => {
    expect(await allocateInvoiceNo()).toBe('IN2610-0001');
    expect(await allocateInvoiceNo()).toBe('IN2610-0002');
  });

  it('skips a number already taken by a stored bill', async () => {
    await allocateInvoiceNo();
    store.documents.set('invoices/IN2610-0002', {});
    expect(await allocateInvoiceNo()).toBe('IN2610-0003');
  });

  it('writes the counter after each allocation', async () => {
    await allocateInvoiceNo();
    expect(store.documents.get('meta/invoice-id-IN2610')).toMatchObject({ value: 1 });
  });

  it('gives up loudly rather than writing over an existing bill', async () => {
    for (let i = 1; i <= 100; i++) {
      store.documents.set(`invoices/IN2610-${String(i).padStart(4, '0')}`, {});
    }
    await expect(allocateInvoiceNo()).rejects.toThrow(/no bill was created/);
  });
});

describe('bill number parsing', () => {
  it('reads the sequence back out', () => {
    expect(invoiceSequenceOf('IN2610-0042')).toBe(42);
    expect(invoiceSequenceOf('legacy-doc-id')).toBeNull();
  });

  it('sorts newest month and highest number first', () => {
    expect(['IN2610-0001', 'IN2611-0002'].sort(byBillNumber)[0]).toBe('IN2611-0002');
    expect(byBillNumber('IN2610-0002', 'IN2610-0001')).toBeLessThan(0);
  });
});

/* -------------------------------- drafting -------------------------------- */

describe('buildInvoiceDraft', () => {
  it('prices an ordered panel as one line and absorbs its members', async () => {
    await upsertPrice({ name: CBC, price: 350, actor: 'a' });
    await upsertPrice({ name: 'HB (HAEMOGLOBIN)', price: 100, actor: 'a' });

    const draft = buildInvoiceDraft({ patient: PATIENT, issuedBy: 'a' });
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({ name: CBC, kind: 'panel', lineTotal: 350 });
    expect(draft.totals.amount).toBe(350);
  });

  it('stamps the referral commission at bill time', async () => {
    await upsertPrice({ name: CBC, price: 400, actor: 'a' });
    const draft = buildInvoiceDraft({
      patient: PATIENT,
      issuedBy: 'a',
      doctors: [
        {
          id: 'd1',
          name: 'DR N KUMAR',
          referralPercent: 50,
          active: true,
          createdAt: '',
        },
      ],
    });
    expect(draft.referral).toMatchObject({ doctorId: 'd1', percent: 50, commission: 200 });
  });

  it('computes commission on the discounted base, not the gross', async () => {
    await upsertPrice({ name: CBC, price: 400, actor: 'a' });
    const draft = buildInvoiceDraft({
      patient: PATIENT,
      issuedBy: 'a',
      discount: 100,
      doctors: [{ id: 'd1', name: 'DR N KUMAR', referralPercent: 50, active: true, createdAt: '' }],
    });
    expect(draft.totals.taxableBase).toBe(300);
    expect(draft.referral?.commission).toBe(150);
  });

  it('lists the unpriced names instead of charging them as zero', async () => {
    const draft = buildInvoiceDraft({ patient: PATIENT, issuedBy: 'a' });
    expect(draft.unpriced.length).toBeGreaterThan(0);
  });

  it('never allocates a bill number for a preview', () => {
    const draft: InvoiceDraft = buildInvoiceDraft({ patient: PATIENT, issuedBy: 'a' });
    expect(draft.invoiceNo).toBe('');
    expect(store.documents.has('meta/invoice-id-IN2610')).toBe(false);
  });
});

/* -------------------------------- raising --------------------------------- */

describe('raiseInvoice', () => {
  it('stores the bill under its own number and returns the record', async () => {
    await upsertPrice({ name: CBC, price: 350, actor: 'a' });
    const invoice = await raiseInvoice({ patient: PATIENT, issuedBy: 'Ashu' });

    expect(invoice.id).toBe(invoice.invoiceNo);
    expect(invoice.invoiceNo).toBe('IN2610-0001');
    expect(store.documents.has(`invoices/${invoice.invoiceNo}`)).toBe(true);
    expect(invoice).toMatchObject({ patientName: 'Asha Rao', amount: 350, status: 'pending' });
    expect(invoice.items[0]?.kind).toBe('panel');
  });

  it('refuses to create an empty bill', async () => {
    await expect(
      raiseInvoice({ patient: { ...PATIENT, testSelection: [] }, issuedBy: 'a' }),
    ).rejects.toThrow(/nothing to print/);
  });

  it('settles a bill paid in full at the counter', async () => {
    await upsertPrice({ name: CBC, price: 350, actor: 'a' });
    const invoice = await raiseInvoice({
      patient: PATIENT,
      issuedBy: 'a',
      paidAmount: 350,
      paymentMode: 'cash',
    });
    expect(invoice).toMatchObject({ status: 'paid', paidAmount: 350 });
  });

  it('marks a partly-paid bill as partial', async () => {
    await upsertPrice({ name: CBC, price: 400, actor: 'a' });
    const invoice = await raiseInvoice({ patient: PATIENT, issuedBy: 'a', paidAmount: 150 });
    expect(invoice.status).toBe('partial');
    expect(balanceOf(invoice)).toBe(250);
  });

  it('freezes the price so a later tariff edit cannot rewrite the bill', async () => {
    await upsertPrice({ name: CBC, price: 350, actor: 'a' });
    const invoice = await raiseInvoice({ patient: PATIENT, issuedBy: 'a' });
    await upsertPrice({ name: CBC, price: 999, actor: 'a' });

    const reread = readInvoice(invoice.id, store.documents.get(`invoices/${invoice.id}`));
    expect(reread.items[0]?.unitPrice).toBe(350);
    expect(reread.amount).toBe(350);
  });
});

/* ------------------------------- payments --------------------------------- */

describe('recordPayment', () => {
  async function raised() {
    await upsertPrice({ name: CBC, price: 500, actor: 'a' });
    return raiseInvoice({ patient: PATIENT, issuedBy: 'a' });
  }

  it('accumulates two part payments to settled', async () => {
    const invoice = await raised();
    const first = await recordPayment(invoice.id, { amount: 200, mode: 'cash' });
    expect(first.status).toBe('partial');
    const second = await recordPayment(invoice.id, { amount: 300, mode: 'upi' });
    expect(second).toMatchObject({ status: 'paid', paidAmount: 500, paymentMode: 'upi' });
  });

  it('clamps an overpayment to the bill value', async () => {
    const invoice = await raised();
    const paid = await recordPayment(invoice.id, { amount: 5000, mode: 'cash' });
    expect(paid.paidAmount).toBe(500);
  });

  it('refuses a payment against a voided bill', async () => {
    const invoice = await raised();
    await voidInvoice(invoice.id, 'wrong patient', 'a');
    await expect(recordPayment(invoice.id, { amount: 100, mode: 'cash' })).rejects.toThrow(
      /voided/,
    );
  });

  it('says so when the bill does not exist', async () => {
    await expect(recordPayment('IN9999-0001', { amount: 10, mode: 'cash' })).rejects.toThrow(
      /found/,
    );
  });
});

describe('voidInvoice', () => {
  it('requires a reason', async () => {
    await upsertPrice({ name: CBC, price: 500, actor: 'a' });
    const invoice = await raiseInvoice({ patient: PATIENT, issuedBy: 'a' });
    await expect(voidInvoice(invoice.id, '   ', 'a')).rejects.toThrow(/reason/);
  });

  it('keeps the document and marks it void', async () => {
    await upsertPrice({ name: CBC, price: 500, actor: 'a' });
    const invoice = await raiseInvoice({ patient: PATIENT, issuedBy: 'a' });
    const voided = await voidInvoice(invoice.id, 'raised for the wrong patient', 'a');
    expect(voided.status).toBe('void');
    expect(store.documents.has(`invoices/${invoice.id}`)).toBe(true);
  });
});

describe('deleteInvoice', () => {
  it('removes the record', async () => {
    await upsertPrice({ name: CBC, price: 500, actor: 'a' });
    const invoice = await raiseInvoice({ patient: PATIENT, issuedBy: 'a' });
    await deleteInvoice(invoice.id);
    expect(store.documents.has(`invoices/${invoice.id}`)).toBe(false);
  });
});

/* ------------------------------ lookups + sums ---------------------------- */

describe('invoiceForReport / invoicesForPatient', () => {
  it('links a bill raised for a report', async () => {
    await upsertPrice({ name: CBC, price: 500, actor: 'a' });
    const invoice = await raiseInvoice({ patient: PATIENT, reportId: 'r1', issuedBy: 'a' });
    expect((await invoiceForReport('r1'))?.id).toBe(invoice.id);
    expect(await invoiceForReport('')).toBeNull();
  });

  it('returns a patient’s bills newest first', async () => {
    await upsertPrice({ name: CBC, price: 500, actor: 'a' });
    const first = await raiseInvoice({ patient: PATIENT, issuedBy: 'a' });
    const second = await raiseInvoice({
      patient: PATIENT,
      issuedBy: 'a',
      at: '2026-11-01T00:00:00.000Z',
    });
    const list = await invoicesForPatient(PATIENT.id);
    expect(list.map(i => i.id)).toEqual([second.id, first.id]);
    expect(await invoicesForPatient('')).toEqual([]);
  });
});

describe('summarise', () => {
  it('splits billed, collected and outstanding and ignores voided bills', async () => {
    await upsertPrice({ name: CBC, price: 500, actor: 'a' });
    const paid = await raiseInvoice({ patient: PATIENT, issuedBy: 'a', paidAmount: 500 });
    const part = await raiseInvoice({
      patient: { ...PATIENT, id: 'p2' },
      issuedBy: 'a',
      paidAmount: 200,
    });
    const raised = await raiseInvoice({ patient: { ...PATIENT, id: 'p3' }, issuedBy: 'a' });
    // The returned record is the voided one — the bill the lab still holds.
    const cancelled = await voidInvoice(raised.id, 'duplicate', 'a');

    const bills = [paid, part, cancelled];
    const summary = summarise(bills);
    expect(summary.bills).toBe(2);
    expect(summary.billed).toBe(1000);
    expect(summary.collected).toBe(700);
    expect(summary.outstanding).toBe(300);
    expect(summary.unpaidBills).toBe(1);
  });

  it('counts the bills that printed an unpriced line', async () => {
    const silent = await raiseInvoice({ patient: PATIENT, issuedBy: 'a' });
    expect(billsWithUnpricedLines([silent])).toHaveLength(1);
    expect(billsWithUnpricedLines([])).toEqual([]);
  });

  it('is zero on nothing', () => {
    expect(summarise([])).toMatchObject({ bills: 0, billed: 0, outstanding: 0 });
  });
});

describe('balanceOf', () => {
  it('is the unpaid remainder', () => {
    expect(balanceOf({ amount: 500, paidAmount: 200, status: 'partial' })).toBe(300);
  });

  it('is zero once settled, and zero for a void', () => {
    expect(balanceOf({ amount: 500, paidAmount: 500, status: 'paid' })).toBe(0);
    expect(balanceOf({ amount: 500, paidAmount: 0, status: 'void' })).toBe(0);
  });

  it('never goes negative on a stored overpayment', () => {
    expect(balanceOf({ amount: 500, paidAmount: 900, status: 'paid' })).toBe(0);
  });
});

describe('price list key stability', () => {
  it('prices the same test under a different typing', async () => {
    await upsertPrice({ name: 'H.D.L.', price: 900, actor: 'a' });
    const draft = buildInvoiceDraft({
      patient: { ...PATIENT, testSelection: ['hdl'] },
      issuedBy: 'a',
    });
    expect(draft.items[0]).toMatchObject({ lineTotal: 900, unpriced: false });
    expect(store.documents.has(`meta/${priceKey('HDL')}`)).toBe(false);
  });
});
