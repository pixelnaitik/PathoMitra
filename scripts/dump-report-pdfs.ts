/**
 * Renders real report PDFs through the production builder and writes them to
 * buildoutput/ for a paper check. Not a test: it exists because nothing in this
 * project has ever been printed, and a passing geometry assertion is not the
 * same as seeing the sheet.
 *
 * Run: npx tsx scripts/dump-report-pdfs.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildReportDocument } from '../src/lib/report-pdf';
import { buildReportLegalLines } from '../src/lib/report-compliance';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { PAD_LAYOUT_PRESET } from '../src/lib/report-layout';
import type { LabSettings } from '../src/lib/settings';
import type { PatientRecord, ReportRecord } from '../src/lib/models';

const CBC_MEMBERS = [
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

const RESULTS: Record<string, string> = {
  'WHITE CELL COUNT(TC)': '12.5',
  NEUTROPHIL: '78',
  LYMPHOCYTE: '14',
  EOSINOPHIL: '4',
  MONOCYTE: '4',
  BASOPHIL: '0.5',
  'ABSOLUTE NEUTROPHIL COUNT': '9.75',
  'ABSOLUTE LYMPHOCYTE COUNT': '1.75',
  'ABSOLUTE MONOCYTE COUNT': '0.5',
  'ABSOLUTE EOSINOPHILL COUNT': '0.5',
  'ABSOLUTE BASOPHIL COUNT': '0.06',
  'RBC (RED BLOOD CELLS)': '4.71',
  'HB (HAEMOGLOBIN)': '13.9',
  'HCT(PCV)': '41',
  MCV: '89.2',
  MCH: '29.5',
  MCHC: '33.9',
  'RDW%': '13.1',
  'RDW-SD': '41.5',
  'PLATELET COUNT': '2.6',
  MPV: '10.2',
  PDW: '15.8',
  PCT: '0.21',
  // P-LCC and P-LCR deliberately left blank: a blank result must print as an
  // em dash, not as nothing, so a non-resulted test is not read as a printer fault.
};

const patient = {
  id: 'demo-patient-0001',
  name: 'Asha Ramesh Sharma',
  age: 41,
  gender: 'female',
  phone: '98765 43210',
  doctorName: 'Dr Mehta',
  address: 'Kothrud, Pune',
  createdAt: '2026-10-15T09:00:00.000Z',
} as PatientRecord;

const baseReport = {
  id: 'demo-report-abcdef123456',
  patientId: patient.id,
  patientName: patient.name,
  status: 'final',
  version: 1,
  signature: 'Dr A. Pathologist',
  createdBy: 'Dr A. Pathologist',
  createdAt: '2026-10-15T09:30:00.000Z',
  updatedAt: '2026-10-15T09:30:00.000Z',
  testSelection: ['CBC (COMPLETE BLOOD COUNT)', ...CBC_MEMBERS],
  resultData: RESULTS,
} as unknown as ReportRecord;

const settings: LabSettings = {
  ...DEFAULT_SETTINGS,
  labName: 'Healthcare Diagnostics Centre',
  address: '2nd Floor, Shivaji Nagar, Pune 411005',
  phone: '+91 20 4000 4000',
  email: 'pathomitra@healthcarediagnosticscenter.in',
  licenceNumber: 'MH-PATH-2026-004182',
};

const legal = buildReportLegalLines({
  licenceNumber: settings.licenceNumber,
  accreditationBody: settings.accreditationBody,
  accreditationNumber: settings.accreditationNumber,
  accreditationAttestedAt: settings.accreditationAttestedAt,
  signerName: 'Dr A. Pathologist',
  signedAt: baseReport.updatedAt,
});

const outDir = path.resolve('buildoutput/print-checks');
fs.mkdirSync(outDir, { recursive: true });

/** What each sheet is meant to prove, on paper. */
const cases: Array<{
  file: string;
  why: string;
  report?: ReportRecord;
  settings?: LabSettings;
  patientOverride?: PatientRecord;
}> = [
  {
    file: '01-cbc-modern-plainpaper.pdf',
    why: 'CBC on the new compact default margins — must be ONE page',
  },
  {
    file: '02-cbc-pad-margins.pdf',
    why: 'Same report on 50/20/8/15 pad margins, one-page fit ON — may compact',
    settings: { ...settings, ...PAD_LAYOUT_PRESET },
  },
  {
    file: '03-cbc-pad-margins-no-fit.pdf',
    why: 'Pad margins with the fit switched OFF — the lab typography wins across pages',
    settings: { ...settings, ...PAD_LAYOUT_PRESET, reportFitToOnePage: false },
  },
  {
    file: '04-amended-v2.pdf',
    why: 'Amendment must be visible: AMENDED v2 stamp, reason block, two dates',
    report: {
      ...baseReport,
      version: 2,
      status: 'final',
      amendReason: 'Platelet count repeated after a clot was observed in the first sample.',
      updatedAt: '2026-10-17T11:20:00.000Z',
    },
  },
  {
    file: '05-draft.pdf',
    why: 'A draft must print DRAFT, never FINAL',
    report: { ...baseReport, status: 'draft' },
  },
  {
    file: '06-zebra-classic.pdf',
    why: 'Band separators on the classic template — survives a photocopy',
    settings: { ...settings, reportTemplate: 'classic', reportRowSeparators: 'zebra' },
  },
  {
    file: '07-minimalist-hairline.pdf',
    why: 'Hairline separators at 0.25 mm / 3:1 on the minimalist template',
    settings: { ...settings, reportTemplate: 'minimalist' },
  },
  {
    file: '08-plain-pad-template.pdf',
    why: 'The blank template: results only — no masthead, no row rules, no footer band',
    settings: { ...settings, ...PAD_LAYOUT_PRESET, reportTemplate: 'blank' },
  },
  {
    file: '09-two-panels.pdf',
    why: 'CBC is a package, so it takes its own sheet and the urine starts on the next — no section is ever split across two sheets',
    report: {
      ...baseReport,
      testSelection: [
        'CBC (COMPLETE BLOOD COUNT)',
        ...CBC_MEMBERS,
        'URINE ROUTINE',
        'PROTEIN',
        'SUGAR',
        'PUS CELLS',
        'RBC',
        'EPITHELIAL CELLS',
      ],
      resultData: {
        ...RESULTS,
        PROTEIN: 'TRACE',
        SUGAR: 'NEGATIVE',
        'PUS CELLS': '4-6',
        RBC: '0-1',
        'EPITHELIAL CELLS': '2-3',
      },
    },
  },
  {
    file: '10-child-caveat.pdf',
    why: 'A 6-year-old on adult intervals must carry the footnote on paper',
    patientOverride: { ...patient, age: 6, gender: 'male' } as PatientRecord,
  },
  {
    file: '11-pad-template-two-sheets.pdf',
    why: 'Pad template, CBC + urine: the package takes sheet 1 and the rest sheet 2 — sheet 2 starts at the top edge with no strip, no page counter and no row rules',
    settings: { ...settings, ...PAD_LAYOUT_PRESET, reportTemplate: 'blank' },
    report: {
      ...baseReport,
      testSelection: [
        'CBC (COMPLETE BLOOD COUNT)',
        ...CBC_MEMBERS,
        'URINE ROUTINE',
        'PROTEIN',
        'SUGAR',
        'PUS CELLS',
        'RBC',
        'EPITHELIAL CELLS',
      ],
      resultData: {
        ...RESULTS,
        PROTEIN: 'TRACE',
        SUGAR: 'NEGATIVE',
        'PUS CELLS': '4-6',
        RBC: '0-1',
        'EPITHELIAL CELLS': '2-3',
      },
    },
  },
  {
    file: '12-small-sections-share-one-sheet.pdf',
    why: 'Three small tests in two sections and no package: one sheet, no forced break — the package rule fires on size, not on category',
    settings: { ...settings, ...PAD_LAYOUT_PRESET, reportTemplate: 'blank' },
    report: {
      ...baseReport,
      testSelection: ['S. creatinine', 'S. Para Typhi "A(H)"', 'S. para Typhi "B(H)"'],
      resultData: {
        'S. creatinine': '0.9',
        'S. Para Typhi "A(H)"': 'NEGATIVE',
        'S. para Typhi "B(H)"': 'NEGATIVE',
      },
    },
  },
];

let failures = 0;
for (const testCase of cases) {
  const report = testCase.report ?? baseReport;
  try {
    const built = await buildReportDocument({
      report,
      patient: testCase.patientOverride ?? patient,
      settings: testCase.settings ?? settings,
      mode: 'print',
      signerName: 'Dr A. Pathologist',
      legal,
    });
    const buffer = Buffer.from(built.doc.output('arraybuffer'));
    const file = path.join(outDir, testCase.file);
    fs.writeFileSync(file, buffer);
    console.log(
      `${built.pageCount} page(s)  ${String(buffer.length).padStart(9)} B  ${testCase.file}\n` +
        `             ${testCase.why}`,
    );
    if (/01-cbc/.test(testCase.file) && built.pageCount !== 1) {
      console.error('  ^^ EXPECTED ONE PAGE');
      failures += 1;
    }
  } catch (err) {
    console.error(`FAILED ${testCase.file}:`, err);
    failures += 1;
  }
}

console.log(
  `\nwrote ${cases.length - failures}/${cases.length} sheets to ${path.relative(process.cwd(), outDir)}/`,
);
console.log('Print at 100% (no "fit to page") on plain A4 to judge the real thing.');
process.exit(failures > 0 ? 1 : 0);
