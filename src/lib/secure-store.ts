/**
 * Small secure key/value store for auth bootstrap data (the account record,
 * password hash, biometric flag).
 *
 * On device this is `@aparajita/capacitor-secure-storage`, which is backed by
 * the Android Keystore / iOS Keychain — the right home for a password hash.
 * In the browser (dev/tests) it falls back to `localStorage`, clearly good
 * enough for development and never used by the shipped APK.
 *
 * The v8 plugin requires a non-blank key prefix before any read/write, so we
 * set it once, lazily.
 */
import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { DataType } from '@aparajita/capacitor-secure-storage';

const PREFIX = 'pathlab_';
let prefixSet = false;

async function ensurePrefix(): Promise<void> {
  if (prefixSet) return;
  await SecureStorage.setKeyPrefix(PREFIX);
  prefixSet = true;
}

export async function secureGet<T>(key: string): Promise<T | null> {
  if (Capacitor.isNativePlatform()) {
    await ensurePrefix();
    const value = await SecureStorage.get(key);
    return (value as unknown as T) ?? null;
  }
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function secureSet<T>(key: string, value: T): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await ensurePrefix();
    await SecureStorage.set(key, value as unknown as DataType);
    return;
  }
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota / private mode — nothing else we can do in dev.
  }
}

export async function secureRemove(key: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await ensurePrefix();
    await SecureStorage.remove(key);
    return;
  }
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}
