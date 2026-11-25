import { describe, expect, it } from 'vitest';
import {
  parseNumericResult,
  validateDelta,
  validateReportResults,
  validateResult,
} from './result-validation';
import type { PathologyTest } from './pathology-tests';

const numeric: PathologyTest = {
  id: 'sodium',
  name: 'Sodium',
  category: 'ELECTROLYTES',
  kind: 'numeric',
  unit: 'mmol/L',
  ranges: { general: { min: 135, max: 145 } },
};

describe('result validation', () => {
  it('accepts bounded numeric values and rejects units or arbitrary text', () => {
    expect(validateResult('138.5', numeric)).toMatchObject({ valid: true, severity: 'ok' });
    expect(validateResult('138 mmol/L', numeric)).toMatchObject({
      valid: false,
      severity: 'error',
    });
    expect(validateResult('not a number', numeric)).toMatchObject({
      valid: false,
      severity: 'error',
    });
    expect(validateResult('1e12', numeric)).toMatchObject({ valid: false, severity: 'error' });
  });

  it('flags critical screening excursions without silently blocking reviewed results', () => {
    expect(validateResult('180', numeric)).toMatchObject({
      valid: true,
      critical: true,
      severity: 'warning',
    });
    expect(validateResult('< 140', numeric)).toMatchObject({ valid: true, critical: false });
  });

  it('uses the resolved patient band instead of a global demographic envelope', () => {
    const sexSpecific: PathologyTest = {
      ...numeric,
      ranges: { male: { min: 135, max: 145 }, female: { min: 120, max: 132 } },
    };
    expect(validateResult('150', sexSpecific).critical).toBe(false);
    expect(validateResult('150', sexSpecific, {}, { min: 120, max: 132 }).critical).toBe(true);
  });

  it('parses comparison-prefixed values identically for screen and print flagging', () => {
    expect(parseNumericResult('< 140')).toBe(140);
    expect(parseNumericResult('≥ 135')).toBe(135);
    expect(parseNumericResult('14.2 mg/dL')).toBeNull();
  });

  it('honours configured delta thresholds instead of warning on every change', () => {
    expect(
      validateDelta('120', '100', { relativeThreshold: 0.1, absoluteThreshold: 10 }).message,
    ).toMatch(/materially/);
    expect(
      validateDelta('105', '100', { relativeThreshold: 0.1, absoluteThreshold: 10 }).message,
    ).toBeUndefined();
  });

  it('validates categorical options and titers', () => {
    const categorical: PathologyTest = {
      id: 'blood',
      name: 'Blood group',
      category: 'HAEMATOLOGY',
      kind: 'categorical',
      options: ['A+', 'O+'],
    };
    expect(validateResult('o+', categorical).valid).toBe(true);
    expect(validateResult('AB+', categorical).valid).toBe(false);
    expect(
      validateResult('1:160', { id: 'widal', name: 'Widal', category: 'SEROLOGY', kind: 'titer' })
        .valid,
    ).toBe(true);
    expect(
      validateResult('positive', {
        id: 'widal',
        name: 'Widal',
        category: 'SEROLOGY',
        kind: 'titer',
      }).valid,
    ).toBe(false);
  });

  it('returns every invalid ordered result for issue preflight', () => {
    const result = validateReportResults(
      ['Sodium', 'Potassium'],
      { Sodium: 'high', Potassium: '4.1' },
      name => (name === 'Sodium' ? numeric : undefined),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].test).toBe('Sodium');
  });

  it('warns on material numeric deltas', () => {
    expect(validateDelta('180', '100').message).toMatch(/materially/);
    expect(validateDelta('101', '100').message).toBeUndefined();
    expect(validateDelta('2', '0').message).toMatch(/materially/);
  });

  it('includes previous issued results in report preflight', () => {
    const result = validateReportResults(
      ['Sodium'],
      { Sodium: '180' },
      () => numeric,
      undefined,
      () => ({ min: 135, max: 145 }),
      { Sodium: '100' },
    );
    expect(result.warnings.some(item => item.message.includes('changed materially'))).toBe(true);
  });
});
