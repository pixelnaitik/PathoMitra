/**
 * The single collection contract shared by renderer repositories, native SQLite,
 * Electron IPC, backup/restore, and erasure. Adding a collection here must be
 * accompanied by schema validation and a platform contract test.
 */
export const ENTITY_NAMES = [
  'users',
  'patients',
  'doctors',
  'orders',
  'samples',
  'reports',
  'reportNotes',
  'reportVersions',
  'invoices',
  'payments',
  'referralPayouts',
  'auditEvents',
  'labSettings',
  'notificationState',
  'meta',
] as const;

export type EntityName = (typeof ENTITY_NAMES)[number];

export function isEntityName(value: unknown): value is EntityName {
  return typeof value === 'string' && (ENTITY_NAMES as readonly string[]).includes(value);
}
