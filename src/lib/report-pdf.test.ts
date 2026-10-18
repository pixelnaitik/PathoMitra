import { describe, it, expect, beforeAll, vi } from 'vitest';
import { buildReportDocument, buildReportModel, reportFilename } from './report-pdf';
import {
  resolveReportLayout,
  getColumnWidths,
  contentCenterMm,
  buildReportPalette,
  PAD_LAYOUT_PRESET,
} from './report-layout';
import { unprintableIn } from './pdf-text';
import { DEFAULT_SETTINGS } from './settings';
import { buildReportLegalLines } from './report-compliance';
import { contrastAgainstWhite } from './print-contrast';
import type { LabSettings } from './settings';
import type { PatientRecord, ReportRecord } from './models';

type DrawnText = { page: number; x: number; y: number; s: string };
type DrawnRule = { page: number; y: number; x1: number; x2: number };
type DrawnMark = { page: number; ink: string; x: number[]; y: number[] };

const drawnSink: {
  text: string[];
  texts: DrawnText[];
  rules: DrawnRule[];
  marks: DrawnMark[];
} = { text: [], texts: [], rules: [], marks: [] };

/**
 * Every string the document draws, captured for assertions.
 *
 * jsPDF v4 attaches its API to each *instance* (`text`, `line`, `rect` are own
 * properties, not prototype methods — verified against the installed build), so
 * patching `jsPDF.prototype.text` silently captures nothing. The module is mocked
 * with a subclass that wraps the instance's own methods after construction, which
 * is the only seam that sees what actually reached the page.
 *
 * `text` alone cannot check a layout decision: "no rule under each row", "both
 * arrows in one ink" and "the second sheet starts at the top" are all claims
 * about geometry, so `line`, `triangle` and `setFillColor` are wrapped too, each
 * stamped with the page it landed on.
 *
 * The sink is a module-level object rather than a global: `report-pdf` imports
 * jsPDF only inside `buildReportDocument()`, so the factory first runs at test
 * time — well after this file's top level has executed, and no temporal-dead-zone
 * hazard exists.
 */
const pushToSink = (content: unknown): void => {
  if (Array.isArray(content)) content.forEach(value => pushToSink(value));
  else if (typeof content === 'string') drawnSink.text.push(content);
};

vi.mock('jspdf', async () => {
  const actual = await vi.importActual<any>('jspdf');
  class InstrumentedJsPDF extends actual.jsPDF {
    constructor(...args: any[]) {
      super(...args);
      const page = () => (this as any).internal.getCurrentPageInfo().pageNumber as number;

      const originalText = (this as any).text.bind(this);
      (this as any).text = (content: any, x?: number, y?: number, ...rest: any[]) => {
        pushToSink(content);
        const first = Array.isArray(content) ? content[0] : content;
        if (typeof first === 'string' && typeof y === 'number' && typeof x === 'number') {
          drawnSink.texts.push({ page: page(), x, y, s: first });
        }
        return originalText(content, x, y, ...rest);
      };

      const originalLine = (this as any).line.bind(this);
      (this as any).line = (x1: number, y1: number, x2: number, y2: number, ...rest: any[]) => {
        // Horizontal strokes only — that is what a row rule is.
        if (typeof y1 === 'number' && typeof y2 === 'number' && Math.abs(y1 - y2) < 0.01) {
          drawnSink.rules.push({ page: page(), y: y1, x1, x2 });
        }
        return originalLine(x1, y1, x2, y2, ...rest);
      };

      let ink = '';
      const originalFill = (this as any).setFillColor.bind(this);
      (this as any).setFillColor = (...fillArgs: any[]) => {
        if (fillArgs.length >= 3 && fillArgs.slice(0, 3).every(v => typeof v === 'number')) {
          ink = fillArgs.slice(0, 3).join(',');
        }
        return originalFill(...fillArgs);
      };

      const originalTriangle = (this as any).triangle.bind(this);
      (this as any).triangle = (
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        x3: number,
        y3: number,
        ...rest: any[]
      ) => {
        // `triangle` is used by exactly one thing in the generator: the
        // out-of-range arrow beside a result.
        drawnSink.marks.push({ page: page(), ink, x: [x1, x2, x3], y: [y1, y2, y3] });
        return originalTriangle(x1, y1, x2, y2, x3, y3, ...rest);
      };
    }
  }
  return { ...actual, jsPDF: InstrumentedJsPDF };
});

