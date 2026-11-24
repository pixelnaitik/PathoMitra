/**
 * Shared, dependency-free layout math for report PDFs and the live A4 preview.
 *
 * Keeping this in one place guarantees the preview is a faithful representation
 * of the generated PDF: the exact same mm geometry and clamping are consumed by
 * both the jsPDF generator (ReportsPage) and the React preview component.
 */
import type { LabSettings } from './settings';
import { buildReportLegalLines } from './report-compliance';
import { NEUTRAL_RULES, ZEBRA_TINT } from './print-contrast';

export { PRINT_HAIRLINE_MM, PRINT_RULE_MM } from './print-contrast';

/** jsPDF draws reports in a 210 × 297 mm coordinate space. */
export const A4 = { widthMm: 210, heightMm: 297 } as const;

/** CSS pixels per millimetre at 100% zoom on a 96 dpi screen (96 / 25.4). */
export const MM_TO_PX_BASE = 96 / 25.4;

/** 1 typographic point (1/72") expressed in millimetres. */
export const PT_TO_MM = 0.3527777778;

/** Coerce any value to a finite number, never NaN/Infinity. */
export function safeNum(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

/** Clamp to [min, max]; falls back to min for invalid input. */
export function clamp(value: number, min: number, max: number): number {
  const n = safeNum(value, min);
  return Math.min(max, Math.max(min, n));
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PrintableArea {
  width: number;
  height: number;
  valid: boolean;
}

/** printableWidth = 210 - left - right ; printableHeight = 297 - top - bottom */
export function getPrintableArea(m: Margins): PrintableArea {
  const width = A4.widthMm - m.left - m.right;
  const height = A4.heightMm - m.top - m.bottom;
  return { width, height, valid: width > 0 && height > 0 };
}

/**
 * Recommended out-of-the-box layout — the single source of truth every
 * "Reset to recommended" action restores.
 *
 * The margins used to be `50 / 20 / 8 / 15`, which is geometry for a lab
 * printing on a pre-printed pad: the 50 mm band is where the pad's artwork
 * sits. That value was shipped to everybody, including every lab printing on
 * plain A4, where it spends 22 % of the sheet height on an empty band and is
 * one of the two reasons a 25-parameter CBC will not fit on one page. The pad
 * geometry did not go away — it is `PAD_LAYOUT_PRESET` below, still one tap
 * away in Settings, and stored pad settings are never rewritten.
 */
export const RECOMMENDED_LAYOUT_DEFAULTS = {
  reportTemplate: 'modern',
  shareTemplate: 'blank',
  reportMarginTop: 14,
  reportMarginBottom: 12,
  reportMarginLeft: 12,
  reportMarginRight: 12,
  shareMarginTop: 40,
  shareMarginBottom: 20,
  shareMarginLeft: 15,
  shareMarginRight: 15,
  reportTableBodyFontSize: 10,
  shareTableBodyFontSize: 10,
  reportTitleFontSize: 22,
  patientInfoFontSize: 10,
  patientLineHeight: 5.0,
  reportSectionGap: 6,
  tableHeaderFontSize: 10,
  tableBodyFontSize: 10,
  tableCellPadding: 1.4,
  notesFontSize: 9,
  footerFontSize: 10,
} as const;

/**
 * The pre-printed-pad geometry, kept as a first-class preset rather than a
 * memory: 50 mm of clear space at the top for the pad's printed masthead, 20 mm
 * at the foot for its printed footer, and an 8 mm left / 15 mm right pair for
 * the binding edge.
 *
 * A lab that switched to it must never be auto-migrated away from it, which is
 * why `migrateSettings` still maps the legacy 20/40 values onto these numbers.
 */
export const PAD_LAYOUT_PRESET = {
  reportMarginTop: 50,
  reportMarginBottom: 20,
  reportMarginLeft: 8,
  reportMarginRight: 15,
} as const;

/** Table column split (mm) shared by the PDF generator, sample export and preview. */
export function getColumnWidths(printableWidth: number): [number, number, number, number] {
  const w = safeNum(printableWidth, 0);
  // 58 / 26 / 16 / 40 of 140. The previous split was 70 / 30 / 35 / 45 of 180,
  // which at the default 187 mm printable width gave the RESULT column 31 mm and
  // UNITS 36 mm — the column holding "g/dL" was wider than the one holding the
  // result, while 26-character test names wrapped inside 73 mm. Result gets
  // enough for a value plus its flag, Units gets enough for a unit, Name gives
  // the difference to the two columns that actually need it.
  return [(w * 58) / 140, (w * 26) / 140, (w * 16) / 140, (w * 40) / 140];
}

/**
 * Centre of the content box, in mm from the left edge of the sheet.
 *
 * Nothing in this app may centre a drawing on `105` (the A4 mid-line). The
 * default margins are 8 mm left and 15 mm right, so the content block is
 * centred at 101.5 mm and a masthead drawn at 105 sits 3.5 mm right of the rules
 * it is supposed to sit centred between — which is the reason the page reads as
 * "slightly wrong" without anyone being able to name it.
 */
export function contentCenterMm(mLeft: number, printableWidth: number): number {
  return safeNum(mLeft, 0) + safeNum(printableWidth, 0) / 2;
}

type Rgb = [number, number, number];

export interface ReportPalette {
  BRAND: Rgb;
  BRAND_DARK: Rgb;
  BRAND_TINT: Rgb;
  BRAND_TINT2: Rgb;
  BRAND_SOFT: Rgb;
  INK: Rgb;
  INK_SOFT: Rgb;
  BLACK: Rgb;
  HAIRLINE: Rgb;
  /**
   * Border of the patient-identity box and other 0.3 mm outlines. Separated from
   * `HAIRLINE` because a box border carries meaning on its own — without it the
   * patient block is just loose text — so it needs the stronger 3:1-plus weight.
   */
  BOX_BORDER: Rgb;
  /** Rules that frame a section: under the masthead, above the footer band. */
  FRAME: Rgb;
  /** Alternating-row band. Neutral, never a brand tint (see `ZEBRA_TINT`). */
  ZEBRA: Rgb;
}

const hexToRgb = (hex: string): Rgb => {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
};

const mixWhite = (rgb: Rgb, amt: number): Rgb => [
  Math.round(rgb[0] + (255 - rgb[0]) * amt),
  Math.round(rgb[1] + (255 - rgb[1]) * amt),
  Math.round(rgb[2] + (255 - rgb[2]) * amt),
];

/**
 * The brand ramp used by the PDF, the live preview and the sample export.
 * 'blank' keeps pure black rules (legacy pre-printed-pad rendering).
 *
 * The structural greys are *not* brand-derived any more, and that is the whole
 * point of `lib/print-contrast`. They used to be: `HAIRLINE` was the brand colour
 * at 72 % white and the patient-box border that brand at 80 %, which measures
 * 1.6:1 and 1.4:1 against paper. At the 300 dpi raster the desktop print path
 * renders at, the 0.1 mm stroke those tokens were drawn with is 1.18 device
 * pixels. Every row separator in a printed report was effectively absent, while
 * the on-screen preview — which scales its own borders up to a CSS pixel — kept
 * looking fine.
 *
 * Tints that are meant to *be* a band are now clamped to the ink-density floor
 * too, so a section band is ink rather than a misfeed.
 */
export function buildReportPalette(themePreviewHex: string, template: string): ReportPalette {
  const legacy = template === 'blank';
  const BRAND = hexToRgb(themePreviewHex);
  const BRAND_DARK: Rgb = [
    Math.round(BRAND[0] * 0.62),
    Math.round(BRAND[1] * 0.62),
    Math.round(BRAND[2] * 0.62),
  ];
  const BLACK: Rgb = [0, 0, 0];
  return {
    BRAND,
    BRAND_DARK,
    // 87 % white / 13 % tint of white: 0.083 ink density, clear of the floor, and
    // still light enough that 10 pt INK on it stays around 16:1.
    BRAND_TINT: mixWhite(BRAND, 0.87),
    // Retained for decorative fills only. Nothing structural may use it — at
    // 60 % white it is still 1.9:1, below the graphic-contrast bar.
    BRAND_TINT2: mixWhite(BRAND, 0.6),
    // Section band: 0.094 ink density, and BRAND_DARK text on it measures 9.07:1.
    BRAND_SOFT: mixWhite(BRAND, 0.84),
    INK: [29, 29, 31],
    INK_SOFT: [102, 102, 109],
    BLACK,
    HAIRLINE: legacy ? BLACK : NEUTRAL_RULES.hairline,
    BOX_BORDER: legacy ? BLACK : NEUTRAL_RULES.strong,
    FRAME: legacy ? BLACK : NEUTRAL_RULES.frame,
    ZEBRA: legacy ? BLACK : ZEBRA_TINT,
  };
}

/**
 * How the results table separates its rows.
 *
 * `hairline` is the current look; `grid` rules the classic template; `zebra`
 * bands alternate rows (the only separator that survives a cheap inkjet or a
 * photocopy, because it is an area rather than a line); `none` is what a pad lab
 * wants, where the pre-printed form already carries the ruling and extra ink
 * fights with it.
 */
export type RowSeparatorMode = 'hairline' | 'zebra' | 'grid' | 'none';

/** Whether sections print in the order the lab ordered them, or grouped. */
export type SectionOrderMode = 'ordered' | 'byCategory';

const ROW_SEPARATOR_MODES: RowSeparatorMode[] = ['hairline', 'zebra', 'grid', 'none'];
const SECTION_ORDER_MODES: SectionOrderMode[] = ['ordered', 'byCategory'];

/**
 * Normalise the vertical margin fallbacks so nothing re-declares the pad numbers.
 */
const marginFallback = (key: keyof typeof RECOMMENDED_LAYOUT_DEFAULTS): number =>
  RECOMMENDED_LAYOUT_DEFAULTS[key] as number;

/**
 * Normalised, always-safe description of the report layout, derived
 * straight from LabSettings. Pass 'share' to resolve the share-template
 * variants of the settings. Every field is clamped to a sane range so a
 * malformed / empty input can never break the preview or the PDF.
 *
 * `signerName` is the authenticated operator issuing the report; the real
 * generator passes it, the preview and the sample export leave it blank and
 * get the neutral issuance wording. `legal` rides along on the resolved layout
 * so the live preview, the sample PDF and the patient PDF can never print
 * three different versions of the laboratory's credentials.
 */
export function resolveReportLayout(
  s: LabSettings,
  mode: 'print' | 'share' = 'print',
  signerName = '',
) {
  const share = mode === 'share';
  const margins: Margins = {
    top: clamp(
      safeNum(share ? s.shareMarginTop : s.reportMarginTop, marginFallback('reportMarginTop')),
      0,
      A4.heightMm,
    ),
    right: clamp(
      safeNum(
        share ? s.shareMarginRight : s.reportMarginRight,
        marginFallback('reportMarginRight'),
      ),
      0,
      A4.widthMm,
    ),
    bottom: clamp(
      safeNum(
        share ? s.shareMarginBottom : s.reportMarginBottom,
        marginFallback('reportMarginBottom'),
      ),
      0,
      A4.heightMm,
    ),
    left: clamp(
      safeNum(share ? s.shareMarginLeft : s.reportMarginLeft, marginFallback('reportMarginLeft')),
      0,
      A4.widthMm,
    ),
  };
  const printable = getPrintableArea(margins);
  const template =
    (share ? s.shareTemplate || s.reportTemplate : s.reportTemplate) ||
    RECOMMENDED_LAYOUT_DEFAULTS.reportTemplate;
  return {
    mode,
    margins,
    printable,
    columns: getColumnWidths(printable.width),
    /** Centre of the content box — see `contentCenterMm`. Never 105. */
    centerMm: contentCenterMm(margins.left, printable.width),
    template,
    titleFont: clamp(safeNum(s.reportTitleFontSize, 22), 6, 60),
    patientFont: clamp(safeNum(s.patientInfoFontSize, 10), 4, 40),
    patientLineHeightMm: clamp(safeNum(s.patientLineHeight, 5), 1, 30),
    sectionGapMm: clamp(safeNum(s.reportSectionGap, 6), 0, 60),
    tableHeaderFont: clamp(safeNum(s.tableHeaderFontSize, 10), 4, 40),
    tableBodyFont: clamp(
      (share ? s.shareTableBodyFontSize : s.reportTableBodyFontSize) ?? s.tableBodyFontSize ?? 10,
      4,
      40,
    ),
    tableCellPaddingMm: clamp(safeNum(s.tableCellPadding, 1.4), 0, 20),
    notesFont: clamp(safeNum(s.notesFontSize, 9), 4, 40),
    footerFont: clamp(safeNum(s.footerFontSize, 10), 4, 40),
    themeId: s.themeId || 'navy',
    labName: s.labName || 'PathoMitra Lab',
    /**
     * The uploaded lab logo as an inline data URL, or '' for the drawn keystone.
     * Already validated at the settings boundary by `isBrandLogoDataUrl`, so the
     * renderer may hand it straight to `addImage`.
     */
    brandLogo: typeof s.brandLogoUrl === 'string' ? s.brandLogoUrl : '',
    /** Shrink padding/font/margins until the report fits one sheet. */
    fitToOnePage: s.reportFitToOnePage !== false,
    rowSeparators: ROW_SEPARATOR_MODES.includes(s.reportRowSeparators as RowSeparatorMode)
      ? (s.reportRowSeparators as RowSeparatorMode)
      : 'hairline',
    showLabIdentity: s.reportShowLabIdentity !== false,
    showSignatureArea: s.reportShowSignatureArea !== false,
    sectionOrder: SECTION_ORDER_MODES.includes(s.reportSectionOrder as SectionOrderMode)
      ? (s.reportSectionOrder as SectionOrderMode)
      : 'ordered',
    legal: buildReportLegalLines({
      accreditationBody: s.accreditationBody,
      accreditationNumber: s.accreditationNumber,
      licenceNumber: s.licenceNumber,
      accreditationAttestedAt: s.accreditationAttestedAt,
      signerName,
    }),
  };
}

export type ResolvedReportLayout = ReturnType<typeof resolveReportLayout>;

/**
 * Vertical rhythm in millimetres. The renderer grew a vocabulary of one-off
 * offsets (`+4`, `+5`, `+8.5`, `+13.5`, `+15.1`, `*1.5`, `*2`, `*3.4`) which is
 * why blocks on a printed report sit at slightly unrelated distances from each
 * other. New spacing uses this ramp; existing pad-derived offsets are left alone
 * deliberately, because they are tuned against artwork that is already on the
 * paper and changing them moves the printed text off the printed form.
 */
export const SPACE = { xs: 2, sm: 4, md: 8, lg: 12 } as const;

/**
 * The type sizes derived from the one number the lab controls.
 *
 * These were spread through the generator as arithmetic on `reportTitleFontSize`
 * (`- 3`, `- 8`, `- 11`, `+ 2`), each with its own inline floor. Same behaviour,
 * one place, so the masthead and its descriptor cannot drift apart.
 */
export function reportTypeScale(titleFont: number) {
  const t = clamp(safeNum(titleFont, RECOMMENDED_LAYOUT_DEFAULTS.reportTitleFontSize), 6, 60);
  return {
    /** Wordmark on the self-drawing templates. */
    wordmark: t,
    /** The masthead serif on 'classic', which has always run two points up. */
    masthead: t + 2,
    /** Small-caps descriptor under the wordmark. */
    descriptor: Math.max(6.5, t - 11),
    /** Italic tagline under the serif masthead. */
    tagline: Math.max(8, t - 8),
  };
}

/**
 * Height of one single-line body row, in mm.
 *
 * autoTable lays a row out as its tallest cell: the line box plus the cell's
 * own top and bottom padding. `PT_TO_MM` converts the font size, and the 1.16
 * factor is the leading jsPDF's standard-14 metrics actually use — measured
 * against a generated document rather than assumed.
 */
export function estimateRowHeightMm(bodyFontPt: number, cellPaddingMm: number): number {
  const font = clamp(safeNum(bodyFontPt, 10), 4, 40);
  const pad = clamp(safeNum(cellPaddingMm, 1.4), 0, 20);
  return font * PT_TO_MM * 1.16 + pad * 2;
}

/** A section band carries roughly 2.5x the row padding, per the renderer. */
export function estimateBandHeightMm(bodyFontPt: number, cellPaddingMm: number): number {
  const font = clamp(safeNum(bodyFontPt, 10), 4, 40);
  const pad = clamp(safeNum(cellPaddingMm, 1.4), 0, 20);
  return font * PT_TO_MM * 1.16 + Math.max(1.5, pad * 2.5) * 2;
}

/**
 * What the continuation header costs, in mm, on every page after the first.
 *
 * The generator used to redraw the complete masthead, the patient box and the
 * column-title band on each page — about 89 mm with the pad margins, which is
 * why a report that spilled by three lines came back with a second page holding
 * three lines and most of a duplicate header. A running strip carries the
 * patient identity, the report number and the status, which is what a lab
 * actually needs to keep sheets of one report together on the bench.
 */
export const RUNNING_HEADER_MM = 12;

/**
 * A section with at least this many rows is a *test package* — a CBC (26 rows), a
 * full urine analysis — and the report generator gives it a sheet to itself: the
 * break falls before it and after it, so a panel is never split across two sheets
 * and whatever follows starts clean. Everything smaller is collected onto ONE
 * trailing sheet and flows from row to row, so three small tests never become
 * three sheets, however the lab ordered them around a package. (Owner decision,
 * 2026-10-17.)
 *
 * The number lives here rather than in `report-pdf` because the composer's
 * "prints as about N page(s)" hint has to apply the same rule to be honest.
 */
export const BIG_PANEL_ROWS = 12;

/** Whether a section of this size is a package that gets its own sheet. */
export const isBigPanel = (rows: number): boolean => safeNum(rows, 0) >= BIG_PANEL_ROWS;

/**
 * How many sheets a report needs once the big-package rule is applied: each big
 * section is alone on its sheet, and all the small sections together need one
 * more (they flow, so that sheet only becomes two when they outrun the page).
 * Takes the per-section row counts in print order.
 */
export function countPageUnits(sectionRowCounts: number[]): number {
  let bigs = 0;
  let hasSmall = false;
  sectionRowCounts.forEach(rows => {
    if (isBigPanel(rows)) bigs += 1;
    else hasSmall = true;
  });
  return bigs + (hasSmall ? 1 : 0);
}

/**
 * Estimate, not a measurement: how many pages a report of this size will take.
 *
 * Used by the composer to warn the operator before they issue. The truth is
 * `buildReportDocument().pageCount`, which is why this is labelled with an
 * approximate and only ever drives a hint, never a gate.
 *
 * `counts.units` is the sheet floor the page-unit rule imposes
 * (`countPageUnits`): height maths alone cannot see that a big package refuses to
 * share a sheet with what follows it, and would promise one page for a CBC plus a
 * urine analysis that prints on two.
 */
export function estimatePrintedPages(
  layout: ResolvedReportLayout,
  counts: { bodyRows: number; bandRows: number; tailMm?: number; units?: number },
): number {
  const height = layout.printable.height;
  if (height <= 0) return 1;
  const rows = Math.max(0, safeNum(counts.bodyRows, 0));
  const bands = Math.max(0, safeNum(counts.bandRows, 0));
  const contentMm =
    rows * estimateRowHeightMm(layout.tableBodyFont, layout.tableCellPaddingMm) +
    bands * estimateBandHeightMm(layout.tableBodyFont, layout.tableCellPaddingMm) +
    Math.max(0, safeNum(counts.tailMm, 40));
  // Page one pays for the full masthead + patient block + column titles; every
  // later page only pays for the running strip.
  const headerFirstPassMm = clamp(layout.margins.top, 0, height) + 34;
  const firstAvailable = Math.max(1, height - headerFirstPassMm);
  const pagesForHeight =
    contentMm <= firstAvailable
      ? 1
      : 1 + Math.ceil((contentMm - firstAvailable) / Math.max(1, height - RUNNING_HEADER_MM));
  return Math.max(pagesForHeight, Math.max(1, Math.floor(safeNum(counts.units, 1))));
}

export interface MarginIssue {
  level: 'error' | 'warn';
  message: string;
}

/** Human-facing warnings when margins become physically impossible. */
export function validateMargins(m: Margins): MarginIssue[] {
  const issues: MarginIssue[] = [];
  const vh = m.top + m.bottom;
  const hw = m.left + m.right;
  if (vh >= A4.heightMm)
    issues.push({
      level: 'error',
      message: `Top + Bottom margins must stay under ${A4.heightMm} mm (page height) — currently ${vh} mm.`,
    });
  else if (vh > A4.heightMm - 20)
    issues.push({
      level: 'warn',
      message: `Only ${Math.round(A4.heightMm - vh)} mm of vertical space left for content.`,
    });
  if (hw >= A4.widthMm)
    issues.push({
      level: 'error',
      message: `Left + Right margins must stay under ${A4.widthMm} mm (page width) — currently ${hw} mm.`,
    });
  else if (hw > A4.widthMm - 30)
    issues.push({
      level: 'warn',
      message: `Only ${Math.round(A4.widthMm - hw)} mm of horizontal space left for content.`,
    });
  return issues;
}
