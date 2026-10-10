/**
 * <SearchField> — the rounded search input used on every list page.
 * <ListRow> — iOS inset-list row for mobile stacks.
 * <EmptyState> / <Skeleton> — the two "nothing here yet" surfaces.
 */
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

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

export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  className,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
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
