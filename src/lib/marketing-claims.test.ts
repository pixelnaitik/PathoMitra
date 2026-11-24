/**
 * Guard: the public marketing layer may not claim capabilities the reference
 * implementation does not have.
 *
 * The Android app is the reference implementation, and it is built from this
 * same `src/` tree (`capacitor.config.ts` → `webDir: 'dist'`), so the console
 * pages can never drift from it structurally. The marketing pages can: they
 * exist only in the web build (`App.tsx` collapses every public route onto
 * `/auth` when `isNative`), which means nothing in the APK verifies what they
 * assert. This file is that missing check.
 *
 * Each rule below cites the code fact that makes the phrase false, in the order
 * it was confirmed. Adding a rule means adding that citation.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Surfaces a visitor or a store reviewer reads as promotion: the landing pages,
 * the installable bundle's own metadata, the brochure fork, and the auth console.
 * AuthPage belongs here even though it is inside the app — it is the first screen
 * of the packaged desktop build (verified from a screenshot of the shipped
 * `win-unpacked\PathoMitra.exe` on 2026-10-17), so its copy is judged as
 * representation under Store Policies 10.1.1 exactly like the landing page is.
 * Three review rounds missed it precisely because the list below stopped at the
 * landing-page boundary.
 */
const MARKETING_SOURCES = [
  'src/LandingPage.tsx',
  'src/components/Header.tsx',
  'src/components/Hero.tsx',
  'src/components/Features.tsx',
  'src/components/HowItWorks.tsx',
  'src/components/Trust.tsx',
  'src/components/CTA.tsx',
  'src/components/Footer.tsx',
  'src/pages/TechnologyPage.tsx',
  'src/pages/SolutionsPage.tsx',
  // The installable bundle's own metadata. `manifest.json` is what a PWA install
  // reads as the product description, and `index.html` carries the `<title>`, the
  // `<meta name="description">` and the og: tags a reviewer sees before the app.
  'index.html',
  'public/manifest.json',
  // The unlock / create-account console. Reassurance rows and the h1 headline are
  // claims about what the product does with a patient's data, and until 2026-10-17
  // nothing policed them.
  'src/pages/auth/AuthPage.tsx',
  /*
   * The brochure at pathomitra.pages.dev is a hand-maintained fork of the ten
   * files above, deployed separately — so it was previously outside every rule in
   * this file and free to say things the app cannot. It is the *public* face a
   * Play reviewer reaches from the listing, which makes it the more important of
   * the two to police. Reading a sibling directory from here is deliberate: the
   * alternative is a second copy of these rules in a project that runs its own
   * build, and two guard files drift exactly the way the components they police
   * already do.
   */
  'promotion_website/index.html',
  'promotion_website/src/components/Header.tsx',
  'promotion_website/src/components/Hero.tsx',
  'promotion_website/src/components/Features.tsx',
  'promotion_website/src/components/HowItWorks.tsx',
  'promotion_website/src/components/Trust.tsx',
  'promotion_website/src/components/CTA.tsx',
  'promotion_website/src/components/Footer.tsx',
  'promotion_website/src/components/Download.tsx',
  'promotion_website/src/pages/TechnologyPage.tsx',
  'promotion_website/src/pages/SolutionsPage.tsx',
];

interface ClaimRule {
  pattern: RegExp;
  /** Why the phrase is false, with the file that proves it. */
  evidence: string;
}

