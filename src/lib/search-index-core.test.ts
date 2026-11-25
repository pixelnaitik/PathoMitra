import { describe, expect, it } from 'vitest';
import { searchIndex, type IndexedResult } from './search-index-core';

const item = (id: string, timestamp: number): IndexedResult => ({
  id,
  type: 'patient',
  title: `Patient ${id}`,
  subtitle: id,
  timestamp,
  haystack: `patient ${id}`,
});

describe('search result ordering and caps', () => {
  it('sorts the full match pool before applying the per-type display cap', () => {
    const records = [
      item('old', 1),
      item('new', 9),
      item('middle', 5),
      item('newest', 10),
      item('older', 2),
      item('latest', 11),
      item('hidden', 0),
    ];
    const result = searchIndex(records, 'patient');
    expect(result.items.map(entry => entry.id)).toEqual([
      'latest',
      'newest',
      'new',
      'middle',
      'older',
      'old',
    ]);
    expect(result).toMatchObject({ totalMatches: 7, omitted: 1 });
  });
});
