import type { jsPDF } from 'jspdf';
import { hasUnprintableChars } from './pdf-text';
import devanagariRegular from '../assets/pdf-fonts/NotoSansDevanagari-Regular.ttf?url&inline';
import devanagariBold from '../assets/pdf-fonts/NotoSansDevanagari-Bold.ttf?url&inline';
import generalRegular from '../assets/pdf-fonts/NotoSans-Regular.ttf?url&inline';
import generalBold from '../assets/pdf-fonts/NotoSans-Bold.ttf?url&inline';
import bengaliRegular from '../assets/pdf-fonts/NotoSansBengali-Regular.ttf?url&inline';
import gujaratiRegular from '../assets/pdf-fonts/NotoSansGujarati-Regular.ttf?url&inline';
import gurmukhiRegular from '../assets/pdf-fonts/NotoSansGurmukhi-Regular.ttf?url&inline';
import kannadaRegular from '../assets/pdf-fonts/NotoSansKannada-Regular.ttf?url&inline';
import malayalamRegular from '../assets/pdf-fonts/NotoSansMalayalam-Regular.ttf?url&inline';
import oriyaRegular from '../assets/pdf-fonts/NotoSansOriya-Regular.ttf?url&inline';
import tamilRegular from '../assets/pdf-fonts/NotoSansTamil-Regular.ttf?url&inline';
import teluguRegular from '../assets/pdf-fonts/NotoSansTelugu-Regular.ttf?url&inline';
import arabicRegular from '../assets/pdf-fonts/NotoSansArabic-Regular.ttf?url&inline';
import hebrewRegular from '../assets/pdf-fonts/NotoSansHebrew-Regular.ttf?url&inline';
import mathRegular from '../assets/pdf-fonts/NotoSansMath-Regular.ttf?url&inline';

export const PDF_FONT = 'NotoSansDevanagari';

type FontDefinition = {
  name: string;
  regular: string;
  bold?: string;
  ranges: ReadonlyArray<readonly [number, number]>;
};

const FONTS: FontDefinition[] = [
  { name: PDF_FONT, regular: devanagariRegular, bold: devanagariBold, ranges: [[0x0900, 0x097f]] },
  {
    name: 'NotoSans',
    regular: generalRegular,
    bold: generalBold,
    ranges: [
      [0x0100, 0x024f],
      [0x0370, 0x03ff],
      [0x0400, 0x052f],
    ],
  },
  {
    name: 'NotoSansMath',
    regular: mathRegular,
    ranges: [
      [0x2190, 0x21ff],
      [0x2200, 0x22ff],
      [0x2300, 0x23ff],
    ],
  },
  { name: 'NotoSansBengali', regular: bengaliRegular, ranges: [[0x0980, 0x09ff]] },
  { name: 'NotoSansGujarati', regular: gujaratiRegular, ranges: [[0x0a80, 0x0aff]] },
  { name: 'NotoSansGurmukhi', regular: gurmukhiRegular, ranges: [[0x0a00, 0x0a7f]] },
  { name: 'NotoSansOriya', regular: oriyaRegular, ranges: [[0x0b00, 0x0b7f]] },
  { name: 'NotoSansTamil', regular: tamilRegular, ranges: [[0x0b80, 0x0bff]] },
  { name: 'NotoSansTelugu', regular: teluguRegular, ranges: [[0x0c00, 0x0c7f]] },
  { name: 'NotoSansKannada', regular: kannadaRegular, ranges: [[0x0c80, 0x0cff]] },
  { name: 'NotoSansMalayalam', regular: malayalamRegular, ranges: [[0x0d00, 0x0d7f]] },
  {
    name: 'NotoSansArabic',
    regular: arabicRegular,
    ranges: [
      [0x0600, 0x06ff],
      [0x0750, 0x077f],
      [0xfb50, 0xfdff],
      [0xfe70, 0xfeff],
    ],
  },
  { name: 'NotoSansHebrew', regular: hebrewRegular, ranges: [[0x0590, 0x05ff]] },
];

const prepared = new WeakSet<jsPDF>();
let activeDocument: jsPDF | null = null;

