import { getRepository } from '../data';
import { isShell } from '../data';
import { readSettings } from './settings';

export interface OutputAudit {
  /** Human-readable operator stamp; the immutable uid is stored separately. */
  actor: string;
  actorUid: string;
  actorRole?: string;
  entityType?: 'reports' | 'invoices' | 'exports';
  action: 'export' | 'print' | 'preview' | 'download' | 'share';
  format: 'csv' | 'pdf' | 'json';
  /** Stable record id, never a patient name or file path. */
  recordId?: string;
  recordVersion?: number;
  rowCount?: number;
  /** Non-PHI filter description such as date bounds and status flags. */
  filters?: Record<string, unknown>;
  destination?: 'private' | 'public' | 'browser-download' | 'share-sheet' | 'printer' | 'viewer';
  /** Actual path, URI, printer, or system destination when the platform exposes it. */
  destinationDetail?: string;
  content: string;
  outcome?: 'completed' | 'cancelled' | 'failed';
}

async function sha256(content: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content),
  );
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Append a tamper-evident, PHI-minimized output manifest to the local audit trail. */
export async function recordOutputAudit(input: OutputAudit): Promise<void> {
  const actorUid = String(input.actorUid ?? '').trim();
  if (!actorUid) throw new Error('Output audit requires an authenticated operator uid.');
  const id = `output-${Date.now()}-${globalThis.crypto.randomUUID()}`;
  const entityType = input.entityType ?? (input.recordId ? 'reports' : 'exports');
  const destinationDetail = Array.from(String(input.destinationDetail ?? ''))
    .filter(ch => {
      const cp = ch.codePointAt(0) ?? 0;
      return cp >= 0x20 && cp !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, 2048);
  await getRepository().set('auditEvents', id, {
    action: `output.${input.action}`,
    entity: entityType,
    entityId: input.recordId ?? id,
    actor: actorUid,
    actorName: String(input.actor ?? '').trim(),
    actorRole: input.actorRole ?? 'guest',
    at: new Date().toISOString(),
    detail: {
      format: input.format,
      entityType,
      recordVersion: input.recordVersion,
      rowCount: input.rowCount,
      filters: input.filters,
      destination: input.destination ?? defaultDestination(),
      destinationDetail: destinationDetail || undefined,
      contentHash: await sha256(input.content),
      outcome: input.outcome ?? 'completed',
    },
  });
}

function defaultDestination(): OutputAudit['destination'] {
  if (!isShell) return 'browser-download';
  return readSettings().allowPublicExports ? 'public' : 'private';
}
