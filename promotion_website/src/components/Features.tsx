import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Archive,
  PieChart,
  ShieldCheck,
  Smartphone,
  Stethoscope,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Card, StatusPill } from './ui';
import { Eyebrow, Reveal } from './ui/motion';
import { cn } from '../lib/utils';

function IconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      className={cn(
        'mb-5 flex h-12 w-12 items-center justify-center rounded-2xl transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:-rotate-6 group-hover:scale-110',
        className,
      )}
    >
      <Icon className="h-6 w-6" aria-hidden="true" />
    </span>
  );
}

function BarsMock({ bar, className }: { bar: string; className?: string }) {
  const bars = [42, 66, 38, 80, 55, 92, 70];
  return (
    <div className={cn('flex h-24 items-end gap-1.5', className)} aria-hidden="true">
      {bars.map((h, i) => (
        <motion.span
          key={i}
          className={cn('flex-1 origin-bottom rounded-t-md', bar, i === 5 ? 'opacity-100' : 'opacity-50')}
          style={{ height: `${h}%` }}
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ delay: 0.15 + i * 0.06, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
    </div>
  );
}

export default function Features() {
  return (
    <section className="bg-surface-container-low px-6 py-24 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <div className="mb-14 max-w-2xl">
          <Eyebrow>The platform</Eyebrow>
          <h2 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-on-surface sm:text-4xl">
            Everything the bench needs. Nothing it doesn’t.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-on-surface-variant">
            One console for intake, results, report issuing, billing and analytics — shaped around
            the day-to-day workflow of a pathology bench.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-6">
          {/* Signed reports — wide */}
          <Reveal className="lg:col-span-4" y={20}>
            <Card
              interactive
              pad="lg"
              className="flex h-full flex-col justify-between gap-8 sm:flex-row sm:items-end"
            >
              <div className="max-w-sm">
                <IconTile icon={ShieldCheck} className="bg-chart-1/12 text-chart-1" />
                <h3 className="text-xl font-bold tracking-[-0.02em] text-on-surface sm:text-[22px]">
                  Reports stored on the lab's device
                </h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-on-surface-variant">
                  Each report records the operator who issued it and is written to an encrypted
                  (SQLCipher AES-256) database on the lab's own device. Amending a released report
                  raises its version and stores the reason. Nothing is uploaded anywhere — the
                  Android app does not even hold a network permission.
                </p>
                <Link
                  to="/technology"
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
                >
                  How reports are issued
                  <ArrowRight className="icon-pop h-4 w-4" aria-hidden="true" />
                </Link>
              </div>

              {/* Report mock */}
              <div className="w-full max-w-[240px] shrink-0 self-center rounded-2xl border border-outline-variant/60 bg-surface-container-low p-4 shadow-card sm:self-end">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
                    PL-20417
                  </span>
                  <StatusPill tone="success" dot>
                    Issued
                  </StatusPill>
                </div>
                <div className="mt-3.5 space-y-2" aria-hidden="true">
                  <span className="block h-2 w-full rounded-full bg-surface-container-high" />
                  <span className="block h-2 w-4/5 rounded-full bg-surface-container-high" />
                  <span className="block h-2 w-2/3 rounded-full bg-surface-container-high" />
                </div>
                <div className="mt-4 flex items-end justify-between gap-3 border-t border-outline-variant/50 pt-4">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-chart-1/12 px-2.5 py-1 text-[10px] font-semibold text-chart-1">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Encrypted on-device
                  </span>
                  <p className="text-right font-mono text-[9px] leading-relaxed text-on-surface-variant">
                    10 Oct · 09:41
                    <br />
                    v1 · final
                  </p>
                </div>
              </div>
            </Card>
          </Reveal>

          {/* Analytics */}
          <Reveal className="lg:col-span-2" y={20} delay={0.06}>
            <Card interactive pad="lg" className="flex h-full flex-col">
              <IconTile icon={PieChart} className="bg-chart-2/12 text-chart-2" />
              <h3 className="text-xl font-bold tracking-[-0.02em] text-on-surface">
                Instant analytics
              </h3>
              <p className="mt-2 text-[15px] leading-relaxed text-on-surface-variant">
                Turnaround, revenue and test mix by section and referring doctor — live, no
                spreadsheet exports.
              </p>
              <BarsMock bar="bg-chart-2" className="mt-auto pt-6" />
            </Card>
          </Reveal>

          {/* Patient registry — widened to keep the row full now that the
              scan-to-verify card is gone with the QR feature itself. */}
          <Reveal className="lg:col-span-4" y={20} delay={0.04}>
            <Card interactive pad="lg" className="flex h-full flex-col">
              <IconTile icon={Users} className="bg-chart-3/12 text-chart-3" />
              <h3 className="text-xl font-bold tracking-[-0.02em] text-on-surface">
                Patient registry
              </h3>
              <p className="mt-2 text-[15px] leading-relaxed text-on-surface-variant">
                Searchable history, previous results and visit notes for every case that has passed
                through the lab.
              </p>
              <div className="mt-auto space-y-2.5 pt-6">
                {[
                  {
                    i: 'AK',
                    n: 'Registration · 24 Aug',
                    t: '3 prior reports · Hb 11.4',
                    c: 'bg-chart-3/12 text-chart-3',
                  },
                  {
                    i: 'RS',
                    n: 'Follow-up · today',
                    t: 'TSH 2.1 · repeat in 6 weeks',
                    c: 'bg-chart-1/12 text-chart-1',
                  },
                ].map(row => (
                  <div
                    key={row.i}
                    className="flex items-center gap-3 rounded-2xl bg-surface-container-low p-2.5"
                  >
                    <span
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                        row.c,
                      )}
                    >
                      {row.i}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-on-surface">
                        {row.n}
                      </span>
                      <span className="block truncate text-[11px] text-on-surface-variant">
                        {row.t}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </Reveal>

          {/* Doctor directory — solid brand card for rhythm */}
          <Reveal className="lg:col-span-2" y={20} delay={0.08}>
            <Card
              pad="lg"
              className="group relative h-full overflow-hidden border-transparent bg-primary text-on-primary"
            >
              <IconTile
                icon={Stethoscope}
                className="bg-surface-container-lowest/15 text-on-primary"
              />
              <h3 className="text-xl font-bold tracking-[-0.02em]">Referring doctor directory</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-on-primary/80">
                Clinicians, clinics and report preferences in one curated list — with every case
                credited to the right referrer automatically.
              </p>
              <div
                className="pointer-events-none absolute -bottom-10 -right-8 opacity-15 transition-transform duration-500 group-hover:scale-110"
                aria-hidden="true"
              >
                <Stethoscope className="h-40 w-40" strokeWidth={1} />
              </div>
            </Card>
          </Reveal>

          {/* Billing & invoicing — mirrors the app's Bills page */}
          <Reveal className="lg:col-span-4" y={20} delay={0.04}>
            <Card interactive pad="lg" className="flex h-full flex-col">
              <IconTile icon={Wallet} className="bg-chart-4/12 text-chart-4" />
              <h3 className="text-xl font-bold tracking-[-0.02em] text-on-surface">
                Billing & invoicing
              </h3>
              <p className="mt-2 text-[15px] leading-relaxed text-on-surface-variant">
                From test-wise charges to the final invoice — item bills per patient, package and
                panel pricing, part-payments and dues tracked at the counter, and doctor-wise
                totals for month-end. Lists export to CSV without leaving the device.
              </p>
            </Card>
          </Reveal>

          {/* Sealed backups */}
          <Reveal className="lg:col-span-2" y={20} delay={0.08}>
            <Card interactive pad="lg" className="flex h-full flex-col">
              <IconTile icon={Archive} className="bg-chart-5/12 text-chart-5" />
              <h3 className="text-xl font-bold tracking-[-0.02em] text-on-surface">
                Sealed backups
              </h3>
              <p className="mt-2 text-[15px] leading-relaxed text-on-surface-variant">
                Database snapshots are sealed with a passphrase you choose (AES-256-GCM) before
                they leave the device — and everything is erasable in one action.
              </p>
            </Card>
          </Reveal>

          {/* Offline-ready PWA — full width */}
          <Reveal className="lg:col-span-6" y={20} delay={0.04}>
            <Card interactive pad="lg" className="grid items-center gap-8 lg:grid-cols-2">
              <div className="max-w-md">
                <IconTile icon={Smartphone} className="bg-chart-6/12 text-chart-6" />
                <h3 className="text-xl font-bold tracking-[-0.02em] text-on-surface sm:text-[22px]">
                  Offline-ready, installs like an app
                </h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-on-surface-variant">
                  A service-worker-backed PWA that keeps the app shell cached, so a reload at the
                  bench still works when the network is down. Records are written straight to local
                  storage — there is no queue and no server to replay to. Add it to the home screen
                  of any tablet or workstation.
                </p>
              </div>
              {/* Static facts, not simulated state. The badges here used to be a
                  fabricated live-sync readout and a fabricated queue depth — hardcoded
                  numbers that looked like telemetry for a data path that does not exist.
                  The in-app banner making the same promise (ConnectionBanner) was deleted
                  for being false; this decorative copy has to match that decision, because
                  `sw.js` caches static assets only and `data/index.ts` writes to SQLite or
                  localStorage and stops. */}
              <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
                <StatusPill tone="success" dot>
                  App shell cached
                </StatusPill>
                <StatusPill tone="neutral">No server required</StatusPill>
                <StatusPill tone="neutral">Installable · Android + Windows + browser</StatusPill>
              </div>
            </Card>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
