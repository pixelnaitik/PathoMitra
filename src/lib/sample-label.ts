import type { SampleRecord } from './models';

/** A compact, scanner-readable accession label using Code 128. */
export async function buildSampleLabelPdf(
  sample: Pick<SampleRecord, 'accessionNo' | 'barcode' | 'patientId' | 'specimen' | 'container' | 'orderId'>,
  patientName: string,
  orderNo?: string,
): Promise<import('jspdf').jsPDF> {
  const { jsPDF } = await import('jspdf');
  const { default: JsBarcode } = await import('jsbarcode');
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 120;
  JsBarcode(canvas, sample.barcode || sample.accessionNo, {
    format: 'CODE128',
    displayValue: true,
    fontSize: 14,
    height: 42,
    width: 1.4,
    margin: 0,
  });
  const barcode = canvas.toDataURL('image/png');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [70, 45] });
  doc.setProperties({ title: `Accession ${sample.accessionNo}` });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('PATHOMITRA · SPECIMEN', 5, 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Patient: ${patientName}`, 5, 12);
  doc.text(`ID: ${sample.patientId}`, 5, 16);
  doc.text(`Order: ${orderNo || sample.orderId.slice(0, 12)}`, 5, 20);
  doc.text(`Specimen: ${sample.specimen || '—'}`, 5, 24);
  doc.text(`Container: ${sample.container || '—'}`, 5, 28);
  doc.addImage(barcode, 'PNG', 5, 31, 60, 11);
  return doc;
}
