/**
 * Bill and referral-statement PDFs.
 *
 * One file on purpose. The audit backlog already carries `F-4` ("single PDF
 * pipeline"), so a third document generator alongside the report PDF and the
 * sample PDF would be the wrong direction — both builders here share one
 * letterhead, one palette resolution, one money renderer and one page frame.
 *
 * ⚠ `F-1` (PDF Unicode font) is still open, and it bites harder here than on a
 * clinical report. jsPDF's built-in fonts are WinAnsi: `₹` (U+20B9) is not in
 * that encoding and prints as a box or a space. A bill is the document a patient
 * takes home and a lab may have to produce to a tax officer, so the currency is
 * rendered as `Rs.` — the ordinary Indian commercial abbreviation, always
 * WinAnsi-safe — rather than shipping a glyph that silently disappears. Changing
 * this is a one-line edit in `pdfMoney()` once a Unicode font is embedded.
 *
 * Everything else is ordinary jsPDF + jspdf-autotable, lazily imported like the
 * report path so the library stays out of the initial bundle.
 */
import { buildReportPalette, A4, resolveReportLayout } from './report-layout';
import { winAnsiSafe } from './pdf-text';
import { THEME_OPTIONS } from './theme';
import { formatAmount } from './notification-engine';
import { legacyInvoiceNo } from './invoice-registry';
import { balanceOf } from './invoices';
import type { InvoiceItem, InvoiceRecord, PatientRecord } from './models';
import { monthLabel, type DoctorStatement } from './referrals';
import type { LabSettings } from './settings';
import { printPdf, previewPdf, savePdf, sharePdf, pdfToBase64 } from './native-print';
import { getShellKind } from './native-files';

const rgba = (c: readonly [number, number, number]): [number, number, number] => [c[0], c[1], c[2]];

/**
 * Paint a colour without spreading.
 *
 * jsPDF's `setTextColor` / `setDrawColor` / `setFillColor` are overloaded
 * signatures rather than a rest parameter, so `(...tuple)` fails to type-check
 * against them. Three explicit arguments always work.
 */
const ink = (doc: jsPdfDoc, c: Rgb) => doc.setTextColor(c[0], c[1], c[2]);
const draw = (doc: jsPdfDoc, c: Rgb) => doc.setDrawColor(c[0], c[1], c[2]);
const fill = (doc: jsPdfDoc, c: Rgb) => doc.setFillColor(c[0], c[1], c[2]);
void fill; // available to the next document that needs a filled band

/** Bill margins — compact, nothing like the 50 mm pad margin of a clinical report. */
const M = { top: 14, right: 14, bottom: 14, left: 14 } as const;

/**
 * Money as it may be drawn with a standard PDF font.
 *
 * `formatAmount` keeps its `₹` because it feeds on-screen alerts, where the glyph
 * is fine; the printed document must not depend on an encoding jsPDF does not
 * have. Grouping stays `en-IN` so the digits read the way the lab reads them.
 *
 * The lab's `BillingPrefs.currency` is deliberately *not* consulted here: any
 * symbol outside Latin-1 (`₹`, `₩`, `฿`) is exactly the thing that cannot be
 * drawn, and a bill is not the place to find that out at the printer.
 */
export function pdfMoney(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const grouped = safe.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(safe) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `Rs. ${grouped}`;
}

/**
 * Strip what a WinAnsi font cannot draw, rather than let it print mojibake.
 *
 * The rule itself lives in `lib/pdf-text` because the *clinical* report needs
 * exactly the same protection and used not to have it: a bill sanitised every
 * string while a report printed a Devanagari patient name raw, and jsPDF writes
 * an undrawable code point as two bytes of unrelated Latin ("रा" comes back as a
 * tab and a zero). One rule, both documents.
 *
 * It is now also less destructive than this function used to be. The old body
 * downgraded en/em dashes and curly quotes to ASCII, but the probe in
 * `scripts/probes/jspdf-encoding-probe.mjs` shows cp1252 encodes those correctly — so
 * "13.0 – 17.0" and "NOTE —" now print as typed instead of as hyphens.
 * Devanagari names remain the known casualty of `F-1`.
 */
