/**
 * Guard: what the registration sheet is allowed to say about an unpriced test.
 *
 * Owner instruction, 2026-10-16: stop printing "No price yet for CBC (COMPLETE
 * BLOOD COUNT) …" while the order is being built. The line is not a warning the
 * counter can act on mid-registration — pricing a tariff sheet happens in
 * Settings, and the sentence fired on every unpriced order until it did. What
 * replaced it is a mark on the thing itself (the chip, and the charge summary),
 * because the failure being prevented is not "the counter is surprised" — it is
 * a ₹0 reaching a printed bill with nothing next to it.
 *
 * That last part is billing rule 6 and it is asserted here too, at the one place
 * it could silently regress: the cells written into the PDF. `price-list.test.ts`
 * proves the line carries `unpriced: true`; nothing else proved the paper said
 * so out loud.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * vitest sets the working directory to the project root, and under jsdom
 * `import.meta.url` is not a `file:` URL — same reason marketing-claims.test.ts
 * reads through cwd. Block comments are stripped because this repo records *why*
 * copy was removed inside the file that used to carry it.
 */
const read = (relative: string) =>
  readFileSync(resolve(process.cwd(), relative), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const REGISTRATION = 'src/pages/dashboard/PatientsPage.tsx';
const PDF = 'src/lib/invoice-pdf.ts';

describe('the registration sheet marks an unpriced test instead of announcing it', () => {
  it('no longer prints the "No price yet for …" sentence', () => {
    expect(read(REGISTRATION)).not.toMatch(/No price yet/i);
  });

  it('still names the unpriced lines, on the chip and in the charge summary', () => {
    const sheet = read(REGISTRATION);
    expect(sheet).toMatch(/function NotPricedTag/);
    expect(sheet).toMatch(/unpricedSet\.has\(group\.name\)/);
    expect(sheet).toMatch(/unpricedSet\.has\(test\)/);
    expect(sheet).toMatch(/not priced/);
  });

  it('asks for the address after the tests, not before them', () => {
    const sheet = read(REGISTRATION);
    const tests = sheet.indexOf('Test Selection');
    const address = sheet.indexOf('<Field label="Address"');
    expect(tests).toBeGreaterThan(-1);
    expect(address).toBeGreaterThan(tests);
  });
});

describe('the bill an unpriced order produces', () => {
  it('prints "not priced" in the rate column, never a bare 0', () => {
    expect(read(PDF)).toMatch(/item\.unpriced \? 'not priced' : pdfMoney\(item\.unitPrice\)/);
  });

  it('leaves the amount column blank rather than charging ₹0', () => {
    expect(read(PDF)).toMatch(/item\.unpriced \? '-' : pdfMoney\(item\.lineTotal\)/);
  });
});