const BANNED_CLAIMS: ClaimRule[] = [
  {
    pattern:
      /\bAI[\s-]?(native|assisted|powered|enabled|driven|intelligent)\b|artificial intelligence/i,
    evidence:
      'no AI/ML dependency in package.json and no inference code in src/lib or src/data — the only "inference" is reference-range kind selection in pathology-tests.ts',
  },
  {
    pattern:
      /(?<!\b(?:no|not|without)\s)\b(?:sync(?:ed|s|ing)?|queued writes?)\b|will sync|auto-?sync|replay (?:queued|pending)/i,
    evidence:
      'no fetch / XMLHttpRequest / sendBeacon / axios anywhere in src outside tests, and public/sw.js precaches static assets only — there is no queue and no ingest endpoint (telemetry.ts: "Offline build: there is no ingest endpoint"). The word itself is banned in visible copy because it implies a server; honest disclaimers say what happens instead ("uploaded", "written to local storage"). The lookbehind keeps a *denial* legal — "no server, no sync" is the truthful sentence and must not be failed by this rule',
  },
  {
    pattern: /live demo|demo portal|report portal|data portal|patient portal|lab(?:oratory)? portal/i,
    evidence:
      'no seeded demo account exists — AuthPage onboarding makes the visitor create the local account — and index.html already replaced this word with "Console" because it implies a server to reach. public/manifest.json carried "Clinical Digital Pathology Laboratory Portal" as the product description while the splash and the policy both said "Console"; a portal is a thing you log into remotely, which this build has no permission to do',
  },
  {
    /*
     * Quality and identity claims the project cannot substantiate. "Clinical
     * Grade Precision" reads as a clinical-quality assurance; the app performs no
     * verification, holds no accreditation and disclaims being a diagnostic
     * device (lib/terms.ts §4, lib/report-compliance.ts). "PathoMitra Diagnostic
     * Systems" is a trading name that does not exist — package.json names one
     * author, and a company that is not registered is an impersonation problem as
     * well as a false claim. Both were removed from the brochure on 2026-10-14 and
     * were still shipping in the parent app's footer; this rule is what stops a
     * fork restoring either one.
     */
    pattern: /Clinical Grade Precision|Diagnostic Systems/i,
    evidence:
      'the app asserts no clinical quality grade (report-compliance.ts returns an empty disclaimer and an empty signer line) and no such company exists — package.json author is one person, LICENSE is MIT, and there is no entity behind the product',
  },
  {
    /*
     * A mailto: label implies somebody reads that mailbox. The project has one
     * monitored support address; "Clinical Advisory" and "Press Inquiries" were
     * extra labels for functions with no staff, and both footers now publish a
     * single Contact Support route. A reviewer or journalist who emailed either
     * and got silence would have evidence of a false contact claim.
     */
    pattern: /Clinical Advisory|Press Inquir/i,
    evidence:
      'src/components/Footer.tsx and promotion_website/src/components/Footer.tsx each publish one SUPPORT_LINKS/CONTACT_LINKS entry now; there is no clinical advisory desk and no press office behind a solo open-source project',
  },
  {
    /*
     * A product URL drawn inside a mock browser address bar is a claim about
     * infrastructure. `pathomitra.app` does not resolve (store audit §2.1), and the
     * two real origins are the `pathomitra://` custom scheme in the desktop shell
     * and pathomitra.pages.dev on Cloudflare Pages. This also bans the shape, not
     * just the one string, so a future hero cannot invent a second host.
     */
    pattern: /\bapp\.[a-z-]+\.(?:app|dev|ai|cloud|io)\b/i,
    evidence:
      'no hosted app origin exists — pathomitra.app does not resolve in DNS, the desktop bundle is served over the pathomitra:// custom scheme (electron/main.ts) and the web build from pathomitra.pages.dev',
  },
  {
    pattern: /\biOS\b/,
    evidence:
      'the repo contains only an `android/` native project; @capacitor/ios is not a dependency',
  },
  {
    pattern: /cursor[- ]paginated/i,
    evidence:
      'useCollectionList.ts pages by widening a rendered window over an in-memory array (slice(0, visible)) — it is not cursor paging',
  },
  {
    pattern: /\bfrom anywhere\b|access(?:ing)? .{0,20}from any device/i,
    evidence:
      'records live in one device-local store (SQLite via SQLCipher, or localStorage) with no export-to-server path, so a second machine cannot read them',
  },
  {
    pattern:
      /share\s+(?:by|via)\s+[^.\n]{0,40}\b(?:sms|whatsapp|email)\b|\b(?:sms|whatsapp)\b[^.\n]{0,30}\b(?:alert|notif|remind)/i,
    evidence:
      'email / SMS / WhatsApp delivery was removed on 2026-10-11 at the lab\u2019s request (a mailto:/sms:/wa.me hand-off puts patient-naming text into a third-party app): notification-engine.ts NotificationPrefs.channels has only `desktop`, and the one share path is the Android share sheet in native-print.ts',
  },
  {
    pattern: /\bno setup\b/i,
    evidence:
      'the lab does set up: it creates the local account and passcode (AuthPage), fills lab settings, and prices its tests. What is absent is a server, so the honest claim is "no server to set up"',
  },
  {
    // Case-sensitive on purpose: prose that says a claim was `verified` by a
    // person is fine; a capitalised status chip is a workflow state, and the
    // console has exactly three of them (Draft / Issued / Amended).
    //
    // The negative lookahead on "Signed" is not a loophole: it separates the two
    // senses of the word. "Signed" as a label on a report claims a document
    // attestation the build cannot produce (report-compliance.ts returns an empty
    // signer line), while "Signed in as <operator>" on the unlock screen is a
    // plain fact about authentication — AuthContext holds a local account and the
    // console unlocks with its passcode. Banning the second sense would mean
    // re-wording true copy to satisfy an over-broad regex, which is the guard
    // degrading the product rather than policing it.
    pattern: /\bVerified\b|\bSigned\b(?! in\b)/,
    evidence:
      'report-status.ts is the single source for the visible states and its own test bans the word "signed" from any visible string; there is no external verification or signature service in this build (report-compliance.ts returns an empty signer line)',
  },
  {
    /*
     * The auth console headline said "Your lab. Securely connected." while
     * privacy-policy.ts §4 states there is no pathway for data to leave the
     * device, the Android manifest ships without INTERNET, and electron/main.ts
     * cancels every remote-scheme request at runtime. "Connected" is the word a
     * reviewer of an offline app must not be handed.
     */
    pattern: /securely connected|stays connected|always connected/i,
    evidence:
      'the product is offline by construction — no INTERNET permission in AndroidManifest.xml, session.webRequest.onBeforeRequest cancels every remote scheme in a packaged build (electron/main.ts), and privacy-policy.ts §4 says no data leaves the device',
  },
  {
    /*
     * "Keep sensitive information safe and compliant" put a certification claim
     * on the front door of a product whose own policy §5 says it is not certified
     * as HIPAA-compliant, NABL-accredited, ISO-certified, CE-marked or SOC 2
     * audited. A bare "compliant" with no scheme named is the shape being banned.
     */
    pattern: /\bsafe and compliant\b|\bfully compliant\b|\bregulatory[- ]compliant\b/i,
    evidence:
      'privacy-policy.ts §5 disclaims every certification, and no accreditation belongs to the software — it belongs to the laboratory and is only printed when the lab enters it in Settings',
  },
];

