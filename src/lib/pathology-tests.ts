import { readCustomTests } from './settings';

export interface ReferenceRange {
  male?: { min?: number; max?: number; text?: string };
  female?: { min?: number; max?: number; text?: string };
  child?: { min?: number; max?: number; text?: string };
  general?: { min?: number; max?: number; text?: string };
}

export interface PathologyTest {
  id: string;
  name: string;
  category: string;
  unit?: string;
  /**
   * Explicit result kind. When present it always wins over inference in
   * `resolveTestKind` — prefer declaring it for any custom test whose unit or
   * reference-range text is ambiguous (e.g. "< 5", "NEGATIVE", "1:100").
   */
  kind?: TestKind;
  ranges?: ReferenceRange;
  method?: string;
  notes?: string[];
  clinicalSignificance?: string;
  isGroup?: boolean;
  isHeader?: boolean;
  includedTests?: string[];
  options?: string[];
  synonyms?: string[];
}

/**
 * How a test's result is entered and validated.
 * - `numeric`     — a number, colour-coded against the reference range
 * - `categorical` — one of a fixed set of `options` (e.g. blood group)
 * - `titer`       — a dilution ratio such as `1:160`
 * - `text`        — free text / qualitative word (e.g. "NEGATIVE")
 */
export type TestKind = 'numeric' | 'categorical' | 'titer' | 'text';

/** Units and range texts that are words, not measurements. */
const QUALITATIVE_TEXTS = [
  'negative',
  'positive',
  'non-reactive',
  'reactive',
  'absent',
  'present',
  'few',
  'nil',
  'normal',
];

/** `1:160`, `1 in 80`, `<1:40` — a dilution rather than a plain measurement. */
const TITER_PATTERN = /\d+\s*[:/]\s*\d+/;

const rangeEntries = (ranges?: ReferenceRange) =>
  ranges ? [ranges.general, ranges.male, ranges.female, ranges.child] : [];

/**
 * Determine how a test's result should be treated.
 *
 * Previously this logic lived inside ReportsPage as `isNumericTest(testInfo: any)`
 * and inferred the type from `ranges.text`, which mis-classified values like
 * `"< 5"` (read as numeric, fine) and `"NEGATIVE"` (also read as numeric, wrong).
 * An explicit `kind` on the test now short-circuits all inference.
 */
export function resolveTestKind(test?: PathologyTest | null): TestKind {
  if (!test || test.isGroup || test.isHeader) return 'text';
  if (test.kind) return test.kind;
  if (test.options && test.options.length > 0) return 'categorical';

  const unit = (test.unit ?? '').toLowerCase().trim();
  if (unit === 'titer' || unit.includes(':')) return 'titer';

  const texts = rangeEntries(test.ranges)
    .map(r => (r?.text ?? '').trim().toLowerCase())
    .filter(Boolean);

  if (texts.some(t => TITER_PATTERN.test(t))) return 'titer';

  const hasNumericBounds = rangeEntries(test.ranges).some(
    r => typeof r?.min === 'number' || typeof r?.max === 'number',
  );
  if (hasNumericBounds) return 'numeric';

  // A range containing a digit ("< 5", "18-22") implies a measurement, unless
  // every range is a plain qualitative word.
  if (texts.some(t => /[0-9]/.test(t))) return 'numeric';
  if (texts.some(t => QUALITATIVE_TEXTS.includes(t))) return 'text';

  if (unit && !QUALITATIVE_TEXTS.includes(unit)) return 'numeric';
  return 'text';
}

/** True when the result is a number that can be checked against a range. */
export const isNumericTest = (test?: PathologyTest | null): boolean =>
  resolveTestKind(test) === 'numeric';

