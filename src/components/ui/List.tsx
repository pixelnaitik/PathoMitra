/**
 * <SearchField> — the rounded search input used on every list page.
 * <ListRow> — iOS inset-list row for mobile stacks.
 * <EmptyState> / <Skeleton> — the two "nothing here yet" surfaces.
 */
import {
  forwardRef,
  useRef,
  type InputHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { hapticMedium, hapticTap } from '../../lib/haptics';

/* ---------------------------------- Search ---------------------------------- */

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  value: string;
  onClear?: () => void;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onClear, className, placeholder = 'Search…', ...rest },
  ref,
) {
  return (
    <div className={cn('group relative', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant transition-colors duration-200 group-focus-within:text-accent"
      />
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={placeholder}
        className={cn(
          'h-11 w-full rounded-full border border-transparent bg-surface-container pl-11 pr-10 text-sm text-on-surface',
          'placeholder:text-on-surface-variant transition-[border-color,background-color,color,box-shadow]',
          'focus:border-accent focus:bg-surface focus:outline-none',
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
        {...rest}
      />
      {value.length > 0 && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => (onClear ? onClear() : undefined)}
          className="animate-pop-in absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full bg-outline-variant/40 p-1 text-on-surface-variant transition hover:bg-outline-variant/70 hover:text-on-surface"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});

/* --------------------------------- ListRow --------------------------------- */

/** Hold time before a press counts as a long-press, and the drag that cancels it. */
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 12;

/**
 * Long-press detection for a touch target, built on pointer events so it behaves
 * the same on the APK (touch) and the desktop / web build (mouse). Fires once
 * after the pointer holds still for {@link LONG_PRESS_MS}; a drag past the
 * tolerance or a lift before the timer cancels it. `fired` lets the caller drop
 * the click that follows the pointer-up, so a long-press never also runs the
 * row's normal action.
 */
function useLongPress(onLongPress?: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const cancel = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  };

  const handlers = {
    onPointerDown: (event: ReactPointerEvent) => {
      if (!onLongPress || event.button !== 0) return;
      firedRef.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        origin.current = null;
        firedRef.current = true;
        hapticMedium();
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (!onLongPress || !origin.current) return;
      const dx = event.clientX - origin.current.x;
      const dy = event.clientY - origin.current.y;
      if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) cancel();
    },
    onPointerUp: () => {
      if (onLongPress) cancel();
    },
    onPointerLeave: () => {
      if (onLongPress) cancel();
    },
    onPointerCancel: () => {
      if (onLongPress) cancel();
    },
    onContextMenu: (event: ReactMouseEvent) => {
      // Android emits contextmenu on a long-press; swallow it so the native
      // callout / selection menu doesn't stack on top of our own action.
      if (onLongPress) event.preventDefault();
    },
  };

  return { firedRef, handlers };
}

export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  onLongPress,
  primaryLabel,
  className,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  /**
   * Fires when the row is pressed and held. Used to surface a secondary action
   * (e.g. editing a doctor's commission rate) without crowding the row with a
   * third visible button. The row's normal `onClick` is suppressed on the
   * pointer-up that follows a long-press.
   */
  onLongPress?: () => void;
  /**
   * Accessible name for the primary action. When the title is composed of
   * rich content (a name + inline badges), `aria-label` on the button is the
   * only reliable announcement TalkBack / VoiceOver gets. Falls back to the
   * text content of `title` when not given.
   */
  primaryLabel?: string;
  className?: string;
}) {
  const { firedRef, handlers } = useLongPress(onLongPress);
  // When `onClick` is set AND `trailing` contains further interactive controls
  // (the pattern every mobile list row in this app is), the whole row cannot
  // be a single <button> — nesting a button inside a button is invalid HTML
  // and TalkBack announces the wrapper first, so the trailing Edit / Delete
  // never receive their own focus stop (UI-P0-04). The row then splits into
  // a primary button (leading + title + subtitle) and a sibling action strip
  // for the trailing controls. Without trailing there is no conflict and the
  // row stays a single full-width button.
  if (onClick && trailing) {
    return (
      <div
        className={cn(
          'cv-row group flex min-h-[60px] w-full items-center gap-3.5 px-4 py-3 text-left transition-colors',
          className,
        )}
      >
        <button
          type="button"
          onClick={() => {
            // A long-press already opened its own sheet — don't also open the row.
            if (firedRef.current) {
              firedRef.current = false;
              return;
            }
            hapticTap();
            onClick();
          }}
          {...handlers}
          aria-label={primaryLabel}
          className="-mx-2 flex min-w-0 flex-1 items-center gap-3.5 rounded-2xl px-2 py-1 text-left transition-colors hover:bg-surface-container-low active:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {leading && (
            <div className="icon-pop flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden">
              {leading}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-on-surface">{title}</p>
            {subtitle && (
              <p className="mt-0.5 truncate text-[13px] text-on-surface-variant">{subtitle}</p>
            )}
          </div>
        </button>
        {/* Each trailing control is a sibling of the primary button, so
            Tab reaches it directly and TalkBack announces it separately. */}
        <div className="icon-slide flex shrink-0 items-center gap-1.5">{trailing}</div>
      </div>
    );
  }

  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={
        onClick
          ? () => {
              // Rows are the most-tapped thing in the app and every other
              // pressable surface already ticks — a row that opens a sheet or a
              // record felt dead next to a button.
              if (firedRef.current) {
                firedRef.current = false;
                return;
              }
              hapticTap();
              onClick();
            }
          : undefined
      }
      {...handlers}
      aria-label={onClick ? primaryLabel : undefined}
      className={cn(
        'cv-row group flex min-h-[60px] w-full items-center gap-3.5 px-4 py-3 text-left transition-colors',
        onClick && 'hover:bg-surface-container-low active:bg-surface-container-high',
        className,
      )}
    >
      {leading && (
        <div className="icon-pop flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden">
          {leading}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-on-surface">{title}</p>
        {subtitle && (
          <p className="mt-0.5 truncate text-[13px] text-on-surface-variant">{subtitle}</p>
        )}
      </div>
      {trailing && <div className="icon-slide flex shrink-0 items-center gap-2">{trailing}</div>}
    </Tag>
  );
}

/** Groups ListRows into a rounded inset card with hairline dividers. */
export function ListGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'divide-y divide-[var(--outline-variant)]/60 overflow-hidden rounded-2xl border border-[var(--elevated-border)] bg-surface-container-lowest',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------- EmptyState -------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'animate-rise-in flex flex-col items-center justify-center px-6 py-14 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-surface-container-high text-on-surface-variant">
        {icon}
      </div>
      <h3 className="text-base font-bold tracking-[-0.01em] text-on-surface">{title}</h3>
      {description && (
        <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-on-surface-variant">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* --------------------------------- Skeleton --------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('skeleton-shimmer animate-fade-in rounded-2xl', className)}
    />
  );
}
