import { describe, it, expect } from 'vitest';
import {
  NEUTRAL_RULES,
  ZEBRA_TINT,
  MIN_GRAPHIC_CONTRAST,
  MIN_INK_DENSITY,
  PRINT_HAIRLINE_MM,
  contrastAgainstWhite,
  contrastRatio,
  inkDensity,
  isGraphicVisible,
  isBandVisible,
  firstVisible,
  relativeLuminance,
} from './print-contrast';
import { buildReportPalette } from './report-layout';

/**
 * The perceptibility floor for anything printed.
 *
 * These numbers are not decoration. Every separator in the report PDF used to be
 * a brand tint at 72-80 % white drawn on a 0.1 mm stroke, which measures 1.4-1.6
 * against paper; the desktop print path then rasterises the page at 300 dpi,
 * where 0.1 mm is 1.18 device pixels. The result was a printed report with no
 * visible row rules while the on-screen preview — borders scaled up to a CSS
 * pixel — looked correct. A threshold nobody can see is not a design choice, it
 * is a missing feature.
 */
describe('contrast math', () => {
  it('matches WCAG for the two anchors', () => {
    expect(contrastAgainstWhite([0, 0, 0])).toBeCloseTo(21, 0);
    expect(contrastAgainstWhite([255, 255, 255])).toBeCloseTo(1, 5);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(relativeLuminance([0, 0, 0])).toBe(0);
  });

  it('is symmetric and never divides by zero', () => {
    const a: [number, number, number] = [10, 94, 166];
    const b: [number, number, number] = [176, 42, 58];
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
    expect(contrastRatio(a, a)).toBeCloseTo(1, 5);
  });

  it('clamps out-of-range channels instead of producing NaN', () => {
    // A value that reached the renderer through a corrupt data URL or a bad
    // settings file must not be able to make the contrast gate crash.
    expect(Number.isFinite(relativeLuminance([999, -40, 12]))).toBe(true);
    expect(contrastAgainstWhite([999, -40, 12])).toBeGreaterThan(1);
  });
});

describe('print tokens', () => {
  it('keeps every structural rule at or above 3:1 on paper', () => {
    for (const [name, rgb] of Object.entries(NEUTRAL_RULES)) {
      expect(contrastAgainstWhite(rgb)).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST);
      expect(isGraphicVisible(rgb)).toBe(true);
      expect(name).toBeTruthy();
    }
  });

  it('makes the zebra band visible ink rather than a misfeed', () => {
    expect(isBandVisible(ZEBRA_TINT)).toBe(true);
    expect(inkDensity(ZEBRA_TINT)).toBeGreaterThanOrEqual(MIN_INK_DENSITY);
    // Black type on the band still clears the body-text bar.
    expect(contrastRatio([29, 29, 31], ZEBRA_TINT)).toBeGreaterThanOrEqual(4.5);
  });

  it('reports the 0.1 mm stroke as sub-pixel at the print raster', () => {
    // 300 dpi is what `PRINT_RENDER_SCALE` in print-model.ts renders at.
    const pxAt300 = (mm: number) => (mm * 300) / 25.4;
    expect(pxAt300(0.1)).toBeLessThan(1.2);
    expect(pxAt300(PRINT_HAIRLINE_MM)).toBeGreaterThan(2.9);
  });

  it('picks the first candidate that survives printing', () => {
    const pick = firstVisible([[240, 244, 249], [200, 210, 225], NEUTRAL_RULES.hairline]);
    expect(pick).toEqual(NEUTRAL_RULES.hairline);
    // Nothing passes: the darkest entry is returned rather than an invisible one.
    expect(
      firstVisible([
        [250, 250, 250],
        [245, 245, 245],
      ]),
    ).toEqual([245, 245, 245]);
  });
});

describe('report palette', () => {
  // The same assertion the audit could not make before this module existed:
  // the palette was free to hand the renderer a rule nobody could see.
  it.each([
    ['navy', '#0a5ea6'],
    ['teal', '#0b7265'],
    ['amethyst', '#6d3fc4'],
    ['graphite', '#3a3a3c'],
  ])('gives every theme a visible hairline and box border (%s)', (_name, hex) => {
    const palette = buildReportPalette(hex, 'modern');
    expect(contrastAgainstWhite(palette.HAIRLINE)).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST);
    expect(contrastAgainstWhite(palette.BOX_BORDER)).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST);
    expect(contrastAgainstWhite(palette.FRAME)).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST);
  });

  it('keeps section band tints above the ink-density floor', () => {
    const palette = buildReportPalette('#0a5ea6', 'modern');
    expect(isBandVisible(palette.BRAND_SOFT)).toBe(true);
    expect(isBandVisible(palette.BRAND_TINT)).toBe(true);
  });

  it('types the band in a colour that clears text contrast against the band', () => {
    const palette = buildReportPalette('#0a5ea6', 'modern');
    expect(contrastRatio(palette.BRAND_DARK, palette.BRAND_SOFT)).toBeGreaterThanOrEqual(4.5);
    // The reversed header band: white on the darkest brand step.
    expect(contrastRatio([255, 255, 255], palette.BRAND_DARK)).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves the plain-pad template on pure black rules', () => {
    // Deliberate: a pad lab prints into pre-registered artwork, and the lightest
    // possible ink is what keeps the form readable under it.
    const palette = buildReportPalette('#0a5ea6', 'blank');
    expect(palette.HAIRLINE).toEqual([0, 0, 0]);
    expect(palette.BOX_BORDER).toEqual([0, 0, 0]);
    expect(palette.FRAME).toEqual([0, 0, 0]);
  });
});