export const DEFAULT_PATHOLOGY_TESTS: PathologyTest[] = [
  // Full Group CBC
  {
    id: 'cbc_group',
    name: 'CBC (COMPLETE BLOOD COUNT)',
    category: 'HAEMATOLOGY',
    isGroup: true,
    synonyms: ['cbc', 'complete blood count', 'hemogram'],
    includedTests: [
      'WHITE CELL COUNT(TC)',
      'DIFFERENTIAL COUNT WBC',
      'NEUTROPHIL',
      'LYMPHOCYTE',
      'EOSINOPHIL',
      'MONOCYTE',
      'BASOPHIL',
      'DIFFERENTIAL LEUCOCYTE ABSOLUTE COUNT',
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
    ],
  },

  {
    id: 'wbc_tc',
    name: 'WHITE CELL COUNT(TC)',
    category: 'HAEMATOLOGY',
    unit: 'x10³/Cu.mm',
    ranges: {
      child: { min: 5.0, max: 14.5, text: '5.0 - 14.5' },
      male: { min: 4.0, max: 11.0, text: '4.0 - 11.0' },
      female: { min: 4.0, max: 11.0, text: '4.0 - 11.0' },
      general: { min: 4.0, max: 11.0, text: '4.0 - 11.0' },
    },
  },
  {
    id: 'diff_wbc_header',
    name: 'DIFFERENTIAL COUNT WBC',
    category: 'HAEMATOLOGY',
    isHeader: true,
  },
  {
    id: 'neutrophil',
    name: 'NEUTROPHIL',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '40 - 65' } },
  },
  {
    id: 'lymphocyte',
    name: 'LYMPHOCYTE',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '20 - 40' } },
  },
  {
    id: 'eosinophil',
    name: 'EOSINOPHIL',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '1 - 6' } },
  },
  {
    id: 'monocyte',
    name: 'MONOCYTE',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '2 - 8' } },
  },
  {
    id: 'basophil',
    name: 'BASOPHIL',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '0 - 2' } },
  },

  {
    id: 'diff_abs_header',
    name: 'DIFFERENTIAL LEUCOCYTE ABSOLUTE COUNT',
    category: 'HAEMATOLOGY',
    isHeader: true,
  },
  {
    id: 'abs_neutrophil',
    name: 'ABSOLUTE NEUTROPHIL COUNT',
    category: 'HAEMATOLOGY',
    unit: 'x10³/Cu.mm',
    ranges: { general: { text: '1.8 - 7.8' } },
  },
  {
    id: 'abs_lymphocyte',
    name: 'ABSOLUTE LYMPHOCYTE COUNT',
    category: 'HAEMATOLOGY',
    unit: 'x10³/Cu.mm',
    ranges: { general: { text: '1.0 - 4.8' } },
  },
  {
    id: 'abs_monocyte',
    name: 'ABSOLUTE MONOCYTE COUNT',
    category: 'HAEMATOLOGY',
    unit: 'x10³/Cu.mm',
    ranges: { general: { text: '0 - 0.8' } },
  },
  {
    id: 'abs_eosinophil',
    name: 'ABSOLUTE EOSINOPHILL COUNT',
    category: 'HAEMATOLOGY',
    unit: 'x10³/Cu.mm',
    ranges: { general: { text: '0 - 0.45' } },
  },
  {
    id: 'abs_basophil',
    name: 'ABSOLUTE BASOPHIL COUNT',
    category: 'HAEMATOLOGY',
    unit: 'x10³/Cu.mm',
    ranges: { general: { text: '0 - 0.2' } },
  },

  {
    id: 'rbc',
    name: 'RBC (RED BLOOD CELLS)',
    category: 'HAEMATOLOGY',
    unit: 'mill/cumm',
    ranges: {
      child: { min: 4.0, max: 5.2, text: '4.0 - 5.2' },
      male: { min: 4.5, max: 5.5, text: '4.5 - 5.5' },
      female: { min: 3.8, max: 4.8, text: '3.8 - 4.8' },
      general: { min: 3.8, max: 5.5, text: '3.8 - 5.5' },
    },
  },
  {
    id: 'hb',
    name: 'HB (HAEMOGLOBIN)',
    category: 'HAEMATOLOGY',
    unit: 'gm/dl',
    ranges: {
      child: { min: 11.0, max: 14.5, text: '11.0 - 14.5' },
      male: { min: 13.5, max: 17.5, text: '13.5 - 17.5' },
      female: { min: 12.0, max: 15.0, text: '12.0 - 15.0' },
      general: { min: 12.0, max: 17.5, text: '12.0 - 17.5' },
    },
    synonyms: ['hemoglobin (hb)', 'hemoglobin', 'haemoglobin'],
  },
  {
    id: 'hct',
    name: 'HCT(PCV)',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: {
      child: { min: 35.0, max: 43.0, text: '35 - 43' },
      male: { min: 40.0, max: 50.0, text: '40 - 50' },
      female: { min: 36.0, max: 46.0, text: '36 - 46' },
      general: { min: 36.0, max: 50.0, text: '36 - 50' },
    },
  },
  {
    id: 'mcv',
    name: 'MCV',
    category: 'HAEMATOLOGY',
    unit: 'fL',
    ranges: { general: { text: '80-100' } },
  },
  {
    id: 'mch',
    name: 'MCH',
    category: 'HAEMATOLOGY',
    unit: 'pg',
    ranges: { general: { text: '26-32' } },
  },
  {
    id: 'mchc',
    name: 'MCHC',
    category: 'HAEMATOLOGY',
    unit: 'gm%',
    ranges: { general: { text: '32-38' } },
  },
  {
    id: 'rdw_cv',
    name: 'RDW%',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '11.5-14.5' } },
  },
  {
    id: 'rdw_sd',
    name: 'RDW-SD',
    category: 'HAEMATOLOGY',
    unit: 'fL',
    ranges: { general: { text: '37.0-54.0' } },
  },

  {
    id: 'platelet',
    name: 'PLATELET COUNT',
    category: 'HAEMATOLOGY',
    unit: 'lakh/cumm',
    ranges: { general: { text: '1.5-4.5' } },
  },
  {
    id: 'mpv',
    name: 'MPV',
    category: 'HAEMATOLOGY',
    unit: 'fL',
    ranges: { general: { text: '7.4-10.4' } },
  },
  {
    id: 'pdw',
    name: 'PDW',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '10.0-17.0' } },
  },
  {
    id: 'pct',
    name: 'PCT',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '0.15-0.5' } },
  },
  {
    id: 'p_lcc',
    name: 'P-LCC',
    category: 'HAEMATOLOGY',
    unit: 'lakh/Cumm',
    ranges: { general: { text: '30-90' } },
  },
  {
    id: 'p_lcr',
    name: 'P-LCR',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '13.0-43.0' } },
  },

  // WIDAL REACTION
  {
    id: 'widal_group',
    name: 'WIDAL REACTION',
    category: 'SEROLOGY',
    synonyms: [
      'widal',
      'widal test',
      'typhoid',
      'typhoid test',
      'typhi',
      'paratyphi',
      'enteric fever',
      'fever',
    ],
    isGroup: true,
    includedTests: [
      "S. typhi 'o'",
      "S. typhi 'H'",
      'S. Para Typhi "A(H)"',
      'S. para Typhi "B(H)"',
      'Impression',
    ],
  },
  {
    id: 'widal_o',
    name: "S. typhi 'o'",
    category: 'SEROLOGY',
    unit: 'titer',
    options: ['Negative', '1:20', '1:40', '1:80', '1:160', '1:320'],
    ranges: { general: { text: 'Negative' } },
    synonyms: ['typhoid o', 'typhi o', 'widal o', 'o titre', 's typhi o'],
  },
  {
    id: 'widal_h',
    name: "S. typhi 'H'",
    category: 'SEROLOGY',
    unit: 'titer',
    options: ['Negative', '1:20', '1:40', '1:80', '1:160', '1:320'],
    ranges: { general: { text: 'Negative' } },
    synonyms: ['typhoid h', 'typhi h', 'widal h', 'h titre', 's typhi h'],
  },
  {
    id: 'widal_ah',
    name: 'S. Para Typhi "A(H)"',
    category: 'SEROLOGY',
    unit: 'titer',
    options: ['Negative', '1:20', '1:40', '1:80', '1:160', '1:320'],
    ranges: { general: { text: 'Negative' } },
    synonyms: ['paratyphi a', 'typhoid a', 'para typhi a', 'ah titre'],
  },
  {
    id: 'widal_bh',
    name: 'S. para Typhi "B(H)"',
    category: 'SEROLOGY',
    unit: 'titer',
    options: ['Negative', '1:20', '1:40', '1:80', '1:160', '1:320'],
    ranges: { general: { text: 'Negative' } },
    synonyms: ['paratyphi b', 'typhoid b', 'para typhi b', 'bh titre'],
  },
  {
    id: 'widal_impression',
    name: 'Impression',
    category: 'SEROLOGY',
    unit: '',
    options: ['Negative', 'Weak positive', 'Positive'],
    ranges: { general: { text: '' } },
  },

  // URINE ANALYSIS
  {
    id: 'urine_analysis_group',
    name: 'URINE ANALYSIS',
    category: 'CLINICAL PATHOLOGY',
    isGroup: true,
    includedTests: [
      'PHYSICAL EXAMINATION',
      'Quantity',
      'Colour',
      'Consistency',
      'Sediments',
      'Specific Gravity',
      'CHEMICAL EXAMINATION',
      'Reaction',
      'Sugar',
      'Albumin',
      'Phosphate',
      'Bile Salt',
      'Bile Pigment',
      'Acetone',
      'Urobilinogen',
      'Chyle Test',
      'MICROSCOPICAL EXAMINATION',
      'Erythrocytes',
      'Pus Cells',
      'Epithelial Cells',
      'Casts',
      'Crystals',
    ],
  },
  {
    id: 'urine_phys_header',
    name: 'PHYSICAL EXAMINATION',
    category: 'CLINICAL PATHOLOGY',
    isHeader: true,
  },
  { id: 'urine_quantity', name: 'Quantity', category: 'CLINICAL PATHOLOGY' },
  {
    id: 'urine_colour',
    name: 'Colour',
    category: 'CLINICAL PATHOLOGY',
    options: ['Pale yellow', 'Yellow', 'Amber', 'Red', 'Brown'],
  },
  {
    id: 'urine_consistency',
    name: 'Consistency',
    category: 'CLINICAL PATHOLOGY',
    options: ['Clear', 'Slightly turbid', 'Turbid', 'Cloudy'],
  },
  {
    id: 'urine_sediments',
    name: 'Sediments',
    category: 'CLINICAL PATHOLOGY',
    options: ['Absent', 'Present'],
  },
  {
    id: 'urine_sp_gravity',
    name: 'Specific Gravity',
    category: 'CLINICAL PATHOLOGY',
    ranges: { general: { text: '1.005 - 1.030' } },
  },

  {
    id: 'urine_chem_header',
    name: 'CHEMICAL EXAMINATION',
    category: 'CLINICAL PATHOLOGY',
    isHeader: true,
  },
  {
    id: 'urine_reaction',
    name: 'Reaction',
    category: 'CLINICAL PATHOLOGY',
    options: ['Acidic', 'Alkaline', 'Neutral'],
    ranges: { general: { text: '4.5 - 8.0' } },
  },
  {
    id: 'urine_sugar',
    name: 'Sugar',
    category: 'CLINICAL PATHOLOGY',
    options: ['Negative', 'Trace', '+', '++', '+++', '++++'],
  },
  {
    id: 'urine_albumin',
    name: 'Albumin',
    category: 'CLINICAL PATHOLOGY',
    options: ['Negative', 'Trace', '+', '++', '+++', '++++'],
  },
  {
    id: 'urine_phosphate',
    name: 'Phosphate',
    category: 'CLINICAL PATHOLOGY',
    options: ['Absent', 'Present'],
  },
  {
    id: 'urine_bile_salt',
    name: 'Bile Salt',
    category: 'CLINICAL PATHOLOGY',
    options: ['Negative', 'Positive'],
  },
  {
    id: 'urine_bile_pigment',
    name: 'Bile Pigment',
    category: 'CLINICAL PATHOLOGY',
    options: ['Negative', 'Positive'],
  },
  {
    id: 'urine_acetone',
    name: 'Acetone',
    category: 'CLINICAL PATHOLOGY',
    options: ['Negative', 'Positive'],
  },
  {
    id: 'urine_urobilinogen',
    name: 'Urobilinogen',
    category: 'CLINICAL PATHOLOGY',
    unit: 'mg/dL',
    ranges: { general: { text: '0.2-1.0' } },
  },
  {
    id: 'urine_chyle',
    name: 'Chyle Test',
    category: 'CLINICAL PATHOLOGY',
    options: ['Negative', 'Positive'],
  },

  {
    id: 'urine_mic_header',
    name: 'MICROSCOPICAL EXAMINATION',
    category: 'CLINICAL PATHOLOGY',
    isHeader: true,
  },
  {
    id: 'urine_erythrocytes',
    name: 'Erythrocytes',
    category: 'CLINICAL PATHOLOGY',
    unit: '/HPF',
    ranges: { general: { text: '0-2' } },
  },
  {
    id: 'urine_pus',
    name: 'Pus Cells',
    category: 'CLINICAL PATHOLOGY',
    unit: '/HPF',
    ranges: { general: { text: '0-5' } },
  },
  {
    id: 'urine_epi',
    name: 'Epithelial Cells',
    category: 'CLINICAL PATHOLOGY',
    unit: '/HPF',
    ranges: { general: { text: 'Few' } },
  },
  {
    id: 'urine_casts',
    name: 'Casts',
    category: 'CLINICAL PATHOLOGY',
    unit: '/LPF',
    options: ['Absent', 'Granular', 'Hyaline', 'Cellular'],
  },
  {
    id: 'urine_crystals',
    name: 'Crystals',
    category: 'CLINICAL PATHOLOGY',
    options: ['Absent', 'Calcium Oxalate', 'Uric Acid', 'Triple Phosphate'],
  },

  // LFT and KFT individual tests (removed groups as requested)
  {
    id: 'lft_tot_bil',
    name: 'Total Serum Bilirubin',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dL',
    ranges: { general: { text: '0.2-1.2' } },
    synonyms: ['bilirubin', 'total bilirubin'],
  },
  {
    id: 'lft_conj_bil',
    name: 'Direct Bilirubin',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dL',
    ranges: { general: { text: '0-0.2' } },
    synonyms: ['conjugated bilirubin'],
  },
  {
    id: 'lft_unconj_bil',
    name: 'Indirect Bilirubin',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dL',
    ranges: { general: { text: '0.2-0.8' } },
    synonyms: ['unconjugated bilirubin'],
  },
  {
    id: 'lft_sgot',
    name: 'S.G.O.T.',
    category: 'BIO CHEMISTRY',
    unit: 'unit/l',
    ranges: {
      child: { min: 15, max: 55, text: '15 - 55' },
      male: { max: 40, text: '5 - 40' },
      female: { max: 35, text: '5 - 35' },
      general: { min: 5, max: 35, text: '5 - 35' },
    },
    synonyms: ['sgot', 'ast', 'aspartate aminotransferase'],
  },
  {
    id: 'lft_sgpt',
    name: 'S.G.P.T.',
    category: 'BIO CHEMISTRY',
    unit: 'unit/l',
    ranges: {
      child: { min: 10, max: 40, text: '10 - 40' },
      male: { max: 45, text: '7 - 45' },
      female: { max: 35, text: '7 - 35' },
      general: { min: 1, max: 40, text: '1 - 40' },
    },
    synonyms: ['sgpt', 'alt', 'alanine aminotransferase'],
  },
  {
    id: 'lft_tot_prot',
    name: 'Total Protein',
    category: 'BIO CHEMISTRY',
    unit: 'g/dL',
    ranges: { general: { text: '6.0-8.3' } },
    synonyms: ['protein'],
  },
  {
    id: 'lft_alb',
    name: 'Albumin',
    category: 'BIO CHEMISTRY',
    unit: 'g/dL',
    ranges: { general: { text: '3.5-5.0' } },
  },
  {
    id: 'lft_alp',
    name: 'Alkaline Phosphaphates',
    category: 'BIO CHEMISTRY',
    unit: 'U/L',
    ranges: {
      child: { min: 100, max: 350, text: '100 - 350' },
      male: { min: 53, max: 128, text: '53 - 128' },
      female: { min: 42, max: 98, text: '42 - 98' },
      general: { min: 44, max: 147, text: '44 - 147' },
    },
    synonyms: ['alp', 'alkaline phosphatase'],
  },

  // KIDNEY FUNCTION TEST
  {
    id: 'kft_urea',
    name: 'Blood Urea',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: {
      child: { min: 5, max: 36, text: '5 - 36' },
      male: { min: 15, max: 45, text: '15 - 45' },
      female: { min: 10, max: 40, text: '10 - 40' },
      general: { min: 20, max: 40, text: '20 - 40' },
    },
    synonyms: ['urea', 'bun'],
  },
  {
    id: 'kft_uric_acid',
    name: 'Uric Acid',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: {
      child: { min: 2.0, max: 5.5, text: '2.0 - 5.5' },
      male: { min: 3.5, max: 7.2, text: '3.5 - 7.2' },
      female: { min: 2.6, max: 6.0, text: '2.6 - 6.0' },
      general: { min: 2.6, max: 7.2, text: '2.6 - 7.2' },
    },
    synonyms: ['uric'],
  },
  {
    id: 'kft_creat',
    name: 'S. creatinine',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: {
      child: { min: 0.3, max: 0.7, text: '0.3 - 0.7' },
      male: { min: 0.7, max: 1.3, text: '0.7 - 1.3' },
      female: { min: 0.6, max: 1.1, text: '0.6 - 1.1' },
      general: { min: 0.6, max: 1.3, text: '0.6 - 1.3' },
    },
    synonyms: ['creatinine', 'creat'],
  },

  // LIPID PROFILE
  {
    id: 'lipid_group',
    name: 'LIPID PROFILE',
    category: 'BIO CHEMISTRY',
    isGroup: true,
    synonyms: ['lipid', 'cholesterol profile'],
    includedTests: ['Total cholestrol', 'H.D.L.', 'L.D.L.', 'Triglyceride'],
  },
  {
    id: 'lipid_chol',
    name: 'Total cholestrol',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: {
      child: { min: 100, max: 170, text: '100 - 170' },
      male: { min: 130, max: 200, text: '130 - 200' },
      female: { min: 130, max: 200, text: '130 - 200' },
      general: { min: 130, max: 200, text: '130 - 200' },
    },
    synonyms: ['cholesterol'],
  },
  {
    id: 'lipid_hdl',
    name: 'H.D.L.',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dL',
    ranges: {
      child: { min: 45, text: '>= 45' },
      male: { min: 40, text: '>= 40' },
      female: { min: 50, text: '>= 50' },
      general: { min: 40, text: 'M: >= 40, F: >= 50' },
    },
    synonyms: ['hdl', 'good cholesterol'],
  },
  {
    id: 'lipid_ldl',
    name: 'L.D.L.',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dL',
    ranges: {
      child: { max: 110, text: '< 110' },
      male: { max: 100, text: '< 100' },
      female: { max: 100, text: '< 100' },
      general: { max: 100, text: '< 100' },
    },
    synonyms: ['ldl', 'bad cholesterol'],
  },
  {
    id: 'lipid_trig',
    name: 'Triglyceride',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: { general: { text: '40-160' } },
    synonyms: ['triglycerides', 'tg'],
  },

  // DIABETIC
  {
    id: 'bs_f',
    name: 'Blood Sugar Fasting',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: { general: { text: '60-100' } },
    synonyms: ['fbs', 'bsf', 'glucose fasting'],
  },
  {
    id: 'bs_pp',
    name: 'Blood Sugar (PP)',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: { general: { text: 'up to 140' } },
    synonyms: ['ppbs', 'bspp', 'glucose pp'],
  },
  {
    id: 'bs_r',
    name: 'Blood Sugar Random',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: { general: { text: '60-130' } },
    synonyms: ['rbs', 'bsr', 'glucose random'],
  },
  {
    id: 'hba1c',
    name: 'HbA1c',
    category: 'BIO CHEMISTRY',
    unit: '%',
    ranges: { general: { min: 4, max: 5.6, text: '4.0 - 5.6' } },
    synonyms: [
      'glycated hemoglobin',
      'glycated haemoglobin',
      'haemoglobin a1c',
      'hemoglobin a1c',
      'a1c',
      'hb a1c',
      'glycohemoglobin',
      'diabetes test',
    ],
  },

  // OTHER HEMOTOLOGY & CLINICAL
  {
    id: 'parasites_mp_mf',
    name: 'Parasites MP / MF',
    category: 'HEMOTOLOGY',
    options: ['Negative', 'Positive'],
    synonyms: ['malaria', 'mp', 'mf'],
  },
  {
    id: 'esr_1st_hr',
    name: 'E.S.R. 1st Hor',
    category: 'HEMOTOLOGY',
    unit: 'mm',
    ranges: {
      child: { min: 0, max: 10, text: '0 - 10' },
      male: { min: 0, max: 15, text: '0 - 15' },
      female: { min: 0, max: 20, text: '0 - 20' },
      general: { min: 0, max: 15, text: '0 - 15' },
    },
    synonyms: ['esr', 'erythrocyte sedimentation rate'],
  },
  {
    id: 'bleeding_time',
    name: 'Bleeding Time',
    category: 'HEMOTOLOGY',
    unit: 'min',
    ranges: { general: { text: '01-03' } },
  },
  {
    id: 'coagulation_time',
    name: 'Coagulation Time',
    category: 'HEMOTOLOGY',
    unit: 'min',
    ranges: { general: { text: '02-08' } },
  },
  {
    id: 'reticulocytes',
    name: 'Reticulocytes',
    category: 'HEMOTOLOGY',
    unit: '%',
    ranges: { general: { text: '0.5-2.0' } },
  },
  {
    id: 'prothrombin_time',
    name: 'Prothrombin Time',
    category: 'HEMOTOLOGY',
    unit: 'sec',
    ranges: { general: { text: 'PT 11-13.5 sec; INR 0.8-1.1' } },
  },
  {
    id: 'anti_hcv',
    name: 'Anti HCV',
    category: 'HEMOTOLOGY',
    options: ['Negative', 'Positive'],
    synonyms: ['hepatitis c', 'hcv'],
  },
  { id: 'aldehyde', name: 'Aldehyde', category: 'HEMOTOLOGY', options: ['Negative', 'Positive'] },
  {
    id: 'hbs_ag',
    name: 'Hbs Ag',
    category: 'HEMOTOLOGY',
    options: ['Negative', 'Positive'],
    synonyms: ['hbsag', 'hepatitis b'],
  },
  {
    id: 'ra_test',
    name: 'R.A. Test',
    category: 'HEMOTOLOGY',
    unit: 'IU/mL',
    ranges: { general: { text: '<14' } },
    synonyms: ['ra factor', 'rheumatoid arthritis'],
  },
  {
    id: 'vdrl',
    name: 'V.D.R.L',
    category: 'HEMOTOLOGY',
    options: ['Non-reactive', 'Reactive'],
    synonyms: ['syphilis', 'vdrl'],
  },
  {
    id: 'rpr',
    name: 'R.P.R.',
    category: 'HEMOTOLOGY',
    options: ['Non-reactive', 'Reactive'],
    synonyms: ['rpr'],
  },
  {
    id: 'abo_group',
    name: 'A.B.O',
    category: 'HEMOTOLOGY',
    isGroup: true,
    synonyms: ['abo', 'blood group'],
    includedTests: ['ABO Typing', 'RH Typing'],
  },
  {
    id: 'abo_typing',
    name: 'ABO Typing',
    category: 'HEMOTOLOGY',
    options: ['A', 'B', 'AB', 'O'],
    synonyms: ['abo typing'],
  },
  {
    id: 'rh_typing',
    name: 'RH Typing',
    category: 'HEMOTOLOGY',
    options: ['Positive', 'Negative'],
    synonyms: ['rh factor'],
  },
  {
    id: 'mantoux',
    name: 'Mantoux Test',
    category: 'HEMOTOLOGY',
    unit: 'mm induration',
    options: ['Negative', 'Positive'],
    synonyms: ['tb skin test'],
  },
  {
    id: 'aso_titre',
    name: 'Aso Titre',
    category: 'HEMOTOLOGY',
    unit: 'IU/mL',
    ranges: { general: { text: '<200' } },
    synonyms: ['aso'],
  },
  {
    id: 'hiv',
    name: 'H.I.V.',
    category: 'HEMOTOLOGY',
    options: ['Non-reactive', 'Reactive'],
    synonyms: ['hiv', 'aids'],
  },
  {
    id: 'dengue',
    name: 'Dengue',
    category: 'HEMOTOLOGY',
    options: ['Negative', 'Positive NS1', 'Positive IgM', 'Positive IgG'],
  },
  {
    id: 'chikungunya',
    name: 'Chikungunya',
    category: 'HEMOTOLOGY',
    options: ['Negative', 'Positive'],
  },
  {
    id: 'afb_sputum',
    name: 'A.F.B. for sputam',
    category: 'HEMOTOLOGY',
    options: ['Negative', 'Scanty', '+1', '+2', '+3'],
    synonyms: ['afb', 'tb', 'tuberculosis'],
  },
  {
    id: 'pregnancy',
    name: 'PREGNANCY TEST',
    category: 'CLINICAL PATHOLOGY',
    options: ['Negative', 'Positive'],
    synonyms: ['upt'],
  },
];

