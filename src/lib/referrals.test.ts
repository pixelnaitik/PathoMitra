import { describe, expect, it, vi } from 'vitest';

vi.mock('./telemetry', () => ({ captureError: vi.fn() }));

import {
  buildDoctorStatements,
  commissionFor,
  currentMonthKey,
  monthKey,
  monthLabel,
  referredTestCounts,
  resolveReferral,
  statementsSummary,
  unattributedBills,
} from './referrals';
import { readInvoice, toInvoiceDoc, type DoctorRecord, type InvoiceRecord } from './models';
import { doctorNameKey } from './doctor-registry';

const DOCTORS: DoctorRecord[] = [
  { id: 'd1', name: 'DR N KUMAR', phone: '', referralPercent: 50, active: true, createdAt: '' },
  { id: 'd2', name: 'Dr A. Rao', phone: '', referralPercent: 10, active: true, createdAt: '' },
];

function bill(overrides: Record<string, unknown> = {}): InvoiceRecord {
  const value = toInvoiceDoc({
    patientId: 'p1',
    patientName: 'Asha Rao',
    items: [
      {
        name: 'CBC (COMPLETE BLOOD COUNT)',
        kind: 'panel',
        detail: 'Blood',
        qty: 1,
        unitPrice: 350,
        lineTotal: 350,
        unpriced: false,
        covers: [],
      },
    ],
    doctorName: 'DR N KUMAR',
    issuedBy: 'Ashu',
    createdAt: '2026-10-05T09:00:00.000Z',
    ...overrides,
  });
  return readInvoice(`IN2610-${String(overrides.seq ?? '0001').padStart(4, '0')}`, {
    ...value,
    invoiceNo: `IN2610-${String(overrides.seq ?? '0001').padStart(4, '0')}`,
  });
}

/** Stamp a referral the way the billing path would — keyed on the bill's own doctor. */
function withReferral(invoice: InvoiceRecord, percent: number): InvoiceRecord {
  const match = DOCTORS.find(
    doctor => doctorNameKey(doctor.name) === doctorNameKey(invoice.doctorName),
  );
  const value = {
    ...invoice,
    referral: {
      doctorName: match?.name ?? invoice.doctorName,
      doctorKey: doctorNameKey(invoice.doctorName),
      doctorId: match?.id ?? '',
      percent,
      commission: Math.round(invoice.taxableBase * percent) / 100,
      unmatched: !match,
    },
  };
  return readInvoice(invoice.id, value);
}

describe('monthKey / monthLabel', () => {
  it('buckets an ISO stamp into its local YYYY-MM', () => {
    expect(monthKey('2026-10-31T23:30:00')).toBe('2026-10');
    expect(monthKey('2026-11-01T00:30:00')).toBe('2026-11');
  });

  it('returns empty for a stamp it cannot read, rather than guessing a month', () => {
    expect(monthKey('not a date')).toBe('');
    expect(monthKey(undefined)).toBe('');
  });

  it('labels a month the way a printed statement reads', () => {
    expect(monthLabel('2026-10')).toContain('2026');
    expect(monthLabel('garbage')).toBe('garbage');
  });

  it('defaults to the running month', () => {
    expect(currentMonthKey(new Date('2026-10-15T00:00:00'))).toBe('2026-10');
  });
});

