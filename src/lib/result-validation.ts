/** Pure result validation shared by entry, issue preflight, viewer, and PDF paths. */
import { resolveTestKind, type PathologyTest } from './pathology-tests';

export interface ResultValidation {
  valid: boolean;
  severity: 'ok' | 'warning' | 'error';
  message?: string;
  critical: boolean;
}

export interface ResultValidationPolicy {
  /**
   * Extra reference-interval width that qualifies as critical. This is a
   * configurable screening rule, not a claimed universal clinical threshold.
   */
  criticalMarginMultiplier?: number;
  /** Maximum absolute numeric value accepted before operator review. */
  absoluteLimit?: number;
}

const NUMBER = /^[<>≤≥]?\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const TITER = /^(?:[<>≤≥]\s*)?\d+\s*(?::|\/|\bin\b)\s*\d+$/i;

function numericBounds(band: { min?: number; max?: number; text?: string } | undefined): number[] {
  if (!band) return [];
  if (band.min !== undefined || band.max !== undefined) {
    return [band.min, band.max].filter((value): value is number => typeof value === 'number');
  }
  const text = band.text ?? '';
  const range = text.match(/([0-9.]+)\s*-\s*([0-9.]+)/);
  if (range) return [Number(range[1]), Number(range[2])].filter(Number.isFinite);
  const lower = text.match(/>=\s*([0-9.]+)/);
  if (lower) return [Number(lower[1])].filter(Number.isFinite);
  const upper = text.match(/(?:<|up to)\s*([0-9.]+)/i);
  return upper ? [Number(upper[1])].filter(Number.isFinite) : [];
}

export function parseNumericResult(value: string): number | null {
  const text = value.trim();
  if (!NUMBER.test(text)) return null;
  const numeric = text.replace(/^[<>≤≥]\s*/, '');
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateResult(
  value: unknown,
  test?: PathologyTest | null,
  policy: ResultValidationPolicy = {},
): ResultValidation {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { valid: true, severity: 'ok', critical: false };
  }
  const text = String(value).trim();
  const kind = resolveTestKind(test);
  if (text.length > 500) {
    return { valid: false, severity: 'error', message: 'Result is longer than 500 characters.', critical: false };
  }
  if (kind === 'numeric') {
    const numeric = parseNumericResult(text);
    if (numeric === null) {
      return {
        valid: false,
        severity: 'error',
        message: `Enter a numeric result${test?.unit ? ` in ${test.unit}` : ''}, without units or extra text.`,
        critical: false,
      };
    }
    const absoluteLimit = policy.absoluteLimit ?? 1_000_000_000_000;
    if (Math.abs(numeric) > absoluteLimit) {
      return { valid: false, severity: 'error', message: 'Result exceeds the accepted numeric limit.', critical: false };
    }
    const bands = test?.ranges ? Object.values(test.ranges) : [];
    const limits = bands.flatMap(numericBounds);
    if (limits.length > 0) {
      const min = Math.min(...limits);
      const max = Math.max(...limits);
      const span = Math.max(max - min, Math.abs(max) * 0.1, 1);
      const margin = span * Math.max(0, policy.criticalMarginMultiplier ?? 1);
      if (numeric < min - margin || numeric > max + margin) {
        return {
          valid: true,
          severity: 'warning',
          critical: true,
          message: 'Result is outside the configured critical screening margin; review before issue.',
        };
      }
      if (numeric < 0 && min >= 0) {
        return { valid: true, severity: 'warning', critical: false, message: 'Negative result requires review.' };
      }
    }
    return { valid: true, severity: 'ok', critical: false };
  }
  if (kind === 'categorical' && test?.options?.length) {
    const match = test.options.find(option => option.toLowerCase() === text.toLowerCase());
    if (!match) {
      return {
        valid: false,
        severity: 'error',
        message: `Choose one of: ${test.options.join(', ')}.`,
        critical: false,
      };
    }
    return { valid: true, severity: 'ok', critical: false };
  }
  if (kind === 'titer' && !TITER.test(text)) {
    return { valid: false, severity: 'error', message: 'Enter a dilution such as 1:160.', critical: false };
  }
  return { valid: true, severity: 'ok', critical: false };
}

export interface ReportResultValidation {
  valid: boolean;
  errors: Array<{ test: string; message: string }>;
  warnings: Array<{ test: string; message: string; critical: boolean }>;
}

export function validateReportResults(
  selection: readonly string[],
  results: Record<string, unknown>,
  resolveTest: (name: string) => PathologyTest | null | undefined = () => undefined,
  policy?: ResultValidationPolicy,
): ReportResultValidation {
  const errors: ReportResultValidation['errors'] = [];
  const warnings: ReportResultValidation['warnings'] = [];
  for (const name of selection) {
    const result = validateResult(results[name], resolveTest(name) ?? undefined, policy);
    if (!result.valid) errors.push({ test: name, message: result.message ?? 'Invalid result.' });
    else if (result.severity === 'warning') {
      warnings.push({ test: name, message: result.message ?? 'Review this result.', critical: result.critical });
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

/** Compare a new numeric result with the previous report for delta review. */
export function validateDelta(
  current: unknown,
  previous: unknown,
  policy: { relativeThreshold?: number; absoluteThreshold?: number } = {},
): { valid: boolean; message?: string } {
  const now = parseNumericResult(String(current ?? ''));
  const before = parseNumericResult(String(previous ?? ''));
  if (now === null || before === null || before === 0) return { valid: true };
  const relative = Math.abs(now - before) / Math.max(Math.abs(before), 1);
  const absolute = Math.abs(now - before);
  if (relative >= (policy.relativeThreshold ?? 0.5) && absolute >= (policy.absoluteThreshold ?? 1)) {
    return { valid: true, message: 'Result changed materially from the previous report; review the delta.' };
  }
  return { valid: true };
}