export function pdfSafeText(value: unknown): string {
  return winAnsiSafe(value);
}

interface Letterhead {
  labName: string;
  address: string;
  contact: string;
  credentials: string;
  brand: [number, number, number];
  brandDark: [number, number, number];
  hairline: [number, number, number];
}

type Rgb = [number, number, number];

function letterhead(settings: LabSettings): Letterhead {
  const L = resolveReportLayout(settings);
  const hex = (THEME_OPTIONS.find(t => t.id === L.themeId) ?? THEME_OPTIONS[0]).previewColor;
  const P = buildReportPalette(hex, L.template === 'blank' ? 'modern' : L.template);
  const contact = [settings.phone, settings.email].filter(Boolean).join('   |   ');
  const credentials = [L.legal.accreditation, L.legal.licence].filter(Boolean).join('   |   ');
  return {
    labName: L.labName,
    address: settings.address || '',
    contact,
    credentials,
    brand: rgba(P.BRAND),
    brandDark: rgba(P.BRAND_DARK),
    hairline: rgba(P.HAIRLINE),
  };
}

/**
 * Draw the lab block + the document title, and return the y below the rule.
 *
 * The two blocks share the first baseline, so each owns one half of the line and
 * wraps inside it. Before that ceiling existed, a long laboratory name ran the
 * full page width and printed straight through the right-aligned document title
 * — the owner's "overlapping lines" on the counter copy. `splitTextToSize` is
 * measured against the font actually set, so the wrap holds for any theme.
 */
function drawHeader(
  doc: jsPdfDoc,
  h: Letterhead,
  title: string,
  refNo: string,
  dateLine: string,
): number {
  const right = A4.widthMm - M.right;
  const width = right - M.left;

  // Font first, measure second — `splitTextToSize` uses the size currently set,
  // so splitting before `setFont` would wrap a 16 pt name as if it were 10 pt.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  ink(doc, h.brandDark);
  const nameBlock = doc.splitTextToSize(
    pdfSafeText(h.labName),
    width * 0.56,
  ) as unknown as string[];
  doc.text(nameBlock, M.left, M.top + 4);
  // 16 pt helvetica is a 5.6 mm line; the small print below it is 4 mm.
  let y = M.top + 4 + nameBlock.length * 5.6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(90, 95, 100);
  y += 1;
  if (h.address) {
    doc.text(pdfSafeText(h.address), M.left, y, { maxWidth: width * 0.56 });
    y += 4;
  }
  if (h.contact) {
    doc.text(pdfSafeText(h.contact), M.left, y, { maxWidth: width * 0.56 });
    y += 4;
  }
  if (h.credentials) {
    doc.setFontSize(7);
    doc.text(pdfSafeText(h.credentials), M.left, y, { maxWidth: width * 0.56 });
    y += 4;
  }

  // Document title sits opposite the lab block, right-aligned, in its own column.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  ink(doc, h.brand);
  const titleBlock = doc.splitTextToSize(pdfSafeText(title), width * 0.42) as unknown as string[];
  doc.text(titleBlock, right, M.top + 4, { align: 'right' });
  let refY = M.top + 4 + titleBlock.length * 4.6 + 1.4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(70, 74, 78);
  doc.text(pdfSafeText(refNo), right, refY, { align: 'right' });
  refY += 4.5;
  doc.text(pdfSafeText(dateLine), right, refY, { align: 'right' });

  const rule = Math.max(y, refY, M.top + 18) + 2;
  draw(doc, h.brand);
  doc.setLineWidth(0.6);
  doc.line(M.left, rule, right, rule);
  return rule + 6;
}

