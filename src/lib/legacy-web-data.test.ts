import { beforeEach, describe, expect, it, vi } from 'vitest';
import { legacyClinicalKeys, purgeLegacyClinicalData } from './legacy-web-data';

beforeEach(() => localStorage.clear());

describe('legacy browser clinical data cleanup', () => {
  it('detects key names without reading or exposing their values', () => {
    localStorage.setItem('pathlab:patients', 'synthetic-sensitive-value');
    localStorage.setItem('pathlab:reports', 'synthetic-sensitive-value');
    localStorage.setItem('pathologyos_settings', 'settings');
    const read = vi.spyOn(Storage.prototype, 'getItem');
    expect(legacyClinicalKeys().sort()).toEqual(['pathlab:patients', 'pathlab:reports']);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });

  it('purges only the legacy clinical namespace and verifies removal', () => {
    localStorage.setItem('pathlab:patients', 'synthetic');
    localStorage.setItem('pathlab:reports', 'synthetic');
    localStorage.setItem('pathologyos_settings', 'keep');
    expect(purgeLegacyClinicalData()).toEqual({ removed: 2, remaining: 0 });
    expect(localStorage.getItem('pathlab:patients')).toBeNull();
    expect(localStorage.getItem('pathologyos_settings')).toBe('keep');
  });
});
