import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrashPayload } from './telemetry';

const store = new Map<string, string>();
vi.mock('./secure-store', () => ({
  secureGet: async (key: string) => store.get(key) ?? null,
  secureSet: async (key: string, value: string) => {
    store.set(key, value);
  },
  secureRemove: async (key: string) => {
    store.delete(key);
  },
}));
const KEY = 'pathlab_crash_log_v1';
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function payload(overrides: Partial<CrashPayload> = {}): CrashPayload {
  return {
    name: 'Error',
    message: 'something broke',
    context: {},
    correlationId: '00000000-0000-4000-8000-000000000001',
    at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('crash-log privacy and durability', () => {
  it('caps the secure buffer and keeps the newest entries', async () => {
    const { clearCrashLog, recordCrash, readCrashLog, __resetCrashLogForTests } =
      await import('./crash-log');
    __resetCrashLogForTests();
    await clearCrashLog();
    for (let i = 0; i < 70; i++)
      recordCrash(
        payload({ correlationId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }),
      );
    await settle();
    const entries = await readCrashLog();
    expect(entries).toHaveLength(20);
    expect(entries[0]?.key).toBe(51);
    expect(entries.at(-1)?.key).toBe(70);
  });

  it('never persists seeded PHI, raw stacks, routes, or arbitrary context', async () => {
    const { clearCrashLog, recordCrash, __resetCrashLogForTests } = await import('./crash-log');
    __resetCrashLogForTests();
    await clearCrashLog();
    recordCrash(
      payload({
        name: 'Error',
        message: 'Asha Rao / a@example.com / +91 98765 43210 / ACC-123',
        stack: 'at run (Asha Rao, index.js:1:1)',
        url: '/dashboard/reports/ACC-123',
        context: { scope: 'reports:save', patientName: 'Asha Rao', file: 'Asha Rao.pdf' },
      }),
    );
    await settle();
    const stored = store.get(KEY) ?? '';
    for (const secret of ['Asha', 'a@example.com', '98765', 'ACC-123', 'index.js'])
      expect(stored).not.toContain(secret);
    expect(stored).toContain('details redacted');
    expect(stored).toContain('reports:save');
  });

  it('clearing empties both memory and secure storage', async () => {
    const { clearCrashLog, recordCrash, readCrashLog, __resetCrashLogForTests } =
      await import('./crash-log');
    __resetCrashLogForTests();
    recordCrash(payload());
    await settle();
    expect(await readCrashLog()).toHaveLength(1);
    await clearCrashLog();
    expect(await readCrashLog()).toHaveLength(0);
    expect(store.has(KEY)).toBe(false);
  });

  it('survives corrupt secure data and exports only redacted categories', async () => {
    store.set(KEY, '{not json');
    const { readCrashLog, recordCrash, formatCrashLog, __resetCrashLogForTests } =
      await import('./crash-log');
    __resetCrashLogForTests();
    await expect(readCrashLog()).resolves.toEqual([]);
    recordCrash(payload({ message: 'raw secret', stack: 'raw stack', url: '/raw' }));
    await settle();
    const text = formatCrashLog(await readCrashLog());
    expect(text).toContain('PathoMitra');
    expect(text).toContain('details redacted');
    expect(text).not.toContain('raw secret');
    expect(text).not.toContain('raw stack');
  });

  it('sanitizes legacy entries on load instead of trusting their old shape', async () => {
    store.set(
      KEY,
      JSON.stringify([
        {
          key: 4,
          name: 'TypeError',
          message: 'Patient Asha Rao 26110001 failed',
          stack: 'at ReportsPage Asha Rao',
          url: '/reports?report=26110001',
          context: { scope: 'reports', patientName: 'Asha Rao', path: '/patients/26110001' },
          correlationId: 'legacy-1',
          at: '2026-11-24T10:00:00.000Z',
        },
      ]),
    );
    const { readCrashLog, formatCrashLog, __resetCrashLogForTests } = await import('./crash-log');
    __resetCrashLogForTests();
    const entries = await readCrashLog();
    expect(entries[0]).toMatchObject({ key: 4, context: { scope: 'reports' } });
    expect(entries[0].stack).toBeUndefined();
    expect(entries[0].url).toBeUndefined();
    expect(formatCrashLog(entries)).not.toMatch(/Asha|26110001|\/patients/);
  });
});
