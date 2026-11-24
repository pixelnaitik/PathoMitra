/**
 * <StoreBadge> — the "Available on Android / Available on Windows" pair from
 * the reference design: a dark plate, the coloured brand mark on the left,
 * small "Available on" over a bold platform name. Micro-interactions live in
 * the `.store-badge` CSS layer (gloss sweep, lift, icon nudge, press scale).
 *
 * The href comes from lib/downloads.ts — a live store/CDN URL opens externally
 * (new tab); until then it resolves to the internal /download status page.
 */
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';
import {
  downloadHref,
  isExternalDownload,
  type DownloadPlatform,
} from '../lib/downloads';
import { AndroidRobotIcon, WindowsPaneIcon } from './BrandIcons';

const PLATFORMS = {
  android: {
    name: 'Android',
    label: 'Download PathoMitra for Android',
    plate:
      ' [--badge-plate:#0b0d10] bg-[#0b0d10] border-white/10 text-white hover:border-[#3ddc84]/50',
    accent: 'text-[#3ddc84]',
    glow: 'group-hover/badge:shadow-[0_14px_40px_-14px_rgba(61,220,132,0.45)]',
    Icon: AndroidRobotIcon,
  },
  windows: {
    name: 'Windows',
    label: 'Download PathoMitra for Windows',
    plate:
      ' [--badge-plate:#08131f] bg-gradient-to-br from-[#0d2438] to-[#08131f] border-[#3ba7ff]/25 text-white hover:border-[#3ba7ff]/60',
    accent: 'text-[#4cc0ff]',
    glow: 'group-hover/badge:shadow-[0_14px_40px_-14px_rgba(76,192,255,0.45)]',
    Icon: WindowsPaneIcon,
  },
} as const satisfies Record<DownloadPlatform, unknown>;

export function StoreBadge({
  platform,
  size = 'md',
  className,
}: {
  platform: DownloadPlatform;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const p = PLATFORMS[platform];
  const href = downloadHref(platform);
  const external = isExternalDownload(platform);

  const inner = (
    <>
      <p
        className={cn(
          'text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-white/70',
          size === 'lg' && 'text-[11px]',
        )}
      >
        Available on
      </p>
      <p
        className={cn(
          'mt-1 text-lg font-bold leading-none tracking-[-0.01em]',
          size === 'lg' && 'text-xl',
        )}
      >
        <span className={p.accent}>{p.name}</span>
      </p>
    </>
  );

  const box = cn(
    'store-badge group/badge flex items-center gap-3.5 rounded-2xl border',
    size === 'lg' ? 'px-6 py-4' : 'px-5 py-3',
    p.plate,
    p.glow,
    className,
  );

  const icon = (
    <span className={cn('shrink-0', p.accent)}>
      <p.Icon className={cn('badge-icon block', size === 'lg' ? 'h-9 w-9' : 'h-8 w-8')} />
    </span>
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={p.label}
        className={box}
      >
        {icon}
        <span className="text-left">{inner}</span>
      </a>
    );
  }

  return (
    <Link to={href} aria-label={p.label} className={box}>
      {icon}
      <span className="text-left">{inner}</span>
    </Link>
  );
}