/**
 * A two-column field/value grid.
 *
 * A value that does not fit its column wraps inside it and the row grows to fit,
 * rather than running under the next column or over the label beneath it — the
 * second place the printed bill used to overlap itself (a long patient name or
 * referring-doctor name on the counter copy).
 */
function drawFieldGrid(
  doc: jsPdfDoc,
  y: number,
  rows: ReadonlyArray<readonly [label: string, value: string, label2?: string, value2?: string]>,
): number {
  const right = A4.widthMm - M.right;
  const half = (right - M.left) / 2;
  const cellWidth = half - 6; // gutter between the two columns
  let cursor = y;
  for (const [labelA, valueA, labelB, valueB] of rows) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 124, 128);
    doc.text(pdfSafeText(labelA.toUpperCase()), M.left, cursor);
    if (labelB !== undefined) doc.text(pdfSafeText(labelB.toUpperCase()), M.left + half, cursor);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(25, 28, 31);
    const linesA = doc.splitTextToSize(valueA, cellWidth) as unknown as string[];
    const linesB =
      valueB === undefined
        ? ([] as string[])
        : (doc.splitTextToSize(valueB, cellWidth) as unknown as string[]);
    doc.text(linesA, M.left, cursor + 4);
    if (valueB !== undefined) doc.text(linesB, M.left + half, cursor + 4);

    // 9.5 pt is a 3.4 mm line; + 6 mm keeps the row clear of the label under it.
    // A single-line row advances exactly as far as it always did (10 mm).
    cursor += 4 + Math.max(linesA.length, linesB.length, 1) * 3.4 + 2.6;
  }
  return cursor;
}

/** Types only — jsPDF is imported lazily inside each builder. */
type jsPdfDoc = import('jspdf').jsPDF;

/** How a line looks on paper. An unpriced line is never printed as `0`. */
function itemCells(item: InvoiceItem): [string, string, string, string, string] {
  const name = item.kind === 'panel' ? `${item.name}  (Profile)` : item.name;
  return [
    pdfSafeText(name),
    pdfSafeText(item.detail || ''),
    String(item.qty),
    item.unpriced ? 'not priced' : pdfMoney(item.unitPrice),
    item.unpriced ? '-' : pdfMoney(item.lineTotal),
  ];
}

export interface InvoicePdfInput {
  invoice: InvoiceRecord;
  patient?: Pick<
    PatientRecord,
    'id' | 'name' | 'age' | 'gender' | 'phone' | 'address' | 'doctorName'
  > | null;
  settings: LabSettings;
  /** Stamp the paid amount even on an unpaid bill (counter copy). */
  copy?: 'patient' | 'lab';
}

/**
 * Build a printed bill.
 *
 * Renders **only what the stored invoice carries** — never the live price list —
 * so a reprint months later is byte-for-byte the document that was handed over.
 */
