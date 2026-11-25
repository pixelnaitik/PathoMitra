import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadWorker(assetResponse: unknown = null) {
  const listeners = new Map<string, Array<(event: any) => void>>();
  const cache = {
    addAll: vi.fn(async () => undefined),
    match: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
  };
  const skipWaiting = vi.fn();
  const self = {
    location: { origin: 'https://pathomitra.pages.dev' },
    addEventListener: (name: string, listener: (event: any) => void) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    },
    skipWaiting,
    clients: { claim: vi.fn(async () => undefined) },
  };
  const fetcher = vi.fn(async (input: string | URL | Request) =>
    String(input).includes('pwa-version.json')
      ? { ok: true, json: async () => ({ version: '2.8.9', buildId: '2.8.9-test' }) }
      : assetResponse,
  );
  const code = fs.readFileSync(path.resolve(process.cwd(), 'public', 'sw.js'), 'utf8');
  vm.runInNewContext(code, { self, caches, fetch: fetcher, URL, Set, Promise, Response });
  return { listeners, cache, caches, skipWaiting, fetcher };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('public service worker cache boundary', () => {
  it('never intercepts unrecognised same-origin JSON', async () => {
    const worker = loadWorker();
    await flush();
    const respondWith = vi.fn();
    worker.listeners.get('fetch')?.forEach(listener =>
      listener({
        request: {
          method: 'GET',
          url: 'https://pathomitra.pages.dev/api/patients.json',
          mode: 'cors',
        },
        respondWith,
      }),
    );
    expect(respondWith).not.toHaveBeenCalled();
    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it('caches allowlisted static assets', async () => {
    const response = { status: 200, type: 'basic', clone: () => ({}) };
    const worker = loadWorker(response);
    await flush();
    const respondWith = vi.fn();
    worker.listeners.get('fetch')?.forEach(listener =>
      listener({
        request: {
          method: 'GET',
          url: 'https://pathomitra.pages.dev/assets/app-test.js',
          mode: 'cors',
        },
        respondWith,
      }),
    );
    await respondWith.mock.calls[0][0];
    expect(worker.cache.put).toHaveBeenCalledOnce();
  });

  it('does not cache clinical-route HTML even when the response is successful', async () => {
    const response = { status: 200, type: 'basic', clone: () => ({}) };
    const worker = loadWorker(response);
    await flush();
    const respondWith = vi.fn();
    worker.listeners.get('fetch')?.forEach(listener =>
      listener({
        request: { method: 'GET', url: 'https://pathomitra.pages.dev/dashboard', mode: 'navigate' },
        respondWith,
      }),
    );
    await respondWith.mock.calls[0][0];
    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it('waits for the update prompt instead of activating during install', async () => {
    const worker = loadWorker();
    await flush();
    let install: Promise<void> | undefined;
    worker.listeners.get('install')?.forEach(listener =>
      listener({
        waitUntil: (promise: Promise<void>) => {
          install = promise;
        },
      }),
    );
    await install;
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    worker.listeners
      .get('message')
      ?.forEach(listener => listener({ data: { type: 'SKIP_WAITING' } }));
    expect(worker.skipWaiting).toHaveBeenCalledOnce();
  });
});
