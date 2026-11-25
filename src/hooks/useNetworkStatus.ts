/**
 * Device network availability for dashboard chrome.
 *
 * PathoMitra clinical data is local-only. This hook never reports cloud sync,
 * pending writes, or server health: `navigator.onLine` says only whether the
 * device has a network connection, not whether any clinical operation is queued.
 */
import { useEffect, useState } from 'react';

export type NetworkStatus = 'online' | 'offline';

function readOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function useNetworkStatus(): NetworkStatus {
  const [online, setOnline] = useState(readOnline);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online ? 'online' : 'offline';
}
