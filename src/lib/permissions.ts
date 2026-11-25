import type { Role } from './models';

export type Permission =
  | 'manageOperators'
  | 'manageSettings'
  | 'registerPatients'
  | 'enterResults'
  | 'verifyReports'
  | 'issueReports'
  | 'manageBilling'
  | 'manageDoctors'
  | 'manageOrders'
  | 'manageSamples'
  | 'manageCatalog'
  | 'manageBackup'
  | 'restoreData'
  | 'manageNotifications'
  | 'viewClinical'
  | 'viewAudit'
  | 'exportData'
  | 'eraseData';

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  guest: ['viewClinical'],
  staff: [
    'viewClinical',
    'registerPatients',
    'enterResults',
    'manageBilling',
    'manageOrders',
    'manageSamples',
  ],
  technologist: [
    'viewClinical',
    'registerPatients',
    'enterResults',
    'manageOrders',
    'manageSamples',
  ],
  pathologist: [
    'viewClinical',
    'registerPatients',
    'enterResults',
    'verifyReports',
    'issueReports',
    'manageOrders',
    'manageSamples',
    'manageCatalog',
  ],
  cashier: ['viewClinical', 'registerPatients', 'manageBilling'],
  admin: [
    'manageOperators',
    'manageSettings',
    'registerPatients',
    'enterResults',
    'verifyReports',
    'issueReports',
    'manageBilling',
    'manageDoctors',
    'manageOrders',
    'manageSamples',
    'manageCatalog',
    'manageBackup',
    'restoreData',
    'manageNotifications',
    'viewClinical',
    'viewAudit',
    'exportData',
    'eraseData',
  ],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  guest: 'Read-only guest',
  staff: 'Staff',
  technologist: 'Technologist',
  pathologist: 'Pathologist',
  cashier: 'Cashier',
  admin: 'Administrator',
};
