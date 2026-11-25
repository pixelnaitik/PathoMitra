import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

let openModals = 0;
const inertBackground = new Map<Element, boolean>();

function tabbableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.closest('[inert]');
  });
}

function setBackgroundInert(inert: boolean, panel?: HTMLElement | null): void {
  const root = document.getElementById('root');
  if (!root) return;
  if (!inert) {
    inertBackground.forEach((wasInert, element) => {
      if (wasInert) element.setAttribute('inert', '');
      else element.removeAttribute('inert');
    });
    inertBackground.clear();
    return;
  }
  if (inertBackground.size > 0) return;
  const mark = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (child === panel) continue;
      if (panel && child.contains(panel)) mark(child);
      else {
        inertBackground.set(child, child.hasAttribute('inert'));
        child.setAttribute('inert', '');
      }
    }
  };
  mark(root);
}

/** Shared focus, Escape, scroll-lock, and inert-background behavior for modal UI. */
export function useModalFocus({
  open,
  onClose,
  dismissible = true,
  panelRef,
  initialFocusRef,
  lockScroll = true,
}: {
  open: boolean;
  onClose: () => void;
  dismissible?: boolean;
  panelRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  lockScroll?: boolean;
}) {
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    returnFocusTo.current = (document.activeElement as HTMLElement | null) ?? null;
    openModals += 1;
    setBackgroundInert(true, panelRef.current);
    const previousOverflow = lockScroll ? document.body.style.overflow : '';
    if (lockScroll) document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      (initialFocusRef?.current ?? tabbableWithin(panel)[0] ?? panel).focus({
        preventScroll: true,
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      if (lockScroll) document.body.style.overflow = previousOverflow;
      openModals = Math.max(0, openModals - 1);
      if (openModals === 0) setBackgroundInert(false);
      returnFocusTo.current?.focus?.({ preventScroll: true });
    };
  }, [open, dismissible, panelRef, initialFocusRef, lockScroll]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = tabbableWithin(panel);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [panelRef],
  );

  return { onKeyDown };
}
