import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  audits: [] as Record<string, unknown>[],
  sequence: 0,
}));

interface TestRepo {
  list: (entity: string) => Promise<Array<{ id: string; data: () => Record<string, unknown> }>>;
  get: (
    entity: string,
    id: string,
  ) => Promise<{ id: string; data: () => Record<string, unknown> } | null>;
  set: (entity: string, id: string, value: Record<string, unknown>) => Promise<void>;
  add: (entity: string, value: Record<string, unknown>) => Promise<string>;
  update: (entity: string, id: string, patch: Record<string, unknown>) => Promise<void>;
  delete: (entity: string, id: string) => Promise<void>;
  transaction: (fn: (tx: TestRepo) => Promise<void>) => Promise<void>;
}

vi.mock('../data', () => {
  const key = (entity: string, id: string) => `${entity}/${id}`;
  const repo: TestRepo = {
    list: async (entity: string) =>
      [...store.docs.entries()]
        .filter(([entry]) => entry.startsWith(`${entity}/`))
        .map(([entry, value]) => ({ id: entry.slice(entity.length + 1), data: () => value })),
    get: async (entity: string, id: string) => {
      const value = store.docs.get(key(entity, id));
      return value ? { id, data: () => value } : null;
    },
    set: async (entity: string, id: string, value: Record<string, unknown>) => {
      store.docs.set(key(entity, id), value);
    },
    add: async (entity: string, value: Record<string, unknown>) => {
      const id = `generated-${++store.sequence}`;
      store.docs.set(key(entity, id), value);
      if (entity === 'auditEvents') store.audits.push(value);
      return id;
    },
    update: async (entity: string, id: string, patch: Record<string, unknown>) => {
      store.docs.set(key(entity, id), { ...store.docs.get(key(entity, id)), ...patch });
    },
    delete: async (entity: string, id: string) => {
      store.docs.delete(key(entity, id));
    },
    transaction: async (fn: (tx: TestRepo) => Promise<void>) => {
      const snapshot = new Map(store.docs);
      const auditCount = store.audits.length;
      try {
        await fn(repo);
      } catch (error) {
        store.docs.clear();
        snapshot.forEach((value, entry) => store.docs.set(entry, value));
        store.audits.length = auditCount;
        throw error;
      }
    },
  };
  return { getRepository: () => repo };
});

import {
  createDoctor,
  deleteDoctor,
  dedupeDoctorNames,
  doctorMatchesQuery,
  doctorNameKey,
  groupByDoctorName,
  normaliseDoctorName,
  updateDoctor,
  validateDoctorInput,
} from './doctor-registry';

beforeEach(() => {
  store.docs.clear();
  store.audits.length = 0;
  store.sequence = 0;
});

/**
 * The referral register is free text, so these tests are all about the same
 * person arriving under three spellings — which is what splits one doctor across
 * three bars of the Top Referring Doctors chart and shows them three times in the
 * registration dropdown.
 */
describe('doctorNameKey', () => {
  it('folds title punctuation and case, but keeps a qualification distinct', () => {
    const a = doctorNameKey('DR MANOJ KUMAR');
    expect(doctorNameKey('DR.MANOJ KUMAR')).toBe(a);
    expect(doctorNameKey('  dr   manoj   kumar  ')).toBe(a);
    expect(doctorNameKey('Dr. Manoj Kumar (MBBS)')).toBe('DR MANOJ KUMAR MBBS');
  });

  it('folds the bracketed-suffix style this lab actually uses', () => {
    expect(doctorNameKey('DR GAUTAM KUMAR MS{EYE}')).toBe(
      doctorNameKey('DR Gautam Kumar MS [Eye]'),
    );
  });

  it('keeps two different doctors apart', () => {
    expect(doctorNameKey('DR ARVIND KUMAR')).not.toBe(doctorNameKey('ARBIND KUMAR'));
    expect(doctorNameKey('DR P K SINGH')).not.toBe(doctorNameKey('DR B K SINGH'));
  });

  it('does not invent a key for an empty name', () => {
    expect(doctorNameKey(undefined)).toBe('');
    expect(doctorNameKey('   .,  ')).toBe('');
  });
});

describe('groupByDoctorName', () => {
  const reports = [
    { id: 'r1', doctor: 'DR MANOJ KUMAR' },
    { id: 'r2', doctor: 'DR.MANOJ KUMAR' },
    { id: 'r3', doctor: 'Dr. Manoj Kumar (MBBS)' },
    { id: 'r4', doctor: 'DR ARVIND KUMAR' },
    { id: 'r5', doctor: '' },
    { id: 'r6' },
  ] as { id: string; doctor?: string }[];

  it('collapses the spellings of one doctor into one group', () => {
    const groups = groupByDoctorName(reports, r => r.doctor);
    const manoj = groups.find(g => doctorNameKey(g.name) === doctorNameKey('DR MANOJ KUMAR'));
    expect(manoj?.members).toHaveLength(2);
    expect(groups).toHaveLength(3);
  });

  it('drops records with no referral rather than grouping them as a doctor', () => {
    const groups = groupByDoctorName(reports, r => r.doctor);
    expect(groups.some(g => g.name === '')).toBe(false);
    expect(groups.reduce((n, g) => n + g.members.length, 0)).toBe(4);
  });

  it('shows the spelling the lab used most often', () => {
    const groups = groupByDoctorName(
      [{ name: 'DR MANOJ KUMAR' }, { name: 'DR MANOJ KUMAR' }, { name: 'DR.MANOJ KUMAR' }],
      r => r.name,
    );
    expect(groups[0]?.name).toBe('DR MANOJ KUMAR');
    expect(groups).toHaveLength(1);
  });
});

