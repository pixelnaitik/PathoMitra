import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildNotifications,
  formatAge,
  formatAmount,
  hoursBetween,
  resolvePrefs,
  safeBannerFor,
  summarizeNotifications,
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationItem,
} from './notification-engine';
import type { InvoiceRecord, PatientRecord, ReportRecord } from './models';

/** Fixed clock so every threshold test is deterministic. */
const NOW = new Date('2026-03-15T12:00:00.000Z');

/** ISO for `hours` before the fixed clock. */
function ago(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function patient(overrides: Partial<PatientRecord> = {}): PatientRecord {
  return {
    id: 'p1',
    name: 'Asha Rao',
    age: 34,
    gender: 'female',
    createdAt: ago(30),
    testSelection: ['CBC', 'Lipid Profile'],
    ...overrides,
  };
}

function report(overrides: Partial<ReportRecord> = {}): ReportRecord {
  return {
    id: 'r1',
    patientId: 'p1',
    patientName: 'Asha Rao',
    resultData: {},
    signature: 'b'.repeat(64),
    status: 'final',
    createdAt: ago(10),
    createdBy: 'uid-1',
    version: 1,
    ...overrides,
  };
}

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'i1',
    reportId: 'r1',
    patientId: 'p1',
    patientName: 'Asha Rao',
    amount: 1200,
    status: 'pending',
    createdAt: ago(24 * 10),
    invoiceNo: 'IN2610-0001',
    items: [],
    subtotal: 1200,
    discount: 0,
    tax: 0,
    taxPercent: 0,
    taxableBase: 1200,
    paidAmount: 0,
    doctorName: '',
    issuedBy: '',
    notes: '',
    ...overrides,
  };
}

/** Build items and pick the one category under test. */
function categoriesOf(items: NotificationItem[]): Set<string> {
  return new Set(items.map(item => item.category));
}

describe('hoursBetween', () => {
  it('measures elapsed hours against the supplied clock', () => {
    expect(hoursBetween(ago(6), NOW)).toBeCloseTo(6);
  });

  it('returns null for a missing or unparseable timestamp', () => {
    expect(hoursBetween(undefined, NOW)).toBeNull();
    expect(hoursBetween('', NOW)).toBeNull();
    expect(hoursBetween('not-a-date', NOW)).toBeNull();
  });

  it('returns a negative age for a future-dated record rather than hiding it', () => {
    expect(hoursBetween(ago(-2), NOW)).toBeCloseTo(-2);
  });
});

