#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [output, ...artifacts] = process.argv.slice(2);
if (!output) {
  console.error('Usage: node scripts/build-source-manifest.mjs <output.json> [artifact ...]');
  process.exit(1);
}

const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = git(['rev-parse', 'HEAD']);
const dirty = git(['status', '--porcelain']);
if (dirty && process.env.PM_REQUIRE_CLEAN_MANIFEST === '1') {
  console.error('Refusing to create a release manifest from a dirty checkout.');
  console.error(dirty);
  process.exit(1);
}

const sourceFiles = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .split('\0')
  .filter(Boolean)
  .filter(file => fs.existsSync(file) && fs.statSync(file).isFile())
  .sort()
  .map(file => ({ path: file, sha256: hash(file) }));
const sourceTreeSha256 = crypto
  .createHash('sha256')
  .update(JSON.stringify(sourceFiles))
  .digest('hex');

function expandArtifact(artifact) {
  if (!fs.existsSync(artifact)) {
    throw new Error(`Requested manifest artifact does not exist: ${artifact}`);
  }
  const stat = fs.statSync(artifact);
  if (stat.isFile()) return [artifact];
  if (!stat.isDirectory()) throw new Error(`Unsupported manifest artifact: ${artifact}`);
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push(file);
    }
  };
  walk(artifact);
  return files.sort();
}

const artifactFiles = [...new Set(artifacts.flatMap(expandArtifact))].sort();
const signaturePath = process.env.PM_SIGNATURE_RESULTS;
let signatureVerification = null;
if (signaturePath) {
  if (!fs.existsSync(signaturePath)) {
    throw new Error(`Signature verification report does not exist: ${signaturePath}`);
  }
  signatureVerification = JSON.parse(fs.readFileSync(signaturePath, 'utf8'));
}

const manifest = {
  schemaVersion: 2,
  product: 'PathoMitra',
  version: JSON.parse(fs.readFileSync('package.json', 'utf8')).version,
  commit,
  generatedAt: new Date().toISOString(),
  workingTreeDirty: dirty.length > 0,
  sourceTreeSha256,
  workflow: process.env.GITHUB_WORKFLOW ?? null,
  runId: process.env.GITHUB_RUN_ID ?? null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  ref: process.env.GITHUB_REF ?? null,
  repository: process.env.GITHUB_REPOSITORY ?? null,
  sourceFiles,
  signatureVerification,
  artifacts: artifactFiles.map(file => ({
    path: file,
    bytes: fs.statSync(file).size,
    sha256: hash(file),
  })),
};

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `Wrote ${output} for commit ${commit} (${sourceFiles.length} source files, ${artifactFiles.length} artifacts).`,
);
