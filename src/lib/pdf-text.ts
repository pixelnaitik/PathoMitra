/**
 * What a jsPDF standard-14 font can actually draw, and what to do about it.
 *
 * The built-in Helvetica/Times/Courier are WinAnsiEncoding (cp1252) fonts. A
 * code point outside that encoding is not rejected and not drawn as a box — it
 * is written as the raw low bytes of the UTF-16 code unit, so the viewer
 * renders *two unrelated Latin characters instead*. Measured against the
 * installed jsPDF (`scripts/probes/jspdf-encoding-probe.mjs`, 2026-10-17):
 *
 *   ₹  U+20B9  ->  bytes 20 B9   prints as space + superscript-one
 *   √  U+221A  ->  bytes 22 1A   prints as a quote + a sub-script letter
 *   ↑  U+2191  ->  bytes 21 91   prints as an exclamation + a quote
 *   रा U+0930  ->  bytes 09 30   prints as a tab + the digit zero
 *
 * That is the worst possible failure for a clinical document: it is silent, and
 * the output is plausible-looking wrong text rather than an obvious gap. A
 * Devanagari patient name comes back as punctuation.
 *
 * The same probe shows the previous rule was over-matched. cp1252 punctuation
 * encodes correctly and needs no downgrading:
 *
 *   — U+2014 -> 97   – U+2013 -> 96   … U+2026 -> 85   ’ U+2019 -> 92
 *   “ U+201C -> 93   µ U+00B5 -> B5   × U+00D7 -> D7   · U+00B7 -> B7
 *
 * So an en dash in "13.0 – 17.0" and an em dash in "NOTE —" survive intact, and
 * `pdfSafeText()` in invoice-pdf.ts was turning them into hyphens for nothing.
 * This module keeps the typographic characters that print correctly and removes
 * only the ones that would have silently turned into garbage.
 */

/** Code points cp1252 draws that live outside Latin-1. */
const CP1252_EXTRA = new Set(
  [
    0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
    0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
    0x0153, 0x017e, 0x0178,
  ].map(cp => String.fromCodePoint(cp)),
);

/**
 * Meanings that must survive even though the glyph cannot. Ordered longest-first
 * so a two-character sequence is never half-replaced.
 */
const REPLACEMENTS: Array<[RegExp, string]> = [
  // A non-breaking space is drawable but reads as a normal space and takes the
  // width metrics of one, so it is normalised rather than preserved — a pasted
  // name from a chat app should not carry an invisible wedge into the column.
  [/\u00A0/g, ' '],
  // The rupee sign is the one the lab types constantly, and a bill is the
  // document a patient takes to a tax officer: 'Rs.' is the ordinary Indian
  // commercial abbreviation and is always WinAnsi-safe.
  [/\u20B9/g, 'Rs.'],
  [/\u2191/g, '(H)'],
  [/\u2193/g, '(L)'],
  [/\u2264/g, '<='],
  [/\u2265/g, '>='],
  [/\u00B1/g, '+/-'],
  [/\u221A/g, 'sqrt'],
  [/\u2248/g, '~'],
  [/\u2032/g, "'"],
  [/\u2033/g, '"'],
];

const isPrintable = (ch: string): boolean => {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x20 && cp <= 0x7e) return true; // ASCII printable
  if (cp >= 0xa0 && cp <= 0xff) return true; // Latin-1: accented letters, micro, multiply, degree
  return CP1252_EXTRA.has(ch); // en/em dash, curly quotes, ellipsis, bullet, euro
};

/**
 * Rewrite `value` so every character in it can be drawn by a standard-14 font.
 *
 * Unlike a drop-everything filter this one *transcodes* where a meaning exists
 * (`₹` → `Rs.`, `±` → `+/-`) and drops only what has no safe spelling, so a
 * Devanagari name loses its characters rather than acquiring random punctuation
 * in their place. Dropping is still lossy and `F-1` (embed a Unicode font) is
 * the real fix; until then a lost character is honest and a substituted one is
 * a fabrication on a clinical document.
 */
export function winAnsiSafe(value: unknown): string {
  let text = String(value ?? '');
  for (const [pattern, replacement] of REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  let out = '';
  for (const ch of text) {
    if (isPrintable(ch)) out += ch;
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Does `value` contain something that will not print? Used to warn the operator
 * at the point of entry ("this name will not print correctly") instead of after
 * the report has been handed over — the only moment a lab can still fix it.
 */
export function hasUnprintableChars(value: unknown): boolean {
  const text = String(value ?? '');
  for (const [pattern] of REPLACEMENTS) if (pattern.test(text)) return true;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20) continue; // control characters: not printable, but not silent either
    if (!isPrintable(ch)) return true;
  }
  return false;
}

/**
 * Draw text, or return the string that could not be drawn.
 *
 * `report-pdf.ts` sanitizes every *data* value (patient name, test name, result,
 * unit, note) but not its own literals, so this is the guard that catches a
 * literal drifting into something the font cannot render.
 */
export function unprintableIn(value: string): string {
  return [...value].filter(ch => (ch.codePointAt(0) ?? 0) >= 0x20 && !isPrintable(ch)).join('');
}
