/**
 * Generates the plain-HTML privacy policy for the deployed brochure.
 *
 * Why this exists: `promotion_website` is a React SPA, and Cloudflare Pages
 * answers `/privacy` by serving `index.html` and letting the router paint the
 * page. A browser sees a full policy; anything that does not run JavaScript sees
 * the 3 KB shell and nothing else. That is exactly what Google's Data Safety
 * review sends — a reviewer opening the link, and Google's crawler indexing it —
 * so an SPA route is a fragile thing to stake a Play submission on. This script
 * writes the same text as static HTML at `promotion_website/public/privacy.html`,
 * and `public/_redirects` points `/privacy` at it, so the URL the listing
 * publishes answers with the policy itself, JS or no JS.
 *
 * Why it reads the brochure's own module instead of the app's: the brochure's
 * `/privacy` route renders `promotion_website/src/lib/privacy-policy.ts`. If the
 * static page were generated from a different file, one URL would serve two
 * texts depending on whether you clicked a link or typed the address. One route,
 * one source. That the brochure copy and the in-app copy
 * (`src/lib/privacy-policy.ts`) agree on the load-bearing facts is asserted by
 * `src/lib/privacy-policy.test.ts` instead of by luck.
 *
 * Run:  npm run build:privacy    (then deploy `promotion_website/dist/`)
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_LAST_UPDATED,
  PRIVACY_POLICY_URL,
  PRIVACY_SECTIONS,
} from '../promotion_website/src/lib/privacy-policy.ts';

const OUT_FILE = path.resolve(
  process.cwd(),
  'promotion_website',
  'public',
  // Pages serves a static `foo.html` at the clean URL `/foo` with a direct 200
  // (verified locally with `wrangler pages dev`: `/policy-static` returned 200
  // from `policy-static.html`), and 308-canonicalises `/foo.html` down to `/foo`.
  // That is why there is deliberately NO `/privacy` rule in public/_redirects:
  // rewriting `/privacy` to `/privacy.html` sends it back through the same
  // canonicalisation and the request loops — verified locally, `308 -> /privacy`.
  // The file name therefore has to be the clean route Google will open.
  'privacy.html',
);

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const sections = PRIVACY_SECTIONS.map(section => {
  const body = section.body
    .map(paragraph => `      <p>${escapeHtml(paragraph)}</p>`)
    .join('\n');
  return `    <section>\n      <h2>${escapeHtml(section.heading)}</h2>\n${body}\n    </section>`;
}).join('\n');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Privacy Policy — PathoMitra</title>
    <meta
      name="description"
      content="How PathoMitra, an offline pathology laboratory console, handles patient and health information: what it stores, where it is kept, what it never collects, and how to delete everything."
    />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${escapeHtml(PRIVACY_POLICY_URL)}" />
    <style>
      /* Inlined on purpose: this page has no build step, no CDN and no
         JavaScript, so a reviewer on any network sees the whole document. */
      :root { color-scheme: light dark; --ink: #1d1d1f; --soft: #66666b; --line: #d6d6db; --accent: #0a5ea6; }
      @media (prefers-color-scheme: dark) {
        :root { --ink: #f2f2f5; --soft: #a7a7b0; --line: #3a3a40; --accent: #58a6ff; }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 2.5rem 1.25rem 4rem;
        font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        color: var(--ink); background: #fff;
      }
      @media (prefers-color-scheme: dark) { body { background: #101014; } }
      main { max-width: 46rem; margin: 0 auto; }
      nav { max-width: 46rem; margin: 0 auto 2rem; font-size: .85rem; }
      .eyebrow {
        margin: 0 0 .5rem; font-size: .75rem; font-weight: 700;
        letter-spacing: .12em; text-transform: uppercase; color: var(--accent);
      }
      h1 { margin: 0 0 .5rem; font-size: clamp(1.9rem, 5vw, 2.6rem); letter-spacing: -.02em; }
      h2 { margin: 2.25rem 0 .5rem; font-size: 1.15rem; }
      p { margin: 0 0 .85rem; }
      .updated { margin: 0 0 2rem; font-size: .8rem; color: var(--soft); }
      hr { border: 0; border-top: 1px solid var(--line); margin: 2.5rem 0 1.5rem; }
      a { color: var(--accent); }
      .contact { font-size: .9rem; }
      @media print { body { padding: 0; } a { color: inherit; text-decoration: none; } }
    </style>
  </head>
  <body>
    <nav><a href="/">← PathoMitra home</a></nav>
    <main>
      <p class="eyebrow">Legal</p>
      <h1>Privacy Policy</h1>
      <p class="updated">Last updated ${escapeHtml(PRIVACY_LAST_UPDATED)}</p>

${sections}

      <hr />
      <p class="contact">
        Questions: <a href="mailto:${escapeHtml(PRIVACY_CONTACT_EMAIL)}">${escapeHtml(PRIVACY_CONTACT_EMAIL)}</a>
        &nbsp;·&nbsp; This page is published at
        <a href="${escapeHtml(PRIVACY_POLICY_URL)}">${escapeHtml(PRIVACY_POLICY_URL)}</a>
      </p>
    </main>
  </body>
</html>
`;

/**
 * Self-check before writing. A hosted policy that names nobody is the rejection
 * this project has already paid for once, so the generated artifact is verified
 * here rather than at review time.
 */
function assertReadable(html: string): void {
  const failures: string[] = [];
  if (!/privacy/i.test(html)) failures.push('the generated page does not read as a privacy policy');
  if (!html.includes(PRIVACY_CONTACT_EMAIL))
    failures.push(`the generated page does not contain the contact ${PRIVACY_CONTACT_EMAIL}`);
  if (/\.(?:test|invalid|example|localhost|local)\b/.test(html))
    failures.push('the generated page contains a reserved, never-resolvable domain');
  if (/<script/i.test(html))
    failures.push('the generated page contains JavaScript — a crawler must not need it');
  if (failures.length > 0) {
    console.error('\n✗ Refusing to write promotion_website/public/privacy.html:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
}

assertReadable(html);
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, html, 'utf8');
console.log(
  `✓ wrote ${path.relative(process.cwd(), OUT_FILE)} ` +
    `(${(Buffer.byteLength(html) / 1024).toFixed(1)} KB, no JavaScript, contact ${PRIVACY_CONTACT_EMAIL})`,
);
