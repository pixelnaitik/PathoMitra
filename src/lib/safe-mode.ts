import { Capacitor, registerPlugin } from '@capacitor/core';
import { z } from 'zod';
import { setRepositoryWriteGuard } from '../data/write-guard';
import { desktopBridge } from './desktop-bridge';

const STORAGE_KEY = 'pathlab_safe_mode_v1';
export const SAFE_MODE_EVENT = 'pathomitra:safe-mode';
const StoredSafeModeSchema = z.object({
  active: z.boolean(),
  reason: z.string().max(300).default(''),
});

let active = false;
let reason = '';

if (typeof window !== 'undefined') {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = StoredSafeModeSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new Error('Malformed safe-mode state');
      active = parsed.data.active;
      reason = parsed.data.active ? parsed.data.reason.slice(0, 300) : '';
    }
  } catch {
    active = true;
    reason =
      'Safe-mode state could not be read. Clinical writes remain paused until an administrator reviews storage integrity.';
  }
}

function publish(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SAFE_MODE_EVENT, { detail: { active, reason } }));
  }
}

export function isSafeMode(): boolean {
  return active;
}
export function safeModeReason(): string {
  return reason;
}

export function enableSafeMode(nextReason: string): void {
  active = true;
  reason =
    nextReason.trim().slice(0, 300) ||
    'Clinical writes are paused while storage integrity is reviewed.';
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ active, reason }));
  } catch {
    /* session still protected */
  }
  setRepositoryWriteGuard(() => {
    throw new Error(`Safe mode is active: ${reason}`);
  });
  publish();
}

export function disableSafeMode(): void {
  active = false;
  reason = '';
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* session still unprotected only by user choice */
  }
  setRepositoryWriteGuard(null);
  publish();
}

setRepositoryWriteGuard(
  active
    ? () => {
        throw new Error(`Safe mode is active: ${reason}`);
      }
    : null,
);

export interface StoragePressure {
  supported: boolean;
  usage: number;
  quota: number;
  ratio: number;
}

interface NativeStoragePressureProvider {
  pressure(): Promise<{ usage: number; quota: number }>;
}

const NativeStoragePressure = registerPlugin<NativeStoragePressureProvider>('StoragePressure');

const pressureResult = (usage: number, quota: number): StoragePressure => ({
  supported: quota > 0,
  usage: Math.max(0, usage),
  quota: Math.max(0, quota),
  ratio: quota > 0 ? Math.max(0, usage) / quota : 0,
});

/** Prefer real filesystem capacity on native shells, then the web estimate. */
export async function storagePressure(): Promise<StoragePressure> {
  const desktop = desktopBridge()?.system;
  if (desktop) {
    const result = await desktop.storagePressure();
    return pressureResult(result.usage, result.quota);
  }
  if (Capacitor.isNativePlatform()) {
    const result = await NativeStoragePressure.pressure();
    return pressureResult(Number(result.usage) || 0, Number(result.quota) || 0);
  }
  if (!navigator.storage?.estimate) return { supported: false, usage: 0, quota: 0, ratio: 0 };
  const estimate = await navigator.storage.estimate();
  return pressureResult(Number(estimate.usage) || 0, Number(estimate.quota) || 0);
}
