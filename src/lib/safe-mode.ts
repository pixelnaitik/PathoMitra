import { setRepositoryWriteGuard } from '../data/write-guard';

const STORAGE_KEY = 'pathlab_safe_mode_v1';
export const SAFE_MODE_EVENT = 'pathomitra:safe-mode';
let active = false;
let reason = '';

if (typeof window !== 'undefined') {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { active?: boolean; reason?: string } | null;
    active = !!stored?.active;
    reason = stored?.reason ?? '';
  } catch { /* an unreadable flag fails open; integrity checks can re-enable it */ }
}

function publish(): void {
  window.dispatchEvent(new CustomEvent(SAFE_MODE_EVENT, { detail: { active, reason } }));
}

export function isSafeMode(): boolean { return active; }
export function safeModeReason(): string { return reason; }

export function enableSafeMode(nextReason: string): void {
  active = true;
  reason = nextReason.slice(0, 300);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ active, reason })); } catch { /* session still protected */ }
  setRepositoryWriteGuard(() => { throw new Error(`Safe mode is active: ${reason}`); });
  publish();
}

export function disableSafeMode(): void {
  active = false;
  reason = '';
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* session still unprotected only by user choice */ }
  setRepositoryWriteGuard(null);
  publish();
}

setRepositoryWriteGuard(active ? () => { throw new Error(`Safe mode is active: ${reason}`); } : null);

export interface StoragePressure {
  supported: boolean;
  usage: number;
  quota: number;
  ratio: number;
}

export async function storagePressure(): Promise<StoragePressure> {
  if (!navigator.storage?.estimate) return { supported: false, usage: 0, quota: 0, ratio: 0 };
  const estimate = await navigator.storage.estimate();
  const usage = Number(estimate.usage) || 0;
  const quota = Number(estimate.quota) || 0;
  return { supported: quota > 0, usage, quota, ratio: quota > 0 ? usage / quota : 0 };
}