describe('resolveReferral', () => {
  it('matches a register entry through the folded name', () => {
    const referral = resolveReferral('Dr. N Kumar', DOCTORS);
    expect(referral).toMatchObject({
      doctorKey: 'DR N KUMAR',
      doctorId: 'd1',
      percent: 50,
      unmatched: false,
    });
  });

  it('keeps the register spelling, not the counter typing', () => {
    expect(resolveReferral('dr n kumar', DOCTORS)?.doctorName).toBe('DR N KUMAR');
  });

  it('records an unregistered referrer instead of dropping it', () => {
    const referral = resolveReferral('DR UNKNOWN', DOCTORS);
    expect(referral).toMatchObject({ doctorId: '', percent: 0, unmatched: true });
  });

  it('uses the lab default only for an unregistered name', () => {
    const referral = resolveReferral('DR UNKNOWN', DOCTORS, {
      taxPercent: 0,
      defaultReferralPercent: 5,
      currency: '₹',
      roundToRupee: true,
    });
    expect(referral?.percent).toBe(5);
    expect(resolveReferral('Dr. N Kumar', DOCTORS)?.percent).toBe(50);
  });

  it('returns nothing when no referrer was recorded', () => {
    expect(resolveReferral('', DOCTORS)).toBeUndefined();
    expect(resolveReferral(undefined, DOCTORS)).toBeUndefined();
    expect(resolveReferral('   ...  ', DOCTORS)).toBeUndefined();
  });
});

describe('commissionFor', () => {
  it('pays on the discounted base, not the gross', () => {
    const invoice = { amount: 1000, taxableBase: 800, referral: { percent: 50 } as never };
    expect(commissionFor(invoice)).toMatchObject({ commission: 400, base: 800, percent: 50 });
  });

  it('falls back to the bill amount for a legacy document and flags it', () => {
    const legacy = { amount: 1000, taxableBase: 0, referral: undefined };
    expect(commissionFor(legacy, 20)).toMatchObject({
      commission: 200,
      base: 1000,
      percent: 20,
      estimated: true,
    });
  });

  it('pays nothing at 0% and clamps a hostile rate', () => {
    expect(
      commissionFor({ amount: 500, taxableBase: 500, referral: undefined }, 0).commission,
    ).toBe(0);
    expect(
      commissionFor({ amount: 500, taxableBase: 500, referral: { percent: 5000 } as never })
        .percent,
    ).toBe(100);
  });
});

