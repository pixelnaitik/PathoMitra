/**
 * The report document builder — the only place a pathology report is drawn.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Until 2026-10-17 the document was built inside `ReportsPage.patient_report()`,
 * a closure in a 2,843-line React component that read `localStorage` through
 * `readSettings()`, touched the DOM for the share letterhead, and took `report:
 * any`. Nothing could assert anything about it: no test in the suite (44 files)
 * covered what actually lands on paper. The module that *parses the print
 * dialog's* page ranges is unit-tested (`print-model.test.ts`), and its header
 * says a wrong printout "is a clinical problem, not a UI problem" — while the
 * thing being printed was the least tested code in the path.
 *
 * So: this builder takes a plain, serializable input and returns a jsPDF
 * document plus what it decided. No `localStorage`, no DOM, no React. That is
 * what makes "a 25-parameter CBC fits on one sheet" a sentence a test can check.
 * It is also now the single implementation: `report-sample-pdf.ts` and the
 * Settings preview consume it, where previously the same geometry was
 * hand-copied three times and had already drifted (the sample drew literal
 * ↑/↓ glyphs that the standard-14 fonts cannot encode).
 *
 * WHAT CHANGED IN THE DOCUMENT ITSELF
 * -----------------------------------
 * Status integrity. The masthead printed the literal `FINAL` for every document
 * (`ReportsPage.tsx:904`), including a draft, while the status model in
 * `lib/report-status` had the right words sitting unused — its own comment said
 * it was designed to be "reused by the PDF pipeline later". It is now, through
 * `reportStatusView`. `version`, `amendReason` and `updatedAt` were never
 * printed at all, so an amended report came out of the printer indistinguishable
 * from the v1 the patient already held, down to the same "Reported on" date.
 *
 * Pagination. The full header (masthead + patient box + column titles) was
 * redrawn on every page, and every category block was forced onto a fresh sheet
 * (`if (!isFirstBlock) doc.addPage()`), so CBC + urine was two pages minimum
 * even when both fit. Now sections group into page units by *size*: a *test
 * package* (`BIG_PANEL_ROWS` in `report-layout`: a CBC, a full urine analysis)
 * prints first and claims a sheet to itself, and every smaller section is
 * collected into one trailing unit that runs straight on under the previous row —
 * Blood Sugar, then Widal, then whatever else — breaking only where the content
 * hits the bottom margin. A 12 mm running strip heads the continuation pages and
 * `rowPageBreak: 'avoid'` keeps a row from being sliced in half between sheets.
 * (Owner decision, 2026-10-17, same day as the package rule: the smalls were
 * being split across sheets by whichever big panel happened to sit between them.)
 *
 * Result typography (owner review of real sheets, 2026-10-17). Values are
 * left-aligned under RESULT, an out-of-range value is bold with its arrow drawn
 * immediately after it in one ink, and the reference interval carries no footnote
 * marker: the `REFERENCE INTERVAL NOTES` block and the `(H)` / `(L)` letters are
 * gone from the paper.
 *
 * Pad chrome (owner request, 2026-10-17). On the 'blank' template the sheet
 * arrives with the laboratory's own artwork on it, so the generator prints
 * nothing there that is not a result: no running strip on continuation pages, no
 * footer band (identity or page counter) on any page, and no rule under each
 * test row. It also stops inheriting page 1's clearance: autoTable parks the
 * cursor at `margin.top` after every `addPage()`, which was set to page 1's
 * `startY`, so a second sheet began ~85 mm below the strip drawn above it. The
 * other end of that over-correction is recorded in `continuationTopMm`: a pad is
 * a stack of identical forms, so a continuation sheet keeps the same top
 * clearance as page 1 rather than starting 12 mm from the paper edge. Plain
 * paper keeps the strip, the footer band and the row rules — there the document
 * *is* the artwork, and `Page 2 of 3` is the only thing that tells a lab a sheet
 * went missing in the tray.
 *
 * What is NOT claimed: jspdf-autotable v5 has no per-cell or per-row `pageBreak`
 * style (verified against the installed `index.d.ts` — only the table-level
 * `pageBreak` and `rowPageBreak` exist), so a section band can still land as the
 * last row on a page. Earlier drafts of this file said otherwise; the honest
 * mitigation is that the band is now *attached to the flow* rather than to a
 * forced sheet, which is the smaller of the two evils.
 *
 * Compaction used to be a guess — it fired only when `lastTestPage ===
 * totalPages - 1`, ran once, and could silently print 9.3 pt text against a
 * 10 pt setting. It is now a measured ladder that applies *only* when it
 * achieves one page, and never goes below the 8 pt floor the layout validator
 * already refuses to store.
 *
 * Perceptibility. Every structural line was a brand tint under 2:1 against
 * paper drawn at 0.1 mm — invisible at the 300 dpi the desktop path rasterises
 * at. The tokens now come from `lib/print-contrast` through the shared palette.
 *
 * Encoding. Data values go through `winAnsiSafe` (`lib/pdf-text`). The bill
 * already did; the clinical report did not, and jsPDF renders an undrawable code
 * point as two bytes of unrelated Latin, so a Devanagari patient name printed as
 * punctuation.
 */
import type { LabSettings } from './settings';
import type { PatientRecord, ReportRecord } from './models';
import { ageAsNumber } from './models';
import type { ReportLegalLines } from './report-compliance';
import { reportStatusView } from './report-status';
import { findTestInfo, resolveReferenceRange } from './pathology-tests';
import { winAnsiSafe } from './pdf-text';
import {
  A4,
  PT_TO_MM,
  RUNNING_HEADER_MM,
  SPACE,
  PRINT_HAIRLINE_MM,
  buildReportPalette,
  contentCenterMm,
  isBigPanel,
  reportTypeScale,
  resolveReportLayout,
  type ResolvedReportLayout,
  type ReportPalette,
} from './report-layout';
import { THEME_OPTIONS } from './theme';

type Rgb = [number, number, number];

/** The catalogue marks these two as headings, not measurements. */
const HEADING_NAMES = new Set(['DIFFERENTIAL COUNT WBC', 'DIFFERENTIAL LEUCOCYTE ABSOLUTE COUNT']);

/** Gray for DRAFT wording — 4.83:1 on paper, so it clears the body-text bar. */
const DRAFT_GRAY: Rgb = [107, 114, 128];

interface SectionRow {
  name: string;
  result: string;
  unit: string;
  refLabel: string;
  flag: 'up' | 'down' | null;
  /** A panel/sub-group row: printed as a band, carries no measurement. */
  isGroupRow: boolean;
}

interface Section {
  category: string;
  rows: SectionRow[];
}

interface ReportModel {
  sections: Section[];
  /** method → test names sharing it, printed once as a footnote. */
  methods: Map<string, string[]>;
  printedRows: number;
}

export interface ReportPdfInput {
  report: ReportRecord;
  /** Null when the report points at a patient document that no longer exists. */
  patient: PatientRecord | null;
  settings: LabSettings;
  mode?: 'print' | 'share';
  /**
   * The operator whose name may be printed as the issuer. Resolved by the caller
   * through `resolveSigner(report)` — never inferred here, because both the PDF
   * and the viewer used to fall back to whoever was at the keyboard, which puts
   * a colleague's report under the wrong name.
   */
  signerName?: string;
  /**
   * Legal lines from `lib/report-compliance`. The builder must not decide what
   * the laboratory claims about its own accreditation.
   */
  legal: ReportLegalLines;
  /** Share-mode full-bleed letterhead data URL, or '' for none. */
  shareTemplateImage?: string;
}

