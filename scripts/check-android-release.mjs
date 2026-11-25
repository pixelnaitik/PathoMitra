#!/usr/bin/env node
/**
 * Release artifact gate for Android.
 *
 * A successful Gradle build only proves that an APK/AAB exists. This gate reads
 * the bytes that would be uploaded and proves that both artifacts are signed,
 * the APK is 16 KiB zip-aligned, and every packaged native LOAD segment is at
 * least 16 KiB aligned. It writes a machine-readable report for the provenance
 * manifest when PM_ANDROID_SIGNATURE_RESULTS is set.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const apkDir = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release');
const aabDir = path.join(root, 'android', 'app', 'build', 'outputs', 'bundle', 'release');
const reportPath = process.env.PM_ANDROID_SIGNATURE_RESULTS;

function fail(message) {
  console.error(`\n✗ Android release artifact check failed: ${message}\n`);
  process.exit(1);
}

function findArtifact(directory, pattern, label) {
  if (!fs.existsSync(directory)) fail(`${label} output directory is missing: ${directory}`);
  const matches = fs
    .readdirSync(directory)
    .filter(name => pattern.test(name))
    .sort();
  if (matches.length !== 1) {
    fail(
      `expected exactly one ${label} in ${directory}, found ${matches.length}: ${matches.join(', ')}`,
    );
  }
  return path.join(directory, matches[0]);
}

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
      shell: process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(command),
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    fail(`${command} ${args.join(' ')} failed: ${detail}`);
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function signerSha256(output) {
  return /Signer #1 certificate SHA-256 digest:\s*([a-f0-9]+)/i.exec(output)?.[1] ?? null;
}

function findJdkTool(name) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const roots = [
    process.env.JAVA_HOME,
    process.env.ProgramFiles &&
      path.join(process.env.ProgramFiles, 'Android', 'Android Studio', 'jbr'),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Programs', 'Android Studio', 'jbr'),
  ].filter(Boolean);
  for (const root of roots) {
    const candidate = path.join(root, 'bin', executable);
    if (fs.existsSync(candidate)) return candidate;
  }
  return executable;
}

function rejectDebugSigner(output, label) {
  if (/CN\s*=\s*Android Debug/i.test(output)) {
    fail(`${label} is signed with the Android debug certificate, not a release key.`);
  }
}

function newestBuildTools(sdkRoot) {
  const directory = path.join(sdkRoot, 'build-tools');
  if (!fs.existsSync(directory)) fail(`Android build-tools directory is missing: ${directory}`);
  const versions = fs
    .readdirSync(directory)
    .filter(name => /^\d+(?:\.\d+){2}$/.test(name))
    .sort((a, b) => {
      const left = a.split('.').map(Number);
      const right = b.split('.').map(Number);
      return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
    });
  for (let index = versions.length - 1; index >= 0; index -= 1) {
    const candidate = path.join(directory, versions[index]);
    const hasApksigner = ['apksigner', 'apksigner.bat'].some(name =>
      fs.existsSync(path.join(candidate, name)),
    );
    const hasZipalign = ['zipalign', 'zipalign.exe'].some(name =>
      fs.existsSync(path.join(candidate, name)),
    );
    if (hasApksigner && hasZipalign) return candidate;
  }
  fail(`no build-tools version contains both apksigner and zipalign under ${directory}`);
}

const apk = findArtifact(apkDir, /^app-release(?:-[\w.-]+)?\.apk$/i, 'release APK');
const aab = findArtifact(aabDir, /^app-release\.aab$/i, 'release AAB');
const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdkRoot) fail('ANDROID_HOME or ANDROID_SDK_ROOT must point to the Android SDK.');
const buildTools = newestBuildTools(sdkRoot);
const toolPath = names => {
  for (const name of names) {
    const candidate = path.join(buildTools, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  fail(`none of ${names.join(', ')} exists under ${buildTools}`);
};
const apksigner = toolPath(['apksigner', 'apksigner.bat']);
const zipalign = toolPath(['zipalign', 'zipalign.exe']);

const apkSignature = run(apksigner, ['verify', '--verbose', '--print-certs', apk]);
rejectDebugSigner(apkSignature, 'APK');
const apkSigner = signerSha256(apkSignature);
if (!apkSigner) fail('apksigner did not report a signer certificate SHA-256 digest.');
run(zipalign, ['-c', '-P', '16', '-v', '4', apk]);

const aabSignature = run(findJdkTool('jarsigner'), ['-verify', '-verbose', '-certs', aab]);
if (!/jar verified\./i.test(aabSignature) || /jar is unsigned/i.test(aabSignature)) {
  fail('jarsigner did not verify the AAB signature.');
}
const aabCertificate = run(findJdkTool('keytool'), ['-printcert', '-jarfile', aab]);
rejectDebugSigner(aabCertificate, 'AAB');
const aabSigner = /SHA256:\s*([0-9a-f:]+)/i
  .exec(aabCertificate)?.[1]
  ?.replace(/:/g, '')
  .toLowerCase();
if (!aabSigner) fail('keytool did not report an AAB signer certificate SHA-256 digest.');

const archiveTool = process.platform === 'win32' ? 'tar' : 'unzip';
const listArchive = file =>
  process.platform === 'win32' ? ['-tf', file] : ['-Z1', file];
const extractArchive = (file, entry, directory) =>
  process.platform === 'win32'
    ? ['-xf', file, '-C', directory, entry]
    : ['-o', '-q', file, entry, '-d', directory];
const nativeEntries = run(archiveTool, listArchive(aab))
  .split(/\r?\n/)
  .filter(entry => /^base\/lib\/[^/]+\/[^/]+\.so$/.test(entry))
  .sort();
if (nativeEntries.length === 0) fail('the AAB contains no native libraries to verify.');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-android-release-'));
const nativeLibraries = [];
try {
  for (const entry of nativeEntries) {
    const extracted = path.join(temporary, entry);
    run(archiveTool, extractArchive(aab, entry, temporary));
    const programHeaders = run('readelf', ['-lW', extracted]);
    const loadSegments = programHeaders
      .split(/\r?\n/)
      .filter(line => /^\s*LOAD\s/.test(line))
      .map(line => line.trim().split(/\s+/).at(-1));
    if (loadSegments.length === 0) fail(`${entry} has no ELF LOAD segments.`);
    const alignments = loadSegments.map(value => Number.parseInt(value, 16));
    if (alignments.some(alignment => !Number.isFinite(alignment) || alignment < 0x4000)) {
      fail(`${entry} has a LOAD segment below 16 KiB alignment: ${loadSegments.join(', ')}`);
    }
    nativeLibraries.push({ path: entry, loadAlignments: alignments });
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  apk: {
    path: path.relative(root, apk),
    bytes: fs.statSync(apk).size,
    sha256: sha256(apk),
    signatureValid: true,
    signerSha256: apkSigner,
    zipAlignment16KiB: true,
  },
  aab: {
    path: path.relative(root, aab),
    bytes: fs.statSync(aab).size,
    sha256: sha256(aab),
    signatureValid: true,
    signerSha256: aabSigner,
    nativeLibraries,
    allLoadSegments16KiB: true,
  },
};

if (reportPath) {
  fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(
  `✓ Android release artifacts verified: ${path.basename(apk)} and ${path.basename(aab)}; ` +
    `${nativeLibraries.length} native librar${nativeLibraries.length === 1 ? 'y' : 'ies'} 16 KiB aligned.`,
);
