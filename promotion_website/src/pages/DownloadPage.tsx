/**
 * /download — the honest landing spot for the store badges while neither
 * channel is publicly hosted (Play listing blocked on the real identity .env
 * values; no GitHub Release for the MSI yet — both verified 2026-10-16).
 *
 * Each platform card states what exists today and how to actually get it
 * (email / GitHub), and carries the system requirements the store listings
 * will mirror. When a URL goes live in lib/downloads.ts, its badge starts
 * opening the real store/CDN link and the card status flips automatically.
 */
import { motion } from 'motion/react';
import { Github, Mail, Smartphone, Monitor, CircleDashed, CircleCheck } from 'lucide-react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { StoreBadge } from '../components/StoreBadge';
import { Eyebrow, PageTransition, Reveal } from '../components/ui/motion';
import { isDownloadLive } from '../lib/downloads';
import { mailto, GITHUB_URL, SUPPORT_EMAIL } from '../lib/contact';

const PLATFORMS = [
  {
    key: 'android' as const,
    icon: Smartphone,
    title: 'Android app',
    requirements: ['Android 9 and up (API 28+)', 'Phone, tablet or bench workstation', 'No INTERNET permission — the app cannot send data out'],
    blurb:
      'The full console in your pocket: registration, results, report issuing, billing and analytics on an encrypted on-device database.',
  },
  {
    key: 'windows' as const,
    icon: Monitor,
    title: 'Windows desktop',
    requirements: ['Windows 10 or 11, 64-bit', 'Installs per machine — no server, no admin domain setup', 'Records live in an AES-256 encrypted local database'],
    blurb:
      'The same console as a native desktop app for the counter PC — print, export and back up without a browser tab.',
  },
];

export default function DownloadPage() {
  return (
    <div className="min-h-dvh bg-background font-sans text-on-surface selection:bg-accent/20">
      <PageTransition>
        <Header />
        <main id="main-content" className="pb-24 pt-20 sm:pt-24">
          <div className="mx-auto max-w-5xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <Eyebrow center>Get PathoMitra</Eyebrow>
              <h1 className="mt-4 text-4xl font-bold tracking-[-0.035em] text-on-surface sm:text-5xl">
                Download PathoMitra
              </h1>
              <p className="mt-5 text-lg leading-relaxed text-on-surface-variant">
                Built for the Android phone in your pocket and the Windows PC on your bench — free,
                open source (MIT), and running entirely on the machine you work at.
              </p>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
                {(['android', 'windows'] as const).map((platform, i) => (
                  <motion.div
                    key={platform}
                    initial={{ opacity: 0, y: 18, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 0.1 + i * 0.12, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
                  >
                    <StoreBadge platform={platform} size="lg" />
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="mt-16 grid gap-5 md:grid-cols-2">
              {PLATFORMS.map((p, i) => {
                const live = isDownloadLive(p.key);
                return (
                  <Reveal key={p.key} delay={i * 0.08}>
                    <div className="card-hover spotlight h-full rounded-3xl border border-[var(--elevated-border)] bg-surface-container-lowest p-7 shadow-card">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/12 text-accent">
                          <p.icon className="h-5.5 w-5.5" aria-hidden="true" />
                        </span>
                        <span
                          className={
                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ' +
                            (live
                              ? 'bg-success-container text-on-success-container'
                              : 'bg-info-container text-on-info-container')
                          }
                        >
                          {live ? (
                            <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <CircleDashed className="h-3.5 w-3.5 animate-spin [animation-duration:4s]" aria-hidden="true" />
                          )}
                          {live ? 'Available now' : 'Publication in progress'}
                        </span>
                      </div>
                      <h2 className="mt-5 text-xl font-bold tracking-[-0.02em] text-on-surface">
                        {p.title}
                      </h2>
                      <p className="mt-2 text-[15px] leading-relaxed text-on-surface-variant">
                        {p.blurb}
                      </p>
                      <ul className="mt-5 space-y-2.5">
                        {p.requirements.map(req => (
                          <li key={req} className="flex items-start gap-2.5 text-sm text-on-surface-variant">
                            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-secondary" aria-hidden="true" />
                            {req}
                          </li>
                        ))}
                      </ul>
                      {!live && (
                        <p className="mt-5 rounded-2xl bg-surface-container-low px-4 py-3 text-[13px] leading-relaxed text-on-surface-variant">
                          The {p.key === 'android' ? 'Google Play' : 'direct-download installer'}{' '}
                          channel is being finalised. Need it today?{' '}
                          <a
                            className="font-semibold text-accent underline-offset-2 hover:underline"
                            href={mailto('Request the current PathoMitra build')}
                          >
                            Email us
                          </a>{' '}
                          or follow the{' '}
                          <a
                            className="font-semibold text-accent underline-offset-2 hover:underline"
                            href={GITHUB_URL}
                            target="_blank"
                            rel="noreferrer"
                          >
                            repository
                          </a>
                          .
                        </p>
                      )}
                    </div>
                  </Reveal>
                );
              })}
            </div>

            <Reveal delay={0.05}>
              <div className="mt-10 flex flex-col items-center justify-between gap-4 rounded-3xl border border-[var(--elevated-border)] bg-surface-container-low px-7 py-6 text-center sm:flex-row sm:text-left">
                <p className="text-sm leading-relaxed text-on-surface-variant">
                  Every build is the same open-source code you can read on GitHub — no telemetry, no
                  accounts, nothing uploaded. Published installers ship with a version and SHA-256
                  checksum listed here.
                </p>
                <div className="flex shrink-0 items-center gap-3">
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="card-hover inline-flex items-center gap-2 rounded-full border border-outline-variant/40 bg-surface-container-lowest px-4 py-2 text-[13px] font-semibold text-on-surface shadow-card hover:text-accent"
                  >
                    <Mail className="h-4 w-4" aria-hidden="true" />
                    Contact
                  </a>
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="card-hover inline-flex items-center gap-2 rounded-full border border-outline-variant/40 bg-surface-container-lowest px-4 py-2 text-[13px] font-semibold text-on-surface shadow-card hover:text-accent"
                  >
                    <Github className="h-4 w-4" aria-hidden="true" />
                    GitHub
                  </a>
                </div>
              </div>
            </Reveal>
          </div>
        </main>
      </PageTransition>
      <Footer />
    </div>
  );
}