export async function buildInvoicePdf(input: InvoicePdfInput): Promise<jsPdfDoc> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const { invoice, settings } = input;
  const h = letterhead(settings);

  const filename = `Bill ${invoice.invoiceNo || invoice.id.slice(0, 8)}.pdf`;
  const doc = new jsPDF();
  doc.setProperties({ title: filename });

  const refNo = `Bill No. ${invoice.invoiceNo || legacyInvoiceNo(invoice.id)}`;
  const dateLine = `Date: ${formatDate(invoice.createdAt)}`;
  let y = drawHeader(doc, h, 'CASH MEMO / BILL', refNo, dateLine);

  const patientName = invoice.patientName || input.patient?.name || '—';
  const ageSex = [
    input.patient?.age !== undefined ? `Age ${input.patient.age}` : '',
    input.patient?.gender ? input.patient.gender : '',
  ]
    .filter(Boolean)
    .join(' / ');
  y = drawFieldGrid(doc, y, [
    ['Patient', pdfSafeText(patientName), 'Registration No.', pdfSafeText(invoice.patientId)],
    [
      'Details',
      pdfSafeText(ageSex),
      'Referring Doctor',
      pdfSafeText(invoice.doctorName || input.patient?.doctorName || 'Self'),
    ],
  ]);

  /**
   * Column widths, in mm, for a 182 mm table.
   *
   * The Amount column used to be 12 mm wide — 8.4 mm once the 1.8 mm cell
   * padding on both sides was taken off, which is narrower than its own
   * "Amount" heading. The header wrapped to "Amou / nt" and any rupee figure
   * above a few thousand wrapped with it, so the money column of a printed bill
   * read as a stack of broken words. Rate carries "not priced" on the same
   * footing, and the test name takes whatever is left.
   */
  const SPECIMEN_W = 24;
  const QTY_W = 12;
  const RATE_W = 24;
  const AMOUNT_W = 24;
  const nameColWidth = A4.widthMm - M.left - M.right - SPECIMEN_W - QTY_W - RATE_W - AMOUNT_W;

  autoTable(doc, {
    startY: y + 2,
    head: [['Test / Profile', 'Specimen', 'Qty', 'Rate', 'Amount']],
    body: invoice.items.map(item => [...itemCells(item)]),
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 1.8,
      lineColor: h.hairline,
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: h.brand,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    alternateRowStyles: { fillColor: [248, 249, 251] },
    columnStyles: {
      0: { cellWidth: nameColWidth },
      1: { cellWidth: SPECIMEN_W, textColor: [90, 95, 100] },
      2: { cellWidth: QTY_W, halign: 'center' },
      3: { cellWidth: RATE_W, halign: 'right' },
      4: { cellWidth: AMOUNT_W, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: M.left, right: M.right, top: M.top },
  });

  // ---- Totals ------------------------------------------------------------
  const afterTable = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable;
  let ty = (afterTable?.finalY ?? y + 20) + 5;
  const right = A4.widthMm - M.right;
  const boxLeft = right - 74;
  const totals: Array<[string, string, boolean]> = [
    ['Subtotal', pdfMoney(invoice.subtotal), false],
    ...(invoice.discount > 0
      ? ([['Discount', `- ${pdfMoney(invoice.discount)}`, false]] as Array<
          [string, string, boolean]
        >)
      : []),
    ...(invoice.tax > 0
      ? ([
          [`GST / Tax @ ${trimNumber(invoice.taxPercent)}%`, pdfMoney(invoice.tax), false],
        ] as Array<[string, string, boolean]>)
      : []),
    ['Total', pdfMoney(invoice.amount), true],
  ];
  if (invoice.paidAmount > 0) totals.push(['Paid', pdfMoney(invoice.paidAmount), false]);
  const outstanding = balanceOf(invoice);
  if (outstanding > 0 && invoice.status !== 'void') {
    totals.push(['Balance Due', pdfMoney(outstanding), false]);
  }

  for (const [label, value, emphasise] of totals) {
    if (ty > A4.heightMm - M.bottom - 26) {
      doc.addPage();
      ty = M.top + 4;
    }
    // The emphasised line carries a rule above it. It used to sit 3.2 mm over a
    // baseline only 5 mm below the previous figure, so the rule landed between
    // the two and read on paper as a strike-through across "Total". The extra
    // lead-in and the wider step give the rule its own air on both sides.
    if (emphasise) ty += 3;
    doc.setFont('helvetica', emphasise ? 'bold' : 'normal');
    doc.setFontSize(emphasise ? 11 : 9);
    ink(doc, emphasise ? h.brandDark : [40, 44, 48]);
    doc.text(pdfSafeText(label), boxLeft, ty);
    doc.text(pdfSafeText(value), right, ty, { align: 'right' });
    if (emphasise) {
      draw(doc, h.brand);
      doc.setLineWidth(0.4);
      doc.line(boxLeft, ty - 4.6, right, ty - 4.6);
    }
    ty += emphasise ? 8 : 5.5;
  }

  // ---- Payment status ----------------------------------------------------
  // A plain unpaid bill prints no status stamp. "PAYABLE ON COLLECTION" was
  // removed on the lab's request (2026-10-17): the Total line and the terms
  // footer already say what is due, and the red stamp read as an alarm on an
  // ordinary counter copy. Only a settled, part-paid or cancelled bill is
  // stamped.
  const statusWord =
    invoice.status === 'void'
      ? 'CANCELLED'
      : invoice.status === 'paid'
        ? 'PAID'
        : invoice.status === 'partial'
          ? `PART PAYMENT - ${formatAmount(outstanding)} DUE`
          : '';
  if (statusWord) {
    const statusY = Math.min(A4.heightMm - M.bottom - 14, ty + 4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    if (invoice.status === 'paid') {
      ink(doc, h.brand);
      draw(doc, h.brand);
      doc.setLineWidth(0.5);
      doc.roundedRect(M.left, statusY - 5, 60, 11, 2, 2, 'S');
      doc.text(pdfSafeText(statusWord), M.left + 30, statusY + 1.5, { align: 'center' });
    } else {
      doc.setTextColor(150, 40, 40);
      doc.text(pdfSafeText(statusWord), M.left, statusY + 2);
    }
  }

  // No commission line here, deliberately. What a referring practitioner is owed
  // is a private term between the lab and that practitioner; it belongs on the
  // statement PDF, never on the copy a patient walks out with.

  // ---- Footer ------------------------------------------------------------
  const footY = A4.heightMm - M.bottom - 6;
  draw(doc, h.hairline);
  doc.setLineWidth(0.2);
  doc.line(M.left, footY - 6, right, footY - 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 124, 128);
  doc.text(
    pdfSafeText(
      `Terms: Reports/records collectable at the time of printing. ${input.copy === 'lab' ? 'Lab copy.' : 'Payment receipt.'} Generated by PathoMitra.`,
    ),
    M.left,
    footY,
  );
  doc.text(pdfSafeText(`Page 1`), right, footY, { align: 'right' });

  return doc;
}

/**
 * Build one doctor's referral statement for a period.
 *
 * Carries what the lab asked for and nothing a patient should see: patient names,
 * the tests done for them, the bill reference and date, the rate agreed with this
 * practitioner, and the commission each bill earned — summed at the foot.
 *
 * `periodLabel` is a pre-formatted human string ("October 2026", "01 Oct 2026 -
 * 15 Oct 2026", "All dates") supplied by the caller, so the heading matches the
 * window that was actually built (month or custom range) rather than assuming one.
 */
export async function buildStatementPdf(
  statement: DoctorStatement,
  settings: LabSettings,
  periodLabel: string,
): Promise<jsPdfDoc> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const h = letterhead(settings);

  const filename = `Referral statement ${statement.doctorName} ${periodLabel}.pdf`;
  const doc = new jsPDF();
  doc.setProperties({ title: filename });

  let y = drawHeader(
    doc,
    h,
    'REFERRAL STATEMENT',
    `Period: ${pdfSafeText(periodLabel)}`,
    `Issued: ${formatDate(new Date().toISOString())}`,
  );

  y = drawFieldGrid(doc, y, [
    [
      'To',
      pdfSafeText(statement.doctorName),
      'Contact',
      pdfSafeText(statement.phone || statement.clinic || '-'),
    ],
    [
      'Rate on file',
      `${trimNumber(statement.percent)}%`,
      'Bills in period',
      String(statement.totals.bills),
    ],
  ]);

  autoTable(doc, {
    startY: y + 2,
    head: [['Bill No.', 'Date', 'Patient', 'Tests referred', 'Bill', 'Rate', 'Commission']],
    body: statement.lines.map(line => [
      pdfSafeText(line.invoiceNo || '-'),
      formatDate(line.billedAt),
      pdfSafeText(line.patientName),
      pdfSafeText(line.tests.join(', ') || '-'),
      pdfMoney(line.billAmount),
      `${trimNumber(line.percent)}%`,
      pdfMoney(line.commission),
    ]),
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 1.6,
      lineColor: h.hairline,
      lineWidth: 0.1,
      valign: 'top',
    },
    headStyles: { fillColor: h.brand, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 18 },
      2: { cellWidth: 30 },
      3: { cellWidth: A4.widthMm - M.left - M.right - 26 - 18 - 30 - 22 - 14 - 22 },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 14, halign: 'center' },
      6: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: M.left, right: M.right, top: M.top },
  });

  const afterTable = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable;
  let ty = (afterTable?.finalY ?? y + 20) + 6;
  const right = A4.widthMm - M.right;
  const boxLeft = right - 74;

  const rows: Array<[string, string, boolean]> = [
    ['Total billed in period', pdfMoney(statement.totals.billAmount), false],
    ['Collected', pdfMoney(statement.totals.collected), false],
    ...(statement.totals.outstanding > 0
      ? ([['Outstanding', pdfMoney(statement.totals.outstanding), false]] as Array<
          [string, string, boolean]
        >)
      : []),
    ['Commission payable', pdfMoney(statement.totals.commission), true],
  ];
  if (statement.totals.commissionPending > 0) {
    rows.push([
      'of which on uncollected bills',
      pdfMoney(statement.totals.commissionPending),
      false,
    ]);
  }

  for (const [label, value, emphasise] of rows) {
    if (ty > A4.heightMm - M.bottom - 30) {
      doc.addPage();
      ty = M.top + 4;
    }
    if (emphasise) ty += 3; // see the bill totals: the rule needs its own air
    doc.setFont('helvetica', emphasise ? 'bold' : 'normal');
    doc.setFontSize(emphasise ? 11 : 9);
    ink(doc, emphasise ? h.brandDark : [40, 44, 48]);
    doc.text(pdfSafeText(label), boxLeft, ty);
    doc.text(pdfSafeText(value), right, ty, { align: 'right' });
    if (emphasise) {
      draw(doc, h.brand);
      doc.setLineWidth(0.4);
      doc.line(boxLeft, ty - 4.6, right, ty - 4.6);
    }
    ty += emphasise ? 8 : 5.5;
  }

  const footY = A4.heightMm - M.bottom - 8;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 124, 128);
  doc.text(
    pdfSafeText(
      "Commission is computed on the discounted bill value (tax excluded) at the rate agreed with this practitioner, and is payable per the lab's terms.",
    ),
    M.left,
    footY,
    { maxWidth: A4.widthMm - M.left - M.right },
  );
  if (statement.unmatched) {
    doc.setTextColor(150, 40, 40);
    doc.setFont('helvetica', 'bold');
    doc.text(
      pdfSafeText('Note: this practitioner is not in the doctor register - details to verify.'),
      M.left,
      footY + 6,
    );
  }

  return doc;
}

