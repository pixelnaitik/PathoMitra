import { describe, expect, it } from 'vitest';
import type { jsPDF } from 'jspdf';
import { ensurePdfFont, PDF_FONT, pdfCellFont, pdfText } from './pdf-fonts';

describe('bundled PDF font coverage', () => {
  it.each([
    ['राहुल शर्मा', PDF_FONT],
    ['বাংলা নাম', 'NotoSansBengali'],
    ['ગુજરાતી', 'NotoSansGujarati'],
    ['ਪੰਜਾਬੀ', 'NotoSansGurmukhi'],
    ['ଓଡ଼ିଆ', 'NotoSansOriya'],
    ['தமிழ்', 'NotoSansTamil'],
    ['తెలుగు', 'NotoSansTelugu'],
    ['ಕನ್ನಡ', 'NotoSansKannada'],
    ['മലയാളം', 'NotoSansMalayalam'],
    ['العربية', 'NotoSansArabic'],
    ['עברית', 'NotoSansHebrew'],
    ['Ελληνικά', 'NotoSans'],
    ['Русский', 'NotoSans'],
    ['√2 ≤ 5', 'NotoSansMath'],
  ])('selects a bundled family for %s', (text, expected) => {
    expect(pdfCellFont(text)).toBe(expected);
    expect(pdfText(text)).toBe(text);
  });

  it('keeps ordinary Latin on the standard font and preserves currency symbols', () => {
    expect(pdfCellFont('CBC 13.9 – 17.5')).toBe('helvetica');
    expect(pdfCellFont('₹400')).toBe(PDF_FONT);
    expect(pdfCellFont('↑ 1,250')).toBe('NotoSansMath');
  });

  it('fails closed for an unsupported script instead of printing mojibake', () => {
    expect(() => pdfCellFont('中文')).toThrow(/U\+4E2D/);
  });

  it('refuses one field that mixes font families', () => {
    expect(() => pdfCellFont('राहুল বাংলা')).toThrow(/mixes scripts/);
  });

  it('refuses currency mixed with math in one field instead of dropping a glyph', () => {
    expect(() => pdfCellFont('₹1,250 ↑')).toThrow(/mixes scripts/);
  });

  it('embeds only the families required by the document plus the report face', () => {
    const registered: string[] = [];
    const doc = {
      addFileToVFS: () => {},
      addFont: (_file: string, name: string) => registered.push(name),
      setFont: () => {},
      getFont: () => ({ fontStyle: 'normal' }),
    } as unknown as jsPDF;
    ensurePdfFont(doc, { patientName: 'বাংলা নাম' });
    expect(registered).toContain(PDF_FONT);
    expect(registered).toContain('NotoSansBengali');
    expect(registered).not.toContain('NotoSansArabic');
  });
});