describe('dedupeDoctorNames', () => {
  it('keeps the first spelling and drops the later variants', () => {
    expect(
      dedupeDoctorNames(['DR ARVIND KUMAR', 'DR. ARVIND KUMAR', 'ARBIND KUMAR', '', '  ']),
    ).toEqual(['DR ARVIND KUMAR', 'ARBIND KUMAR']);
  });
});

describe('doctorMatchesQuery', () => {
  const name = 'DR SHAILENDRA KUMAR MS';

  it('matches words in any position and in any case', () => {
    expect(doctorMatchesQuery(name, 'shailendra ms')).toBe(true);
    expect(doctorMatchesQuery(name, 'KUMAR')).toBe(true);
    expect(doctorMatchesQuery(name, 'dr ms kumar')).toBe(true);
  });

  it('ignores the punctuation someone types', () => {
    expect(doctorMatchesQuery('DR.M.K SINGH', 'dr m k singh')).toBe(true);
  });

  it('shows everything when nothing has been typed', () => {
    expect(doctorMatchesQuery(name, '   ')).toBe(true);
  });

  it('does not match a different doctor', () => {
    expect(doctorMatchesQuery(name, 'shailendra verma')).toBe(false);
  });
});

describe('normaliseDoctorName', () => {
  it('collapses repeated spaces', () => {
    expect(normaliseDoctorName('DR   MANOJ   KUMAR')).toBe('DR MANOJ KUMAR');
  });

  it('leaves an all-caps register entry shouting, and title-cases a lowercase one', () => {
    expect(normaliseDoctorName('DR MANOJ KUMAR')).toBe('DR MANOJ KUMAR');
    expect(normaliseDoctorName('dr manoj kumar')).toBe('Dr Manoj Kumar');
  });
});

describe('doctor registry write boundary', () => {
  it('validates identity, contact and commission fields', () => {
    expect(validateDoctorInput({ name: 'Dr Test', referralPercent: 10 })).toBeNull();
    expect(validateDoctorInput({ name: ' ', referralPercent: 10 })).toMatch(/required/);
    expect(validateDoctorInput({ name: 'Dr Test', phone: 'call me' })).toMatch(/8–15 digits/);
    expect(validateDoctorInput({ name: 'Dr Test', referralPercent: 101 })).toMatch(
      /between 0 and 100/,
    );
  });

  it('creates a unique doctor and a domain audit event in one transaction', async () => {
    const doctor = await createDoctor(
      { name: 'Dr. Test Kumar', registration: 'REG-1', referralPercent: 10 },
      'Admin',
    );
    expect(doctor).toMatchObject({
      name: 'Dr. Test Kumar',
      registration: 'REG-1',
      referralPercent: 10,
    });
    expect(store.audits).toEqual([
      expect.objectContaining({ action: 'doctor.created', entityId: doctor.id, actor: 'Admin' }),
    ]);
    await expect(
      createDoctor({ name: 'DR TEST KUMAR', referralPercent: 0 }, 'Admin'),
    ).rejects.toThrow(/already in the register/);
    expect(store.audits).toHaveLength(1);
  });

  it('updates without changing registration provenance and rejects duplicate practitioner ids', async () => {
    const first = await createDoctor({ name: 'Dr First', registration: 'REG-1' }, 'Admin');
    const second = await createDoctor({ name: 'Dr Second', registration: 'REG-2' }, 'Admin');
    const updated = await updateDoctor(
      second.id,
      { name: 'Dr Second Updated', registration: 'REG-2', referralPercent: 20 },
      'Admin',
    );
    expect(updated.createdAt).toBe(second.createdAt);
    await expect(
      updateDoctor(second.id, { name: 'Dr Second Updated', registration: 'REG-1' }, 'Admin'),
    ).rejects.toThrow(/already used/);
    expect(first.id).not.toBe(second.id);
  });

  it('refuses to delete a doctor who is attached to patient or billing history', async () => {
    const doctor = await createDoctor({ name: 'Dr History' }, 'Admin');
    store.docs.set('patients/p1', { doctorId: doctor.id, name: 'Synthetic Patient' });
    await expect(deleteDoctor(doctor.id, 'Admin')).rejects.toThrow(/history and cannot be deleted/);
    expect(store.docs.has(`doctors/${doctor.id}`)).toBe(true);
  });
});
