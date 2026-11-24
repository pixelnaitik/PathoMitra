import { describe, expect, it } from 'vitest';
import { buildReportIssuanceSnapshot } from './report-snapshot';
import { DEFAULT_SETTINGS, writeCustomTests } from './settings';
import { ReportIssuanceSnapshotSchema, type PatientRecord } from './models';

const patient: PatientRecord = {
  id: 'p1',
  name: 'Asha Rao',
  age: 8,
  gender: 'female',
  phone: '9876543210',
  doctorName: 'Dr Rao',
  createdAt: '2026-11-01T00:00:00.000Z',
};

describe('report issuance snapshot', () => {
  it('captures demographics, settings, and the exact range decision', () => {
    const snapshot = buildReportIssuanceSnapshot(
      { patientId: patient.id, testSelection: ['HB (HAEMOGLOBIN)'], resultData: {} },
      patient,
      { ...DEFAULT_SETTINGS, labName: 'First Lab' },
      '2026-11-24T10:00:00.000Z',
    );
    expect(snapshot.patient).toMatchObject({ name: 'Asha Rao', age: 8, gender: 'female' });
    expect(snapshot.settings.labName).toBe('First Lab');
    expect(snapshot.tests[0].range.unverifiedForPatient).toBe(true);
    expect(snapshot.tests[0].range.reason).toMatch(/paediatric/i);
    expect(ReportIssuanceSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('freezes catalogue and range governance provenance', () => {
    writeCustomTests([{
      id: 'custom_governed',
      name: 'Governed Assay',
      category: 'CUSTOM',
      kind: 'numeric',
      unit: 'mg/dL',
      method: 'Validated photometric method',
      version: 3,
      effectiveFrom: '2026-11-01',
      reviewedBy: 'Dr Reviewer',
      ranges: {
        general: {
          text: '1.0 - 2.0',
          source: 'In-house validation',
          verification: 'approved',
          lastReviewed: '2026-10-31',
          reviewedBy: 'Dr Reviewer',
          effectiveFrom: '2026-11-01',
          version: 3,
        },
      },
    }]);
    const snapshot = buildReportIssuanceSnapshot(
      { patientId: patient.id, testSelection: ['Governed Assay'], resultData: {} },
      patient,
      DEFAULT_SETTINGS,
    );
    expect(snapshot.tests[0]).toMatchObject({
      testId: 'custom_governed',
      version: 3,
      effectiveFrom: '2026-11-01',
      reviewedBy: 'Dr Reviewer',
      method: 'Validated photometric method',
      range: { verification: 'approved', reviewedBy: 'Dr Reviewer', version: 3 },
    });
    expect(ReportIssuanceSnapshotSchema.safeParse(snapshot).success).toBe(true);
    writeCustomTests([]);
  });

  it('does not mutate when live patient or lab settings change later', () => {
    const snapshot = buildReportIssuanceSnapshot(
      { patientId: patient.id, testSelection: ['HB (HAEMOGLOBIN)'], resultData: {} },
      patient,
      DEFAULT_SETTINGS,
    );
    const before = JSON.stringify(snapshot);
    patient.name = 'Changed Name';
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(snapshot.patient.name).toBe('Asha Rao');
  });
});
