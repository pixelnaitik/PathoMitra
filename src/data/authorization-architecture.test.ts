import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('authorization architecture', () => {
  it('restricts the raw system repository to bootstrap and recovery code', () => {
    const offenders = sourceFiles(resolve('src'))
      .map(file => file.replaceAll('\\', '/'))
      .filter(
        file =>
          !file.endsWith('.test.ts') &&
          !file.endsWith('/data/index.ts') &&
          !file.endsWith('/contexts/AuthContext.tsx'),
      )
      .filter(file => readFileSync(file, 'utf8').includes('getSystemRepository'));
    expect(offenders).toEqual([]);
  });

  it('keeps renderer and main permission mapping on one shared function', () => {
    const renderer = readFileSync(resolve('src/data/authorized-repository.ts'), 'utf8');
    const main = readFileSync(resolve('electron/ipc.ts'), 'utf8');
    expect(renderer).toContain('repositoryPermission');
    expect(main).toContain('repositoryPermission');
  });
});
