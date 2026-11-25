/**
 * Local data-error reporting.
 *
 * This used to enrich errors with the Firebase Auth user and rethrow a JSON
 * blob. Offline there is no auth object and no backend to enrich against, so it
 * now logs a structured line and rethrows the underlying message for the UI.
 * The export names are kept so existing call sites are unchanged.
 */
import { captureError } from './telemetry';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const message = error instanceof Error ? error.message : String(error);
  captureError(error, {
    scope: 'data',
    operation: operationType,
    // Only the collection name is safe diagnostics context; a document path can
    // contain a patient or report identifier.
    entity: path?.split('/')[0],
  });
  throw new Error(message);
}