function decodeDataUrl(url: string): string {
  return atob(url.slice(url.indexOf(',') + 1));
}

function fontForCodePoint(cp: number): FontDefinition | null {
  return FONTS.find(font => font.ranges.some(([from, to]) => cp >= from && cp <= to)) ?? null;
}

function requiredFonts(value: unknown, depth = 0): Set<string> {
  const fonts = new Set<string>();
  if (value === null || value === undefined || depth > 8) return fonts;
  if (typeof value === 'string') {
    let hasCurrency = false;
    for (const ch of value) {
      const cp = ch.codePointAt(0) ?? 0;
      if (
        cp < 0x20 ||
        (cp >= 0x20 && cp <= 0x7e) ||
        (cp >= 0x0300 && cp <= 0x036f) ||
        !hasUnprintableChars(ch)
      )
        continue;
      // Every bundled Noto family carries the rupee sign. Defer it until the
      // other characters have selected a family, so Devanagari + ₹ stays on one
      // font while a symbol-only field selects Noto Sans Math. A field that
      // genuinely mixes currency and math fails closed in pdfCellFont.
      if (cp === 0x20b9) {
        hasCurrency = true;
        continue;
      }
      const font = fontForCodePoint(cp);
      if (!font)
        throw new Error(
          `PDF output cannot render U+${cp.toString(16).toUpperCase().padStart(4, '0')} with the bundled fonts.`,
        );
      fonts.add(font.name);
    }
    if (hasCurrency && (fonts.size === 0 || fonts.has('NotoSansMath'))) fonts.add(PDF_FONT);
    return fonts;
  }
  if (Array.isArray(value)) {
    if (value.length > 5000)
      throw new Error('PDF input is too large to validate for font coverage.');
    value.forEach(item => requiredFonts(item, depth + 1).forEach(name => fonts.add(name)));
    return fonts;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 2000)
      throw new Error('PDF input has too many fields to validate for font coverage.');
    entries.forEach(([, item]) => requiredFonts(item, depth + 1).forEach(name => fonts.add(name)));
  }
  return fonts;
}

function registerFont(doc: jsPDF, definition: FontDefinition): void {
  const regularFile = `${definition.name}-Regular.ttf`;
  const boldFile = `${definition.name}-Bold.ttf`;
  doc.addFileToVFS(regularFile, decodeDataUrl(definition.regular));
  doc.addFont(regularFile, definition.name, 'normal');
  const boldSource = definition.bold ?? definition.regular;
  if (boldSource !== definition.regular) doc.addFileToVFS(boldFile, decodeDataUrl(boldSource));
  doc.addFont(boldSource === definition.regular ? regularFile : boldFile, definition.name, 'bold');
}

/** Embed only the bundled font families needed by this document's data. */
export function ensurePdfFont(doc: jsPDF, values?: unknown): void {
  if (prepared.has(doc)) return;
  const needed = requiredFonts(values ?? '');
  needed.add(PDF_FONT);
  activeDocument = doc;
  for (const name of needed) {
    const definition = FONTS.find(font => font.name === name);
    if (definition) registerFont(doc, definition);
  }
  doc.setFont(PDF_FONT, 'normal');
  prepared.add(doc);
}

/** Select one bundled family for a complete cell/string; mixed scripts fail closed. */
export function pdfCellFont(value: unknown): string {
  if (!hasUnprintableChars(value)) return 'helvetica';
  const fonts = requiredFonts(value);
  if (fonts.size > 1)
    throw new Error(
      'A printed field mixes scripts that require different bundled fonts. Split the field before output.',
    );
  return fonts.values().next().value ?? PDF_FONT;
}

/** Preserve Unicode, but refuse a glyph the bundled families cannot draw. */
export const pdfText = (value: unknown): string => {
  const text = String(value ?? '');
  if (!hasUnprintableChars(text)) return text;
  const font = pdfCellFont(text);
  if (activeDocument && font !== 'helvetica') {
    const current = activeDocument.getFont();
    activeDocument.setFont(font, current.fontStyle);
  }
  return text;
};