const allText = (): string => drawnSink.text.join('\n');
const resetDrawn = (): void => {
  drawnSink.text.length = 0;
  drawnSink.texts.length = 0;
  drawnSink.rules.length = 0;
  drawnSink.marks.length = 0;
};

/** Horizontal rules drawn strictly between two baselines on one sheet. */
const rulesBetween = (page: number, fromY: number, toY: number): DrawnRule[] =>
  drawnSink.rules.filter(r => r.page === page && r.y > fromY && r.y < toY);

/** The 25 measurable members of CBC: the group's list minus its two headings. */
const CBC_MEMBERS = [
  'WHITE CELL COUNT(TC)',
  'NEUTROPHIL',
  'LYMPHOCYTE',
  'EOSINOPHIL',
  'MONOCYTE',
  'BASOPHIL',
  'ABSOLUTE NEUTROPHIL COUNT',
  'ABSOLUTE LYMPHOCYTE COUNT',
  'ABSOLUTE MONOCYTE COUNT',
  'ABSOLUTE EOSINOPHILL COUNT',
  'ABSOLUTE BASOPHIL COUNT',
  'RBC (RED BLOOD CELLS)',
  'HB (HAEMOGLOBIN)',
  'HCT(PCV)',
  'MCV',
  'MCH',
  'MCHC',
  'RDW%',
  'RDW-SD',
  'PLATELET COUNT',
  'MPV',
  'PDW',
  'PCT',
  'P-LCC',
  'P-LCR',
];

const urinePatient: PatientRecord = {
  id: 'patient-abcdef12345',
  name: 'Asha Ramesh',
  age: 41,
  gender: 'female',
  phone: '9876543210',
  doctorName: 'Dr Mehta',
  address: 'Pune',
  createdAt: '2026-10-01T09:00:00.000Z',
};

const cbcResults = Object.fromEntries(CBC_MEMBERS.map((name, i) => [name, String(10 + (i % 9))]));

const report = (patch: Partial<ReportRecord> = {}): ReportRecord =>
  ({
    id: 'report-uuid-123456',
    patientId: urinePatient.id,
    patientName: urinePatient.name,
    resultData: cbcResults,
    testSelection: ['CBC (COMPLETE BLOOD COUNT)', ...CBC_MEMBERS],
    status: 'final',
    version: 1,
    signature: 'Dr Naitik Raj',
    createdBy: 'Dr Naitik Raj',
    createdAt: '2026-10-15T09:30:00.000Z',
    updatedAt: '2026-10-15T09:30:00.000Z',
    ...patch,
  }) as ReportRecord;

const withSettings = (patch: Partial<LabSettings>): LabSettings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
});

const legal = () => buildReportLegalLines({});

