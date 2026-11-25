import type { EntityName } from '../data/entities';
import type { Role } from './models';
import type { Permission } from './permissions';

export type RepositoryMutation = 'create' | 'update' | 'delete';

/** Shared renderer/main mapping for repository mutations. */
export function repositoryPermission(
  entity: EntityName,
  mutation: RepositoryMutation,
  value?: Record<string, unknown>,
): Permission {
  switch (entity) {
    case 'users':
      return 'manageOperators';
    case 'patients':
      return 'registerPatients';
    case 'doctors':
      return 'manageDoctors';
    case 'orders':
      return 'manageOrders';
    case 'samples':
      return 'manageSamples';
    case 'reports':
    case 'reportNotes':
    case 'reportVersions':
      return value?.status === 'final' || mutation === 'delete' ? 'issueReports' : 'enterResults';
    case 'invoices':
    case 'payments':
    case 'referralPayouts':
      return 'manageBilling';
    case 'labSettings':
      return 'manageSettings';
    case 'notificationState':
      return 'manageNotifications';
    case 'auditEvents':
      return mutation === 'create' ? 'viewClinical' : 'viewAudit';
    case 'meta':
      return 'enterResults';
    default:
      return 'manageSettings';
  }
}

export function repositoryActorRole(role: Role): Role {
  return role;
}
