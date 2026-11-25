import type { LabSettings } from './settings';
import type { PatientRecord, ReportRecord } from './models';
import { ageAsNumber } from './models';
import {
  expandTestSelection,
  findTestInfo,
  resolveReferenceRange,
  type PathologyTest,
  type RangeVerification,
} from './pathology-tests';

export interface SnapshotRange {
  [key: string]: unknown;
  label: string;
  values: { min?: number; max?: number } | null;
  unverifiedForPatient: boolean;
  reason?: string;
  source?: string;
  verification?: RangeVerification;
  lastReviewed?: string;
  reviewedBy?: string;
  effectiveFrom?: string;
  version?: number;
}

export interface SnapshotTest {
  [key: string]: unknown;
  name: string;
  unit?: string;
  method?: string;
  specimen?: string;
  category?: string;
  kind?: PathologyTest['kind'];
  isGroup?: boolean;
  isHeader?: boolean;
  testId?: string;
  version?: number;
  effectiveFrom?: string;
  reviewedBy?: string;
  range: SnapshotRange;
}

export interface ReportIssuanceSnapshot {
  [key: string]: unknown;
  version: 1;
  orderId?: string;
  createdAt: string;
  patient: Pick<
    PatientRecord,
    | 'id'
    | 'name'
    | 'age'
    | 'gender'
    | 'phone'
    | 'dateOfBirth'
    | 'guardianName'
    | 'guardianPhone'
    | 'externalIdType'
    | 'externalId'
    | 'address'
    | 'doctorName'
    | 'createdAt'
  >;
  settings: LabSettings & Record<string, unknown>;
  tests: SnapshotTest[];
}

/**
 * Capture the clinical context that determines what an issued report means.
 * Historical output must not change when a patient, tariff, lab identity, or
 * catalogue range is edited later.
 */
export function buildReportIssuanceSnapshot(
  report: Pick<ReportRecord, 'patientId' | 'testSelection' | 'resultData' | 'orderId'>,
  patient: PatientRecord,
  settings: LabSettings,
  now = new Date().toISOString(),
): ReportIssuanceSnapshot {
  const age = ageAsNumber(patient, new Date(now));
  const names = [
    ...new Set([...(report.testSelection ?? []), ...expandTestSelection(report.testSelection)]),
  ];
  const tests = names.map(name => {
    const info = findTestInfo(name);
    const range = resolveReferenceRange(info?.ranges, age, patient.gender);
    return {
      name,
      ...(info?.id ? { testId: info.id } : {}),
      ...(info?.version ? { version: info.version } : {}),
      ...(info?.effectiveFrom ? { effectiveFrom: info.effectiveFrom } : {}),
      ...(info?.reviewedBy ? { reviewedBy: info.reviewedBy } : {}),
      ...(info?.unit ? { unit: info.unit } : {}),
      ...(info?.method ? { method: info.method } : {}),
      ...(info?.specimen ? { specimen: info.specimen } : {}),
      ...(info?.category ? { category: info.category } : {}),
      ...(info?.kind ? { kind: info.kind } : {}),
      ...(info?.isGroup ? { isGroup: true } : {}),
      ...(info?.isHeader ? { isHeader: true } : {}),
      range: {
        label: range.label,
        values: range.values,
        unverifiedForPatient: range.unverifiedForPatient,
        ...(range.reason ? { reason: range.reason } : {}),
        ...(range.source ? { source: range.source } : {}),
        ...(range.verification ? { verification: range.verification } : {}),
        ...(range.lastReviewed ? { lastReviewed: range.lastReviewed } : {}),
        ...(range.reviewedBy ? { reviewedBy: range.reviewedBy } : {}),
        ...(range.effectiveFrom ? { effectiveFrom: range.effectiveFrom } : {}),
        ...(range.version ? { version: range.version } : {}),
      },
    };
  });
  const snapshotSettings = {
    ...settings,
    brandLogoUrl: '',
    sharingTemplateImage: '',
    avatarSeed: 'default',
  } as LabSettings & Record<string, unknown>;
  return {
    version: 1,
    ...(report.orderId ? { orderId: report.orderId } : {}),
    createdAt: now,
    patient: {
      id: patient.id,
      name: patient.name,
      age: patient.age,
      gender: patient.gender,
      ...(patient.phone ? { phone: patient.phone } : {}),
      ...(patient.dateOfBirth ? { dateOfBirth: patient.dateOfBirth } : {}),
      ...(patient.guardianName ? { guardianName: patient.guardianName } : {}),
      ...(patient.guardianPhone ? { guardianPhone: patient.guardianPhone } : {}),
      ...(patient.externalIdType ? { externalIdType: patient.externalIdType } : {}),
      ...(patient.externalId ? { externalId: patient.externalId } : {}),
      ...(patient.address ? { address: patient.address } : {}),
      ...(patient.doctorName ? { doctorName: patient.doctorName } : {}),
      createdAt: patient.createdAt,
    },
    settings: snapshotSettings,
    tests,
  };
}

/** Evaluate an issued value only against the range frozen at issuance. */
export function resolveIssuanceValueStatus(
  snapshot: ReportRecord['issuanceSnapshot'],
  testName: string,
  value: unknown,
): {
  status: 'normal' | 'low' | 'high' | null;
  rangeLabel: string;
  unit: string;
  unverifiedForPatient: boolean;
} {
  const test = snapshot?.tests.find(item => item.name === testName);
  if (!test) return { status: null, rangeLabel: '', unit: '', unverifiedForPatient: true };
  const raw =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const numeric = Number(raw.replace(/^[<>≤≥]\s*/, ''));
  const bounds = test.range.values;
  const status =
    !raw || !bounds || !Number.isFinite(numeric)
      ? null
      : bounds.min !== undefined && numeric < bounds.min
        ? 'low'
        : bounds.max !== undefined && numeric > bounds.max
          ? 'high'
          : 'normal';
  return {
    status,
    rangeLabel: test.range.label,
    unit: test.unit ?? '',
    unverifiedForPatient: test.range.unverifiedForPatient,
  };
}
