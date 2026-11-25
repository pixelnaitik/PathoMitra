const STORAGE_KEY = 'pathomitra_notification_delivery_v1';
export const NOTIFICATION_DELIVERY_EVENT = 'pathomitra:notification-delivery';
const MAX_RECORDS = 200;
let writeQueue: Promise<void> = Promise.resolve();

export type DeliveryOutcome = 'scheduled' | 'delivered' | 'failed' | 'acknowledged';

interface DeliveryRecord {
  keyHash: string;
  outcome: DeliveryOutcome;
  at: string;
}

function read(): DeliveryRecord[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is DeliveryRecord =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as DeliveryRecord).keyHash === 'string' &&
          ['scheduled', 'delivered', 'failed', 'acknowledged'].includes(
            (entry as DeliveryRecord).outcome,
          ) &&
          typeof (entry as DeliveryRecord).at === 'string',
      )
      .slice(-MAX_RECORDS);
  } catch {
    return [];
  }
}

async function keyHash(key: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Store only a one-way digest and outcome, never an alert id, patient name or body. */
export async function recordNotificationDelivery(
  key: string,
  outcome: DeliveryOutcome,
): Promise<void> {
  const hash = await keyHash(key);
  if (!hash) return;
  writeQueue = writeQueue.then(() => {
    const next = [...read(), { keyHash: hash, outcome, at: new Date().toISOString() }].slice(
      -MAX_RECORDS,
    );
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(NOTIFICATION_DELIVERY_EVENT));
    } catch {
      // Diagnostics are best-effort and must never break alert delivery.
    }
  });
  await writeQueue;
}

export function notificationDeliverySummary(): {
  delivered: number;
  failed: number;
  acknowledged: number;
} {
  const records = read();
  return {
    delivered: records.filter(record => record.outcome === 'delivered').length,
    failed: records.filter(record => record.outcome === 'failed').length,
    acknowledged: records.filter(record => record.outcome === 'acknowledged').length,
  };
}
