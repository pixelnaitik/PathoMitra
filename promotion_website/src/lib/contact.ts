/**
 * Shared contact seam for the static brochure.
 *
 * This site ships no `/auth` route and no server endpoint, so every call to
 * action that used to open the console resolves to a mailto: instead — a link
 * that works with no backend and stores nothing about the visitor.
 */
export const SUPPORT_EMAIL = 'pathomitra@healthcarediagnosticscenter.in';

/**
 * Public source repository, MIT-licensed (see the repo's LICENSE). Linked from
 * the header, footer and Technology page so the open-source status the stores
 * can verify lives on the marketing surface too.
 */
export const GITHUB_URL = 'https://github.com/pixelnaitik/PathoMitra';

/** Build a mailto: with a prefilled subject (and optional body). */
export function mailto(subject: string, body?: string): string {
  const params = new URLSearchParams({ subject });
  if (body) params.set('body', body);
  return `mailto:${SUPPORT_EMAIL}?${params.toString()}`;
}