/** Consolidated statement for every practitioner in one month. */
export async function buildStatementsSummaryPdf(
  statements: readonly DoctorStatement[],
  settings: LabSettings,
  month: string,
): Promise<jsPdfDoc> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const h = letterhead(settings);

  const doc = new jsPDF();
  const filename = `Referral summary ${month}.pdf`;
  doc.setProperties({ title: filename });
  const y = drawHeader(
    doc,
    h,
    'REFERRAL SUMMARY',
    `Period: ${pdfSafeText(monthLabel(month))}`,
    `Issued: ${formatDate(new Date().toISOString())}`,
  );

  autoTable(doc, {
    startY: y + 2,
    head: [['Doctor', 'Bills', 'Patients', 'Billed', 'Rate', 'Commission']],
    body: statements.map(s => [
      pdfSafeText(s.doctorName) + (s.unmatched ? ' *' : ''),
      String(s.totals.bills),
      String(s.totals.patients),
      pdfMoney(s.totals.billAmount),
      `${trimNumber(s.percent)}%`,
      pdfMoney(s.totals.commission),
    ]),
    theme: 'striped',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: h.brand, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      1: { halign: 'center' },
      2: { halign: 'center' },
      3: { halign: 'right' },
      4: { halign: 'center' },
      5: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: M.left, right: M.right, top: M.top },
  });

  const total = statements.reduce((sum, s) => sum + s.totals.commission, 0);
  const afterTable = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  ink(doc, h.brandDark);
  doc.text(
    pdfSafeText(`Total payable  ${pdfMoney(total)}`),
    A4.widthMm - M.right,
    (afterTable?.finalY ?? 40) + 8,
    { align: 'right' },
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 124, 128);
  doc.text(pdfSafeText('* not in the doctor register'), M.left, A4.heightMm - M.bottom);
  return doc;
}

