import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Windows keeps the drive-letter case of process.cwd(), while Vite normalizes
 * module IDs. Vitest 4/5 can then load @vitest/runner twice and lose the current
 * suite. Resolve the real project path and normalize the drive before loading
 * the CLI by absolute path; see vitest-dev/vitest#10692.
 */
const root = realpathSync.native(fileURLToPath(new URL('..', import.meta.url)));
const normalizedRoot = root.replace(/^([a-z]):/, (_match, drive) => `${drive.toUpperCase()}:`);
const vitestCli = path.join(normalizedRoot, 'node_modules', 'vitest', 'vitest.mjs');
const child = spawn(process.execPath, [vitestCli, ...process.argv.slice(2)], {
  cwd: normalizedRoot,
  env: process.env,
  stdio: 'inherit',
});

child.on('error', error => {
  console.error('Could not start Vitest:', error);
  process.exit(1);
});

child.on('exit', code => process.exit(code ?? 1));