export const getCustomTests = (): PathologyTest[] => {
  return readCustomTests();
};

export const getPathologyTests = (): PathologyTest[] => {
  return [...DEFAULT_PATHOLOGY_TESTS, ...getCustomTests()];
};

/**
 * The tests a picker may offer as standalone picks, minus the ones already
 * selected. Members of a group panel are added through their parent, so they
 * are excluded here. The exclusion set is built in one pass — the previous
 * inline `catalog.some(g => g.includedTests?.includes(name))` inside a
 * `.filter()` rescanned the whole catalog per row (O(n²)) and called
 * `getPathologyTests()` (which re-reads custom tests from settings) repeatedly.
 */
export const getStandaloneTests = (selected: readonly string[] = []): PathologyTest[] => {
  const all = getPathologyTests();
  const grouped = new Set<string>();
  for (const test of all) {
    if (test.includedTests) for (const member of test.includedTests) grouped.add(member);
  }
  const selectedSet = new Set(selected);
  return all.filter(t => !t.isHeader && !selectedSet.has(t.name) && !grouped.has(t.name));
};

/**
 * The candidate list a test picker searches. With no query it is the browse
 * list (group members hidden — they are added through their parent panel). Once
 * the user types, group members become searchable so a disease term like
 * "typhoid" can surface both the WIDAL group and its "S. typhi 'O' / 'H'"
 * components, not just tests whose literal name contains the query.
 */
