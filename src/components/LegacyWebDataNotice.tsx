import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { isUnprotectedProductionStore } from '../lib/storage-mode';
import { legacyClinicalKeys, purgeLegacyClinicalData } from '../lib/legacy-web-data';
import { Button } from './ui';

/** Production-web-only upgrade notice for plaintext clinical data left by older builds. */
export function LegacyWebDataNotice() {
  const [count, setCount] = useState(0);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isUnprotectedProductionStore()) setCount(legacyClinicalKeys().length);
  }, []);

  if (!isUnprotectedProductionStore() || (count === 0 && !error)) return null;

  return (
    <aside
      role="alert"
      className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-2xl rounded-2xl border border-warning/50 bg-warning-container p-4 text-on-surface shadow-float"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Legacy browser data found</p>
          <p className="mt-1 text-xs leading-relaxed">
            {removed
              ? 'Legacy browser records were removed and their absence was verified. Browser storage is not an approved clinical store.'
              : `This browser still contains ${count} legacy clinical storage ${count === 1 ? 'entry' : 'entries'}. Their contents are not displayed. Remove them before using the marketing-only web build.`}
          </p>
          {error && <p className="mt-2 text-xs font-semibold text-error">{error}</p>}
          {!removed && (
            <Button
              size="sm"
              variant="brand"
              className="mt-3"
              onClick={() => {
                try {
                  const result = purgeLegacyClinicalData();
                  setCount(result.remaining);
                  setRemoved(true);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : 'Legacy browser data could not be removed.',
                  );
                }
              }}
            >
              Remove legacy browser data
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
