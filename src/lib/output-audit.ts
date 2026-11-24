import { getRepository } from '../data';
import { isShell } from '../data';
import { readSettings } from './settings';

export interface OutputAudit {
  actor: string;
  action: 'export' | 'print' | 'preview' | 'download' | 'share';
  format: 'csv' | 'pdf' | 'json';
  /** Stable record id, never a patient name or file path. */
  recordId?: string;
  recordVersion?: number;
  rowCount?: number;
  /** Non-PHI filter description such as date bounds and status flags. */
  filters?: Record<string, unknown>;
  destination?: 'private' | 'public' | 'browser-download' | 'share-sheet' | 'printer' | 'viewer';
  content: string;
  outcome?: 'completed' | 'cancelled' | 'failed';
}

async function sha256(content: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Append a tamper-evident, PHI-minimized output manifest to the local audit trail. */
export async function recordOutputAudit(input: OutputAudit): Promise<void> {
  const id = `output-${Date.now()}-${globalThis.crypto.randomUUID()}`;
  await getRepository().set('auditEvents', id, {
    action: `output.${input.action}`,
    entity: input.recordId ? 'reports' : 'exports',
    entityId: input.recordId ?? id,
    actor: input.actor,
    at: new Date().toISOString(),
    detail: {
      format: input.format,
      recordVersion: input.recordVersion,
      rowCount: input.rowCount,
      filters: input.filters,
      destination: input.destination ?? defaultDestination(),
      contentHash: await sha256(input.content),
      outcome: input.outcome ?? 'completed',
    },
  });
}

function defaultDestination(): OutputAudit['destination'] {
  if (!isShell) return 'browser-download';
  return readSettings().allowPublicExports ? 'public' : 'private';
}
