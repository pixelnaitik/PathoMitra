/**
 * Shared motion primitives for the brochure — one reveal curve, one eyebrow,
 * one page-transition shell, so every section animates with the same timing
 * vocabulary. MotionConfig in App.tsx already sets the shared default easing
 * and honours the OS "reduce motion" preference for all of these.
 */
import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

/** Scroll-triggered rise + fade, fired once, with an optional stagger offset. */
export function Reveal({
  children,
  delay = 0,
  y = 26,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-90px' }}
      transition={{ duration: 0.65, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Section eyebrow: accent hairline that draws in from the left + label. */
export function Eyebrow({
  children,
  className,
  center = false,
}: {
  children: ReactNode;
  className?: string;
  center?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-accent',
        center && 'justify-center',
        className,
      )}
    >
      <motion.span
        aria-hidden="true"
        className="inline-block h-[2px] w-8 origin-left rounded-full bg-accent"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      />
      {children}
    </span>
  );
}

/**
 * Route shell: a short rise-in on enter and fade-out on exit, keyed by the
 * router location in App.tsx inside <AnimatePresence mode="wait">. Keeps the
 * page swap feeling continuous without blocking interaction (transform +
 * opacity only, ~0.3s total).
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
