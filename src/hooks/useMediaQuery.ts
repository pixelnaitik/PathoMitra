/**
 * The one place this app asks "is this a wide screen?" from JavaScript.
 *
 * Interface structure normally switches in CSS (`fold:` / `lg:` in the class
 * list) and this hook must not become a habit — but a stylesheet cannot express
 * every case. The report composer's desktop results table and its stacked-card
 * fallback are two different DOMs: rendering both and hiding one with
 * `hidden lg:grid` would duplicate every `.test-result-input`, and the
 * Enter / Arrow-down bench navigation in `ReportsPage` walks that selector by
 * index, so it would start jumping to invisible fields. Exactly one branch may
 * exist in the document, which only JS can decide.
 *
 * Callers pass the same edge Tailwind uses (`lg` = 1024px) so the JS branch and
 * the CSS variants around it agree on one number.
 */
import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => readMatches(query));

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * `false` when there is no `matchMedia` — that is the narrow answer, which is
 * the layout the jsdom suite and the phone build already assert, so a missing
 * API degrades to what is already covered rather than to an untested table.
 */
function readMatches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}
