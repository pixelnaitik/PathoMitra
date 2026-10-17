// Does jsPDF's standard helvetica actually encode WinAnsi punctuation?
// Decisive probe: write a PDF with compress:false and read the content stream.
// Every non-ASCII character is a \u escape so this file stays pure ASCII.
import { jsPDF } from 'jspdf';

// A—B–C…D·EµF×G€H’J“K”L
const SAMPLE = 'A\u2014B\u2013C\u2026D\u00B7E\u00B5F\u00D7G\u20ACH\u2019J\u201CK\u201DL';
// रा R₹A√B↑C  (Devanagari, rupee, radical, up-arrow: all outside WinAnsi)
const HARD = '\u0930\u093E R\u20B9A\u221AB\u2191C';

const doc = new jsPDF({ compress: false });
doc.setFont('helvetica', 'normal');
doc.text(SAMPLE, 10, 10);
const text = Buffer.from(doc.output('arraybuffer')).toString('latin1');

const m = text.match(/\(([^)]*)\)\s*Tj|\[([^\]]*)\]\s*TJ/);
const shown = (m?.[1] || m?.[2] || '').replace(/[()\\]/g, '');
const codes = [...shown].map(ch => ch.charCodeAt(0).toString(16).padStart(2, '0'));
console.log('input codepoints:', [...SAMPLE].map(c => c.codePointAt(0).toString(16)).join(' '));
console.log('bytes in PDF    :', codes.join(' '));

const want = {
  'em dash (97)': '97',
  'en dash (96)': '96',
  'ellipsis (85)': '85',
  'middot (b7)': 'b7',
  'micro (b5)': 'b5',
  'multiply (d7)': 'd7',
  'euro (80)': '80',
  'rsquo (92)': '92',
};
for (const [name, hex] of Object.entries(want)) {
  console.log(name.padEnd(16), codes.includes(hex) ? 'PRESENT' : 'MISSING');
}

const doc2 = new jsPDF({ compress: false });
doc2.setFont('helvetica', 'normal');
doc2.text(HARD, 10, 20);
const t2 = Buffer.from(doc2.output('arraybuffer')).toString('latin1');
const m2 = t2.match(/\(([^)]*)\)\s*Tj|\[([^\]]*)\]\s*TJ/);
const s2 = (m2?.[1] || m2?.[2] || '').replace(/[()\\]/g, '');
console.log('undrawable -> bytes:', [...s2].map(c => c.charCodeAt(0).toString(16)).join(' '));