describe('buildDoctorStatements', () => {
  it('groups one doctor across every spelling of their name', () => {
    const invoices = [
      bill({ seq: '0001', doctorName: 'DR N KUMAR' }),
      bill({ seq: '0002', doctorName: 'Dr. n kumar', patientId: 'p2', patientName: 'Ravi' }),
      bill({ seq: '0003', doctorName: 'DR  N.KUMAR', patientId: 'p3', patientName: 'Suni' }),
    ].map(invoice => withReferral(invoice, 50));

    const statements = buildDoctorStatements(invoices, [], { month: '2026-10', doctors: DOCTORS });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({ doctorKey: 'DR N KUMAR', doctorName: 'DR N KUMAR' });
    expect(statements[0].totals.bills).toBe(3);
    expect(statements[0].totals.patients).toBe(3);
    expect(statements[0].totals.commission).toBe(525); // 175 × 3
  });

  it('keeps a degree-suffixed name distinct, as the register rule intends', () => {
    // doctor-registry deliberately does NOT strip qualifications: two
    // practitioners can share a name, and merging their money books is worse
    // than showing one doctor's referrals under two spellings.
    const invoices = [
      bill({ seq: '0001', doctorName: 'DR N KUMAR' }),
      bill({ seq: '0002', doctorName: 'DR N KUMAR MBBS', patientId: 'p2', patientName: 'Ravi' }),
    ].map(invoice => withReferral(invoice, 50));
    const statements = buildDoctorStatements(invoices, [], { month: '2026-10', doctors: DOCTORS });
    expect(statements).toHaveLength(2);
  });

  it('carries the tests, the date and the reference the lab asked to see', () => {
    const statement = buildDoctorStatements([withReferral(bill(), 50)], [], {
      month: '2026-10',
      doctors: DOCTORS,
    })[0];
    const line = statement.lines[0];
    expect(line).toMatchObject({
      invoiceNo: 'IN2610-0001',
      patientName: 'Asha Rao',
      percent: 50,
      commission: 175,
      billAmount: 350,
    });
    expect(line.tests).toEqual(['CBC (COMPLETE BLOOD COUNT)']);
    expect(line.month).toBe('2026-10');
  });

  it('excludes bills from another month', () => {
    const invoices = [
      bill({ seq: '0001', createdAt: '2026-09-30T09:00:00.000Z' }),
      bill({ seq: '0002' }),
    ].map(invoice => withReferral(invoice, 50));
    const [statement] = buildDoctorStatements(invoices, [], { month: '2026-10', doctors: DOCTORS });
    expect(statement.totals.bills).toBe(1);
  });

  it('excludes a voided bill from the payout', () => {
    const invoices = [
      withReferral(bill(), 50),
      withReferral(bill({ seq: '0002', status: 'void' }), 50),
    ];
    const [statement] = buildDoctorStatements(invoices, [], { month: '2026-10', doctors: DOCTORS });
    expect(statement.totals.bills).toBe(1);
    expect(statement.totals.commission).toBe(175);
  });

  it('omits a bill with no referrer at all', () => {
    const [statement] = buildDoctorStatements(
      [bill({ doctorName: '' })],
      [{ id: 'p1', name: 'Asha Rao' }],
      { month: '2026-10', doctors: DOCTORS },
    );
    expect(statement).toBeUndefined();
  });

  it('separates two doctors', () => {
    const invoices = [
      withReferral(bill({ seq: '0001', doctorName: 'DR N KUMAR' }), 50),
      readInvoice('IN2610-0002', {
        ...toInvoiceDoc({
          patientId: 'p2',
          patientName: 'Ravi',
          items: [
            {
              name: 'CRP',
              kind: 'test',
              detail: '',
              qty: 1,
              unitPrice: 500,
              lineTotal: 500,
              unpriced: false,
              covers: [],
            },
          ],
          doctorName: 'Dr A. Rao',
          createdAt: '2026-10-06T09:00:00.000Z',
        }),
        referral: {
          doctorName: 'Dr A. Rao',
          doctorKey: 'DR A RAO',
          doctorId: 'd2',
          percent: 10,
          commission: 50,
          unmatched: false,
        },
      }),
    ];
    const statements = buildDoctorStatements(invoices, [], { month: '2026-10', doctors: DOCTORS });
    expect(statements.map(s => s.doctorKey).sort()).toEqual(['DR A RAO', 'DR N KUMAR']);
    expect(statements.find(s => s.doctorKey === 'DR N KUMAR')?.totals.commission).toBe(175);
    expect(statements.find(s => s.doctorKey === 'DR A RAO')?.totals.commission).toBe(50);
  });

  it('flags an unregistered referrer so month end cannot lose them', () => {
    const invoices = [
      readInvoice('IN2610-0009', {
        ...toInvoiceDoc({
          patientId: 'p9',
          patientName: 'Ganesh',
          items: [
            {
              name: 'CRP',
              kind: 'test',
              detail: '',
              qty: 1,
              unitPrice: 200,
              lineTotal: 200,
              unpriced: false,
              covers: [],
            },
          ],
          doctorName: 'DR UNKNOWN',
          createdAt: '2026-10-07T09:00:00.000Z',
        }),
        referral: {
          doctorName: 'DR UNKNOWN',
          doctorKey: 'DR UNKNOWN',
          doctorId: '',
          percent: 0,
          commission: 0,
          unmatched: true,
        },
      }),
    ];
    const [statement] = buildDoctorStatements(invoices, [], { month: '2026-10', doctors: DOCTORS });
    expect(statement.unmatched).toBe(true);
    expect(statement.doctorName).toBe('DR UNKNOWN');
  });

  it('reports the commission on uncollected bills as pending, not payable', () => {
    const unpaid = withReferral(bill({ paidAmount: 0 }), 50);
    const [statement] = buildDoctorStatements([unpaid], [], { month: '2026-10', doctors: DOCTORS });
    expect(statement.totals.collected).toBe(0);
    expect(statement.totals.commissionPending).toBe(175);
  });

  it('falls back to the patient record for a bill predating referral stamps', () => {
    const legacy = readInvoice('IN2610-0020', {
      ...toInvoiceDoc({
        patientId: 'p20',
        patientName: 'Meena',
        items: [
          {
            name: 'CRP',
            kind: 'test',
            detail: '',
            qty: 1,
            unitPrice: 400,
            lineTotal: 400,
            unpriced: false,
            covers: [],
          },
        ],
        createdAt: '2026-10-08T09:00:00.000Z',
      }),
      doctorName: '',
    });
    const patients = [{ id: 'p20', name: 'Meena', doctorName: 'DR N KUMAR' }];
    const [statement] = buildDoctorStatements([legacy], patients, {
      month: '2026-10',
      doctors: DOCTORS,
    });
    expect(statement.doctorKey).toBe('DR N KUMAR');
    expect(statement.totals.commission).toBe(200); // 50% of 400
  });

  it('sorts the biggest payout first', () => {
    const big = readInvoice('IN2610-0030', {
      ...toInvoiceDoc({
        patientId: 'p30',
        patientName: 'Big',
        items: [
          {
            name: 'CRP',
            kind: 'test',
            detail: '',
            qty: 1,
            unitPrice: 9000,
            lineTotal: 9000,
            unpriced: false,
            covers: [],
          },
        ],
        doctorName: 'Dr A. Rao',
        createdAt: '2026-10-09T09:00:00.000Z',
      }),
      referral: {
        doctorName: 'Dr A. Rao',
        doctorKey: 'DR A RAO',
        doctorId: 'd2',
        percent: 10,
        commission: 900,
        unmatched: false,
      },
    });
    const statements = buildDoctorStatements([big, withReferral(bill(), 50)], [], {
      month: '2026-10',
      doctors: DOCTORS,
    });
    expect(statements[0].doctorKey).toBe('DR A RAO'); // 900 > 175
    expect(statements[0].totals.commission).toBeGreaterThanOrEqual(statements[1].totals.commission);
  });
});

