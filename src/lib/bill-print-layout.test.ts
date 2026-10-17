/**
 * Guard: the printed bill's layout.
 *
 * Owner instruction, 2026-10-17, after the first bill was actually put on paper:
 * the counter copy had lines running into each other (the "Amount" heading
 * wrapped to "Amou / nt" and the rule over the Total struck through the figure
 * above it), and it carried two fields a patient's bill has no business printing
 * — the patient's phone number and the name of whoever raised it.
 *
 * These are source guards, not render tests: jsPDF writes a binary stream, so
 * "did the text overlap" cannot be asserted without a printer. What *can* be
 * pinned is the geometry that caused it — the column widths, the clearance above
 * the emphasised rule, and the fact that both header blocks are now measured and
 * wrapped instead of being allowed to run the full page width into each other.
 * The same technique `registration-copy.test.ts` uses for printed copy.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pdfMoney, pdfSafeText } from './invoice-pdf';

/**
 * vitest sets the working directory to the project root, and under jsdom
 * `import.meta.url` is not a `file:` URL — same reason registration-copy.test.ts
 * reads through cwd. Block comments are stripped because this repo records *why*
 * a field was removed inside the file that used to print it.
 */
const read = (relative: string) =>
  readFileSync(resolve(process.cwd(), relative), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const PDF = 'src/lib/invoice-pdf.ts';

/** One builder's source, so a rule about the bill cannot be satisfied by the statement. */
function section(name: string): string {
  const source = read(PDF);
  const start = source.indexOf(`export async function ${name}`);
  if (start === -1) throw new Error(`${name} is gone from ${PDF}`);
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe('the patient’s bill prints the patient, not the paperwork', () => {
  const bill = section('buildInvoicePdf');

  it('has no Contact row', () => {
    expect(bill).not.toMatch(/'Contact'/);
    expect(bill).not.toMatch(/patient\?\.phone/);
  });

  it('has no "Raised By" row', () => {
    expect(bill).not.toMatch(/'Raised By'/i);
    expect(bill).not.toMatch(/invoice\.issuedBy/);
  });

  it('still prints who referred the patient', () => {
    // Removing the counter's own bookkeeping must not remove the clinically
    // relevant line — the referring doctor is what a patient checks.
    expect(bill).toMatch(/'Referring Doctor'/);
  });
});

describe('the bill table gives its money columns room', () => {
  const bill = section('buildInvoicePdf');

  it('gives the amount column enough width for its own heading', () => {
    const width = Number(bill.match(/const AMOUNT_W = (\d+)/)?.[1] ?? 0);
    // 12 mm minus 2 × 1.8 mm cell padding is 8.4 mm — narrower than "Amount"
    // set at 8.5 pt bold, which is why the heading used to break in half.
    expect(width).toBeGreaterThanOrEqual(20);
  });

  it('keeps the rate column wide enough for "not priced"', () => {
    const width = Number(bill.match(/const RATE_W = (\d+)/)?.[1] ?? 0);
    expect(width).toBeGreaterThanOrEqual(20);
  });

  it('adds the columns up to the printable width, with the name taking the rest', () => {
    const numbers = ['SPECIMEN_W', 'QTY_W', 'RATE_W', 'AMOUNT_W'].map(key =>
      Number(bill.match(new RegExp(`const ${key} = (\\d+)`))?.[1] ?? 0),
    );
    expect(numbers.every(value => value > 0)).toBe(true);
    // A4 is 210 mm with 14 mm margins → 182 mm of table. The test-name column
    // must keep the lion's share, or profiles like "CBC (COMPLETE BLOOD COUNT)"
    // wrap.
    expect(182 - numbers.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(90);
  });
});

describe('nothing on the printed page runs into anything else', () => {
  it('clears the rule above an emphasised total', () => {
    for (const source of ['buildInvoicePdf', 'buildStatementPdf'].map(section)) {
      const offset = Number(source.match(/doc\.line\(boxLeft, ty - ([\d.]+)/)?.[1] ?? 0);
      // 3.2 mm over a baseline that sat 5 mm under the previous figure put the
      // rule between the two lines of text — a strike-through over "Total".
      expect(offset).toBeGreaterThanOrEqual(4);
      const step = Number(source.match(/ty \+= emphasise \? (\d+(?:\.\d+)?)/)?.[1] ?? 0);
      expect(step).toBeGreaterThanOrEqual(7);
      // The emphasised row gets a lead-in of its own before the rule is drawn.
      expect(source).toMatch(/if \(emphasise\) ty \+= /);
    }
  });

  it('wraps the lab name and the document title instead of overlapping them', () => {
    const source = read(PDF);
    // Whitespace-tolerant on purpose. These read the *source text*, and the
    // project's own pre-commit Prettier pass is free to reflow a long call onto
    // several lines — a guard that breaks on formatting is a guard someone
    // deletes rather than fixes. What must not regress is the wrapping itself:
    // the name/title going through splitTextToSize with a width argument.
    expect(source).toMatch(/splitTextToSize\(\s*pdfSafeText\(h\.labName\),\s*\n?\s*[^)]/);
    expect(source).toMatch(/splitTextToSize\(\s*pdfSafeText\(title\),\s*width \* 0\.42\)/);
  });

  it('wraps a field-grid value inside its own column', () => {
    const source = read(PDF);
    const grid = source.slice(
      source.indexOf('function drawFieldGrid'),
      source.indexOf('function itemCells'),
    );
    expect(grid.length).toBeGreaterThan(0);
    expect(grid).toMatch(/splitTextToSize\(valueA, cellWidth\)/);
    expect(grid).toMatch(/splitTextToSize\(valueB, cellWidth\)/);
    // The row has to grow with the wrapped value, or the next label prints on top
    // of the second line.
    expect(grid).toMatch(/Math\.max\(linesA\.length, linesB\.length, 1\)/);
  });
});

describe('pdfMoney', () => {
  it('writes the rupee as "Rs." because the built-in font cannot draw ₹', () => {
    expect(pdfMoney(400)).toBe('Rs. 400');
    expect(pdfMoney(400)).not.toContain('₹');
  });

  it('groups Indian digits and keeps paise only when there are some', () => {
    expect(pdfMoney(12500)).toBe('Rs. 12,500');
    expect(pdfMoney(150000)).toBe('Rs. 1,50,000');
    expect(pdfMoney(1234.5)).toBe('Rs. 1,234.50');
  });

  it('prints a non-finite amount as zero rather than NaN', () => {
    expect(pdfMoney(Number.NaN)).toBe('Rs. 0');
    expect(pdfMoney(Infinity)).toBe('Rs. 0');
  });
});

describe('pdfSafeText', () => {
  it('converts what a WinAnsi font cannot draw instead of printing boxes', () => {
    expect(pdfSafeText('₹400')).toBe('Rs.400');
    expect(pdfSafeText('Rahul\u00A0Sharma')).toBe('Rahul Sharma');
  });

  it('keeps the punctuation cp1252 actually draws', () => {
    // These used to be downgraded to ASCII on the assumption a standard-14 font
    // could not draw them. It can: measured against the installed jsPDF, an em
    // dash is written as byte 97, an en dash as 96 and a curly quote as 92-94
    // (`scripts/probes/jspdf-encoding-probe.mjs`). Downgrading them was costing the bill
    // and the report their typography for no safety at all.
    expect(pdfSafeText('Rahul \u2014 Sharma')).toBe('Rahul \u2014 Sharma');
    expect(pdfSafeText('13.0 \u2013 17.0')).toBe('13.0 \u2013 17.0');
    expect(pdfSafeText('\u201CRahul\u201D')).toBe('\u201CRahul\u201D');
    expect(pdfSafeText('4.5 \u00B7 10')).toBe('4.5 \u00B7 10');
    // Still transcoded where no glyph exists.
    expect(pdfSafeText('WBC \u2191')).toBe('WBC (H)');
    expect(pdfSafeText('5 \u00B1 0.2')).toBe('5 +/- 0.2');
  });

  it('drops characters outside Latin-1 rather than guessing at them', () => {
    // The known casualty of the open Unicode-font item (F-1): a Devanagari name
    // prints empty. It is dropped loudly here; left alone it would print as two
    // bytes of unrelated punctuation per character, which is worse on a clinical
    // document than a gap.
    expect(pdfSafeText('राहुल Sharma')).toBe('Sharma');
  });

  it('survives null, undefined and a collapsed run of spaces', () => {
    expect(pdfSafeText(null)).toBe('');
    expect(pdfSafeText(undefined)).toBe('');
    expect(pdfSafeText('  a   b  ')).toBe('a b');
  });
});
