/**
 * Download seam for the brochure — the single place the badge URLs live.
 *
 * Truthfulness rule (store-readiness, 2026-10-16): a badge may only point at a
 * URL that actually serves the build today. Neither channel is public yet —
 * the Play listing is blocked on the real `.env` identity values, and no GitHub
 * Release exists (verified against github.com/pixelnaitik/PathoMitra/releases,
 * 2026-10-16), so the Windows MSI has no published host either. Until a URL is
 * filled in, the badges resolve to the in-app `/download` status page, which
 * states availability honestly instead of 404-ing on a store link.
 *
 * When each channel goes live, paste its public URL here — the landing
 * section, the header, the CTA band and the /download page all follow.
 */
export type DownloadPlatform = 'android' | 'windows';

export const DOWNLOAD_URLS: Record<DownloadPlatform, string | null> = {
  /** Google Play listing (`play.google.com/store/apps/details?id=com.pathomitra.app`) once live. */
  android: null,
  /** Direct MSI host or GitHub Release asset once published. */
  windows: null,
};

/** True when that platform's badge points at a real, published download. */
export function isDownloadLive(platform: DownloadPlatform): boolean {
  return DOWNLOAD_URLS[platform] !== null;
}

/** Badge href: the live URL when published, otherwise the /download status page. */
export function downloadHref(platform: DownloadPlatform): string {
  return DOWNLOAD_URLS[platform] ?? '/download';
}

/** External when it leaves the brochure (store / CDN), internal for /download. */
export function isExternalDownload(platform: DownloadPlatform): boolean {
  return isDownloadLive(platform);
}
