/**
 * <ConnectionBanner> — offline and reconnecting states for the dashboard.
 *
 * Firestore's persistent cache makes every write look successful with the cable
 * unplugged, so the only honest signal a lab gets is this strip. It never blocks
 * work: data entry continues, and the queue flushes itself on reconnect.
 */
import { AnimatePresence, motion } from 'motion/react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { cn } from '../lib/utils';

export function ConnectionBanner() {
  const status = useNetworkStatus();
  const offline = status === 'offline';

  return (
    <AnimatePresence>
      {(offline || status === 'syncing') && (
        <motion.div
          key={status}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className={cn(
            'flex items-center gap-2 rounded-2xl px-4 py-2.5 text-[13px] font-semibold',
            offline
              ? 'bg-warning-container text-on-warning-container'
              : 'bg-info-container text-on-info-container',
          )}
        >
          {offline ? (
            <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          )}
          <span>
            {offline
              ? 'You are offline. Changes are saved on this device and will sync automatically when you reconnect.'
              : 'Back online — syncing the changes you saved offline…'}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
