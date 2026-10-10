/**
 * Clinical auto-calculations for pathology reports.
 * Derived results (absolute counts, red-cell indices) are recomputed whenever
 * a dependent raw value changes.
 */

const WBC_PARAMS = [
  'WHITE CELL COUNT(TC)',
  'NEUTROPHIL',
  'LYMPHOCYTE',
  'MONOCYTE',
  'EOSINOPHIL',
  'BASOPHIL',
];

const RBC_PARAMS = ['RBC (RED BLOOD CELLS)', 'HB (HAEMOGLOBIN)', 'HCT(PCV)'];

export function recalculateCBC(
  results: Record<string, string>,
  changedName: string,
  changedValue: string,
): Record<string, string> {
  const updatedResults = { ...results, [changedName]: changedValue };

  const isWBCParam = WBC_PARAMS.includes(changedName);
  const isRBCParam = RBC_PARAMS.includes(changedName);

  if (isWBCParam) {
    const wbc = parseFloat(updatedResults['WHITE CELL COUNT(TC)']);
    if (!isNaN(wbc) && wbc > 0) {
      const neutrino = parseFloat(updatedResults['NEUTROPHIL']);
      if (!isNaN(neutrino)) {
        updatedResults['ABSOLUTE NEUTROPHIL COUNT'] = ((neutrino / 100) * wbc).toFixed(2);
      }
      const lympho = parseFloat(updatedResults['LYMPHOCYTE']);
      if (!isNaN(lympho)) {
        updatedResults['ABSOLUTE LYMPHOCYTE COUNT'] = ((lympho / 100) * wbc).toFixed(2);
      }
      const mono = parseFloat(updatedResults['MONOCYTE']);
      if (!isNaN(mono)) {
        updatedResults['ABSOLUTE MONOCYTE COUNT'] = ((mono / 100) * wbc).toFixed(2);
      }
      const eosino = parseFloat(updatedResults['EOSINOPHIL']);
      if (!isNaN(eosino)) {
        updatedResults['ABSOLUTE EOSINOPHILL COUNT'] = ((eosino / 100) * wbc).toFixed(2);
      }
      const baso = parseFloat(updatedResults['BASOPHIL']);
      if (!isNaN(baso)) {
        updatedResults['ABSOLUTE BASOPHIL COUNT'] = ((baso / 100) * wbc).toFixed(2);
      }
    }
  }

  if (isRBCParam) {
    const rbc = parseFloat(updatedResults['RBC (RED BLOOD CELLS)']);
    const hb = parseFloat(updatedResults['HB (HAEMOGLOBIN)']);
    const hct = parseFloat(updatedResults['HCT(PCV)']);

    if (!isNaN(rbc) && !isNaN(hct) && rbc > 0) {
      updatedResults['MCV'] = ((hct * 10) / rbc).toFixed(1);
    }
    if (!isNaN(rbc) && !isNaN(hb) && rbc > 0) {
      updatedResults['MCH'] = ((hb * 10) / rbc).toFixed(1);
    }
    if (!isNaN(hb) && !isNaN(hct) && hct > 0) {
      updatedResults['MCHC'] = ((hb * 100) / hct).toFixed(1);
    }
  }

  return updatedResults;
}