/**
 * Drop `/* … *\/` blocks. JSX comments are how this codebase records *why* a
 * piece of copy was changed, and those explanations quote the removed phrase —
 * the guard is about what a visitor reads, not about what a maintainer is told.
 * Line comments are deliberately left in place: `//` is rarer in copy lines and
 * silently skipping them would weaken every other rule here.
 */
function visibleSource(source: string): string {
  // Block comments in JS/TSX *and* HTML comments: `index.html` records why the
  // Firebase preconnects and the remote-font import were removed by quoting
  // what used to be there, and a rule that fires on an explanation of a fix
  // teaches nobody anything.
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
}

// vitest sets the process working directory to the project root, and under the
// jsdom environment `import.meta.url` is not a `file:` URL — so cwd is the only
// reliable way to reach the sources this guard reads.
const read = (relative: string) =>
  visibleSource(readFileSync(resolve(process.cwd(), relative), 'utf8'));

describe('marketing copy matches the reference implementation', () => {
  it.each(MARKETING_SOURCES)('%s is read', file => {
    expect(() => read(file)).not.toThrow();
  });

  it.each(BANNED_CLAIMS.map(rule => [rule.evidence, rule] as const))(
    'is absent from every marketing surface: %s',
    (_evidence, rule) => {
      const offenders = MARKETING_SOURCES.filter(file => rule.pattern.test(read(file)));
      expect(offenders).toEqual([]);
    },
  );

  it('states which build each security guarantee belongs to', () => {
    // Trust.tsx renders four chips under "Security model". Three describe the
    // Android build; a browser visitor reading them unqualified would conclude
    // their session is encrypted and offline-cached when WebRepository gives
    // them plain localStorage. Either the labels carry the scope, or the
    // section says the same thing in prose — so both are asserted here.
    const trust = read('src/components/Trust.tsx');
    expect(trust).toContain('(Android)');
    expect(trust).toMatch(/unencrypted local storage|browser build/i);
  });

  it('never renders a number that looks like live system state', () => {
    // The decorative badges in Features.tsx used to print a relative timestamp
    // and a queue depth. Those read as telemetry, so ban the shape: a digit
    // immediately followed by a sync/queue word in user-visible copy.
    expect(read('src/components/Features.tsx')).not.toMatch(
      /\d+\s?(s|seconds|minutes|writes|items)\b.{0,40}(sync|queue)/i,
    );
  });

  it('labels the hero product mock as an illustration, not a screenshot', () => {
    // Store Policies 10.1.1: "your product must not in any way attempt to mislead
    // customers as to its actual features, functionality". The hero mock renders
    // invented KPIs and a fabricated case queue; that is acceptable as an
    // illustration and not acceptable as an implied capture of a real install.
    // The label is the whole difference, so it is asserted rather than trusted.
    const hero = read('src/components/Hero.tsx');
    expect(hero).toMatch(/Illustration/i);
    // …and the two props that made it read as a live hosted app are gone.
    expect(hero).not.toMatch(/>\s*Live\s*</);
  });

  it('keeps the auth console copy inside what the build actually does', () => {
    /*
     * The two banned phrases above arrived on the auth screen and survived three
     * review rounds because nothing scanned this file. Asserting only their
     * absence would let the next rewrite swap in a different over-claim, so the
     * positive shape is pinned too: the headline states the offline + encrypted
     * guarantee, and the reassurance rows name a control that exists in code
     * (SQLCipher at rest, passcode + auto-lock) rather than an accreditation.
     */
    const auth = read('src/pages/auth/AuthPage.tsx');
    expect(auth).toMatch(/Offline and encrypted\./);
    expect(auth).toMatch(/Encrypted at rest/);
    expect(auth).not.toMatch(/connected/i);
  });
});
