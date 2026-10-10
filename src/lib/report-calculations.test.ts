import { describe, it, expect } from 'vitest';
import { recalculateCBC } from './report-calculations';

describe('recalculateCBC', () => {
  it('derives absolute counts from WBC and differentials', () => {
    const out = recalculateCBC(
      {
        'WHITE CELL COUNT(TC)': '8.0',
        NEUTROPHIL: '60',
        LYMPHOCYTE: '30',
        MONOCYTE: '5',
        EOSINOPHIL: '4',
        BASOPHIL: '1',
      },
      'NEUTROPHIL',
      '50',
    );
    expect(out['ABSOLUTE NEUTROPHIL COUNT']).toBe('4.00');
    expect(out['ABSOLUTE LYMPHOCYTE COUNT']).toBe('2.40');
    expect(out['ABSOLUTE MONOCYTE COUNT']).toBe('0.40');
  });

  it('derives red-cell indices (MCV, MCH, MCHC)', () => {
    const out = recalculateCBC(
      {
        'RBC (RED BLOOD CELLS)': '5.0',
        'HB (HAEMOGLOBIN)': '15',
        'HCT(PCV)': '45',
      },
      'HCT(PCV)',
      '40',
    );
    expect(out['MCV']).toBe('80.0');
    expect(out['MCH']).toBe('30.0');
    expect(out['MCHC']).toBe('37.5');
  });

  it('leaves unrelated values untouched', () => {
    const out = recalculateCBC({ PLATELET: '250' }, 'PLATELET', '260');
    expect(out).toEqual({ PLATELET: '260' });
  });

  it('does not derive indices from invalid numbers', () => {
    const out = recalculateCBC({ 'RBC (RED BLOOD CELLS)': 'abc' }, 'HB (HAEMOGLOBIN)', '15');
    expect(out['MCV']).toBeUndefined();
    expect(out['MCH']).toBeUndefined();
  });
});