describe('resolvePrefs', () => {
  it('falls back to every default when nothing is stored', () => {
    expect(resolvePrefs()).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it('fills a partial channel object from the defaults', () => {
    expect(resolvePrefs({ channels: {} }).channels).toEqual(DEFAULT_NOTIFICATION_PREFS.channels);
    expect(resolvePrefs({ channels: { desktop: true } }).channels.desktop).toBe(true);
  });

  it('keeps default thresholds when only categories are overridden', () => {
    const prefs = resolvePrefs({ categories: { due: false } as never });
    expect(prefs.categories.due).toBe(false);
    expect(prefs.categories.overdue).toBe(true);
    expect(prefs.dueDays).toBe(7);
  });
});

describe('buildNotifications — awaiting reports', () => {
  it('alerts when a patient with collected tests has no report yet', () => {
    const items = buildNotifications({
      patients: [patient()],
      reports: [],
      invoices: [],
      now: NOW,
    });
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe('overdue');
    expect(items[0].id).toBe('overdue:p1');
    // Deep link starts composing the missing report for that patient.
    expect(items[0].link).toEqual({ tab: 'reports', param: { key: 'patient', value: 'p1' } });
  });

  it('escalates to critical once twice the threshold has passed', () => {
    const build = (hours: number) =>
      buildNotifications({
        patients: [patient({ createdAt: ago(hours) })],
        reports: [],
        invoices: [],
        now: NOW,
      });
    expect(build(25)[0]?.severity).toBe('warning');
    expect(build(49)[0]?.severity).toBe('critical');
  });

  it('stays quiet inside the configured grace window', () => {
    expect(
      buildNotifications({
        patients: [patient({ createdAt: ago(5) })],
        reports: [],
        invoices: [],
        now: NOW,
      }),
    ).toHaveLength(0);
  });

  it('honours a custom threshold', () => {
    const items = buildNotifications({
      patients: [patient({ createdAt: ago(6) })],
      reports: [],
      invoices: [],
      prefs: { overdueHours: 4 },
      now: NOW,
    });
    expect(items[0]?.category).toBe('overdue');
  });

  it('ignores walk-in registrations with no tests selected', () => {
    expect(
      categoriesOf(
        buildNotifications({
          patients: [patient({ testSelection: [] })],
          reports: [],
          invoices: [],
          now: NOW,
        }),
      ).has('overdue'),
    ).toBe(false);
  });

  it('says nothing once any report exists for the patient', () => {
    expect(
      categoriesOf(
        buildNotifications({
          patients: [patient()],
          reports: [report({ status: 'draft' })],
          invoices: [],
          now: NOW,
        }),
      ).has('overdue'),
    ).toBe(false);
  });

  it('drops a patient whose createdAt cannot be parsed', () => {
    expect(
      buildNotifications({
        patients: [patient({ createdAt: 'garbage' })],
        reports: [],
        invoices: [],
        now: NOW,
      }),
    ).toHaveLength(0);
  });
});

describe('buildNotifications — drafts', () => {
  it('flags a draft that has not been issued', () => {
    const items = buildNotifications({
      patients: [],
      reports: [report({ status: 'draft', patientId: '', createdAt: ago(30) })],
      invoices: [],
      now: NOW,
    });
    expect(items[0]?.category).toBe('draft');
    // Honest wording: this build has no patient-facing surface and no signing
    // service, so a draft alert must not promise a visibility or a signature that
    // cannot exist (see lib/report-compliance).
    expect(items[0]?.body).toContain('It stays in the lab until the report is issued.');
    expect(items[0]?.body).not.toMatch(/invisible to the patient|signed/i);
  });

  it('judges a draft by its last edit, not by when it was created', () => {
    const items = buildNotifications({
      patients: [],
      reports: [report({ status: 'draft', patientId: '', createdAt: ago(200), updatedAt: ago(2) })],
      invoices: [],
      now: NOW,
    });
    expect(items).toHaveLength(0);
  });

  it('never flags a finalized report as a draft', () => {
    expect(
      categoriesOf(
        buildNotifications({
          patients: [],
          reports: [report({ status: 'final', createdAt: ago(200) })],
          invoices: [],
          now: NOW,
        }),
      ).has('draft'),
    ).toBe(false);
  });
});

describe('buildNotifications — amendments', () => {
  it('surfaces a versioned-up issued report as informational', () => {
    const items = buildNotifications({
      patients: [],
      reports: [report({ version: 2, updatedAt: ago(5), amendReason: 'Transcription error' })],
      invoices: [],
      now: NOW,
    });
    expect(items[0]?.category).toBe('amended');
    expect(items[0]?.severity).toBe('info');
    expect(items[0]?.body).toContain('Transcription error');
  });

  it('loudens when the same report has been amended more than once', () => {
    const items = buildNotifications({
      patients: [],
      reports: [report({ version: 3, updatedAt: ago(5) })],
      invoices: [],
      now: NOW,
    });
    expect(items[0]?.severity).toBe('warning');
    expect(items[0]?.body).toContain('more than once');
  });

  it('stops reporting an amendment after it stops being news', () => {
    expect(
      categoriesOf(
        buildNotifications({
          patients: [],
          reports: [report({ version: 2, updatedAt: ago(24 * 10) })],
          invoices: [],
          now: NOW,
        }),
      ).has('amended'),
    ).toBe(false);
  });

  it('ignores version 1 reports', () => {
    expect(
      buildNotifications({
        patients: [],
        reports: [report({ version: 1, updatedAt: ago(2) })],
        invoices: [],
        now: NOW,
      }),
    ).toHaveLength(0);
  });
});

describe('buildNotifications — payments', () => {
  it('alerts on an invoice past its due window', () => {
    const items = buildNotifications({
      patients: [],
      reports: [],
      invoices: [invoice()],
      now: NOW,
    });
    expect(items[0]?.category).toBe('due');
    expect(items[0]?.title).toContain('₹1,200');
    expect(items[0]?.amount).toBe(1200);
  });

  it('caps payment alerts at warning, however old the dues are', () => {
    const items = buildNotifications({
      patients: [],
      reports: [],
      invoices: [invoice({ createdAt: ago(24 * 90) })],
      now: NOW,
    });
    expect(items[0]?.severity).toBe('warning');
  });

  it('says nothing about an invoice that is already paid', () => {
    expect(
      buildNotifications({
        patients: [],
        reports: [],
        invoices: [invoice({ status: 'paid' })],
        now: NOW,
      }),
    ).toHaveLength(0);
  });

  it('links a payment alert to the bills desk', () => {
    const items = buildNotifications({
      patients: [],
      reports: [],
      invoices: [invoice({ reportId: 'r9' })],
      now: NOW,
    });
    // Taking the payment happens on Bills, not inside the clinical report — the
    // alert should land the operator where the action is.
    expect(items[0]?.link).toEqual({ tab: 'bills' });
  });

  it('names the bill number in the alert body', () => {
    const items = buildNotifications({
      patients: [],
      reports: [],
      invoices: [invoice({ invoiceNo: 'IN2610-0042' })],
      now: NOW,
    });
    expect(items[0]?.body).toContain('IN2610-0042');
  });

  it('alerts on a part payment for only the balance still owed', () => {
    const items = buildNotifications({
      patients: [],
      reports: [],
      invoices: [invoice({ status: 'partial', paidAmount: 400 })],
      now: NOW,
    });
    expect(items[0]?.category).toBe('due');
    expect(items[0]?.amount).toBe(800);
    expect(items[0]?.title).toContain('₹800');
    expect(items[0]?.title).not.toContain('₹1,200');
  });

  it('says nothing once a bill is fully collected, whatever the status string', () => {
    expect(
      buildNotifications({
        patients: [],
        reports: [],
        invoices: [invoice({ status: 'paid', paidAmount: 1200 })],
        now: NOW,
      }),
    ).toHaveLength(0);
  });

  it('says nothing about a cancelled bill', () => {
    expect(
      buildNotifications({
        patients: [],
        reports: [],
        invoices: [invoice({ status: 'void' })],
        now: NOW,
      }),
    ).toHaveLength(0);
  });

  it('treats a fully-paid-in-advance bill as settled even if still marked partial', () => {
    // The balance guard is what stops the lab chasing money it already has.
    expect(
      buildNotifications({
        patients: [],
        reports: [],
        invoices: [invoice({ status: 'partial', paidAmount: 1200 })],
        now: NOW,
      }),
    ).toHaveLength(0);
  });
});

describe('buildNotifications — preferences and ordering', () => {
  it('respects a disabled category', () => {
    const items = buildNotifications({
      patients: [patient()],
      reports: [],
      invoices: [invoice()],
      prefs: { categories: { overdue: false, draft: true, amended: true, due: true } },
      now: NOW,
    });
    expect(categoriesOf(items).has('overdue')).toBe(false);
    expect(categoriesOf(items).has('due')).toBe(true);
  });

  it('sorts critical first, then warning, then info', () => {
    const items = buildNotifications({
      patients: [patient({ id: 'p9', createdAt: ago(100) })],
      reports: [report({ id: 'r2', patientId: 'p2', version: 2, updatedAt: ago(1) })],
      invoices: [invoice()],
      now: NOW,
    });
    expect(items.map(item => item.severity)).toEqual(['critical', 'warning', 'info']);
  });

  it('breaks severity ties by oldest record first', () => {
    const items = buildNotifications({
      patients: [
        patient({ id: 'a', createdAt: ago(30) }),
        patient({ id: 'b', createdAt: ago(40) }),
      ],
      reports: [],
      invoices: [],
      now: NOW,
    });
    expect(items.map(item => item.entityId)).toEqual(['b', 'a']);
  });

  it('produces nothing for an empty lab', () => {
    expect(buildNotifications({ patients: [], reports: [], invoices: [], now: NOW })).toEqual([]);
  });
});

/*
 * The lock-screen rule, pinned.
 *
 * `title` is for the in-app centre, where the operator has already unlocked the
 * device; `bannerTitle` is what goes to the Android notification shade, which is
 * legible on a locked screen, in a pocket, and to anyone standing at the bench.
 * `FLAG_SECURE` (Settings -> screenshot protection) does not cover the shade, so
 * the only thing keeping a patient's name off a locked phone is this field. A
 * future category that forgets it is a PHI disclosure, not a copy nit — hence an
 * entire describe block rather than a comment.
 */
describe('banner text is safe for a locked screen', () => {
  const PATIENT_NAME = 'Asha Rao';

  const everyCategory = buildNotifications({
    // p1 has no report at all, so it produces the `overdue` alert; the draft and
    // the amendment are pinned to other patients so all four categories appear at
    // once. Every one of them is about the patient named `PATIENT_NAME`.
    patients: [patient()],
    reports: [
      report({
        id: 'r1',
        patientId: 'p2',
        patientName: PATIENT_NAME,
        status: 'draft',
        updatedAt: ago(50),
      }),
      report({
        id: 'r2',
        patientId: 'p3',
        patientName: PATIENT_NAME,
        version: 2,
        updatedAt: ago(1),
      }),
    ],
    invoices: [invoice()],
    now: NOW,
  });

  it('has one for every alert the engine can produce', () => {
    expect(everyCategory.length).toBeGreaterThan(0);
    for (const item of everyCategory) {
      expect(item.bannerTitle, item.id).toBeTruthy();
    }
  });

  it('carries no patient name in the banner text', () => {
    for (const item of everyCategory) {
      expect(item.bannerTitle, `${item.id} bannerTitle`).not.toContain(PATIENT_NAME);
      expect(item.body, `${item.id} body`).not.toContain(PATIENT_NAME);
    }
  });

  it('keeps the name in the in-app title, where it belongs', () => {
    // The counter-assertion matters: the fix is "do not put the name in the OS
    // shade", not "never tell the operator who the alert is about". If somebody
    // strips names from `title` too, the alert list becomes a pile of numbers.
    const overdue = everyCategory.find(item => item.category === 'overdue');
    expect(overdue?.title).toContain(PATIENT_NAME);
    expect(overdue?.bannerTitle).not.toContain(PATIENT_NAME);
  });

  it('identifies the patient by record number instead', () => {
    const overdue = everyCategory.find(item => item.category === 'overdue');
    expect(overdue?.bannerTitle).toContain('p1');
  });

  it('ships a banner body with every alert, and keeps confidential detail out of it', () => {
    // Store review PR-07 / Microsoft Store Policies 10.9.3: a notification may not
    // carry "information a customer would reasonably consider to be confidential".
    // `body` is written for the unlocked in-app list and legitimately quotes the
    // operator's amendment reason and the money still owed — which is exactly why
    // the banner gets its own body instead of inheriting one.
    expect(everyCategory.length).toBeGreaterThan(0);
    for (const item of everyCategory) {
      expect(item.bannerBody, item.id).toBeTruthy();
      expect(item.bannerBody, `${item.id} bannerBody`).not.toContain(PATIENT_NAME);
      expect(item.bannerBody, `${item.id} bannerBody`).not.toMatch(/₹/);
      expect(item.bannerBody, `${item.id} bannerBody`).not.toMatch(/Reason:/);
    }
  });

  it('does not let an operator-typed amendment reason reach the shade', () => {
    // The dangerous case, constructed rather than hoped for: a lab that types the
    // patient's name into the free-text reason field must still not put it on a
    // lock screen. `amendReason` is unvalidated input by design.
    const [amended] = buildNotifications({
      patients: [patient()],
      reports: [
        report({
          id: 'r9',
          patientId: 'p4',
          patientName: PATIENT_NAME,
          version: 2,
          updatedAt: ago(2),
          amendReason: `${PATIENT_NAME} asked us to correct the spelling`,
        }),
      ],
      invoices: [],
      now: NOW,
    }).filter(item => item.category === 'amended');
    expect(amended).toBeDefined();
    expect(amended.body).toContain(PATIENT_NAME); // the in-app list shows it
    expect(amended.bannerBody).not.toContain(PATIENT_NAME);
    expect(amended.bannerTitle).not.toContain(PATIENT_NAME);
  });

  it('keeps the outstanding amount off the banner but not off the alert list', () => {
    const due = buildNotifications({
      patients: [patient()],
      reports: [],
      invoices: [invoice()],
      now: NOW,
    }).find(item => item.category === 'due');
    // Asserted, not guarded: an `if` here would pass silently the day the `due`
    // category stops firing for this fixture, and the leak it is watching for
    // would come back unnoticed.
    expect(due, 'the fixture must still produce a `due` alert').toBeDefined();
    expect(due?.title).toMatch(/₹/);
    expect(due?.bannerTitle).not.toMatch(/₹/);
    expect(due?.bannerBody).not.toMatch(/₹/);
  });
});

/*
 * The Windows / browser half of the same rule.
 *
 * Android can be told to hide banner text until the device is unlocked
 * (`visibility: 0` on the channel). Chromium cannot — `new Notification()` and
 * `showNotification()` post straight to a toast that Windows will happily render
 * on the lock screen, so the only control left is what the app puts in the text.
 * `bannerTitle` carries the registration number, which is pseudonymous but still
 * names a specific record to whoever is standing at the console; on a surface with
 * no privacy control that is the part that has to go.
 */
describe('safeBannerFor — a banner on a surface with no lock-screen control', () => {
  const PATIENT = 'Asha Rao';

  const everyCategory = buildNotifications({
    patients: [patient()],
    reports: [
      report({ id: 'r1', patientId: 'p2', patientName: PATIENT, status: 'draft', updatedAt: ago(50) }),
      report({ id: 'r2', patientId: 'p3', patientName: PATIENT, version: 2, updatedAt: ago(1) }),
    ],
    invoices: [invoice()],
    now: NOW,
  });

  it('covers every category the engine can emit', () => {
    const categories = new Set(everyCategory.map(item => item.category));
    expect(categories.size).toBe(4);
    for (const item of everyCategory) {
      expect(safeBannerFor(item).title, item.id).toBeTruthy();
    }
  });

  it('names no record — no id, no invoice number, no digit run', () => {
    for (const item of everyCategory) {
      const { title, body } = safeBannerFor(item);
      expect(title, `${item.id} generic title`).not.toMatch(/\d/);
      // Case-sensitive on purpose: with /i this matched the word "Invoice" itself
      // (IN + "voice"), which is the opposite of a finding. These are the shapes a
      // record number actually takes — patient id, report id, `IN2610-0042`.
      expect(title, `${item.id} generic title`).not.toMatch(/\b(p\d+|r\d+|IN\d{4}-\d{4})\b/);
      expect(title, `${item.id} generic title`).not.toContain(PATIENT);
      // The body is reused unchanged, so re-assert the guarantee here rather than
      // trusting the bannerBody test above to still exist.
      expect(body, `${item.id} generic body`).not.toContain(PATIENT);
      expect(body, `${item.id} generic body`).not.toMatch(/₹|Reason:/);
    }
  });

  it('still distinguishes the four alert kinds from each other', () => {
    // Stripping identifiers must not collapse every alert into "you have a
    // notification", or the desktop banner stops being actionable at all.
    const titles = new Set(everyCategory.map(item => safeBannerFor(item).title));
    expect(titles.size).toBe(4);
  });

  it('differs from the Android banner, which keeps the record number', () => {
    const overdue = everyCategory.find(item => item.category === 'overdue');
    expect(overdue?.bannerTitle).toContain('p1');
    expect(safeBannerFor(overdue!).title).not.toContain('p1');
  });

  it('is actually what the desktop and web banner path posts', () => {
    /*
     * A source-level guard, not a behaviour test, and deliberately so: there is no
     * hook test harness in this repo, and the failure being prevented is narrow
     * and structural — somebody routing every backend through `bannerTitle` again,
     * which silently un-fixes Windows while leaving all 50 engine tests green. The
     * same technique already polices the registration-sheet copy
     * (registration-copy.test.ts) and the marketing claims.
     */
    const hook = readFileSync(resolve(process.cwd(), 'src/hooks/useNotifications.ts'), 'utf8');
    expect(hook).toMatch(/safeBannerFor\(item\)/);
    expect(hook).toMatch(/pickBackend\(\) === 'native'/);
    // …and the generic pair is what reaches showBanner, not the identifier one.
    expect(hook).toMatch(/showBanner\(\{\s*key:\s*item\.id,\s*\.\.\.banner\s*\}\)/);
  });
});

describe('summarizeNotifications', () => {
  const items = buildNotifications({
    patients: [patient({ id: 'p9', createdAt: ago(100) })],
    reports: [report({ id: 'r2', patientId: 'p2', version: 2, updatedAt: ago(1) })],
    invoices: [invoice({ id: 'i1', amount: 500 }), invoice({ id: 'i2', amount: 700 })],
    now: NOW,
  });

  it('counts severities and totals outstanding dues', () => {
    const summary = summarizeNotifications(items);
    expect(summary.critical).toBe(1);
    expect(summary.dueAmount).toBe(1200);
    expect(summary.byCategory.due).toBe(2);
    expect(summary.total).toBe(items.length);
  });

  it('separates unread from already-handled alerts', () => {
    const read = items.map(item => ({ ...item, read: true }));
    expect(summarizeNotifications(items).unread).toBe(items.length);
    expect(summarizeNotifications(read).unread).toBe(0);
  });

  it('reports an all-clear cleanly for no alerts', () => {
    expect(summarizeNotifications([])).toMatchObject({
      total: 0,
      unread: 0,
      critical: 0,
      dueAmount: 0,
    });
  });
});

describe('formatters', () => {
  it('renders currency with Indian grouping', () => {
    expect(formatAmount(1200)).toBe('₹1,200');
    expect(formatAmount(123456)).toBe('₹1,23,456');
  });

  it('treats a non-finite amount as zero instead of printing NaN', () => {
    expect(formatAmount(Number.NaN)).toBe('₹0');
  });

  it('compacts an age to the smallest useful unit', () => {
    expect(formatAge(0.4)).toBe('<1h');
    expect(formatAge(5.2)).toBe('5h');
    expect(formatAge(30)).toBe('1d 6h');
    expect(formatAge(48)).toBe('2d');
  });
});