describe('buildDoctorStatements — custom day range', () => {
  // Noon UTC keeps each bill's *local* calendar day stable under any runner
  // timezone (offsets up to ±14 cannot push a noon stamp across a day edge),
  // so the range boundaries below are exercised without TZ flake.
  const at = (day: string) => `${day}T12:00:00.000Z`;
  const windowInvoices = [
    withReferral(bill({ seq: '0001', createdAt: at('2026-10-15') }), 50),
    withReferral(
      bill({ seq: '0002', patientId: 'p2', patientName: 'Ravi', createdAt: at('2026-10-01') }),
      50,
    ),
    withReferral(
      bill({ seq: '0003', patientId: 'p3', patientName: 'Suni', createdAt: at('2026-10-25') }),
      50,
    ),
  ];

  it('keeps only bills whose raised date falls inside the inclusive range', () => {
    const [statement] = buildDoctorStatements(windowInvoices, [], {
      from: '2026-10-10',
      to: '2026-10-20',
      doctors: DOCTORS,
    });
    expect(statement.totals.bills).toBe(1);
    expect(statement.lines.map(l => l.invoiceNo)).toEqual(['IN2610-0001']);
    expect(statement.totals.commission).toBe(175);
  });

  it('honours a half-open range (only `from`, or only `to`)', () => {
    const after = buildDoctorStatements(windowInvoices, [], {
      from: '2026-10-10',
      doctors: DOCTORS,
    });
    expect(after[0].totals.bills).toBe(2); // 15th and 25th
    const before = buildDoctorStatements(windowInvoices, [], {
      to: '2026-10-10',
      doctors: DOCTORS,
    });
    expect(before[0].totals.bills).toBe(1); // 1st
  });

  it('ANDs a month with a range when both are given', () => {
    const [statement] = buildDoctorStatements(windowInvoices, [], {
      month: '2026-10',
      from: '2026-10-10',
      to: '2026-10-20',
      doctors: DOCTORS,
    });
    expect(statement.totals.bills).toBe(1);
    // A range inside October but a November month filter matches nothing.
    const none = buildDoctorStatements(windowInvoices, [], {
      month: '2026-11',
      from: '2026-10-10',
      to: '2026-10-20',
      doctors: DOCTORS,
    });
    expect(none).toHaveLength(0);
  });

  it('drops an undated bill when a range is applied', () => {
    // `toInvoiceDoc` stamps a missing date with "now", so an empty date is
    // forced at the read boundary — a bill the range can never place.
    const undated = readInvoice('IN2610-0004', {
      ...toInvoiceDoc({
        patientId: 'p4',
        patientName: 'Undated',
        items: [
          {
            name: 'CBC (COMPLETE BLOOD COUNT)',
            kind: 'panel',
            detail: 'Blood',
            qty: 1,
            unitPrice: 350,
            lineTotal: 350,
            unpriced: false,
            covers: [],
          },
        ],
        doctorName: 'DR N KUMAR',
        issuedBy: 'Ashu',
      }),
      invoiceNo: 'IN2610-0004',
      referral: {
        doctorName: 'DR N KUMAR',
        doctorKey: 'DR N KUMAR',
        doctorId: 'd1',
        percent: 50,
        commission: 175,
        unmatched: false,
      },
      createdAt: '',
    });
    const statements = buildDoctorStatements([undated], [], {
      from: '2026-10-01',
      to: '2026-10-31',
      doctors: DOCTORS,
    });
    expect(statements).toHaveLength(0);
  });

  it('leaves the no-range output unchanged', () => {
    const all = buildDoctorStatements(windowInvoices, [], { doctors: DOCTORS });
    expect(all[0].totals.bills).toBe(3);
  });
});

