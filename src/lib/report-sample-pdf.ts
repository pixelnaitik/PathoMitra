/**
 * Sample report PDF — the *real* builder, run on sample content.
 *
 * This used to be a second, hand-copied implementation of the document: the same
 * masthead, the same patient box, the same table, drawn again with the same
 * magic numbers. It shared only the resolved *numbers* with the generator
 * (`report-layout.ts`), none of the drawing code, and had already drifted —
 * it drew literal `↑` / `↓` glyphs that jsPDF's standard-14 fonts cannot encode
 * (they come out as punctuation), used an en dash in reference ranges where the
 * report used a hyphen, and was fixed at five rows so it could never show what a
 * two-page report looks like.
 *
 * It is now a thin caller of `buildReportDocument`, which means "Preview PDF" in
 * Settings shows the document the laboratory would actually hand over, including
 * page breaks, the status stamp, the footnotes and the fit-to-one-page pass.
 */
import type { LabSettings } from './settings';
import { previewPdf } from './native-print';
import { buildReportDocument, type ReportPdfInput } from './report-pdf';
import { buildReportLegalLines } from './report-compliance';
import { resolveReportLayout } from './report-layout';
import type { PatientRecord, ReportRecord } from './models';

/**
 * A CBC, because it is the panel that stresses the layout: 25 measurable members
 * under one heading is exactly what used to spill onto a second sheet. One value
 * is deliberately out of range so the flag prints, and one deliberately blank so
 * the em-dash placeholder shows — both are states a lab sees every day.
 */
const SAMPLE_TESTS = [
  'WHITE CELL COUNT(TC)',
  'NEUTROPHIL',
  'LYMPHOCYTE',
  'EOSINOPHIL',
  'MONOCYTE',
  'BASOPHIL',
  'ABSOLUTE NEUTROPHIL COUNT',
  'ABSOLUTE LYMPHOCYTE COUNT',
  'ABSOLUTE MONOCYTE COUNT',
  'ABSOLUTE EOSINOPHILL COUNT',
  'ABSOLUTE BASOPHIL COUNT',
  'RBC (RED BLOOD CELLS)',
  'HB (HAEMOGLOBIN)',
  'HCT(PCV)',
  'MCV',
  'MCH',
  'MCHC',
  'RDW%',
  'RDW-SD',
  'PLATELET COUNT',
  'MPV',
  'PDW',
  'PCT',
  'P-LCC',
  'P-LCR',
];

const SAMPLE_RESULTS: Record<string, string> = {
  'WHITE CELL COUNT(TC)': '12.5',
  'HB (HAEMOGLOBIN)': '13.9',
  'PLATELET COUNT': '2.6',
  MCV: '89.2',
  'RDW%': '13.1',
  NEUTROPHIL: '72',
  LYMPHOCYTE: '20',
  MONOCYTE: '5',
  'RBC (RED BLOOD CELLS)': '4.7',
  'HCT(PCV)': '41',
};

const samplePatient: PatientRecord = {
  id: 'sample-patient-0001',
  name: 'Sample Patient',
  age: 41,
  gender: 'female',
  doctorName: 'Dr A. Reference',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const sampleReport: ReportRecord = {
  id: 'sample-report-000001',
  patientId: samplePatient.id,
  patientName: samplePatient.name,
  status: 'final',
  version: 1,
  signature: 'Dr A. Pathologist',
  createdBy: 'Dr A. Pathologist',
  createdAt: '2026-01-01T00:00:00.000Z',
  testSelection: ['CBC (COMPLETE BLOOD COUNT)', ...SAMPLE_TESTS],
  resultData: Object.fromEntries(SAMPLE_TESTS.map(name => [name, SAMPLE_RESULTS[name] ?? ''])),
} as ReportRecord;

/** Build and open the sample; returns a message when the tab was refused. */
export async function openSampleReportPdf(
  settings: LabSettings,
  mode: 'print' | 'share' = 'print',
): Promise<string | null> {
  const layout = resolveReportLayout(settings, mode);
  if (!layout.printable.valid) {
    return 'Margins leave no printable area — fix the highlighted values first.';
  }

  const signerName = 'Dr A. Pathologist';
  const legal = buildReportLegalLines({
    accreditationBody: settings.accreditationBody,
    accreditationNumber: settings.accreditationNumber,
    licenceNumber: settings.licenceNumber,
    accreditationAttestedAt: settings.accreditationAttestedAt,
    signerName,
  });

  const input: ReportPdfInput = {
    report: sampleReport,
    patient: samplePatient,
    settings,
    mode,
    signerName,
    legal,
    // The share letterhead is an uploaded image here; the sample never fetches the
    // shipped default through a canvas, because that is the page's job and this
    // module has to stay drawable without a DOM.
    shareTemplateImage: mode === 'share' ? settings.sharingTemplateImage : '',
  };

  const { doc, filename } = await buildReportDocument(input);
  return previewPdf(doc, filename);
}
