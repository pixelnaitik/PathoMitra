import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { disableSafeMode, isSafeMode, safeModeReason, SAFE_MODE_EVENT } from '../lib/safe-mode';
import { Button } from './ui';

export default function SafeModeBanner({ onReview }: { onReview: () => void }) {
  const { isAdmin } = useAuth();
  const [active, setActive] = useState(isSafeMode);
  const [reason, setReason] = useState(safeModeReason);
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ active: boolean; reason: string }>).detail;
      setActive(detail.active);
      setReason(detail.reason);
    };
    window.addEventListener(SAFE_MODE_EVENT, update);
    return () => window.removeEventListener(SAFE_MODE_EVENT, update);
  }, []);
  const resume = useCallback(() => {
    if (isAdmin) disableSafeMode();
  }, [isAdmin]);
  if (!active) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-error/40 bg-error-container p-4"
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-error" aria-hidden="true" />
        <div>
          <p className="text-sm font-bold text-error">Safe mode: clinical writes are paused</p>
          <p className="mt-0.5 text-xs text-on-error-container">
            {reason} Review integrity and a verified backup before resuming.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onReview}>
          Review data
        </Button>
        {isAdmin && (
          <Button size="sm" onClick={resume}>
            Resume writes
          </Button>
        )}
      </div>
    </div>
  );
}