describe('CBC fits on one sheet', () => {
  beforeAll(() => {
    resetDrawn();
  });

  it('prints 25 measurement rows and nothing else out of the panel', async () => {
    const result = await buildReportDocument({
      report: report(),
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    expect(result.printedRows).toBe(25);
    // The two catalogue headings CBC lists as members take no value and must not
    // appear as blank lines — the behaviour round AM-2 aligned the counts to.
    expect(result.sections).toBe(1);
  });

  it('resolves to a single page at the recommended settings', async () => {
    const result = await buildReportDocument({
      report: report(),
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    expect(result.pageCount).toBe(1);
  });

  it('reports the compaction only when it actually reached one page', async () => {
    const cramped = await buildReportDocument({
      report: report(),
      patient: urinePatient,
      settings: withSettings({ ...PAD_LAYOUT_PRESET, reportFitToOnePage: false }),
      legal: legal(),
    });
    expect(cramped.compacted).toBe(false);

    const fitted = await buildReportDocument({
      report: report(),
      patient: urinePatient,
      settings: withSettings(PAD_LAYOUT_PRESET),
      legal: legal(),
    });
    // On the pad margins the ladder is allowed to fire; if it fires it must win.
    if (fitted.compacted) expect(fitted.pageCount).toBe(1);
    else expect(fitted.pageCount).toBeLessThanOrEqual(cramped.pageCount);
  });

  it('does not force a second sheet when only small panels are ordered', async () => {
    const mixed = report({
      testSelection: ['URINE ROUTINE', 'PROTEIN', 'SUGAR', 'PUS CELLS', 'S. creatinine'],
      resultData: {
        PROTEIN: 'TRACE',
        SUGAR: 'NEGATIVE',
        'PUS CELLS': '2-4',
        'S. creatinine': '0.9',
      },
    });
    const result = await buildReportDocument({
      report: mixed,
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    // The old generator called addPage() per category block, so this was two
    // pages minimum whatever the content. Only a *package* (see BIG_PANEL_ROWS)
    // is allowed to claim a sheet now.
    expect(result.pageCount).toBe(1);
    expect(result.sections).toBeGreaterThan(1);
  });
});

describe('document integrity', () => {
  it('prints the real status instead of the literal FINAL', async () => {
    resetDrawn();
    await buildReportDocument({
      report: report({ status: 'draft' }),
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    const text = allText();
    expect(text).toContain('DRAFT');
    expect(text).not.toContain('FINAL');
  });

  it('never claims verification it cannot provide', async () => {
    resetDrawn();
    await buildReportDocument({
      report: report(),
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    const text = allText();
    expect(text).not.toMatch(/signed/i);
    expect(text).not.toMatch(/verified by/i);
    expect(text).not.toMatch(/NABL|ISO 9001/);
  });

  it('shows an amendment on paper: version, reason, re-issue date', async () => {
    resetDrawn();
    await buildReportDocument({
      report: report({
        version: 2,
        amendReason: 'Platelet count repeated after sample clot observed.',
        updatedAt: '2026-10-17T11:00:00.000Z',
      }),
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    const text = allText();
    expect(text).toContain('AMENDED v2');
    expect(text).toContain('supersedes v1');
    expect(text).toContain('Platelet count repeated after sample clot observed.');
    // The original issue date must survive alongside the amendment, not be
    // relabelled as the report date.
    expect(text).toContain('Issued:');
    expect(text).toContain('Amended:');
  });

  it('marks a record that could not be validated at read time', async () => {
    resetDrawn();
    await buildReportDocument({
      report: report({ needsReview: true, status: 'draft' }),
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    expect(allText()).toContain('UNVERIFIED RECORD');
  });
});

describe('clinical content', () => {
  it('prints an em dash where a result is blank', async () => {
    resetDrawn();
    await buildReportDocument({
      report: report({ resultData: { ...cbcResults, MCV: '' } }),
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    expect(allText()).toContain('\u2014');
  });

  it('builds a four-column table and actually prints the reference range', async () => {
    resetDrawn();
    const built = await buildReportDocument({
      report: report(),
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    // Regression guard. A band row once pushed as a spread cell object made
    // autoTable read `body[0]`'s keys (content/colSpan/styles) as the column
    // list: three columns, and the reference-range column disappeared from every
    // report while the page still looked perfectly normal at a glance.
    const table = (built.doc as unknown as { lastAutoTable: { columns: unknown[] } }).lastAutoTable;
    expect(table.columns).toHaveLength(4);
    // Some interval in the 'a – b' form must reach the page.
    expect(allText()).toMatch(/\d+\.?\d* \u2013 \d+\.?\d*/);
  });

  it('prints no reference-interval footnote, marker or notes block', async () => {
    resetDrawn();
    // Age 8 has no paediatric band in the catalogue, so the adult interval is
    // applied. The sheet used to disclose that with a '*' / '†' on every affected
    // range plus a "REFERENCE INTERVAL NOTES" block under the table; the owner
    // removed both on 2026-10-17 after reviewing real pad sheets, because on the
    // form the markers read as part of the number (see `buildReportModel`). The
    // computation is still done and still tested in `pathology-tests.test.ts`, and
    // the composer can surface it — this asserts only that the paper does not.
    const child: PatientRecord = { ...urinePatient, age: 8, gender: 'male' };
    await buildReportDocument({
      report: report(),
      patient: child,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    const text = allText();
    expect(text).not.toMatch(
      /REFERENCE INTERVAL NOTES|adult range applied|awaiting laboratory verification/i,
    );
    // No interval reaches the page with a footnote marker glued to it.
    expect(text).not.toMatch(/\d[\d.]*\s*[*\u2020\u2021\u00A7]/);
  });

  it('keeps method out of the test-name column and prints it once', async () => {
    resetDrawn();
    await buildReportDocument({
      report: report({
        testSelection: ['T.S.H.', 'Total T3'],
        resultData: { 'T.S.H.': '2.1', 'Total T3': '1.4' },
      }),
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    // The old generator appended "\nMethod: CLIA" inside every row, doubling its
    // height. Methods are footnotes now.
    expect(allText()).not.toMatch(/^Method: /);
  });

  it('sanitises every drawn string to what a standard-14 font can encode', async () => {
    resetDrawn();
    await buildReportDocument({
      report: report({ patientName: 'राहुल शर्मा' }),
      patient: { ...urinePatient, name: 'राहुल शर्मा ₹500' },
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    const offenders = drawnSink.text.filter(text => unprintableIn(text) !== '');
    expect(offenders).toEqual([]);
  });
});

describe('layout model', () => {
  it('centres on the content box, never on the sheet mid-line', () => {
    const layout = resolveReportLayout(withSettings(PAD_LAYOUT_PRESET));
    const center = contentCenterMm(layout.margins.left, layout.printable.width);
    expect(center).not.toBe(105);
    expect(center).toBeCloseTo(8 + (210 - 8 - 15) / 2, 5);
  });

  it('gives the result column more room than the units column', () => {
    const [name, result, units, ref] = getColumnWidths(187);
    expect(result).toBeGreaterThan(units);
    expect(name + result + units + ref).toBeCloseTo(187, 5);
  });

  it('keeps every structural token above 3:1 against paper', () => {
    // WCAG 1.4.11 as a numeric gate: a separator lighter than this is absent on
    // paper, and the desktop path rasterises at 300 dpi where sub-pixel strokes
    // disappear entirely.
    const palette = buildReportPalette('#0a5ea6', 'modern');
    for (const token of ['HAIRLINE', 'BOX_BORDER', 'FRAME'] as const) {
      expect(contrastAgainstWhite(palette[token])).toBeGreaterThanOrEqual(3);
    }
    // The pad template keeps pure black rules by design.
    const legacy = buildReportPalette('#0a5ea6', 'blank');
    expect(legacy.HAIRLINE).toEqual([0, 0, 0]);
  });

  it('drops the pad artwork band only for labs that are not using a pad', () => {
    const pad = resolveReportLayout(withSettings(PAD_LAYOUT_PRESET));
    expect(pad.margins.top).toBe(50);
    const fresh = resolveReportLayout(DEFAULT_SETTINGS);
    expect(fresh.margins.top).toBeLessThan(20);
    expect(fresh.printable.height).toBeGreaterThan(pad.printable.height);
  });

  it('names the file by report identity, not by the patient', () => {
    expect(reportFilename(report())).toMatch(/^PathoMitra-\d{4}-\d{2}-\d{2}-\w{6}-v1\.pdf$/);
    expect(reportFilename(report({ version: 3 }))).toContain('-v3.pdf');
  });

  it('builds a model that ignores catalogue headings in any order', () => {
    const layout = resolveReportLayout(DEFAULT_SETTINGS);
    const model = buildReportModel(
      report({
        testSelection: ['DIFFERENTIAL COUNT WBC', 'CBC (COMPLETE BLOOD COUNT)', 'HB (HAEMOGLOBIN)'],
        resultData: { 'HB (HAEMOGLOBIN)': '13.9' },
      }),
      urinePatient,
      layout,
    );
    expect(model.printedRows).toBe(1);
    const flat = model.sections.flatMap(s => s.rows).map(r => r.name);
    expect(flat).not.toContain('DIFFERENTIAL COUNT WBC');
  });

  it('prints nothing that a WinAnsi font cannot draw, even from settings', async () => {
    resetDrawn();
    await buildReportDocument({
      report: report(),
      patient: urinePatient,
      settings: withSettings({
        labName: 'संजीवनी Diagnostics',
        address: '₹1 crore building, Near √2 Park',
      }),
      legal: legal(),
    });
    expect(allText()).toContain('Diagnostics');
    expect(allText()).toContain('Rs.');
    expect(unprintableIn(allText())).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Layout of the printed sheet: pad chrome, row rules, range markers
// ---------------------------------------------------------------------------

/**
 * The pre-printed-pad configuration: pad geometry (50/20/8/15) with the blank
 * template. This is what a lab that prints onto its own artworked forms uses,
 * and the case the sheet is judged on.
 */
const padSettings = (): LabSettings =>
  withSettings({
    ...PAD_LAYOUT_PRESET,
    reportTemplate: 'blank',
    shareTemplate: 'blank',
    reportFitToOnePage: false,
  });

/** CBC + urine: enough rows that the pad geometry cannot keep them on one sheet. */
const twoPanelReport = (): ReportRecord =>
  report({
    testSelection: [
      'CBC (COMPLETE BLOOD COUNT)',
      ...CBC_MEMBERS,
      'URINE ROUTINE',
      'PROTEIN',
      'SUGAR',
      'PUS CELLS',
      'RBC',
      'EPITHELIAL CELLS',
    ],
    resultData: {
      ...cbcResults,
      PROTEIN: 'TRACE',
      SUGAR: 'NEGATIVE',
      'PUS CELLS': '4-6',
      RBC: '0-1',
      'EPITHELIAL CELLS': '2-3',
    },
  });

/** One result above and one below its interval, so both arrows are drawn. */
const flaggedReport = (): ReportRecord =>
  report({
    testSelection: ['CBC (COMPLETE BLOOD COUNT)', 'WHITE CELL COUNT(TC)', 'NEUTROPHIL'],
    resultData: { 'WHITE CELL COUNT(TC)': '14.2', NEUTROPHIL: '18' },
  });

/**
 * The band the measurement rows occupy on a sheet, by baseline.
 *
 * Row names rather than fixed coordinates, because where a sheet's table ends is
 * exactly the thing a layout change moves: the pad keeps all 25 CBC rows on
 * page 1, while the modern masthead pushes the last few onto page 2.
 */
const rowBand = (page = 1): { top: number; bottom: number; rows: number } => {
  const ys = drawnSink.texts
    .filter(t => t.page === page && CBC_MEMBERS.includes(t.s))
    .map(t => t.y);
  expect(ys.length).toBeGreaterThan(5);
  return { top: Math.min(...ys), bottom: Math.max(...ys), rows: ys.length };
};

describe('out-of-range markers', () => {
  it('draws both directions in one ink at the smaller size', async () => {
    resetDrawn();
    await buildReportDocument({
      report: flaggedReport(),
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    expect(drawnSink.marks).toHaveLength(2);
    const inks = new Set(drawnSink.marks.map(m => m.ink));
    // The whole point: a high value and a low value are the same kind of mark.
    expect(inks).toHaveLength(1);
    const [r, g, b] = [...inks][0].split(',').map(Number);
    expect(Math.max(r, g, b)).toBeLessThanOrEqual(60); // dark ink, not a colour code
    for (const mark of drawnSink.marks) {
      // Head geometry, not the shaft: 1.3 × 1.5 mm, down from 1.6 × 1.8 mm.
      expect(Math.max(...mark.x) - Math.min(...mark.x)).toBeCloseTo(1.3, 1);
      expect(Math.max(...mark.y) - Math.min(...mark.y)).toBeCloseTo(1.5, 1);
    }
  });

  it('keeps one ink for both arrows on the pad template too', async () => {
    resetDrawn();
    await buildReportDocument({
      report: flaggedReport(),
      patient: urinePatient,
      settings: padSettings(),
      legal: legal(),
    });
    expect(drawnSink.marks).toHaveLength(2);
    expect(new Set(drawnSink.marks.map(m => m.ink))).toEqual(new Set(['0,0,0']));
  });
});

describe('pad template prints results only', () => {
  it('draws no rule under each test row', async () => {
    resetDrawn();
    await buildReportDocument({
      report: report(),
      patient: urinePatient,
      settings: padSettings(),
      legal: legal(),
    });
    const band = rowBand(1);
    // The pad form already carries its own ruling; a rule per row boxes every
    // value twice. Everything between the first and the last baseline is table.
    expect(rulesBetween(1, band.top, band.bottom)).toEqual([]);
  });

  it('prints no running header and no footer text on any sheet', async () => {
    resetDrawn();
    const built = await buildReportDocument({
      report: twoPanelReport(),
      patient: urinePatient,
      settings: padSettings(),
      legal: legal(),
    });
    // The assertion is only worth anything if there is a middle sheet and a last
    // one to check, and a first sheet whose footer used to carry the counter.
    expect(built.pageCount).toBeGreaterThanOrEqual(2);
    const text = allText();
    expect(text).not.toMatch(/Page \d+ of \d+/);
    expect(text).not.toContain('continued');
    expect(text).not.toMatch(/^ID /m);
    expect(text).not.toMatch(/^Report [0-9A-F]/m);
    // ...while the findings themselves still reach the page.
    expect(text).toContain('End of Report');
    expect(text).toMatch(/\d+\.?\d* \u2013 \d+\.?\d*/);
  });

  it('starts a continuation sheet at the height sheet 1 starts at', async () => {
    resetDrawn();
    await buildReportDocument({
      report: twoPanelReport(),
      patient: urinePatient,
      settings: padSettings(),
      legal: legal(),
    });
    const onPage2 = drawnSink.texts.filter(t => t.page === 2);
    expect(onPage2.length).toBeGreaterThan(0);
    const firstPerSheet = Array.from(new Set(drawnSink.texts.map(t => t.page))).map(page =>
      Math.min(...drawnSink.texts.filter(t => t.page === page).map(t => t.y)),
    );
    const [top1, top2] = firstPerSheet;
    // Sheet 1's first line is the one the owner approved: it clears the printed
    // masthead and the REPORT badge hanging below the ribbon. A pad is a stack of
    // identical forms, so no later sheet may print its first line ABOVE that —
    // the cursor starts at sheet 1's height, and the category band's own padding
    // then sets its text a little lower still.
    expect(top2).toBeGreaterThanOrEqual(top1 - 0.5);
    // …without drifting so far down that the top of the sheet goes to waste.
    expect(top2).toBeLessThan(top1 + 8);
    // Two regressions sit either side of that: the 2.8.1 build restarted at 12 mm
    // and printed on top of the address banner, and the 2.7.x build restarted at
    // page 1's table Y (~75 mm with the patient box and column titles paid) and
    // left the top half of the sheet empty.
    expect(top2).toBeGreaterThan(PAD_LAYOUT_PRESET.reportMarginTop - 5);
    expect(top2).toBeLessThan(PAD_LAYOUT_PRESET.reportMarginTop + 15);
  });

  it('keeps every sheet of a pad report clear of the artwork band', async () => {
    resetDrawn();
    // The owner's real sheet: a package plus the small tests after it, so the
    // report spans more than one pad form.
    const mixed = report({
      testSelection: [
        'CBC (COMPLETE BLOOD COUNT)',
        ...CBC_MEMBERS,
        'URINE ROUTINE',
        'PROTEIN',
        'SUGAR',
        'PUS CELLS',
        'EPITHELIAL CELLS',
        'S. Para Typhi "A(H)"',
        'ABO Typing',
      ],
      resultData: {
        ...cbcResults,
        PROTEIN: 'TRACE',
        SUGAR: 'NEGATIVE',
        'PUS CELLS': '4-6',
        'EPITHELIAL CELLS': '2-3',
        'S. Para Typhi "A(H)"': 'NEGATIVE',
        'ABO Typing': 'O',
      },
    });
    const built = await buildReportDocument({
      report: mixed,
      patient: urinePatient,
      settings: padSettings(),
      legal: legal(),
    });
    expect(built.pageCount).toBeGreaterThanOrEqual(2);
    // Nothing the generator draws may sit in the zone the lab's name, address
    // banner and contact line occupy — on any sheet, not only the first.
    const clear = PAD_LAYOUT_PRESET.reportMarginTop;
    const offenders = drawnSink.texts.filter(t => t.y < clear - 0.5);
    expect(offenders.map(o => `sheet ${o.page} y=${o.y.toFixed(1)} "${o.s}"`)).toEqual([]);
    // And no sheet's first line may sit closer to the paper edge than sheet 1's,
    // which is what keeps the hanging REPORT badge clear on all of them.
    const firstPerSheet = Array.from(new Set(drawnSink.texts.map(t => t.page))).map(page =>
      Math.min(...drawnSink.texts.filter(t => t.page === page).map(t => t.y)),
    );
    expect(firstPerSheet.length).toBeGreaterThanOrEqual(2);
    firstPerSheet.forEach((top, i) => {
      expect(top, `sheet ${i + 1}`).toBeGreaterThanOrEqual(firstPerSheet[0] - 0.5);
      expect(top, `sheet ${i + 1}`).toBeLessThan(firstPerSheet[0] + 8);
    });
  });

  it('prints no reference interval for a qualitative row that has none', async () => {
    resetDrawn();
    const widal = report({
      testSelection: ["S. typhi 'O'", 'Impression'],
      resultData: { "S. typhi 'O'": 'Negative', Impression: 'Negative' },
    });
    await buildReportDocument({
      report: widal,
      patient: urinePatient,
      settings: padSettings(),
      legal: legal(),
    });
    // `Impression` carries `{ text: '' }` — a conclusion, not a measurement. It
    // used to render "0 – 0", an interval of zero to zero, beside it.
    const text = allText();
    expect(text).toContain('Impression');
    expect(text).not.toMatch(/0\.?0? \u2013 0\.?0?/);
  });
});

describe('plain paper keeps its chrome', () => {
  it('keeps the running strip, the page counter and the row rules', async () => {
    resetDrawn();
    const built = await buildReportDocument({
      report: twoPanelReport(),
      patient: urinePatient,
      settings: withSettings({ ...PAD_LAYOUT_PRESET, reportFitToOnePage: false }),
      legal: legal(),
    });
    expect(built.pageCount).toBeGreaterThanOrEqual(2);
    const text = allText();
    expect(text).toMatch(new RegExp(`Page 1 of ${built.pageCount}`));
    expect(text).toContain('continued');
    // The lab's `Row separators: Lines` setting still means something here: a
    // rule between each pair of rows that fits on the first sheet.
    const band = rowBand(1);
    expect(rulesBetween(1, band.top, band.bottom)).toHaveLength(band.rows - 1);
  });
});

describe('result cell', () => {
  it('draws the range marker after the value it flags, never in front of it', async () => {
    resetDrawn();
    await buildReportDocument({
      report: flaggedReport(),
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    // '14.2' is above its interval, '18' below it. The marker's x used to be
    // derived from the left edge of the cell, which on a right-aligned number put
    // the arrow in front of the value — the owner's sheet read "↑ (H)   57".
    expect(drawnSink.marks).toHaveLength(2);
    /** Vertical middle of a drawn triangle, in mm. */
    const markMidY = (m: DrawnMark): number => (Math.min(...m.y) + Math.max(...m.y)) / 2;
    for (const value of ['14.2', '18']) {
      const drawn = drawnSink.texts.find(t => t.s === value);
      expect(drawn, value).toBeDefined();
      const near = drawnSink.marks.filter(m => Math.abs(markMidY(m) - drawn!.y) < 4);
      expect(near).toHaveLength(1);
      expect(Math.min(...near[0].x)).toBeGreaterThan(drawn!.x);
    }
  });

  it('marks an out-of-range value with bold and an arrow only — no (H) / (L) letter', async () => {
    resetDrawn();
    await buildReportDocument({
      report: flaggedReport(),
      patient: urinePatient,
      settings: padSettings(),
      legal: legal(),
    });
    expect(drawnSink.marks).toHaveLength(2);
    expect(allText()).not.toMatch(/\((H|L)\)/);
  });
});

describe('page units', () => {
  /** Which sheet a drawn string landed on. */
  const pageOf = (s: string): number | undefined => drawnSink.texts.find(t => t.s === s)?.page;

  it('gives a big package its own sheet and starts the rest on the next', async () => {
    resetDrawn();
    const built = await buildReportDocument({
      report: twoPanelReport(),
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    expect(built.pageCount).toBe(2);
    expect(pageOf('WHITE CELL COUNT(TC)')).toBe(1);
    expect(pageOf('P-LCR')).toBe(1);
    // The urine rows would have fitted under the CBC — the package rule is what
    // moves them, not a shortage of room. That is the behaviour change.
    expect(pageOf('PROTEIN')).toBe(2);
    expect(pageOf('EPITHELIAL CELLS')).toBe(2);
  });

  it('never lets the fit pass promise fewer sheets than the page units require', async () => {
    resetDrawn();
    const built = await buildReportDocument({
      report: twoPanelReport(),
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    // Two units: the CBC claims sheet 1, the small run claims sheet 2. The ladder
    // may shrink the type to reach that floor, but it can never go under it — this
    // is the number the composer's "prints as about N page(s)" now agrees with.
    expect(built.pageCount).toBe(2);
  });

  it('keeps several small sections together on one sheet', async () => {
    resetDrawn();
    const small = report({
      testSelection: ['S. Para Typhi "A(H)"', 'S. para Typhi "B(H)"', 'S. creatinine'],
      resultData: {
        'S. Para Typhi "A(H)"': 'NEGATIVE',
        'S. para Typhi "B(H)"': 'NEGATIVE',
        'S. creatinine': '0.9',
      },
    });
    const built = await buildReportDocument({
      report: small,
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    // Two sections, three rows, no package: serology and biochemistry share a
    // sheet rather than each claiming one.
    expect(built.sections).toBe(2);
    expect(built.pageCount).toBe(1);
    expect(pageOf('S. Para Typhi "A(H)"')).toBe(1);
    expect(pageOf('S. creatinine')).toBe(1);
  });

  it('leads with the package and collects every small test onto the sheet after it', async () => {
    resetDrawn();
    // Ordered so a small test sits on each side of the CBC. Grouping the smalls by
    // "the run between two packages" read the CBC as a wall and gave each half its
    // own sheet — three sheets for 27 rows of results (owner report, 2026-10-17).
    const straddled = report({
      testSelection: [
        'S. creatinine',
        'CBC (COMPLETE BLOOD COUNT)',
        ...CBC_MEMBERS,
        'S. Para Typhi "A(H)"',
      ],
      resultData: {
        ...cbcResults,
        'S. creatinine': '0.9',
        'S. Para Typhi "A(H)"': 'NEGATIVE',
      },
    });
    const built = await buildReportDocument({
      report: straddled,
      patient: urinePatient,
      settings: DEFAULT_SETTINGS,
      legal: legal(),
    });
    expect(built.sections).toBe(3);
    expect(built.pageCount).toBe(2);
    // The package comes first even though the creatinine was ordered before it...
    expect(pageOf('WHITE CELL COUNT(TC)')).toBe(1);
    // ...and both smalls land on the one sheet after it, flowing rather than each
    // being forced onto a fresh page of its own.
    expect(pageOf('S. creatinine')).toBe(2);
    expect(pageOf('S. Para Typhi "A(H)"')).toBe(2);
    expect(pageOf('BIO CHEMISTRY')).toBe(2);
    expect(pageOf('SEROLOGY')).toBe(2);
    // Nothing separates the two small sections but the band itself: no page break
    // is inserted between them, so the serology row sits under the biochemistry row.
    const creatinine = drawnSink.texts.find(t => t.s === 'S. creatinine');
    const typhi = drawnSink.texts.find(t => t.s === 'S. Para Typhi "A(H)"');
    expect(creatinine!.y).toBeLessThan(typhi!.y);
  });
});
