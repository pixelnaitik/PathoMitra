/**
 * Guard: how a screen is allowed to lay itself out and what it counts.
 *
 * Three owner instructions from 2026-10-17, none of which a behaviour test can
 * reach without mounting the whole dashboard (subscriptions, motion, the sheet
 * portal):
 *
 *  1. The bottom tab bar must read Reports before Bills — the lab's work goes
 *     register → report → money, and the desktop rail already listed them that
 *     way. The two surfaces drifting apart is what made the phone bar wrong.
 *  2. A test *package* is one thing. Analytics drew CBC as its 25 member
 *     parameters and the overview printed all 25 names in one cell; the owner
 *     asked for that for every package, not only CBC.
 *  3. The doctor sheet's six-month chart must measure referral *amount*, not
 *     how many patients walked in.
 *
 * Source guards, in the style of registration-copy.test.ts: they cannot prove the
 * pixels, but they make the regression loud the next time someone edits the file.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Block comments are stripped — this repo records *why* something was removed
 *  inside the file that used to carry it, and a guard should not read that
 *  history as live code. */
const read = (relative: string) =>
  readFileSync(resolve(process.cwd(), relative), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const LAYOUT = 'src/pages/dashboard/DashboardLayout.tsx';
const ANALYTICS = 'src/pages/dashboard/AnalyticsPage.tsx';
const OVERVIEW = 'src/pages/dashboard/OverviewPage.tsx';
const DOCTOR_SHEET = 'src/components/DoctorDetailSheet.tsx';

/** The `bottomNavItems` array literal, so a rule cannot be met by the drawer list. */
function bottomNav(): string {
  const source = read(LAYOUT);
  const start = source.indexOf('const bottomNavItems');
  if (start === -1) throw new Error(`${LAYOUT} no longer has a bottom tab bar`);
  return source.slice(start, source.indexOf('];', start));
}

describe('the bottom tab bar', () => {
  const nav = bottomNav();

  it('puts Reports before Bills', () => {
    const reports = nav.indexOf("id: 'reports'");
    const bills = nav.indexOf("id: 'bills'");
    expect(reports).toBeGreaterThan(-1);
    expect(bills).toBeGreaterThan(-1);
    expect(reports).toBeLessThan(bills);
  });

  it('keeps the four destinations the grid was sized for', () => {
    // A fifth entry wrapped onto a second row under the pill and surfaced as a
    // stray half-hidden gear — the reason this list is pinned at four.
    expect(nav.match(/id: '/g)).toHaveLength(4);
  });

  it('matches the desktop rail’s order for the tabs both surfaces show', () => {
    const source = read(LAYOUT);
    const railStart = source.indexOf('const navItems');
    const rail = source.slice(railStart, source.indexOf('];', railStart));
    expect(rail.indexOf("id: 'reports'")).toBeLessThan(rail.indexOf("id: 'bills'"));
  });
});

describe('a package is one test everywhere a test is counted as ordered', () => {
  it('folds the analytics charts through collapseToProfiles', () => {
    const source = read(ANALYTICS);
    expect(source).toMatch(/import \{[^}]*collapseToProfiles[^}]*\} from '\.\.\/\.\.\/lib\/pathology-tests'/);
    // Both the category donut and the volume bars used to walk the raw list.
    const folded = source.match(/collapseToProfiles\(r\.testSelection\)/g) ?? [];
    expect(folded.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toMatch(/\(r\.testSelection \|\| \[\]\)\.forEach/);
  });

  it('still counts reported parameters the other way, on purpose', () => {
    // `expandTestSelection` answers "how many results does this report carry";
    // the volume chart answers "how many things did the lab sell". Both live,
    // and collapsing the first away would put a false number back on screen.
    expect(read(ANALYTICS)).toMatch(/function testCountFor/);
    expect(read(ANALYTICS)).toMatch(/expandTestSelection\(report\.testSelection/);
  });

  it('names the ordered units, not the member list, in the overview', () => {
    const source = read(OVERVIEW);
    expect(source).toMatch(/function orderedSummary/);
    expect(source).toMatch(/collapseToProfiles\(testSelection\)/);
    // Twenty-odd names joined into one table cell is what overflowed the row.
    expect(source).not.toMatch(/testSelection\.join\(', '\)/);
    expect(source.match(/orderedSummary\(item\.testSelection\)/g)).toHaveLength(2);
  });
});

describe('the doctor sheet’s six-month chart measures money', () => {
  const source = read(DOCTOR_SHEET);

  it('buckets bills, not registrations', () => {
    expect(source).toMatch(/Referral amount · last/);
    expect(source).toMatch(/bucket\.amount/);
    expect(source).not.toMatch(/bucket\.count/);
    // The old series counted `referredPatients` by registration month.
    expect(source).not.toMatch(/Patients referred per month/);
  });

  it('reads the amount off the same statement engine the paper does', () => {
    const trend = source.slice(
      source.indexOf('const referralTrend'),
      source.indexOf('const maxTrend'),
    );
    expect(trend).toMatch(/buildDoctorStatements\(invoices, patients, \{ doctors \}\)/);
    expect(trend).toMatch(/statementForDoctor/);
    expect(trend).toMatch(/line\.billAmount/);
  });

  it('reaches back past the picker window when it reads the bills', () => {
    // The chart is deliberately not scoped to the picker, so the subscription
    // has to cover the trend floor or a narrow window zeroes five of six bars.
    expect(source).toMatch(/const trendFloorDay/);
    expect(source).toMatch(/localDayStartIso\(trendFloorDay\)/);
    expect(source).toMatch(/\[doctor, fromDate, toDate, trendFloorDay\]/);
  });
});
