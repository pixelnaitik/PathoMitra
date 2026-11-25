import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The store is faked here: registration numbers and the duplicate guard are the
 * parts worth pinning, and both decide what identity a clinical record gets.
 */
const store = vi.hoisted(() => ({
  /** id → document, or undefined when the id is free. */
  documents: new Map<string, Record<string, unknown> | undefined>(),
  writes: [] as { path: string; id: string; data: Record<string, unknown> }[],
  transactions: 0,
  failMetaWrite: false,
}));

interface TestRepo {
  get: (
    path: string,
    id: string,
  ) => Promise<{ id: string; data: () => Record<string, unknown> } | null>;
  set: (path: string, id: string, data: Record<string, unknown>) => Promise<void>;
  transaction: (fn: (tx: TestRepo) => Promise<void>) => Promise<void>;
}

vi.mock('../data', () => {
  const repo: TestRepo = {
    get: async (path: string, id: string) => {
      const found = store.documents.get(`${path}/${id}`);
      return found ? { id, data: () => found } : null;
    },
    set: async (path: string, id: string, data: Record<string, unknown>) => {
      if (path === 'meta' && store.failMetaWrite) throw new Error('counter write failed');
      store.documents.set(`${path}/${id}`, data);
      store.writes.push({ path, id, data });
    },
    transaction: async (fn: (tx: TestRepo) => Promise<void>) => {
      store.transactions += 1;
      const snapshot = new Map(store.documents);
      const writeCount = store.writes.length;
      try {
        await fn(repo);
      } catch (error) {
        store.documents.clear();
        snapshot.forEach((value, key) => store.documents.set(key, value));
        store.writes.length = writeCount;
        throw error;
      }
    },
  };
  return { getRepository: () => repo };
});

import {
  registerPatient,
  findProbableDuplicates,
  normalisePhone,
  patientMonthKey,
  patientNameKey,
  validatePatientForm,
} from './patient-registry';

const NOW = new Date('2026-10-13T09:00:00.000Z');

beforeEach(() => {
  store.documents.clear();
  store.writes.length = 0;
  store.transactions = 0;
  store.failMetaWrite = false;
});

describe('validatePatientForm', () => {
  const base = { name: 'Asha Rao', age: '34', phone: '', address: '' };

  it('requires a name and an age', () => {
    expect(validatePatientForm({ ...base, name: '   ' })).toMatch(/Full Name is required/);
    expect(validatePatientForm({ ...base, age: '' })).toMatch(/Age is required/);
  });

  it('refuses a non-integer or out-of-range age instead of clamping it silently', () => {
    expect(validatePatientForm({ ...base, age: 'abc' })).toMatch(/whole number/);
    expect(validatePatientForm({ ...base, age: '-5' })).toMatch(/whole number/);
    expect(validatePatientForm({ ...base, age: '250' })).toMatch(/between 0 and 150/);
    expect(validatePatientForm(base)).toBeNull();
  });

  it('accepts a phone with separators and rejects letters or too few digits', () => {
    expect(validatePatientForm({ ...base, phone: '+91 98765 43210' })).toBeNull();
    expect(validatePatientForm({ ...base, phone: 'call me later' })).toMatch(/digits/);
    expect(validatePatientForm({ ...base, phone: '123456' })).toMatch(/8–15 digits/);
  });

  it('caps the address like the schema does', () => {
    expect(validatePatientForm({ ...base, address: 'x'.repeat(501) })).toMatch(/500 characters/);
  });

  it('validates paediatric and identity fields without making them mandatory', () => {
    expect(validatePatientForm({ ...base, dateOfBirth: '2024-02-30' })).toMatch(/valid date/);
    expect(validatePatientForm({ ...base, externalId: 'BC-1' })).toMatch(/identifier type/);
    expect(
      validatePatientForm({
        ...base,
        dateOfBirth: '2024-02-29',
        guardianName: 'Guardian',
        externalIdType: 'birth-certificate',
        externalId: 'BC-1',
      }),
    ).toBeNull();
  });
});

describe('normalisePhone and patientNameKey', () => {
  it('compares digits only', () => {
    expect(normalisePhone('+91 98765-4321')).toBe('91987654321');
    expect(normalisePhone(undefined)).toBe('');
  });

  it('folds case, punctuation and repeated spaces in a name', () => {
    expect(patientNameKey('  ASHA   RAO ')).toBe('asha rao');
    expect(patientNameKey('Asha Rao.')).toBe('asha rao');
  });

  it('preserves Indic letters and vowel marks instead of collapsing them to an empty key', () => {
    expect(patientNameKey('आशा राव')).toBe('आशा राव');
    expect(patientNameKey('आशा राव')).not.toBe('');
  });
});