describe('statementsSummary', () => {
  it('rolls the register up without double-counting a patient across doctors', () => {
    const invoices = [
      withReferral(bill({ seq: '0001' }), 50),
      readInvoice('IN2610-0002', {
        ...toInvoiceDoc({
          patientId: 'p2',
          patientName: 'Ravi',
          items: [
            {
              name: 'CRP',
              kind: 'test',
              detail: '',
              qty: 1,
              unitPrice: 500,
              lineTotal: 500,
              unpriced: false,
              covers: [],
            },
          ],
          doctorName: 'Dr A. Rao',
          createdAt: '2026-10-06T09:00:00.000Z',
        }),
        referral: {
          doctorName: 'Dr A. Rao',
          doctorKey: 'DR A RAO',
          doctorId: 'd2',
          percent: 10,
          commission: 50,
          unmatched: false,
        },
      }),
    ];
    const summary = statementsSummary(buildDoctorStatements(invoices, [], { doctors: DOCTORS }));
    expect(summary).toMatchObject({ doctors: 2, bills: 2, billAmount: 850, commission: 225 });
    expect(summary.unmatchedDoctors).toBe(0);
  });

  it('is all zeros for an empty month', () => {
    expect(statementsSummary([])).toMatchObject({ doctors: 0, bills: 0, commission: 0 });
  });
});

describe('unattributedBills', () => {
  it('counts the bills no one is credited for', () => {
    const result = unattributedBills(
      [bill({ seq: '0001', doctorName: '' }), bill({ seq: '0002', doctorName: 'DR N KUMAR' })],
      { month: '2026-10', patients: [] },
    );
    expect(result).toEqual({ count: 1, amount: 350 });
  });

  it('treats a bill whose patient has a referrer as attributed', () => {
    const result = unattributedBills([bill({ doctorName: '' })], {
      month: '2026-10',
      patients: [{ id: 'p1', doctorName: 'DR N KUMAR' }],
    });
    expect(result.count).toBe(0);
  });
});

describe('referredTestCounts', () => {
  it('counts a test once per bill, across all doctors', () => {
    const invoices = [
      withReferral(bill({ seq: '0001' }), 50),
      withReferral(bill({ seq: '0002' }), 50),
    ];
    const counts = referredTestCounts(buildDoctorStatements(invoices, [], { doctors: DOCTORS }));
    expect(counts).toEqual([{ test: 'CBC (COMPLETE BLOOD COUNT)', bills: 2 }]);
  });
});
