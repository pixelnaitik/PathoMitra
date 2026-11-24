import { motion } from 'motion/react';
import { ArrowDown, WifiOff, Lock, Sparkles } from 'lucide-react';
import { scrollToId } from '../lib/scroll';

/**
 * Hero — deliberately text-only. The product-dashboard mock stays removed (owner
 * direction, 2026-10-16: stores judge imagery against real behaviour). What the
 * band does instead is motion: the aurora glows drift, the headline gradient
 * pans, and the fact chips pop in on a spring — all compositor-only, all
 * collapsed by the reduced-motion layer. The scroll cue drops the visitor
 * straight into the Download band that now sits below.
 */

const FACT_CHIPS = [
  { icon: WifiOff, label: 'Runs offline on Android & Windows' },
  { icon: Lock, label: 'Encrypted on-device records' },
  { icon: Sparkles, label: 'Free & open source' },
];

export default function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pb-24 pt-20 sm:pt-28 lg:pb-28">
      {/* Aurora — soft brand glows, palette + mode aware, slowly drifting */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora-orb absolute -top-44 left-1/2 h-[560px] w-[860px] -translate-x-1/2 rounded-full bg-accent/10 blur-[130px]" />
        <div className="aurora-orb absolute -left-32 top-40 h-[380px] w-[380px] rounded-full bg-secondary/10 blur-[110px]" />
        <div className="aurora-orb absolute -right-24 top-24 h-[380px] w-[380px] rounded-full bg-primary/10 blur-[110px]" />
        {/* faint dot grid for depth, fading out toward the fold */}
        <div
          className="absolute inset-0 opacity-[0.35] [background-image:radial-gradient(circle,var(--outline-variant)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]"
          style={{ contain: 'paint' }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-3xl text-center">
        <motion.span
          initial={{ opacity: 0, y: 12, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          className="inline-flex items-center gap-2 rounded-full bg-accent/12 px-3.5 py-1.5 text-[11px] font-bold tracking-wider uppercase text-accent ring-1 ring-inset ring-accent/20"
        >
          <span
            className="animate-soft-pulse h-1.5 w-1.5 rounded-full bg-accent"
            aria-hidden="true"
          />
          LAB MANAGEMENT SIMPLIFIED
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.05 }}
          className="mt-6 text-5xl font-bold leading-[1.04] tracking-[-0.04em] text-on-surface sm:text-6xl lg:text-7xl"
        >
          Precision pathology,
          <br className="hidden sm:block" />{' '}
          <span className="animate-gradient-pan bg-gradient-to-r from-primary via-accent to-secondary bg-clip-text text-transparent">
            beautifully simple.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-on-surface-variant"
        >
          PathoMitra runs the whole bench-to-report workflow — intake, results, report issuing,
          billing and analytics — in one fast, offline-ready console built for small and mid-size
          labs, on the Android phone in your pocket or the Windows PC on your bench.
        </motion.p>

        {/* Fact chips — one honest strapline per pill, popping in on a spring */}
        <motion.ul
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.28 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-2.5"
        >
          {FACT_CHIPS.map(({ icon: Icon, label }, i) => (
            <motion.li
              key={label}
              initial={{ opacity: 0, y: 10, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.34 + i * 0.09, type: 'spring', stiffness: 300, damping: 22 }}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--elevated-border)] bg-surface-container-lowest/80 px-3 py-1.5 text-[12px] font-semibold text-on-surface-variant shadow-card backdrop-blur-sm"
            >
              <Icon className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              {label}
            </motion.li>
          ))}
        </motion.ul>

        {/* Scroll cue into the Download band */}
        <motion.button
          type="button"
          onClick={() => scrollToId('download')}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          aria-label="Jump to the download section"
          className="group mx-auto mt-12 flex flex-col items-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant transition-colors hover:text-accent"
        >
          Get the app
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-variant/50 bg-surface-container-lowest shadow-card transition-transform group-hover:translate-y-0.5">
            <ArrowDown className="animate-bob h-4 w-4" aria-hidden="true" />
          </span>
        </motion.button>
      </div>
    </section>
  );
}