export const getSearchableTests = (
  selected: readonly string[] = [],
  query = '',
): PathologyTest[] => {
  const all = getPathologyTests();
  const selectedSet = new Set(selected);
  const candidates = all.filter(t => !t.isHeader && !selectedSet.has(t.name));
  if (query.trim()) return candidates;
  const grouped = new Set<string>();
  for (const t of all) if (t.includedTests) for (const m of t.includedTests) grouped.add(m);
  return candidates.filter(t => !grouped.has(t.name));
};

export const getReferenceRangeLabel = (
  ranges: ReferenceRange | undefined,
  age?: number,
  gender?: string,
): string => {
  if (!ranges) return '';

  if (age !== undefined && age < 12 && ranges.child) {
    return (
      ranges.child.text ||
      `${ranges.child.min?.toFixed(1) || 0} - ${ranges.child.max?.toFixed(1) || 0}`
    );
  }

  if (gender) {
    const isMale = gender.toLowerCase().startsWith('m');
    const isFemale = gender.toLowerCase().startsWith('f');

    if (isMale && ranges.male) {
      return (
        ranges.male.text ||
        `${ranges.male.min?.toFixed(1) || 0} - ${ranges.male.max?.toFixed(1) || 0}`
      );
    }

    if (isFemale && ranges.female) {
      return (
        ranges.female.text ||
        `${ranges.female.min?.toFixed(1) || 0} - ${ranges.female.max?.toFixed(1) || 0}`
      );
    }
  }

  if (ranges.general) {
    return (
      ranges.general.text ||
      `${ranges.general.min?.toFixed(1) || 0} - ${ranges.general.max?.toFixed(1) || 0}`
    );
  }

  return '';
};

