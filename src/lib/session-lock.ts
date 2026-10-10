/**
 * Automatic session locking.
 *
 * The lab console holds other people's medical records, and before this existed
 * the only way to lock it was the manual Log out button. Real use looks like:
 * unlock the app, look something up, hand the phone to a colleague or put it
 * down on the bench — and the patient list stays open indefinitely, with the
 * device's own screen lock doing nothing because the app was already unlocked.
 *
 * Two independent triggers:
 *   - backgrounding: Android sends `appStateChange`, the browser gives
 *     `visibilitychange`. Either way the session locks as soon as the app stops
 *     being the foreground thing on the screen.
 *   - idle timeout: no pointer, keyboard or scroll activity for `idleMs`.
 *
 * `idleMs = 0` disables the idle timer (the "Never" option in Settings), while
 * background-locking always stays on — that one is not a convenience setting, it
 * is the behaviour that stops an abandoned desk from becoming an open record.
 */
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export interface SessionLockOptions {
  onLock: () => void;
  /** Milliseconds of inactivity before locking; 0 disables the idle timer. */
  idleMs: number;
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export function installSessionLock({ onLock, idleMs }: SessionLockOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const teardowns: Array<() => void> = [];

  const fire = () => {
    if (!disposed) onLock();
  };

  const resetIdle = () => {
    if (idleMs <= 0) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, idleMs);
  };

  // Background / foreground transition.
  if (Capacitor.isNativePlatform()) {
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        fire();
        return;
      }
      // Coming back to the foreground restarts the idle clock rather than
      // leaving a timer that counted down while the app was away.
      resetIdle();
    })
      .then(handle => {
        if (disposed) void handle.remove();
        else teardowns.push(() => void handle.remove());
      })
      .catch(error => console.error('SessionLock: appStateChange unavailable', error));
  } else {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') fire();
      else resetIdle();
    };
    document.addEventListener('visibilitychange', onVisibility);
    teardowns.push(() => document.removeEventListener('visibilitychange', onVisibility));
  }

  // Inactivity.
  if (idleMs > 0) {
    for (const type of ACTIVITY_EVENTS) {
      document.addEventListener(type, resetIdle, { passive: true });
      teardowns.push(() => document.removeEventListener(type, resetIdle));
    }
    resetIdle();
  }

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    teardowns.forEach(off => off());
  };
}
