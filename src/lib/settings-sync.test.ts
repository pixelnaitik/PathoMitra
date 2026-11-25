import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ setDoc: vi.fn(async () => undefined), captureError: vi.fn() }));
vi.mock('../data/fs', () => ({
  db: {},
  doc: () => ({}),
  onSnapshot: () => () => undefined,
  setDoc: mocks.setDoc,
}));
vi.mock('./telemetry', () => ({ captureError: mocks.captureError }));

import { flushPendingSettings, parsePendingSettings } from './settings-sync';
import { DEFAULT_SETTINGS, SETTINGS_PERSIST_ERROR_EVENT, writeSettings } from './settings';

const PENDING_KEY = 'pathlab_settings_pending_v1';
const QUARANTINE_KEY = 'pathlab_settings_pending_v1_quarantine';

beforeEach(() => {
  localStorage.clear();
  mocks.setDoc.mockClear();
  mocks.captureError.mockClear();
});

describe('pending settings journal', () => {
  it('accepts a bounded, complete mirror payload', () => {
    expect(
      parsePendingSettings(
        JSON.stringify({
          settings: { labName: 'Test Lab' },
          customTests: [],
          updatedAt: '2026-11-24T10:00:00.000Z',
        }),
      ),
    ).toMatchObject({
      settings: { labName: 'Test Lab' },
      customTests: [],
    });
  });

  it('rejects malformed, incomplete, and oversized entries', () => {
    expect(() => parsePendingSettings('{')).toThrow();
    expect(() => parsePendingSettings(JSON.stringify({ settings: {} }))).toThrow(/malformed/);
    expect(() =>
      parsePendingSettings(
        JSON.stringify({ settings: {}, customTests: Array.from({ length: 401 }, () => ({})) }),
      ),
    ).toThrow(/malformed/);
    expect(() =>
      parsePendingSettings(
        `{"settings":{"value":"${'x'.repeat(8 * 1024 * 1024)}"},"customTests":[]}`,
      ),
    ).toThrow(/size limit/);
  });

  it('flushes a valid journal and removes it only after the mirror write succeeds', async () => {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ settings: { labName: 'Test Lab' }, customTests: [] }),
    );
    await flushPendingSettings();
    expect(mocks.setDoc).toHaveBeenCalledOnce();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('quarantines corrupt content without copying it into the marker', async () => {
    localStorage.setItem(PENDING_KEY, '{not-json');
    await expect(flushPendingSettings()).rejects.toThrow(/quarantined/);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(localStorage.getItem(QUARANTINE_KEY)).toContain('malformed-or-oversized');
    expect(localStorage.getItem(QUARANTINE_KEY)).not.toContain('not-json');
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('announces cache quota failures instead of silently losing the latest settings', () => {
    const messages: string[] = [];
    const listener = (event: Event) =>
      messages.push((event as CustomEvent<{ message: string }>).detail.message);
    window.addEventListener(SETTINGS_PERSIST_ERROR_EVENT, listener);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota');
    });
    expect(writeSettings({ ...DEFAULT_SETTINGS, labName: 'Latest Lab' })).toBe(false);
    spy.mockRestore();
    window.removeEventListener(SETTINGS_PERSIST_ERROR_EVENT, listener);
    expect(messages.join(' ')).toMatch(/could not be cached/);
  });
});
