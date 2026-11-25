import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildCrashPayload,
  captureError,
  initErrorReporting,
  __resetErrorReporting,
} from './telemetry';

vi.mock('./crash-log', () => ({ recordCrash: vi.fn() }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetErrorReporting();
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetErrorReporting();
  vi.restoreAllMocks();
});

describe('captureError (offline)', () => {
  it('always logs through console.error so it survives minification', () => {
    captureError(new Error('boom'));
    expect(console.error).toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls[0][1]).toMatchObject({ name: 'Error' });
  });

  it('never touches the network — the offline app has no ingest endpoint', () => {
    captureError(new Error('network down'), { scope: 'fetch' });
    captureError(new Error('and again'), { scope: 'fetch' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs every occurrence (dedupe only ever gated the removed network report)', () => {
    captureError(new Error('duplicate'), { scope: 'render' });
    captureError(new Error('duplicate'), { scope: 'render' });
    expect(console.error).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles non-Error throwables without throwing', () => {
    expect(() => captureError('a string reason')).not.toThrow();
    expect(() => captureError({ code: 42 })).not.toThrow();
    expect(() => captureError(undefined)).not.toThrow();
  });

  it('keeps raw patient/error text out of the console trace', () => {
    captureError(new Error('Patient Asha Rao 26110001 failed'), { scope: 'reports' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/Asha|26110001/);
  });
});

describe('buildCrashPayload', () => {
  it('keeps correlation metadata but removes arbitrary PHI and raw stacks', () => {
    const payload = buildCrashPayload(new Error('Asha Rao ACC-123 failed'), {
      scope: 'reports:save',
      patientName: 'Asha Rao',
      file: 'Asha Rao.pdf',
      retryable: true,
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('Asha');
    expect(serialized).not.toContain('ACC-123');
    expect(payload.stack).toBeUndefined();
    expect(payload.url).toBeUndefined();
    expect(payload.context).toEqual({ scope: 'reports:save', retryable: true });
    expect(payload.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('initErrorReporting', () => {
  const rejectedPromise = (error: Error) => {
    const promise = Promise.reject(error);
    promise.catch(() => {});
    return promise;
  };

  it('captures unhandled rejections without any network call', () => {
    initErrorReporting();
    const reason = new Error('loose promise');
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', { reason, promise: rejectedPromise(reason) }),
    );
    expect(console.error).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is idempotent — repeated init still captures offline, never over the network', () => {
    initErrorReporting();
    initErrorReporting();
    const reason = new Error('once');
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', { reason, promise: rejectedPromise(reason) }),
    );
    expect(console.error).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores resource load errors that carry no Error object', () => {
    initErrorReporting();
    window.dispatchEvent(new Event('error'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
