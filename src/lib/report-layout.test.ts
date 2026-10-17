import { describe, it, expect } from 'vitest';
import {
  A4,
  BIG_PANEL_ROWS,
  PT_TO_MM,
  RUNNING_HEADER_MM,
  SPACE,
  PAD_LAYOUT_PRESET,
  RECOMMENDED_LAYOUT_DEFAULTS,
  contentCenterMm,
  countPageUnits,
  estimateBandHeightMm,
  estimatePrintedPages,
  estimateRowHeightMm,
  getPrintableArea,
  isBigPanel,
  reportTypeScale,
  resolveReportLayout,
  safeNum,
  validateMargins,
} from './report-layout';
import { DEFAULT_SETTINGS } from './settings';
import type { LabSettings } from './settings';

const withSettings = (patch: Partial<LabSettings>): LabSettings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
});

describe('geometry', () => {
  it('derives the printable area from the margins, both axes', () => {
    const area = getPrintableArea({ top: 14, bottom: 12, left: 12, right: 12 });
    expect(area.width).toBeCloseTo(210 - 24, 5);
    expect(area.height).toBeCloseTo(297 - 26, 5);
    expect(area.valid).toBe(true);
  });

  it('marks an impossible margin set invalid instead of dividing by it', () => {
    expect(getPrintableArea({ top: 200, bottom: 120, left: 12, right: 12 }).valid).toBe(false);
    expect(getPrintableArea({ top: 14, bottom: 12, left: 120, right: 120 }).valid).toBe(false);
  });

  it('splits the columns across the whole printable width', () => {
    const widths = [70, 100, 187].map(w => {
      const c = columnsAtPrintableWidth(w);
      expect(c.reduce((a, b) => a + b, 0)).toBeCloseTo(w, 5);
      return c;
    });
    // The result column must be wider than the units column at every width.
    for (const c of widths) expect(c[1]).toBeGreaterThan(c[2]);
  });

  it('centres on the content box rather than the sheet', () => {
    expect(contentCenterMm(12, 186)).toBe(105);
    // Asymmetric pad margins: the sheet mid-line is 105, the content is not.
    expect(contentCenterMm(PAD_LAYOUT_PRESET.reportMarginLeft, 187)).toBeCloseTo(101.5, 5);
  });

  it('refuses to clamp a margin past the edge of the sheet', () => {
    const layout = resolveReportLayout(
      withSettings({ reportMarginTop: 999, reportMarginLeft: 999 }),
    );
    expect(layout.margins.top).toBeLessThanOrEqual(A4.heightMm);
    expect(layout.margins.left).toBeLessThanOrEqual(A4.widthMm);
  });

  it('flags margins that leave no room, and says how to fix them', () => {
    // Over the sheet height outright: an error, the report cannot be drawn.
    const impossible = validateMargins({ top: 150, bottom: 160, left: 12, right: 12 });
    expect(impossible.some(i => i.level === 'error')).toBe(true);
    // Under the sheet but with less than 20 mm of vertical room left: a warning.
    const tight = validateMargins({ top: 140, bottom: 145, left: 12, right: 12 });
    expect(tight.some(i => i.level === 'warn')).toBe(true);
    // Horizontal: 190 mm of margin on a 210 mm sheet leaves 20 mm to print in.
    const narrow = validateMargins({ top: 14, bottom: 12, left: 95, right: 95 });
    expect(narrow.some(i => i.level === 'warn')).toBe(true);
    expect(validateMargins({ top: 14, bottom: 12, left: 12, right: 12 })).toEqual([]);
  });
});

describe('sane defaults', () => {
  it('coerces garbage to the fallback, never to NaN', () => {
    expect(safeNum(undefined, 7)).toBe(7);
    expect(safeNum(Number.NaN, 7)).toBe(7);
    expect(safeNum(Number.POSITIVE_INFINITY, 7)).toBe(7);
    expect(safeNum('12.5', 0)).toBe(12.5);
    expect(safeNum('abc', 3)).toBe(3);
  });

  it('ships a plain-paper default and keeps the pad as a preset', () => {
    const layout = resolveReportLayout(DEFAULT_SETTINGS);
    expect(layout.margins.top).toBeLessThan(20);
    expect(PAD_LAYOUT_PRESET.reportMarginTop).toBe(50);
    // The pad preset must still be reachable and must still be self-consistent.
    const pad = resolveReportLayout(withSettings(PAD_LAYOUT_PRESET));
    expect(pad.printable.height).toBe(A4.heightMm - 70);
  });

  it('falls back to the recommended template when settings are empty', () => {
    const layout = resolveReportLayout(withSettings({ reportTemplate: '' }));
    expect(layout.template).toBe(RECOMMENDED_LAYOUT_DEFAULTS.reportTemplate);
  });

  it('rejects an unknown separator or section order instead of printing blind', () => {
    const layout = resolveReportLayout(
      withSettings({
        reportRowSeparators: 'sparkles' as LabSettings['reportRowSeparators'],
        reportSectionOrder: 'chaos' as LabSettings['reportSectionOrder'],
      }),
    );
    expect(layout.rowSeparators).toBe('hairline');
    expect(layout.sectionOrder).toBe('ordered');
  });

  it('treats a missing display flag as the documented default, not false', () => {
    const layout = resolveReportLayout(
      withSettings({ reportFitToOnePage: undefined as unknown as boolean }),
    );
    expect(layout.fitToOnePage).toBe(true);
  });
});