export const findTestInfo = (query: string): PathologyTest | undefined => {
  if (!query) return undefined;
  const q = query.toLowerCase().trim();
  return getPathologyTests().find(
    t => t.name.toLowerCase() === q || t.synonyms?.some(s => s.toLowerCase() === q),
  );
};

export function getLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  // Rolling two-row DP: identical result to the full matrix but O(min(m,n))
  // space and far less allocation churn — this runs per candidate word/synonym
  // on every keystroke in the test search.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let prev = Array.from({ length: short.length + 1 }, (_, i) => i);
  let curr = new Array<number>(short.length + 1);
  for (let j = 1; j <= long.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= short.length; i++) {
      const cost = long[j - 1] === short[i - 1] ? 0 : 1;
      curr[i] = Math.min(prev[i] + 1, curr[i - 1] + 1, prev[i - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[short.length];
}

export function searchPathologyTests(query: string, tests: PathologyTest[]): PathologyTest[] {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return tests;

  const scored = tests.map(test => {
    let score = -1;
    const nameLower = test.name.toLowerCase();
    const synonymsLower = (test.synonyms || []).map(s => s.toLowerCase());

    // 1. Exact Match on name
    if (nameLower === cleanQuery) {
      score = Math.max(score, 100);
    }

    // 2. Exact Match on any synonym (Synonym Priority!)
    synonymsLower.forEach(syn => {
      if (syn === cleanQuery) {
        score = Math.max(score, 95);
      }
    });

    // 3. Name starts with query
    if (nameLower.startsWith(cleanQuery)) {
      score = Math.max(score, 85);
    }

    // 4. Synonym starts with query
    synonymsLower.forEach(syn => {
      if (syn.startsWith(cleanQuery)) {
        score = Math.max(score, 80);
      }
    });

    // 5. Word starts with query inside Name
    const nameWords = nameLower.split(/[\s/()_.-]+/);
    nameWords.forEach(word => {
      if (word.startsWith(cleanQuery) && cleanQuery.length >= 2) {
        score = Math.max(score, 75);
      }
    });

    // 6. Word starts with query inside any Synonym
    synonymsLower.forEach(syn => {
      const synWords = syn.split(/[\s/()_.-]+/);
      synWords.forEach(word => {
        if (word.startsWith(cleanQuery) && cleanQuery.length >= 2) {
          score = Math.max(score, 70);
        }
      });
    });

    // 7. Substring match on name
    if (nameLower.includes(cleanQuery)) {
      score = Math.max(score, 65);
    }

    // 8. Substring match on synonym
    synonymsLower.forEach(syn => {
      if (syn.includes(cleanQuery)) {
        score = Math.max(score, 60);
      }
    });

    // 9. Length-restricted mild fuzzy fallback.
    //
    // Only reached when no cheaper tier matched: every fuzzy score below is
    // (45 - distance) at most, strictly under the lowest substring tier (60),
    // so a candidate that already scored can never be overtaken by fuzzing —
    // skipping it here is exact and removes the bulk of the edit-distance work.
    if (cleanQuery.length >= 3 && score < 0) {
      // Determine max edit distance threshold
      const maxFuzzyDist = cleanQuery.length <= 4 ? 1 : 2;
      // A length gap larger than the threshold already proves the distance
      // exceeds it, so bail before paying for the DP.
      const distWithin = (candidate: string, limit: number): number =>
        Math.abs(candidate.length - cleanQuery.length) > limit
          ? limit + 1
          : getLevenshteinDistance(cleanQuery, candidate);

      // Entire test name fuzzy
      const distName = distWithin(nameLower, maxFuzzyDist);
      if (distName <= maxFuzzyDist) {
        score = Math.max(score, 45 - distName);
      }

      // Fuzzy on individual words in test name
      nameWords.forEach(word => {
        if (word.length >= 3) {
          const wordMaxDist = cleanQuery.length <= 4 || word.length <= 4 ? 1 : 2;
          const distWord = distWithin(word, wordMaxDist);
          if (distWord <= wordMaxDist) {
            score = Math.max(score, 40 - distWord);
          }
        }
      });

      // Entire synonym fuzzy
      synonymsLower.forEach(syn => {
        const distSyn = distWithin(syn, maxFuzzyDist);
        if (distSyn <= maxFuzzyDist) {
          score = Math.max(score, 35 - distSyn);
        }

        // Fuzzy on word in synonym
        const synWords = syn.split(/[\s/()_.-]+/);
        synWords.forEach(word => {
          if (word.length >= 3) {
            const wordMaxDist = cleanQuery.length <= 4 || word.length <= 4 ? 1 : 2;
            const distSynWord = distWithin(word, wordMaxDist);
            if (distSynWord <= wordMaxDist) {
              score = Math.max(score, 30 - distSynWord);
            }
          }
        });
      });
    }

    return { test, score };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.test);
}

export const getReferenceRangeValues = (
  ranges: ReferenceRange | undefined,
  age?: number,
  gender?: string,
): { min?: number; max?: number } | null => {
  if (!ranges) return null;

  const extract = (obj: any): { min?: number; max?: number } | null => {
    if (!obj) return null;
    if (obj.min !== undefined || obj.max !== undefined) return { min: obj.min, max: obj.max };
    if (obj.text) {
      const match = obj.text.match(/([0-9.]+)\s*-\s*([0-9.]+)/);
      if (match) return { min: parseFloat(match[1]), max: parseFloat(match[2]) };

      const gteMatch = obj.text.match(/>=\s*([0-9.]+)/);
      if (gteMatch) return { min: parseFloat(gteMatch[1]) };

      const ltMatch = obj.text.match(/<\s*([0-9.]+)/);
      if (ltMatch) return { max: parseFloat(ltMatch[1]) };

      const upToMatch = obj.text.match(/up to\s*([0-9.]+)/i);
      if (upToMatch) return { max: parseFloat(upToMatch[1]) };
    }
    return null;
  };

  if (age !== undefined && age < 12 && ranges.child) {
    const res = extract(ranges.child);
    if (res) return res;
  }

  if (gender) {
    const isMale = gender.toLowerCase().startsWith('m');
    const isFemale = gender.toLowerCase().startsWith('f');

    if (isMale && ranges.male) {
      const res = extract(ranges.male);
      if (res) return res;
    }

    if (isFemale && ranges.female) {
      const res = extract(ranges.female);
      if (res) return res;
    }
  }

  if (ranges.general) {
    return extract(ranges.general);
  }

  return null;
};
