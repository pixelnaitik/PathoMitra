/**
 * Print perceptibility math — the numbers behind "can the lab actually see it".
 *
 * Why this is code and not a comment: every separator in the report PDF was
 * derived from the brand ramp as a high-white mix (the hairline was brand colour
 * at 72 % white, the patient box border at 80 %). Measured against paper white
 * those land at 1.4–1.6:1, and the desktop path then rasterises the page at
 * 300 dpi, where a 0.1 mm stroke is 1.18 device pixels. The result printed as a
 * blank sheet with text floating on it, while the on-screen preview — which
 * scales its borders up to a CSS pixel — looked fine. Screen contrast is not
 * paper contrast.
 *
 * WCAG 1.4.11 (non-text contrast) asks for 3:1 for the graphical objects that
 * carry meaning. Row rules, box borders and status stamps are exactly that: a
 * row separator that is invisible is a missing row boundary on a clinical
 * document. Text tokens keep the stricter 4.5:1 body-text bar.
 *
 * A tint *band* is not a contrast object — it is ink density. Below roughly 8 %
 * ink an office laser printer under-exposes it into non-existence, so a band
 * becomes a printing artifact rather than a design element.
 */

export type Rgb = [number, number, number];

/** WCAG 1.4.11 — non-text contrast (rules, borders, stamps, icons). */
export const MIN_GRAPHIC_CONTRAST = 3;
/** WCAG 1.4.3 — body text against its background. */
export const MIN_TEXT_CONTRAST = 4.5;
/**
 * Faintest tint band that survives an office laser printer, measured as the
 * channel distance from white weighted by luminance (see `inkDensity`).
 *
 * Calibrated against the brand ramp, not guessed: the navy tint the patient box
 * used to carry sat at 0.060, and the section band at 0.094. 0.07 sits between
 * them, so a band that reads as ink on paper clears the bar while a 6 % wash —
 * which prints as nothing — does not.
 */
export const MIN_INK_DENSITY = 0.07;

/** Paper white, the background every report token is drawn on. */
export const PAPER_WHITE: Rgb = [255, 255, 255];

/**
 * Minimum stroke width, in millimetres, for a line that has to be seen.
 *
 * 0.25 mm is 2.95 device pixels at the 300 dpi the desktop print path renders
 * at (`print-model.ts` `PRINT_RENDER_SCALE`), which is the point where a laser
 * printer lays down a continuous line rather than a dithered suggestion of one.
 */
export const PRINT_HAIRLINE_MM = 0.25;

/** A rule that frames or separates major blocks wants a little more weight. */
export const PRINT_RULE_MM = 0.4;

const toLinear = (channel8bit: number): number => {
  const c = Math.min(255, Math.max(0, channel8bit)) / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** WCAG relative luminance. Accepts any triple; out-of-range channels clamp. */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb;
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Convenience: a colour against the paper it will be printed on. */
export function contrastAgainstWhite(rgb: Rgb): number {
  return contrastRatio(rgb, PAPER_WHITE);
}

/** Fraction of ink in a tint of white — 0.07 is a 7 % band. */
export function inkDensity(rgb: Rgb): number {
  const lum = relativeLuminance(rgb);
  // White is luminance 1; a flat 1 - lum overstates a pale tint's darkness, so
  // the metric is the average channel distance from 255, which is how a printer
  // driver maps the same colour to a toner percentage.
  const avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
  return Math.min(1, Math.max(0, (255 - avg) / 255) * (0.6 + lum * 0.4));
}

/** A separator/border/stamp visible on paper? */
export function isGraphicVisible(rgb: Rgb): boolean {
  return contrastAgainstWhite(rgb) >= MIN_GRAPHIC_CONTRAST;
}

/** A tint band dark enough to read as a band rather than as a misfeed? */
export function isBandVisible(rgb: Rgb): boolean {
  return inkDensity(rgb) >= MIN_INK_DENSITY;
}

/**
 * The darkest of a candidate list that still meets `min` contrast on paper.
 *
 * Used to keep a brand-derived token on-brand without letting it fade out: the
 * ramp is walked light→dark and the first entry that clears the threshold wins,
 * so `HAIRLINE` stays a neutral gray family while still being chosen for the
 * lab's palette where a coloured rule is wanted.
 */
export function firstVisible(candidates: Rgb[], min = MIN_GRAPHIC_CONTRAST): Rgb {
  return candidates.find(c => contrastAgainstWhite(c) >= min) ?? candidates[candidates.length - 1];
}

/**
 * Neutral rule greys, by theme-independent ink weight, all ≥ 3:1 on paper.
 * `hairline` is the default row separator; `strong` is for a box border that
 * alone defines the patient identity card.
 */
export const NEUTRAL_RULES = {
  /** #8a8f98 — 3.25:1 measured. Row separators. */
  hairline: [138, 143, 152] as Rgb,
  /** #6b7280 — 4.83:1 measured. Box borders, stamp outlines. */
  strong: [107, 114, 128] as Rgb,
  /** #5b6168 — 6.26:1 measured. Rules that frame a section. */
  frame: [91, 97, 104] as Rgb,
} as const;

/**
 * Zebra tint: #e6e9ee, 0.077 ink density — clears `MIN_INK_DENSITY` while
 * staying light enough that 10 pt black type on it is still ~16:1.
 *
 * Neutral rather than brand-derived on purpose: striping that shifts with the
 * theme changes the report's colour every time the lab edits an unrelated
 * setting, and a saturated 7 % tint is exactly what an office laser drops out.
 */
export const ZEBRA_TINT: Rgb = [230, 233, 238];
