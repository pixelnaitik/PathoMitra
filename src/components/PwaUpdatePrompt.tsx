import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { isDesktopShell } from '../lib/desktop-bridge';
import { Button } from './ui';

/** Detect a waiting service worker and let the operator choose when to activate it. */
export function PwaUpdatePrompt() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [reloading, setReloading] = useState(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform() || isDesktopShell() || !('serviceWorker' in navigator)) return;
    let active = true;
    let registration: ServiceWorkerRegistration | null = null;
    const track = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (active && worker.state === 'installed' && registration?.waiting)
          setWaiting(registration.waiting);
      });
    };
    const reloadOnce = () => {
      if (reloadingRef.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
    void navigator.serviceWorker
      .register('/sw.js')
      .then(async current => {
        if (!active) return;
        registration = current;
        track(current.installing);
        if (current.waiting) setWaiting(current.waiting);
        await current.update().catch(() => undefined);
      })
      .catch(() => undefined);
    const timer = window.setInterval(
      () => registration?.update().catch(() => undefined),
      6 * 60 * 60 * 1000,
    );
    return () => {
      active = false;
      window.clearInterval(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', reloadOnce);
    };
  }, []);

  if (!waiting) return null;
  const apply = () => {
    reloadingRef.current = true;
    setReloading(true);
    waiting.postMessage({ type: 'SKIP_WAITING' });
  };
  return (
    <aside
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 top-3 z-[95] mx-auto max-w-xl rounded-2xl border border-accent/40 bg-surface p-4 text-on-surface shadow-float"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold">A new PathoMitra web build is ready</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              Save any open work, then reload to use it. The current build keeps working if you
              dismiss this notice.
            </p>
          </div>
        </div>
        <div className="pointer-events-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setWaiting(null)}>
            Later
          </Button>
          <Button size="sm" variant="brand" loading={reloading} onClick={apply}>
            Reload and update
          </Button>
        </div>
      </div>
    </aside>
  );
}