describe('row and page estimates', () => {
  it('prices a row as its line box plus both paddings', () => {
    const height = estimateRowHeightMm(10, 1.4);
    expect(height).toBeGreaterThan(5);
    expect(height).toBeLessThan(8);
    // More padding must always cost more height, and never NaN.
    expect(estimateRowHeightMm(10, 4)).toBeGreaterThan(height);
    expect(Number.isFinite(estimateRowHeightMm(NaN, NaN))).toBe(true);
  });

  it('prices a section band above a plain row', () => {
    expect(estimateBandHeightMm(10, 1.4)).toBeGreaterThan(estimateRowHeightMm(10, 1.4));
  });

  it('converts points to millimetres at the PDF definition', () => {
    expect(PT_TO_MM * 72).toBeCloseTo(25.4, 4);
  });

  it('puts a small panel on one page and a large one on more', () => {
    const layout = resolveReportLayout(DEFAULT_SETTINGS);
    expect(estimatePrintedPages(layout, { bodyRows: 6, bandRows: 1 })).toBe(1);
    const big = estimatePrintedPages(layout, { bodyRows: 120, bandRows: 6, tailMm: 60 });
    expect(big).toBeGreaterThan(1);
  });

  it('never returns fewer than one page, even on a broken layout', () => {
    const broken = resolveReportLayout(
      withSettings({ reportMarginTop: 250, reportMarginBottom: 40 }),
    );
    expect(estimatePrintedPages(broken, { bodyRows: 25, bandRows: 2 })).toBeGreaterThanOrEqual(1);
  });

  it('costs a continuation page the running strip, not the masthead', () => {
    // The claim behind the pagination fix: page 2 is nearly a whole sheet, where
    // redrawing the full header used to eat ~89 mm of it.
    expect(RUNNING_HEADER_MM).toBeLessThan(20);
    expect(A4.heightMm - RUNNING_HEADER_MM).toBeGreaterThan(A4.heightMm - 89);
  });

  it('keeps the space ramp monotonic', () => {
    expect(SPACE.xs).toBeLessThan(SPACE.sm);
    expect(SPACE.sm).toBeLessThan(SPACE.md);
    expect(SPACE.md).toBeLessThan(SPACE.lg);
  });

  it('derives the masthead ramp without letting a small title vanish', () => {
    const big = reportTypeScale(22);
    expect(big.masthead).toBe(24);
    expect(big.wordmark).toBe(22);
    const tiny = reportTypeScale(6);
    expect(tiny.descriptor).toBeGreaterThanOrEqual(6.5);
    expect(tiny.tagline).toBeGreaterThanOrEqual(8);
    expect(Number.isFinite(reportTypeScale(NaN).wordmark)).toBe(true);
  });
});

describe('the big-package sheet rule', () => {
  it('draws the line at a size, not at a category name', () => {
    expect(isBigPanel(BIG_PANEL_ROWS)).toBe(true);
    expect(isBigPanel(BIG_PANEL_ROWS - 1)).toBe(false);
    expect(isBigPanel(NaN)).toBe(false);
  });

  it('gives each package its own unit and lets the small runs share one', () => {
    // CBC (26 rows) + urine (6) + biochemistry (2): the package stands alone and
    // the two small sections after it share the next sheet.
    expect(countPageUnits([26, 6, 2])).toBe(2);
    expect(countPageUnits([2, 3])).toBe(1);
    expect(countPageUnits([26, 30])).toBe(2);
    expect(countPageUnits([26, 2, 30, 4])).toBe(4);
    expect(countPageUnits([])).toBe(0);
  });

  it('raises the page estimate to the floor the package rule imposes', () => {
    const layout = resolveReportLayout(DEFAULT_SETTINGS);
    expect(estimatePrintedPages(layout, { bodyRows: 4, bandRows: 2 })).toBe(1);
    // Same content, but a package will not share its sheet with what follows it,
    // which is what the composer's "prints as about N page(s)" has to reflect.
    expect(estimatePrintedPages(layout, { bodyRows: 4, bandRows: 2, units: 2 })).toBe(2);
  });
});

/**
 * A layout whose printable width is exactly `width` mm — both side margins move,
 * because `resolveReportLayout` takes the printable width from left *and* right.
 */
function columnsAtPrintableWidth(width: number): [number, number, number, number] {
  const side = (210 - width) / 2;
  const layout = resolveReportLayout(
    withSettings({ reportMarginLeft: side, reportMarginRight: side }),
  );
  return layout.columns;
}