/** The lab's published tariff — the sheet that hangs at the reception counter. */
export async function buildPriceListPdf(
  rows: ReadonlyArray<{ name: string; category: string; price: number | null; active: boolean }>,
  settings: LabSettings,
): Promise<jsPdfDoc> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const h = letterhead(settings);

  const doc = new jsPDF();
  const filename = `Price list ${formatDate(new Date().toISOString())}.pdf`;
  doc.setProperties({ title: filename });
  const y = drawHeader(
    doc,
    h,
    'PRICE LIST',
    `${rows.length} tests`,
    `Effective: ${formatDate(new Date().toISOString())}`,
  );

  autoTable(doc, {
    startY: y + 2,
    head: [['Test / Profile', 'Category', 'Price']],
    body: rows.map(row => [
      pdfSafeText(row.name) + (row.active ? '' : '  (discontinued)'),
      pdfSafeText(row.category),
      row.price === null ? 'not priced' : pdfMoney(row.price),
    ]),
    theme: 'striped',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6 },
    headStyles: { fillColor: h.brand, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 50, textColor: [90, 95, 100] },
      2: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: M.left, right: M.right, top: M.top },
  });
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 124, 128);
  doc.text(
    pdfSafeText(
      'Prices in Indian Rupees, exclusive of applicable taxes. Subject to change without notice.',
    ),
    M.left,
    A4.heightMm - M.bottom,
  );
  return doc;
}

