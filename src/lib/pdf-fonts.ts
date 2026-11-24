import type { jsPDF } from 'jspdf';
import { hasUnprintableChars } from './pdf-text';
import regularFont from '@expo-google-fonts/noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf?url&inline';
import boldFont from '@expo-google-fonts/noto-sans-devanagari/700Bold/NotoSansDevanagari_700Bold.ttf?url&inline';

export const PDF_FONT = 'NotoSansDevanagari';
export const pdfText = (value: unknown): string => String(value ?? '');
/** Keep standard-14 metrics for ordinary text; switch only cells that need Unicode. */
export const pdfCellFont = (value: unknown): string => hasUnprintableChars(value) ? PDF_FONT : 'helvetica';
const prepared = new WeakSet<jsPDF>();

function decodeDataUrl(url: string): string {
  const base64 = url.slice(url.indexOf(',') + 1);
  const binary = atob(base64);
  return binary;
}

/** Embed the bundled OFL font so Indic names, ₹, and arrows survive PDF output. */
export function ensurePdfFont(doc: jsPDF): void {
  if (prepared.has(doc)) return;
  doc.addFileToVFS('NotoSansDevanagari-Regular.ttf', decodeDataUrl(regularFont));
  doc.addFont('NotoSansDevanagari-Regular.ttf', PDF_FONT, 'normal');
  doc.addFileToVFS('NotoSansDevanagari-Bold.ttf', decodeDataUrl(boldFont));
  doc.addFont('NotoSansDevanagari-Bold.ttf', PDF_FONT, 'bold');
  doc.setFont(PDF_FONT, 'normal');
  prepared.add(doc);
}
