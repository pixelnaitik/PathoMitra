/** Legacy browser clinical stores used the pathlab: namespace before SQLCipher shells. */
const LEGACY_PREFIX = 'pathlab:';

/** Enumerate key names only; values are never read or exposed to the UI. */
export function legacyClinicalKeys(storage: Storage = window.localStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(LEGACY_PREFIX)) keys.push(key);
  }
  return keys;
}

export function purgeLegacyClinicalData(storage: Storage = window.localStorage): {
  removed: number;
  remaining: number;
} {
  const keys = legacyClinicalKeys(storage);
  for (const key of keys) storage.removeItem(key);
  const remaining = legacyClinicalKeys(storage).length;
  if (remaining > 0)
    throw new Error('Legacy browser data could not be fully removed. Nothing was displayed.');
  return { removed: keys.length, remaining };
}