// ---------------------------------------------------------------------------
// Output routing — the same four-way split the report PDF uses
// ---------------------------------------------------------------------------

export type InvoiceOutput = 'print' | 'preview' | 'download' | 'share';

/**
 * Put a finished document in front of the user.
 *
 * The Windows shell gets the app's own <PrintDialog> (returned as base64 so the
 * caller can mount it — the shell-verb path spools blindly to whatever Windows
 * calls the default printer). The APK and the browser go through `printPdf` /
 * `previewPdf`, which already know how to land a PDF on each of them.
 *
 * @returns a base64 job when the desktop dialog should take over, else a message.
 */
export async function outputInvoicePdf(
  doc: jsPdfDoc,
  filename: string,
  action: InvoiceOutput,
  subject = filename,
): Promise<{
  printJob: { title: string; filename: string; pdfBase64: string } | null;
  message: string | null;
}> {
  if (action === 'print') {
    if (getShellKind() === 'desktop') {
      return {
        printJob: { title: subject, filename, pdfBase64: pdfToBase64(doc) },
        message: null,
      };
    }
    // Android's print sheet and the browser's print tab confirm themselves; only a
    // thrown failure needs relaying, and the caller's own catch does that.
    await printPdf(doc, filename);
    return { printJob: null, message: null };
  }
  if (action === 'preview') {
    return { printJob: null, message: await previewPdf(doc, filename) };
  }
  if (action === 'download') {
    return { printJob: null, message: await savePdf(doc, filename) };
  }
  return { printJob: null, message: await sharePdf(doc, filename, subject) };
}

function formatDate(iso: string): string {
  const date = new Date(String(iso ?? ''));
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** `12.50` → `12.5`, `18` → `18` — a rate on paper never carries dead zeros. */
function trimNumber(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
