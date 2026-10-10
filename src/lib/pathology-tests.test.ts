import { describe, it, expect } from 'vitest';
import {
  getReferenceRangeLabel,
  getLevenshteinDistance,
  searchPathologyTests,
  findTestInfo,
  resolveTestKind,
  isNumericTest,
  getSearchableTests,
  DEFAULT_PATHOLOGY_TESTS,
  type PathologyTest,
} from './pathology-tests';

describe('getReferenceRangeLabel', () => {
  const ranges = {
    male: { min: 13, max: 17 },
    female: { min: 12, max: 16 },
    child: { text: 'Age dependent' },
    general: { min: 10, max: 20 },
  };

  it('prefers child range for children under 12', () => {
    expect(getReferenceRangeLabel(ranges, 8, 'male')).toBe('Age dependent');
  });

  it('uses gender-specific ranges for adults', () => {
    expect(getReferenceRangeLabel(ranges, 30, 'male')).toBe('13.0 - 17.0');
    expect(getReferenceRangeLabel(ranges, 30, 'female')).toBe('12.0 - 16.0');
  });

  it('falls back to general range when gender is missing', () => {
    expect(getReferenceRangeLabel(ranges, 30)).toBe('10.0 - 20.0');
  });

  it('returns empty string for no ranges', () => {
    expect(getReferenceRangeLabel({})).toBe('');
  });

  it('tolerates a missing range map (callers pass test.ranges, which is optional)', () => {
    expect(getReferenceRangeLabel(undefined)).toBe('');
    expect(getReferenceRangeLabel(null as never)).toBe('');
  });
});

describe('resolveTestKind', () => {
  const test = (partial: Partial<PathologyTest>): PathologyTest => ({
    id: 't',
    name: 'TEST',
    category: 'C',
    ...partial,
  });

  it('an explicit kind always wins over inference', () => {
    expect(
      resolveTestKind(
        test({ kind: 'text', unit: 'mg/dL', ranges: { general: { min: 1, max: 2 } } }),
      ),
    ).toBe('text');
  });

  it('treats a test with options as categorical', () => {
    expect(resolveTestKind(test({ options: ['A Positive', 'B Negative'] }))).toBe('categorical');
  });

  it('recognises a dilution as a titer, not a number', () => {
    expect(resolveTestKind(test({ ranges: { general: { text: '1:160' } } }))).toBe('titer');
    expect(resolveTestKind(test({ unit: 'titer' }))).toBe('titer');
  });

  it('classifies numeric bounds and numeric text ranges', () => {
    expect(resolveTestKind(test({ ranges: { general: { min: 10, max: 20 } } }))).toBe('numeric');
    expect(resolveTestKind(test({ ranges: { general: { text: '< 5' } } }))).toBe('numeric');
  });

  it('does not mistake a qualitative word for a number', () => {
    // This is the bug the old regex-based isNumericTest had: "NEGATIVE" read as
    // a measurement, so the UI offered a numeric input and range colouring.
    expect(resolveTestKind(test({ ranges: { general: { text: 'NEGATIVE' } } }))).toBe('text');
    expect(isNumericTest(test({ ranges: { general: { text: 'NON REACTIVE' } } }))).toBe(false);
  });

  it('falls back to the unit when there are no ranges', () => {
    expect(resolveTestKind(test({ unit: 'g/dL' }))).toBe('numeric');
    expect(resolveTestKind(test({}))).toBe('text');
  });

  it('never treats a group or section header as a result field', () => {
    expect(resolveTestKind(test({ isGroup: true, unit: 'cells' }))).toBe('text');
    expect(resolveTestKind(test({ isHeader: true }))).toBe('text');
    expect(resolveTestKind(undefined)).toBe('text');
  });

  it('classifies the shipped catalog without a single "text" numeric misread', () => {
    const grouped = DEFAULT_PATHOLOGY_TESTS.filter(t => t.isGroup || t.isHeader);
    expect(grouped.every(t => !isNumericTest(t))).toBe(true);
    // Every catalog entry must resolve to one of the four known kinds.
    expect(DEFAULT_PATHOLOGY_TESTS.every(t => resolveTestKind(t).length > 0)).toBe(true);
  });
});

describe('getLevenshteinDistance', () => {
  it('computes edit distances', () => {
    expect(getLevenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(getLevenshteinDistance('abc', 'abc')).toBe(0);
    expect(getLevenshteinDistance('', 'abc')).toBe(3);
  });
});

describe('searchPathologyTests / findTestInfo', () => {
  it('finds a test by exact name (case-insensitive)', () => {
    const found = findTestInfo('cbc');
    expect(found).toBeDefined();
  });

  it('ranks synonym matches highly (hemogram -> CBC group)', () => {
    const results = searchPathologyTests('hemogram', DEFAULT_PATHOLOGY_TESTS);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name.toLowerCase()).toContain('complete blood count');
  });

  it('returns all tests for an empty query', () => {
    expect(searchPathologyTests('', DEFAULT_PATHOLOGY_TESTS)).toBe(DEFAULT_PATHOLOGY_TESTS);
  });
});

describe('searchPathologyTests — Indian disease→test relevance', () => {
  it('surfaces the WIDAL group and its S. typhi components for "typhoid"', () => {
    const results = searchPathologyTests('typhoid', DEFAULT_PATHOLOGY_TESTS);
    expect(results.some(r => r.name === 'WIDAL REACTION')).toBe(true);
    expect(results.some(r => /S\. typhi/i.test(r.name))).toBe(true);
    // The group outranks its members because "typhoid" is an exact synonym of it.
    expect(results[0].name).toBe('WIDAL REACTION');
  });

  it('finds HbA1c by its glycated-haemoglobin synonyms', () => {
    for (const q of ['hba1c', 'a1c', 'glycated haemoglobin']) {
      const results = searchPathologyTests(q, DEFAULT_PATHOLOGY_TESTS);
      expect(results.some(r => r.name === 'HbA1c')).toBe(true);
    }
  });

  it('hides group members in the browse list but searches them once typing', () => {
    const browse = getSearchableTests([], '');
    const typed = getSearchableTests([], 'typhi');
    expect(browse.some(t => t.name === "S. typhi 'o'")).toBe(false);
    expect(typed.some(t => t.name === "S. typhi 'o'")).toBe(true);
  });
});