export interface ReportPdfResult {
  doc: import('jspdf').jsPDF;
  /** Real page count, after any fit-to-one-page pass. */
  pageCount: number;
  filename: string;
  /** Printed measurement rows, excluding section bands. */
  printedRows: number;
  /** True when the fit-to-page pass had to shrink the lab's own typography. */
  compacted: boolean;
  sections: number;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Filename carries the report's identity, never the patient's name. A name in
 * the path leaks into file browsers, the Windows index and every recent-documents
 * list; `<name>_lab_report.pdf` also let two same-named patients overwrite each
 * other and let a v2 silently replace a v1 that had already been handed over.
 */
export function reportFilename(report: ReportRecord): string {
  const version = Number(report.version) || 1;
  const raw = new Date(report.updatedAt || report.createdAt || new Date().toISOString());
  const day = Number.isNaN(raw.getTime())
    ? 'undated'
    : `${raw.getFullYear()}-${pad2(raw.getMonth() + 1)}-${pad2(raw.getDate())}`;
  return `PathoMitra-${day}-${String(report.id || 'draft').slice(-6)}-v${version}.pdf`;
}

/** '13.0 - 17.0' → '13.0 – 17.0'. The en dash is WinAnsi 0x96 and prints. */
const dashRange = (text: string): string => text.replace(/(\d)\s*-\s*(\d)/g, '$1 \u2013 $2');

const ink = (doc: any, c: readonly number[]) => doc.setTextColor(c[0], c[1], c[2]);
const stroke = (doc: any, c: readonly number[]) => doc.setDrawColor(c[0], c[1], c[2]);
const paint = (doc: any, c: readonly number[]) => doc.setFillColor(c[0], c[1], c[2]);

/** Date + time as the lab reads them, or '' — never 'Invalid Date' on paper. */
function formatStamp(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-IN').replace(/\//g, '-')} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

// --------------------------------------------------------------------------
// Row model
// --------------------------------------------------------------------------

/**
 * Build the printed model from the stored report.
 *
 * The two catalogue headings CBC lists as members are dropped: they take no
 * value, never appear in `resultData`, and printing them as blank rows is what
 * round AM-2 corrected the composer's count to agree with.
 */
export function buildReportModel(
  report: ReportRecord,
  patient: PatientRecord | null,
  layout: ResolvedReportLayout,
): ReportModel {
  const names: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const clean = (name ?? '').trim();
    if (!clean || HEADING_NAMES.has(clean) || seen.has(clean)) return;
    seen.add(clean);
    names.push(clean);
  };
  (report.testSelection || []).forEach(push);
  // A stored result for a test that is not in the selection still prints: it is
  // on the record, and hiding a value is worse than an ordering question.
  Object.keys(report.resultData || {}).forEach(push);

  const age = patient ? ageAsNumber(patient) : undefined;
  const gender = patient?.gender;
  const results = (report.resultData || {}) as Record<string, unknown>;
  const methods = new Map<string, string[]>();
  const categoryOf = (name: string) => findTestInfo(name)?.category || 'GENERAL';

  // Sections in print order. 'byCategory' merges a category's tests into one
  // band; 'ordered' keeps the order the lab ordered in and starts a new band
  // whenever the category changes, which is what a bench printout should read.
  const groups: { key: string; category: string; rows: SectionRow[] }[] = [];
  const appendRow = (category: string, row: SectionRow) => {
    const last = groups[groups.length - 1];
    // 'ordered' keeps the order the lab ordered in and opens a new band whenever
    // the category changes; 'byCategory' always merges into the same category's
    // group, which is collapsed again below.
    if (last && last.category === category) {
      last.rows.push(row);
      return;
    }
    groups.push({ key: `${category}#${groups.length}`, category, rows: [row] });
  };

  let printedRows = 0;
  names.forEach(name => {
    const info = findTestInfo(name);
    const category = categoryOf(name);
    const raw = results[name];
    const result = raw === undefined || raw === null ? '' : String(raw).trim();

    if (info?.isGroup || info?.isHeader) {
      appendRow(category, {
        name: winAnsiSafe(name),
        result: '',
        unit: '',
        refLabel: '',
        flag: null,
        isGroupRow: true,
      });
      return;
    }

    const range = resolveReferenceRange(info?.ranges, age, gender);
    let flag: 'up' | 'down' | null = null;
    if (result && range.values && Number.isFinite(Number(result))) {
      const value = Number(result);
      if (range.values.min !== undefined && value < range.values.min) flag = 'down';
      else if (range.values.max !== undefined && value > range.values.max) flag = 'up';
    }

    /*
     * `range.unverifiedForPatient` / `range.reason` are deliberately NOT printed.
     * They used to append a '*' / '†' to the interval and open a
     * "REFERENCE INTERVAL NOTES" block under the table; the owner removed both on
     * 2026-10-17 after reviewing real sheets, because on a pad form the markers
     * read as part of the number. The reason this is survivable is that the
     * computation still happens and is still tested: `resolveReferenceRange` keeps
     * returning the caveat, and `pathology-tests.test.ts` fails if a band goes
     * missing — so the composer can surface it even though the paper does not.
     */

    if (info?.method) {
      const list = methods.get(info.method) || [];
      if (!list.includes(name)) list.push(name);
      methods.set(info.method, list);
    }

    printedRows += 1;
    appendRow(category, {
      name: winAnsiSafe(name),
      result: winAnsiSafe(result),
      unit: winAnsiSafe(info?.unit || ''),
      refLabel: winAnsiSafe(dashRange(range.label)),
      flag,
      isGroupRow: false,
    });
  });

  // 'byCategory' collapses repeats of the same category into one band.
  const sections: Section[] = [];
  if (layout.sectionOrder === 'byCategory') {
    const byCat = new Map<string, SectionRow[]>();
    const order: string[] = [];
    groups.forEach(g => {
      const upper = g.category.toUpperCase();
      if (!byCat.has(upper)) {
        byCat.set(upper, []);
        order.push(upper);
      }
      byCat.get(upper)!.push(...g.rows);
    });
    order.forEach(category => sections.push({ category, rows: byCat.get(category)! }));
  } else {
    groups.forEach(g =>
      sections.push({ category: winAnsiSafe(g.category.toUpperCase()), rows: g.rows }),
    );
  }

  return {
    sections: sections.filter(s => s.rows.length > 0),
    methods,
    printedRows,
  };
}

// --------------------------------------------------------------------------
// Per-pass render parameters and the compaction ladder
// --------------------------------------------------------------------------

interface RenderParams {
  cellPadding: number;
  bodyFont: number;
  sectionGap: number;
  ptLineHeight: number;
  mTop: number;
  mBottom: number;
}

const paramsFrom = (layout: ResolvedReportLayout): RenderParams => ({
  cellPadding: layout.tableCellPaddingMm,
  bodyFont: layout.tableBodyFont,
  sectionGap: layout.sectionGapMm,
  ptLineHeight: layout.patientLineHeightMm,
  mTop: layout.margins.top,
  mBottom: layout.margins.bottom,
});

/**
 * Floors for the one-page ladder.
 *
 * `bodyFont: 8` is not a taste call — `report-layout-spec.validateLayoutSettings`
 * already refuses to *store* result text below 8 pt ("hard to read in print"), so
 * a compacted report can never be less legible than a report the lab could have
 * configured on purpose. The margin floors keep the sheet printable.
 */
const MIN_FLOORS = {
  cellPadding: 0.6,
  bodyFont: 8,
  sectionGap: 3,
  ptLineHeight: 4,
  mTop: 10,
  mBottom: 8,
} as const;

function shrinkOnce(p: RenderParams): RenderParams {
  const step = (v: number, floor: number) => Math.max(floor, Math.round(v * 0.9 * 100) / 100);
  return {
    cellPadding: step(p.cellPadding, MIN_FLOORS.cellPadding),
    bodyFont: step(p.bodyFont, MIN_FLOORS.bodyFont),
    sectionGap: step(p.sectionGap, MIN_FLOORS.sectionGap),
    ptLineHeight: step(p.ptLineHeight, MIN_FLOORS.ptLineHeight),
    mTop: step(p.mTop, MIN_FLOORS.mTop),
    mBottom: step(p.mBottom, MIN_FLOORS.mBottom),
  };
}

const sameParams = (a: RenderParams, b: RenderParams): boolean =>
  (Object.keys(a) as (keyof RenderParams)[]).every(k => a[k] === b[k]);

// --------------------------------------------------------------------------
// One rendering pass
// --------------------------------------------------------------------------

interface PassContext {
  doc: any;
  autoTable: (doc: any, options: any) => void;
  /**
   * Pages whose header has already been drawn during this pass. autoTable fires
   * `didDrawPage` for page 1 as well, and the manual tail break needs the same
   * bookkeeping, so both paths share one set.
   */
  drawnPages: Set<number>;
  input: ReportPdfInput;
  layout: ResolvedReportLayout;
  palette: ReportPalette;
  p: RenderParams;
  model: ReportModel;
  version: number;
  statusView: ReturnType<typeof reportStatusView>;
  /**
   * On the pad template: the Y of the first line sheet 1 actually prints, recorded
   * while that header was drawn. Continuation sheets start at the same height, so
   * the artwork's clearance is paid identically on every sheet whatever the margin,
   * the section gap or the compaction ladder decided this pass. Undefined until
   * `drawFullHeader` has run, and unused on plain paper.
   */
  padContentTopMm?: number;
}

/** Everything the page foot needs, drawn once per pass. */
function drawTail(ctx: PassContext, startY: number): number {
  const { doc, layout, palette, p, model, input, version } = ctx;
  const { report, signerName = '' } = input;
  const legacy = layout.template === 'blank';
  const mLeft = layout.margins.left;
  const right = A4.widthMm - layout.margins.right;
  const width = layout.printable.width;
  const limit = A4.heightMm - p.mBottom;
  let y = startY;

  const newPageIfNeeded = (needed: number) => {
    if (y + needed <= limit) return false;
    doc.addPage();
    y = startContinuationPage(ctx);
    return true;
  };

  /**
   * Wrapped footnote text. The generator used to print each catalogue note with
   * a bare `doc.text(note, ...)` and budget one line per note, so a long note on
   * a custom test ran off the right edge of the sheet and the page-break maths
   * under-counted it. Everything here goes through `splitTextToSize`.
   */
  const paragraph = (text: string, opts?: { bold?: boolean; gray?: boolean; indent?: number }) => {
    const indent = opts?.indent ?? 0;
    const lines = doc.splitTextToSize(winAnsiSafe(text), width - indent) as string[];
    const lineHeight = Math.max(
      3.2,
      (opts?.gray ? layout.notesFont : layout.notesFont) * PT_TO_MM * 1.2,
    );
    newPageIfNeeded(lines.length * lineHeight + 2);
    doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal');
    doc.setFontSize(layout.notesFont);
    ink(doc, opts?.gray ? palette.INK_SOFT : legacy ? palette.BLACK : palette.INK);
    doc.setCharSpace(0);
    lines.forEach(line => {
      doc.text(line, mLeft + indent, y);
      y += lineHeight;
    });
    return lines.length;
  };

  // Rule closing the results block.
  newPageIfNeeded(SPACE.md);
  stroke(doc, legacy ? palette.BLACK : palette.FRAME);
  doc.setLineWidth(PRINT_HAIRLINE_MM);
  doc.line(mLeft, y, right, y);
  y += SPACE.md;

  // ---- amendment record ----------------------------------------------------
  if (version > 1) {
    const reason = winAnsiSafe(report.amendReason || '');
    const head = `AMENDED REPORT v${version} \u2014 supersedes v${version - 1}`;
    const reissued = formatStamp(report.updatedAt || report.createdAt);
    newPageIfNeeded(SPACE.lg + 4);
    const boxTop = y - 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(Math.max(8, layout.notesFont));
    ink(doc, legacy ? palette.BLACK : palette.BRAND_DARK);
    doc.text(head, mLeft, y);
    y += 4;
    if (reissued) {
      doc.setFont('helvetica', 'normal');
      ink(doc, palette.INK_SOFT);
      doc.text(winAnsiSafe(`Re-issued ${reissued}`), mLeft, y);
      y += 4;
    }
    if (reason) paragraph(`Reason recorded by the laboratory: ${reason}`, { indent: 0 });
    else paragraph('No reason was recorded for this amendment.', { gray: true });
    stroke(doc, legacy ? palette.BLACK : palette.BOX_BORDER);
    doc.setLineWidth(PRINT_HAIRLINE_MM);
    doc.rect(mLeft - 3, boxTop, width + 6, y - boxTop + 2, 'S');
    y += SPACE.md;
  }

  // A record that could not be validated at read time must say so on paper:
  // `models.ts` forces such a document to draft specifically so it cannot print
  // as a validated final report.
  if (report.needsReview) {
    newPageIfNeeded(SPACE.md);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(Math.max(8, layout.notesFont));
    ink(doc, legacy ? palette.BLACK : [176, 42, 58]);
    doc.text('UNVERIFIED RECORD \u2014 re-verify before issuing or relying on it', mLeft, y);
    y += 4.4;
  }

  // ---- footnotes ------------------------------------------------------------
  // Reference-interval caveats are not printed any more (owner decision,
  // 2026-10-17 — see `buildReportModel`). Methods still are, and they still wrap.
  const footnoteStart = y;
  if (model.methods.size > 0) {
    model.methods.forEach((tests, method) => {
      paragraph(`Method ${winAnsiSafe(method)}: ${tests.map(t => winAnsiSafe(t)).join(', ')}`, {
        gray: true,
        indent: 0,
      });
    });
  }
  if (y > footnoteStart) y += SPACE.sm;

  // ---- signature area -------------------------------------------------------
  // Not the retired "Electronically signed by..." sentence (owner decision,
  // 2026-10-12) — a signature *rule* and the name of the operator who issued the
  // document, which is what a referring doctor expects to find and what the
  // record actually knows.
  if (layout.showSignatureArea && !legacy) {
    const name = winAnsiSafe(signerName || '');
    const blockHeight = SPACE.lg + 8;
    newPageIfNeeded(blockHeight);
    const lineY = y + SPACE.lg;
    stroke(doc, palette.BOX_BORDER);
    doc.setLineWidth(PRINT_HAIRLINE_MM);
    doc.line(mLeft, lineY, mLeft + 52, lineY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(Math.max(7.5, layout.footerFont - 2.5));
    ink(doc, palette.INK_SOFT);
    doc.text(name || 'Issuing operator', mLeft, lineY + 3.6);
    doc.text('Reported by / Signature', mLeft, lineY + 7.2);
    y = lineY + 9;
  }

  // ---- end of report --------------------------------------------------------
  newPageIfNeeded(SPACE.md);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(layout.footerFont);
  doc.setCharSpace(legacy ? 0 : 0.3);
  ink(doc, legacy ? palette.BLACK : palette.INK_SOFT);
  const center = contentCenterMm(mLeft, width);
  doc.text(legacy ? '*** End of Report ***' : '\u2014 End of Report \u2014', center, y, {
    align: 'center',
  });
  doc.setCharSpace(0);
  return y;
}

/** Masthead, patient block and column titles, on page 1 only. */
function drawFullHeader(ctx: PassContext): number {
  const { doc, layout, palette, p, input, version, statusView } = ctx;
  const { report, patient, settings, legal } = input;
  const legacy = layout.template === 'blank';
  const mLeft = layout.margins.left;
  const right = A4.widthMm - layout.margins.right;
  const width = layout.printable.width;
  const center = contentCenterMm(mLeft, width);
  const [c0, c1, c2] = layout.columns;
  const type = reportTypeScale(layout.titleFont);
  const isDraft = statusView.icon === 'draft';

  paintBackground(ctx);

  let y = p.mTop;

  if (legacy) {
    // 'blank' is the pre-printed-pad contract: the laboratory's own artwork
    // already carries the masthead, the footer and the ruling, so the document
    // prints none of it — and no identity block is added, because it would land
    // on top of artwork that is already on the paper.
    y += p.sectionGap;
  } else if (layout.template === 'classic') {
    stroke(doc, palette.BLACK);
    doc.setLineWidth(0.9);
    doc.line(mLeft - 5, y - 3, right + 5, y - 3);
    doc.setLineWidth(PRINT_HAIRLINE_MM);
    doc.line(mLeft - 5, y - 1.4, right + 5, y - 1.4);
    doc.setFont('times', 'bold');
    doc.setFontSize(type.masthead);
    ink(doc, palette.BLACK);
    doc.text(winAnsiSafe(labTitle(layout)), center, y + 5.5, { align: 'center' });
    doc.setFont('times', 'italic');
    doc.setFontSize(type.tagline);
    ink(doc, [60, 60, 60]);
    doc.text(winAnsiSafe(legal.tagline), center, y + 11, { align: 'center' });
    doc.setLineWidth(PRINT_HAIRLINE_MM);
    doc.line(mLeft - 5, y + 13.5, right + 5, y + 13.5);
    doc.setLineWidth(0.9);
    doc.line(mLeft - 5, y + 15.1, right + 5, y + 15.1);
    y += p.sectionGap * 2 + 9;
  } else if (layout.template === 'minimalist') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(type.wordmark - 3);
    ink(doc, palette.INK);
    doc.text(winAnsiSafe(labTitle(layout)), mLeft, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(type.descriptor);
    ink(doc, palette.INK_SOFT);
    doc.text('D I G I T A L   P A T H O L O G Y   R E P O R T', mLeft, y + 5);
    stroke(doc, palette.FRAME);
    doc.setLineWidth(PRINT_HAIRLINE_MM);
    doc.line(mLeft, y + 8.5, right, y + 8.5);
    y += p.sectionGap + 4;
  } else {
    // 'modern': logo (or drawn keystone), wordmark, descriptor, status, meta.
    let textX = mLeft + 4.6;
    if (layout.brandLogo) {
      try {
        doc.addImage(layout.brandLogo, 'PNG', mLeft, y - 5.5, 11, 11);
        textX = mLeft + 14.6;
      } catch (err) {
        // A logo that cannot be decoded must not take the report with it.
        console.error('report-pdf: brand logo could not be drawn, using keystone', err);
        paint(doc, palette.BRAND);
        doc.roundedRect(mLeft, y - 4.2, 1.7, 10.5, 0.85, 0.85, 'F');
      }
    } else {
      paint(doc, palette.BRAND);
      doc.roundedRect(mLeft, y - 4.2, 1.7, 10.5, 0.85, 0.85, 'F');
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(type.wordmark);
    ink(doc, palette.BRAND_DARK);
    doc.text(winAnsiSafe(labTitle(layout)), textX, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(type.descriptor);
    ink(doc, palette.INK_SOFT);
    doc.text('DIGITAL PATHOLOGY REPORT', textX, y + 5.2);

    doc.setFontSize(8);
    doc.text(
      winAnsiSafe(`Report No. ${(report.id || '').substring(0, 8).toUpperCase() || 'N/A'}`),
      right,
      y - 1,
      { align: 'right' },
    );
    doc.setFont('helvetica', 'bold');
    // The status word used to be the literal 'FINAL' for every document,
    // including drafts. It comes from the same model the on-screen pill uses
    // now, so paper and pixel cannot disagree.
    ink(doc, isDraft ? DRAFT_GRAY : palette.BRAND);
    doc.text(
      winAnsiSafe(version > 1 ? `AMENDED v${version}` : statusView.label.toUpperCase()),
      right,
      y + 5.2,
      { align: 'right' },
    );
    stroke(doc, palette.FRAME);
    doc.setLineWidth(PRINT_HAIRLINE_MM);
    doc.line(mLeft, y + 9, right, y + 9);

    if (layout.showLabIdentity) {
      const address = winAnsiSafe(settings.address || '');
      const contact = winAnsiSafe(
        [settings.phone, settings.email].filter(Boolean).join('  \u00b7  '),
      );
      const credential = winAnsiSafe(legal.accreditation || legal.licence || '');
      let iy = y + 13.2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      ink(doc, palette.INK_SOFT);
      for (const line of [address, contact, credential].filter(Boolean)) {
        doc.text(line, right, iy, { align: 'right', maxWidth: width * 0.52 });
        iy += 3.4;
      }
      if (iy > y + 13.2) y = iy - 4.2;
    }
    y += p.sectionGap * 1.5 + 6;
  }

  // ---- patient block --------------------------------------------------------
  const startY = y + 4;
  if (legacy) ctx.padContentTopMm = startY;
  const lh = p.ptLineHeight;
  const nameText = `: ${patient?.name || report.patientName || ''}`;
  const ptNameLines = doc.splitTextToSize(winAnsiSafe(nameText), width * (55 / 180)) as string[];
  const nameOffset = (ptNameLines.length - 1) * lh;
  const boxTop = startY - 12;
  const boxHeight = lh * 2 + nameOffset + 15;

  if (layout.template === 'modern') {
    paint(doc, palette.BRAND_TINT);
    stroke(doc, palette.BOX_BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(mLeft - 5, boxTop, width + 10, boxHeight, 2.6, 2.6, 'FD');
  } else if (layout.template === 'classic') {
    stroke(doc, palette.BLACK);
    doc.setLineWidth(0.5);
    doc.rect(mLeft - 5, boxTop, width + 10, boxHeight, 'S');
    doc.setLineWidth(0.15);
    doc.rect(mLeft - 3.8, boxTop + 1.2, width + 7.6, boxHeight - 2.4, 'S');
  } else if (layout.template === 'minimalist') {
    stroke(doc, palette.FRAME);
    doc.setLineWidth(PRINT_HAIRLINE_MM);
    doc.line(mLeft - 5, boxTop + boxHeight + 1, right + 5, boxTop + boxHeight + 1);
  }

  doc.setFontSize(layout.patientFont);
  const label = (text: string, x: number, yy: number) => {
    doc.setFont('helvetica', 'bold');
    ink(doc, legacy ? palette.BLACK : palette.INK_SOFT);
    doc.setCharSpace(legacy ? 0 : 0.25);
    doc.text(text, x, yy);
  };
  const value = (text: string, x: number, yy: number) => {
    doc.setFont('helvetica', 'normal');
    ink(doc, legacy ? palette.BLACK : palette.INK);
    doc.setCharSpace(0);
    doc.text(winAnsiSafe(text), x, yy);
  };

  const col2 = mLeft + 97;
  const rawGender = (patient?.gender || '').trim();
  const genderText = rawGender ? rawGender.charAt(0).toUpperCase() + rawGender.slice(1) : 'N/A';
  const ageText =
    patient?.age !== undefined && patient?.age !== null && String(patient.age) !== ''
      ? String(patient.age)
      : 'N/A';

  label('Patient Name', mLeft, startY);
  doc.setFont('helvetica', 'normal');
  ink(doc, legacy ? palette.BLACK : palette.INK);
  doc.setCharSpace(0);
  doc.text(ptNameLines, mLeft + 27, startY);
  label('Ref By', mLeft, startY + lh + nameOffset);
  value(`: ${patient?.doctorName || 'Self'}`, mLeft + 27, startY + lh + nameOffset);
  label('Patient ID', mLeft, startY + lh * 2 + nameOffset);
  value(
    `: ${patient?.id ? patient.id.substring(0, 8).toUpperCase() : 'N/A'}`,
    mLeft + 27,
    startY + lh * 2 + nameOffset,
  );

  label('Age', col2, startY);
  value(`: ${ageText} yrs`, col2 + 23, startY);
  label('Sex', col2, startY + lh + nameOffset);
  value(`: ${genderText}`, col2 + 23, startY + lh + nameOffset);
  const collected = formatStamp(report.createdAt);
  label('Collected', col2, startY + lh * 2 + nameOffset);
  value(`: ${collected || 'N/A'}`, col2 + 23, startY + lh * 2 + nameOffset);

  // Specimen: the catalogue already carries it, and a pathology result read
  // without its specimen asks the reader to guess. Printed only when every
  // ordered test agrees on one, so a mixed panel says nothing rather than wrong.
  const specimens = Array.from(
    new Set(
      (report.testSelection || [])
        .map(n => findTestInfo(n)?.specimen)
        .filter((s): s is string => Boolean(s)),
    ),
  );
  let lowest = startY + lh * 2 + nameOffset;
  if (specimens.length === 1) {
    lowest += lh;
    label('Specimen', col2, lowest);
    value(`: ${specimens[0]}`, col2 + 23, lowest);
  }

  // Issued / amended dates in the right third, which used to sit empty.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setCharSpace(0);
  ink(doc, palette.INK_SOFT);
  doc.text(winAnsiSafe(`Issued: ${collected || 'N/A'}`), right, startY, { align: 'right' });
  if (version > 1) {
    doc.setFont('helvetica', 'bold');
    ink(doc, palette.BRAND_DARK);
    doc.text(winAnsiSafe(`Amended: ${formatStamp(report.updatedAt) || 'N/A'}`), right, startY + 4, {
      align: 'right',
    });
  }

  // ---- column titles --------------------------------------------------------
  const headerY = Math.max(startY + lh * 3, lowest + lh) + p.sectionGap + 5;
  const titleColor = legacy ? palette.BLACK : palette.INK_SOFT;

  if (!legacy && layout.template !== 'classic') {
    if (layout.template === 'modern') {
      paint(doc, palette.BRAND_DARK);
      doc.roundedRect(mLeft - 5, headerY - 6.2, width + 10, 9.5, 1.6, 1.6, 'F');
      ink(doc, [255, 255, 255]);
    } else {
      stroke(doc, palette.FRAME);
      doc.setLineWidth(PRINT_HAIRLINE_MM);
      doc.line(mLeft, headerY - 5, right, headerY - 5);
      ink(doc, titleColor);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(layout.tableHeaderFont);
    doc.setCharSpace(0.4);
  } else {
    stroke(doc, palette.BLACK);
    doc.setLineWidth(0.5);
    doc.line(mLeft, headerY - 5, right, headerY - 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(layout.tableHeaderFont);
    doc.setCharSpace(0);
    ink(doc, palette.BLACK);
  }
  doc.text('TEST DESCRIPTION', mLeft + 1.5, headerY);
  doc.text('RESULT', mLeft + c0 + 1.5, headerY);
  doc.text('UNITS', mLeft + c0 + c1 + 1.5, headerY);
  doc.text('REF. RANGE', mLeft + c0 + c1 + c2 + 1.5, headerY);
  doc.setCharSpace(0);
  if (legacy || layout.template === 'classic' || layout.template === 'minimalist') {
    stroke(doc, legacy || layout.template === 'classic' ? palette.BLACK : palette.FRAME);
    doc.setLineWidth(legacy ? 0.5 : PRINT_HAIRLINE_MM);
    doc.line(mLeft, headerY + 2, right, headerY + 2);
  }

  return headerY + 3;
}

/**
 * Continuation strip on plain paper: 12 mm instead of the ~89 mm a full header
 * costs. The pad template never reaches this — see `startContinuationPage`.
 */
function drawRunningHeader(ctx: PassContext): void {
  const { doc, layout, palette, input, version, statusView } = ctx;
  const { report, patient } = input;
  const legacy = layout.template === 'blank';
  const mLeft = layout.margins.left;
  const right = A4.widthMm - layout.margins.right;
  const width = layout.printable.width;

  paintBackground(ctx);
  const y = RUNNING_HEADER_MM;
  stroke(doc, legacy ? palette.BLACK : palette.FRAME);
  doc.setLineWidth(PRINT_HAIRLINE_MM);
  doc.line(mLeft, y, right, y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  ink(doc, legacy ? palette.BLACK : palette.BRAND_DARK);
  const who = winAnsiSafe(
    [
      legacy ? null : labTitle(layout),
      patient?.name || report.patientName || '',
      report.id ? `No. ${String(report.id).substring(0, 8).toUpperCase()}` : null,
    ]
      .filter(Boolean)
      .join('  \u00b7  '),
  );
  doc.text(who, mLeft, y - 2.6, { maxWidth: width * 0.68 });
  doc.setFont('helvetica', 'normal');
  ink(doc, palette.INK_SOFT);
  doc.text(
    winAnsiSafe(
      version > 1 ? `AMENDED v${version} \u00b7 continued` : `${statusView.label} \u00b7 continued`,
    ),
    right,
    y - 2.6,
    { align: 'right' },
  );
}

/**
 * Where content on a sheet after the first may begin, in mm from the top edge.
 *
 * One number serves two callers on purpose: autoTable restarts its cursor at
 * `margin.top` after every `addPage()`, while `drawTail` breaks pages by hand.
 * They used to disagree — the strip was drawn at 12 mm and the table restarted at
 * page 1's `startY` — which is what left the top half of the second sheet empty.
 */
function continuationTopMm(ctx: PassContext): number {
  const { layout, p } = ctx;
  if (layout.template === 'blank') {
    // A pre-printed pad is a stack of identical forms: the laboratory's masthead
    // is on every sheet, not just the first. So a continuation sheet starts at the
    // height sheet 1's first line starts at — recorded while that header was drawn
    // — rather than at a number guessed here. Two failures this closes: restarting
    // at 12 mm printed the category band on top of the artwork (the 2.8.1 sheets),
    // and restarting at page 1's table Y re-paid the patient box and the column
    // titles, leaving the top half of the sheet empty (the 2.7.x sheets).
    // The artwork's own lead-in is the lab's top margin plus its section gap, so
    // the badge that hangs below the printed ribbon stays clear.
    return ctx.padContentTopMm ?? p.mTop;
  }
  return RUNNING_HEADER_MM + SPACE.sm;
}

/** Draw what a continuation sheet needs above its content, and return that Y. */
function startContinuationPage(ctx: PassContext): number {
  // The share letterhead is full-bleed artwork: it belongs on every sheet whether
  // or not anything is printed over it.
  if (ctx.layout.template === 'blank') paintBackground(ctx);
  else drawRunningHeader(ctx);
  return continuationTopMm(ctx);
}

function paintBackground(ctx: PassContext): void {
  const { doc, input, layout } = ctx;
  const image = input.shareTemplateImage || '';
  if (layout.mode !== 'share' || !image) return;
  try {
    const marker = image.substring(image.indexOf('/') + 1, image.indexOf(';')).toUpperCase();
    doc.addImage(image, marker === 'PNG' ? 'PNG' : 'JPEG', 0, 0, A4.widthMm, A4.heightMm);
  } catch (err) {
    // A broken letterhead must not eat the report: the findings are the document.
    console.error('report-pdf: share letterhead could not be drawn', err);
  }
}

function labTitle(layout: ResolvedReportLayout): string {
  if (!layout.labName) return 'PathoMitra Report';
  return layout.template === 'classic' ? layout.labName.toUpperCase() : layout.labName;
}

// --------------------------------------------------------------------------
// Results table
// --------------------------------------------------------------------------

/** One row group: a section band plus its measurement rows, as autoTable cells. */
function sectionBandRow(ctx: PassContext, category: string): any[] {
  const { layout, palette, p } = ctx;
  const legacy = layout.template === 'blank';
  const bandPadding = (multiplier: number, floor: number, left: number) => ({
    top: Math.max(floor, p.cellPadding * multiplier),
    bottom: Math.max(floor, p.cellPadding * multiplier),
    left,
  });

  if (legacy) {
    return [
      {
        content: category,
        colSpan: 4,
        styles: {
          fontStyle: 'bold',
          fillColor: false,
          textColor: palette.BLACK,
          halign: 'center',
          cellPadding: bandPadding(2.5, 1.5, 2),
        },
      },
    ];
  }
  if (layout.template === 'classic') {
    return [
      {
        content: category,
        colSpan: 4,
        styles: {
          fontStyle: 'bold',
          fillColor: false,
          textColor: palette.BLACK,
          halign: 'center',
          lineWidth: { top: PRINT_HAIRLINE_MM, bottom: 0, left: 0, right: 0 },
          lineColor: palette.BLACK,
          cellPadding: bandPadding(2.5, 1.5, 2),
        },
      },
    ];
  }
  if (layout.template === 'modern') {
    return [
      {
        content: category,
        colSpan: 4,
        styles: {
          fontStyle: 'bold',
          fillColor: palette.BRAND_SOFT,
          textColor: palette.BRAND_DARK,
          halign: 'left',
          cellPadding: bandPadding(2.6, 2, 3),
        },
      },
    ];
  }
  return [
    {
      content: category,
      colSpan: 4,
      styles: {
        fontStyle: 'bold',
        fillColor: false,
        textColor: palette.INK_SOFT,
        halign: 'left',
        lineWidth: { top: PRINT_HAIRLINE_MM, bottom: 0, left: 0, right: 0 },
        lineColor: palette.FRAME,
        cellPadding: {
          top: Math.max(2.6, p.cellPadding * 3.4),
          bottom: Math.max(1.2, p.cellPadding * 1.4),
          left: 0,
        },
      },
    },
  ];
}

function groupBandRow(ctx: PassContext, row: SectionRow): any[] {
  const { layout, palette, p } = ctx;
  const legacy = layout.template === 'blank';
  const fill = legacy ? false : layout.template === 'modern' ? palette.BRAND_TINT : false;
  const color: Rgb = legacy
    ? [11, 60, 93]
    : layout.template === 'classic'
      ? palette.BLACK
      : layout.template === 'modern'
        ? palette.BRAND_DARK
        : palette.BRAND;
  /*
   * The category band (HAEMATOLOGY) stays centred — it names the section of the
   * sheet. A panel band (CBC (COMPLETE BLOOD COUNT), URINE ANALYSIS) is
   * left-justified on the pad so it reads as the heading of the rows under it
   * rather than as a second centred title (owner request, 2026-10-17). The other
   * templates keep their centring: nothing about their artwork was reviewed.
   */
  const centered: 'center' | 'left' =
    layout.template === 'classic' || layout.template === 'modern' ? 'center' : 'left';
  return [
    {
      content: row.name,
      colSpan: 4,
      styles: {
        fontStyle: 'bold',
        fillColor: fill,
        textColor: color,
        halign: centered,
        // A panel band belongs with the rows under it.
        cellPadding: {
          top: Math.max(1.5, p.cellPadding * 1.8),
          bottom: Math.max(1.5, p.cellPadding * 1.8),
          // Left-justified on the pad: lined up with the test names under it.
          left: legacy ? p.cellPadding : 2,
        },
      },
    },
  ];
}

/**
 * The sections grouped into page units. A *test package* (see `BIG_PANEL_ROWS` in
 * `report-layout`) is alone in its unit and leads the report; every smaller
 * section — however many of them there are, and wherever the lab ordered them —
 * is collected into one unit that trails the packages and flows inside it.
 *
 * The collection is the point. Grouping smalls by "the run between two packages"
 * looked equivalent until a report ordered a small test on either side of a CBC:
 * the CBC split the run in two, and two or three rows of minor tests each got a
 * sheet of their own.
 */
function pageUnits(model: ReportModel): Section[][] {
  const units: Section[][] = [];
  const smalls: Section[] = [];
  model.sections.forEach(section => {
    if (isBigPanel(section.rows.length)) units.push([section]);
    else smalls.push(section);
  });
  if (smalls.length) units.push(smalls);
  // A report with nothing selected still renders one (empty) unit, so the tail —
  // notes, signature, legal lines — has a sheet to land on.
  return units.length ? units : [[]];
}

/**
 * Table options for one page unit.
 *
 * `Method:` no longer rides inside the test name as a `\n` second line — that
 * doubled the row height of every test whose catalogue entry declares a method
 * and was one of the reasons a panel tipped onto a second page. Methods are
 * collected into one footnote line each (`drawTail`), which is also how a
 * reference laboratory prints them.
 */
function buildTableOptions(ctx: PassContext, startY: number, sections: Section[]): any {
  const { doc, layout, palette, p } = ctx;
  const legacy = layout.template === 'blank';
  const mLeft = layout.margins.left;
  const right = A4.widthMm - layout.margins.right;
  const [c0, c1, c2, c3] = layout.columns;

  const separators =
    layout.template === 'classic' && layout.rowSeparators === 'hairline'
      ? 'grid'
      : layout.rowSeparators;

  /*
   * A rule under every test row is a plain-paper device. On the pad the form
   * already carries its own ruling, so ours lands beside it and each value ends
   * up boxed twice; the lab's `Lines` setting therefore applies to plain paper
   * only, the same call `startContinuationPage` and `drawFooters` make about the
   * masthead band and the footer band.
   */
  const rowRules = separators === 'hairline' && !legacy;

  const body: any[] = [];
  sections.forEach(section => {
    // Push the ROW, not its cells. `sectionBandRow` returns `[cell]`, and
    // autoTable derives the column list from `body[0]`'s keys
    // (`parseContent` → `parseColumns`): spreading a bare cell object here made
    // the first row look like a row of three cells named `content`, `colSpan`
    // and `styles`, so the table was built with THREE columns and the
    // reference-range column silently disappeared from every report. The
    // accompanying console noise was autoTable's
    // "Of the table content, 53 units width could not fit page".
    body.push(sectionBandRow(ctx, section.category));
    section.rows.forEach(row => {
      if (row.isGroupRow) {
        body.push(groupBandRow(ctx, row));
        return;
      }
      const flag = row.flag;
      body.push([
        row.name,
        {
          content: row.result === '' ? '\u2014' : row.result,
          styles: {
            ...(flag ? { fontStyle: 'bold' as const } : {}),
            // Values are left-aligned under RESULT (owner decision, 2026-10-17 —
            // the reference sheet the lab works from is laid out that way), which
            // is also what lets the range marker sit in the gap after the number.
            // Carried through didParseCell to didDrawCell, because a per-row
            // alignment flag has nowhere else to live in autoTable's model.
            ...(flag ? ({ pmFlag: flag } as any) : {}),
          },
        },
        row.unit,
        row.refLabel,
      ]);
    });
  });

  return {
    startY,
    // Continuation sheets restart here (autoTable sets `cursor.y = margin.top`
    // after every `addPage()`), not at page 1's `startY` — see `continuationTopMm`.
    margin: {
      top: continuationTopMm(ctx),
      left: mLeft,
      right: layout.margins.right,
      bottom: p.mBottom,
    },
    pageBreak: 'auto' as const,
    // Supported by v5 (unlike a per-row pageBreak): a measurement row's text is
    // never split across a sheet boundary, which on a clinical table would put a
    // value on one page and its name on the next.
    rowPageBreak: 'avoid' as const,
    showHead: false,
    theme: (separators === 'grid' ? 'grid' : 'plain') as 'grid' | 'plain',
    body,
    styles: {
      cellPadding: p.cellPadding,
      fontSize: p.bodyFont,
      ...(legacy
        ? { textColor: palette.BLACK }
        : separators === 'grid'
          ? { lineColor: palette.HAIRLINE, lineWidth: PRINT_HAIRLINE_MM, textColor: palette.INK }
          : { font: 'helvetica', textColor: palette.INK }),
    },
    columnStyles: {
      0: { cellWidth: c0 },
      1: { cellWidth: c1 },
      2: { cellWidth: c2, textColor: legacy ? palette.BLACK : palette.INK_SOFT },
      3: {
        cellWidth: c3,
        halign: 'center' as const,
        textColor: legacy ? palette.BLACK : palette.INK_SOFT,
      },
    },
    ...(separators === 'zebra' ? { alternateRowStyles: { fillColor: palette.ZEBRA } } : {}),
    didParseCell: (data: any) => {
      if (data.section !== 'body' || data.column.index !== 1) return;
      const raw = data.cell.raw;
      if (raw && typeof raw === 'object' && raw.styles && (raw.styles as any).pmFlag) {
        (data.cell as any).pmFlag = (raw.styles as any).pmFlag;
      }
    },
    didDrawCell: (data: any) => {
      if (data.section !== 'body') return;
      const isBand =
        data.cell.raw && typeof data.cell.raw === 'object' && (data.cell.raw as any).colSpan;

      if (rowRules && data.column.index === 3 && !isBand) {
        stroke(doc, legacy ? palette.BLACK : palette.HAIRLINE);
        doc.setLineWidth(legacy ? 0.3 : PRINT_HAIRLINE_MM);
        doc.line(mLeft, data.cell.y + data.cell.height, right, data.cell.y + data.cell.height);
      }

      const flag = (data.cell as any).pmFlag;
      if (data.column.index !== 1 || !flag) return;
      // The out-of-range marker is a drawn triangle, not an arrow glyph: U+2191 is
      // outside WinAnsi, and jsPDF writes an undrawable code point as two bytes of
      // unrelated Latin, so the sample PDF's literal '↑' was printing as junk.
      const isHigh = flag === 'up';
      const padding =
        typeof data.cell.styles.cellPadding === 'number'
          ? data.cell.styles.cellPadding
          : ((data.cell.styles.cellPadding as any)?.left ?? 3);
      const textWidth = doc.getTextWidth(String(data.cell.text?.[0] ?? ''));
      /*
       * The marker belongs after the value it flags, so it has to be measured from
       * where that text actually ended. Deriving x from `cell.x + padding +
       * textWidth` is only true for left-aligned text: the result column can be
       * right- or centre-aligned, and on a right-aligned number that put the arrow
       * in FRONT of the value — which is what the owner's sheet showed
       * (`↑ (H)   57`). One expression per alignment, same 1.5 mm gap.
       */
      const halign = String(data.cell.styles.halign ?? 'left');
      const textEnd =
        halign === 'right'
          ? data.cell.x + data.cell.width - padding
          : halign === 'center'
            ? data.cell.x + data.cell.width / 2 + textWidth / 2
            : data.cell.x + padding + textWidth;
      const x = textEnd + 1.5;
      const y = data.cell.y + data.cell.height / 2;
      /*
       * One ink for both directions. A red up-arrow beside a black down-arrow
       * reads as two different kinds of mark, and the reader stops to work out why
       * one of them is coloured — when all either of them says is "outside the
       * interval", which the bold result already says. The pad prints pure black
       * so the marker matches the black rules around it; plain paper uses body
       * ink, so the marker matches the numbers it belongs to.
       */
      const color: Rgb = legacy ? palette.BLACK : palette.INK;
      paint(doc, color);
      stroke(doc, color);
      doc.setLineWidth(0.35);
      // 1.3 × 1.5 mm head on a 3.2 mm mark, down from 1.6 × 1.8 / 4.0 mm — the old
      // size read as a second column next to the result. Still ~15 × 18 dots at the
      // 300 dpi the desktop path rasterises at, so it survives the sheet.
      const w = 1.3;
      const h = 1.5;
      const shaft = 1.6;
      if (isHigh) {
        doc.line(x + w / 2, y + shaft, x + w / 2, y - shaft + h);
        doc.triangle(x, y - shaft + h, x + w / 2, y - shaft, x + w, y - shaft + h, 'FD');
      } else {
        doc.line(x + w / 2, y - shaft, x + w / 2, y + shaft - h);
        doc.triangle(x, y + shaft - h, x + w / 2, y + shaft, x + w, y + shaft - h, 'FD');
      }
      // The '(H)' / '(L)' letters the pad template used to print beside the marker
      // are gone (owner request, 2026-10-17): the value is bold and the arrow
      // points, which is the whole message. `winAnsiSafe` still turns a literal
      // ↓ into '(L)' inside data text — unrelated, and still tested.
    },
    didDrawPage: () => {
      const page = doc.internal.getCurrentPageInfo().pageNumber;
      if (ctx.drawnPages.has(page)) return;
      ctx.drawnPages.add(page);
      // Page 1 already paid for the full masthead in `drawFullHeader`; anything
      // after it gets the 12 mm strip instead of another 89 mm of duplicate
      // header, and on the pad template it gets nothing at all.
      if (page > 1) startContinuationPage(ctx);
    },
  };
}

/** Per-page footer band: identity on the left, pagination on the right. */
function drawFooters(ctx: PassContext): void {
  const { doc, layout, palette, p, input } = ctx;
  const { report, patient } = input;
  const legacy = layout.template === 'blank';
  // The third leg of the pad contract: the sheet arrives with its own footer
  // artwork, so nothing of ours is printed on it — no rule, no identity line and
  // no page counter. Plain paper keeps all three (see the file header).
  if (legacy) return;
  const mLeft = layout.margins.left;
  const right = A4.widthMm - layout.margins.right;
  const width = layout.printable.width;
  const total = doc.getNumberOfPages();
  const y = A4.heightMm - Math.min(8, Math.max(5, p.mBottom * 0.4));

  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    stroke(doc, legacy ? palette.BLACK : palette.HAIRLINE);
    doc.setLineWidth(PRINT_HAIRLINE_MM);
    doc.line(mLeft, y - 3, right, y - 3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(Math.max(7.5, layout.footerFont - 2.5));
    ink(doc, palette.INK_SOFT);
    const identity = winAnsiSafe(
      [
        legacy ? null : labTitle(layout),
        patient?.id ? `ID ${patient.id.substring(0, 8).toUpperCase()}` : null,
        report.id ? `Report ${String(report.id).substring(0, 8).toUpperCase()}` : null,
      ]
        .filter(Boolean)
        .join('  \u00b7  '),
    );
    if (identity) doc.text(identity, mLeft, y, { maxWidth: width * 0.7 });
    // Page geometry is derived from the sheet, never pinned at `297 - 11`: with a
    // large bottom margin a fixed position lands inside the area the lab asked to
    // keep clear.
    doc.setFont('helvetica', 'bold');
    ink(doc, legacy ? palette.BLACK : palette.FRAME);
    doc.text(winAnsiSafe(`Page ${page} of ${total}`), right, y, { align: 'right' });
  }
}

/** Draw one complete document with the given parameters. */
function renderPass(
  doc: any,
  autoTable: (doc: any, options: any) => void,
  passInput: ReportPdfInput,
  layout: ResolvedReportLayout,
  palette: ReportPalette,
  params: RenderParams,
  model: ReportModel,
  version: number,
  statusView: ReturnType<typeof reportStatusView>,
): void {
  const ctx: PassContext & { drawnPages: Set<number> } = {
    doc,
    autoTable,
    input: passInput,
    layout,
    palette,
    p: params,
    model,
    version,
    statusView,
    drawnPages: new Set<number>(),
  };
  const startY = drawFullHeader(ctx);
  ctx.drawnPages.add(doc.internal.getCurrentPageInfo().pageNumber);
  // One autoTable call per page unit: autoTable v5 has no per-row `pageBreak`
  // (see the file header), so each package gets its own table on its own sheet and
  // the collected small tests get one table after them. Within a unit nothing is
  // forced — autoTable breaks the flow itself when a row would cross the bottom
  // margin, which is what lets Blood Sugar and Widal sit on one sheet.
  let y = startY;
  pageUnits(model).forEach((unit, index) => {
    if (index > 0) {
      doc.addPage();
      // Mark the sheet as drawn: autoTable fires didDrawPage for the page it
      // starts on, and without this the continuation strip is painted twice at the
      // same y.
      ctx.drawnPages.add(doc.internal.getCurrentPageInfo().pageNumber);
      y = startContinuationPage(ctx);
    }
    autoTable(doc, buildTableOptions(ctx, y, unit));
    y = doc.lastAutoTable?.finalY ?? y;
  });
  drawTail(ctx, y + Math.max(params.sectionGap, SPACE.md));
  drawFooters(ctx);
}

/**
 * Build the report document.
 *
 * The lab's own settings win. Compaction is attempted only when the lab asked
 * for it (`reportFitToOnePage`) and only ever *adopted* when a pass actually
 * reaches the sheet floor the page units impose — otherwise the returned document
 * is the unshrunk one, so a report that needs three sheets prints at the font
 * size the lab configured rather than at whatever a rescue pass happened to leave
 * behind.
 */
export async function buildReportDocument(input: ReportPdfInput): Promise<ReportPdfResult> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const mode = input.mode ?? 'print';
  const layout = resolveReportLayout(input.settings, mode, input.signerName ?? '');
  const themeHex = (THEME_OPTIONS.find(option => option.id === layout.themeId) ?? THEME_OPTIONS[0])
    .previewColor;
  const palette = buildReportPalette(themeHex, layout.template);
  const version = Number(input.report.version) || 1;
  const statusView = reportStatusView({ status: input.report.status, version });
  const model = buildReportModel(input.report, input.patient, layout);
  const filename = reportFilename(input.report);
  const base = paramsFrom(layout);

  const render = (params: RenderParams) => {
    const doc = new jsPDF();
    doc.setProperties({ title: filename });
    renderPass(doc, autoTable, input, layout, palette, params, model, version, statusView);
    return doc;
  };

  const standard = render(base);
  let doc = standard;
  let compacted = false;

  // The floor is one sheet per page unit: a package claims its sheet, so nothing
  // below `floor` pages is reachable however small the type goes. The ladder is
  // still worth running above that floor — it is what keeps a 26-row CBC from
  // spilling its last three lines onto a sheet of their own.
  const floor = pageUnits(model).length;

  if (layout.fitToOnePage && standard.getNumberOfPages() > floor) {
    let candidate = shrinkOnce(base);
    // Bound the search: each notch is a 10 % reduction against a hard floor, so
    // eight passes exhausts the ladder on any sane setting.
    for (let step = 0; step < 8; step += 1) {
      const trial = render(candidate);
      if (trial.getNumberOfPages() <= floor) {
        doc = trial;
        compacted = true;
        break;
      }
      const next = shrinkOnce(candidate);
      if (sameParams(next, candidate)) break;
      candidate = next;
    }
  }

  return {
    doc,
    pageCount: doc.getNumberOfPages(),
    filename,
    printedRows: model.printedRows,
    compacted,
    sections: model.sections.length,
  };
}
