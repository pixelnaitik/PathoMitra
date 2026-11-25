import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function directive(source: string, name: string): string {
  const match = source.match(new RegExp(`(?:^|[;\\s"'])${name}[^;,"\r\n]*`));
  if (!match) throw new Error(`Missing CSP directive: ${name}`);
  return match[0];
}

describe('CSP policy', () => {
  it.each(['public/_headers', 'electron/main.ts'])(
    'keeps script and stylesheet execution strict in %s',
    path => {
      const source = read(path);
      expect(directive(source, 'script-src')).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
      expect(directive(source, 'style-src')).not.toMatch(/'unsafe-inline'/);
      expect(source).toContain('frame-ancestors');
      expect(source).toContain('object-src');
    },
  );

  it('scopes and documents the React/Recharts inline-style exception', () => {
    const web = read('public/_headers');
    const desktop = read('electron/main.ts');
    expect(directive(web, 'style-src-attr')).toContain("'unsafe-inline'");
    expect(directive(desktop, 'style-src-attr')).toContain("'unsafe-inline'");
    expect(web).toMatch(/inline style attributes are scoped separately/i);
    expect(desktop).toMatch(/Inline style attributes\s*\* remain scoped/);
  });
});
