import { describe, expect, it } from 'vitest';
import type { LocalDoc } from '../data';
import { filterSearchResults, indexRecord } from './search-index';

const doc = (id: string, data: Record<string, unknown>): LocalDoc => ({ id, data: () => data });

describe('global search index', () => {
  it('matches reordered names, formatted phones, orders, and accessions', () => {
    const patient = indexRecord('patient', doc('p1', {
      name: 'Asha Rao', phone: '+91 98765 43210', createdAt: '2026-01-01T00:00:00.000Z',
    }));
    const order = indexRecord('order', doc('o1', {
      orderNo: 'ORD-202601-0001', patientName: 'Asha Rao', status: 'ordered',
      items: [{ name: 'CBC' }], createdAt: '2026-01-02T00:00:00.000Z',
    }));
    const sample = indexRecord('sample', doc('s1', {
      accessionNo: 'ACC-202601-0001', barcode: '123456', patientId: 'p1', status: 'collected',
    }));
    expect(filterSearchResults([patient, order, sample], 'rao asha').map(item => item.type)).toEqual(['patient', 'order']);
    expect(filterSearchResults([patient], '9876543210')).toHaveLength(1);
    expect(filterSearchResults([order], 'cbc')).toHaveLength(1);
    expect(filterSearchResults([sample], '123456')).toHaveLength(1);
  });

  it('keeps each record type visible instead of letting reports crowd out patients', () => {
    const items = [
      ...Array.from({ length: 10 }, (_, index) => indexRecord('report', doc(`r${index}`, { patientName: 'Match' }))),
      indexRecord('patient', doc('p', { name: 'Match' })),
      indexRecord('doctor', doc('d', { name: 'Match' })),
    ];
    const result = filterSearchResults(items, 'match');
    expect(result.filter(item => item.type === 'patient')).toHaveLength(1);
    expect(result.filter(item => item.type === 'report')).toHaveLength(6);
    expect(result.filter(item => item.type === 'doctor')).toHaveLength(1);
  });
});
