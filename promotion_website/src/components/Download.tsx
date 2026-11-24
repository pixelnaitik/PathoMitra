/**
 * Download section — the reference badge pair ("Available on Android" /
 * "Available on Windows") as a landing band. Badges resolve through
 * lib/downloads.ts: while neither channel is publicly hosted they route to the
 * /download status page, which states availability honestly. The row of chips
 * below repeats the hard facts the stores check (OS floors, price, license).
 */
import { motion } from 'motion/react';
import { MonitorSmartphone, ShieldCheck, BadgeCheck } from 'lucide-react';
import { Eyebrow } from './ui/motion';
import { StoreBadge } from './StoreBadge';

const FACTS = [
  { icon: MonitorSmartphone, label: 'Android 9+ · Windows 10/11 (64-bit)' },
  { icon: ShieldCheck, label: 'Records stay on the device' },
  { icon: BadgeCheck, label: 'Free · Open source (MIT)' },
];

export default function Download() {
  return (
    <section id="download" className="relative overflow-hidden bg-surface-container-low px-6 py-24 sm:py-28">
      {/* soft brand glow behind the badges, drifting with the hero aurora */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="aurora-orb absolute left-1/2 top-1/2 h-[340px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/8 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-3xl text-center">
        <Eyebrow center>Get the app</Eyebrow>
        <motion.h2
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mt-4 text-4xl font-bold tracking-[-0.035em] text-on-surface sm:text-5xl"
        >
          Download
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-on-surface-variant"
        >
          One console, two benches — take PathoMitra to the Android phone in your pocket or the
          Windows PC on your counter.
        </motion.p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4 sm:gap-5">
          {(['android', 'windows'] as const).map((platform, i) => (
            <motion.div
              key={platform}
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: i * 0.12, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            >
              <StoreBadge platform={platform} size="lg" />
            </motion.div>
          ))}
        </div>

        <ul className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5">
          {FACTS.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-on-surface-variant"
            >
              <Icon className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
