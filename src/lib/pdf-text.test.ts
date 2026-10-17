import { describe, it, expect } from 'vitest';
import { winAnsiSafe, hasUnprintableChars, unprintableIn } from './pdf-text';

/**
 * The encoding contract for anything printed through jsPDF's standard-14 fonts.
 *
 * The behaviour being guarded is the silent kind: an undrawable code point is
 * written as the low bytes of its UTF-16 unit, so `₹` arrives as space + `¹` and
 * a Devanagari name arrives as tabs and digits. Measured against the installed
 * jsPDF in `scripts/probes/jspdf-encoding-probe.mjs`. A gap is recoverable on paper; a
 * plausible-looking wrong character on a clinical document is not.
 */
describe('winAnsiSafe', () => {
  it('keeps what cp1252 genuinely draws', () => {
    const kept = 'A-Za-z 0-9 àéîõü ñç µ × ÷ · — – … ‘’“” € ½ ¾ °';
    expect(winAnsiSafe(kept)).toBe(kept);
  });

  it('transcodes the meanings that have a safe spelling', () => {
    expect(winAnsiSafe('₹450')).toBe('Rs.450');
    expect(winAnsiSafe('WBC ↑')).toBe('WBC (H)');
    expect(winAnsiSafe('↓ low')).toBe('(L) low');
    expect(winAnsiSafe('≤ 5.61')).toBe('<= 5.61');
    expect(winAnsiSafe('≥ 12')).toBe('>= 12');
    expect(winAnsiSafe('5 ± 0.2')).toBe('5 +/- 0.2');
    expect(winAnsiSafe('√2')).toBe('sqrt2');
  });

  it('drops what has no safe spelling rather than inventing one', () => {
    // A substituted character on a report is a fabrication; a missing one is a
    // visible gap the lab can notice and fix. F-1 (embed a Unicode font) is the
    // real cure for Devanagari names.
    expect(winAnsiSafe('राहुल Sharma')).toBe('Sharma');
    expect(winAnsiSafe('😀 happy')).toBe('happy');
    expect(winAnsiSafe('〇')).toBe('');
  });

  it('normalises spacing noise and survives non-strings', () => {
    expect(winAnsiSafe('Rahul\u00A0Sharma')).toBe('Rahul Sharma');
    expect(winAnsiSafe('  a   b  ')).toBe('a b');
    expect(winAnsiSafe(null)).toBe('');
    expect(winAnsiSafe(undefined)).toBe('');
    expect(winAnsiSafe(42)).toBe('42');
    // An object reaches here only through a caller that forgot to unwrap a
    // record. Stringifying it is what the bill path has always done, and it is
    // kept on purpose: '[object Object]' on a printout is an obvious bug someone
    // reports, while an empty cell reads as "this test had no value".
    expect(winAnsiSafe({})).toBe('[object Object]');
  });

  it('keeps a long mixed string inside the drawable set', () => {
    const mixed = winAnsiSafe('मरीज ₹1,500 — platelet 2.6 ↑ / µL');
    expect(unprintableIn(mixed)).toBe('');
    expect(mixed).toContain('Rs.');
    expect(mixed).toContain('—');
    expect(mixed).toContain('µ');
  });
});

describe('hasUnprintableChars', () => {
  it('flags input before it reaches the paper', () => {
    // The point of warning at entry: by the time the PDF exists the report has
    // already been handed over, and the lab cannot correct it.
    expect(hasUnprintableChars('राहुल')).toBe(true);
    expect(hasUnprintableChars('cost ₹500')).toBe(true);
    expect(hasUnprintableChars('↑')).toBe(true);
  });

  it('does not cry wolf on the punctuation that prints fine', () => {
    expect(hasUnprintableChars('Asha — Ramesh “nick” µL')).toBe(false);
    expect(hasUnprintableChars('13.0 – 17.0')).toBe(false);
    expect(hasUnprintableChars('')).toBe(false);
    expect(hasUnprintableChars(null)).toBe(false);
  });

  it('agrees with winAnsiSafe on every case it flags', () => {
    for (const sample of ['राहुल', '₹500', '↑', '—', 'µL', '😀x', '√2']) {
      const cleaned = winAnsiSafe(sample);
      const flagged = hasUnprintableChars(sample);
      // Flagged input is either changed by the cleaner or carries a mapping.
      if (flagged) expect(cleaned === sample).toBe(false);
    }
  });
});

describe('unprintableIn', () => {
  it('returns exactly the characters that cannot be drawn', () => {
    expect(unprintableIn('abc')).toBe('');
    expect(unprintableIn('aराb')).toBe('रा');
    expect(unprintableIn('a😀b')).toBe('😀');
  });

  it('ignores control characters, which are invisible rather than wrong', () => {
    expect(unprintableIn('a\nb\tc')).toBe('');
  });
});