describe('findProbableDuplicates', () => {
  const records = [
    { id: '26100001', name: 'Asha Rao', age: 34, phone: '+91 98765 43210' },
    { id: '26100002', name: 'Asha Rao', age: 34 },
    { id: '26100003', name: 'Vikram Rao', age: 8, phone: '9811111111' },
  ];

  it('flags an identical phone regardless of formatting', () => {
    const matches = findProbableDuplicates(
      { name: 'Asha R', age: '34', phone: '9876543210' },
      records,
    );
    expect(matches.map(m => m.id)).toEqual(['26100001']);
    expect(matches[0]?.reason).toContain('same phone number');
  });

  it('flags the same name and age even with no phone on either side', () => {
    const matches = findProbableDuplicates({ name: 'asha rao', age: '34', phone: '' }, records);
    expect(matches.map(m => m.id).sort()).toEqual(['26100001', '26100002']);
  });

  it('finds a duplicate beyond the old 500-record window', () => {
    const many = Array.from({ length: 600 }, (_, index) => ({
      id: `p${index}`,
      name: `Patient ${index}`,
      age: 30,
    }));
    many[599] = { id: 'old-match', name: 'Asha Rao', age: 34 };
    expect(
      findProbableDuplicates({ name: 'asha rao', age: '34' }, many).map(match => match.id),
    ).toContain('old-match');
  });

  it('does not interrupt a registration for a different person', () => {
    expect(findProbableDuplicates({ name: 'Vikram Rao', age: '40', phone: '' }, records)).toEqual(
      [],
    );
  });

  it('uses a stable external identifier or name plus birth date for identity matching', () => {
    const candidates = [
      { id: 'child-1', name: 'Asha Rao', age: 2, dateOfBirth: '2024-02-29', externalId: 'BC-1' },
    ];
    expect(
      findProbableDuplicates({ name: 'Different Name', age: 2, externalId: 'bc-1' }, candidates)[0]
        ?.reason,
    ).toMatch(/external identifier/);
    expect(
      findProbableDuplicates({ name: 'Asha Rao', age: 2, dateOfBirth: '2024-02-29' }, candidates)[0]
        ?.reason,
    ).toMatch(/date of birth/);
  });

  it('never flags the record being edited as its own duplicate', () => {
    const matches = findProbableDuplicates(
      { name: 'Asha Rao', age: '34', phone: '9876543210' },
      records,
      '26100001',
    );
    expect(matches.map(m => m.id)).not.toContain('26100001');
  });
});

describe('registerPatient', () => {
  const input = { name: 'Asha Rao', age: '34', gender: 'female', phone: '', address: '' };

  it('starts each month at 0001 and writes patient plus counter in one transaction', async () => {
    const patient = await registerPatient(input, NOW);
    expect(patient.id).toBe(`${patientMonthKey(NOW)}0001`);
    expect(store.transactions).toBe(1);
    expect(store.documents.has(`patients/${patient.id}`)).toBe(true);
    expect(
      store.writes.some(w => w.path === 'meta' && w.id === `patient-id-${patientMonthKey(NOW)}`),
    ).toBe(true);
  });

  it('continues from the stored counter rather than probing at random', async () => {
    const month = patientMonthKey(NOW);
    store.documents.set(`meta/patient-id-${month}`, { value: 41, allocatedAt: NOW.toISOString() });

    expect((await registerPatient(input, NOW)).id).toBe(`${month}0042`);
  });

  it('walks past an id that is already taken', async () => {
    const month = patientMonthKey(NOW);
    store.documents.set(`patients/${month}0001`, { name: 'Someone Else' });

    expect((await registerPatient(input, NOW)).id).toBe(`${month}0002`);
  });

  it('rolls back the patient when the counter cannot be written', async () => {
    store.failMetaWrite = true;
    await expect(registerPatient(input, NOW)).rejects.toThrow(/counter write failed/);
    expect([...store.documents.keys()].some(key => key.startsWith('patients/'))).toBe(false);
    expect(store.writes).toHaveLength(0);
  });

  it('does not report success when it cannot find a number', async () => {
    const month = patientMonthKey(NOW);
    for (let n = 1; n <= 200; n++) {
      store.documents.set(`patients/${month}${String(n).padStart(4, '0')}`, { name: 'Taken' });
    }
    await expect(registerPatient(input, NOW)).rejects.toThrow(/could not be advanced/);
  });
});
