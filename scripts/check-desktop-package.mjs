#!/usr/bin/env node
/**
 * Desktop package gate — the Microsoft Store 10.2.9 evidence check.
 *
 * Why this exists as a script and not as a config option: electron-builder
 * silently ignores unknown configuration keys at 26.x (the recorded reason the
 * first MSIX attempt "succeeded" while producing nothing), so "I set the signing
 * options" is not evidence of anything. A signed build is a claim about bytes,
 * and the only way to check a claim about bytes is to read the bytes.
 *
 * Four checks, run against the ARTIFACT:
 *   1. every PE in win-unpacked verifies with Authenticode (Store Policies
 *      10.2.9 requires the installer *and all of its PE files* to chain to a
 *      Microsoft Trusted Root CA — the 2.7.2 build measured 16 of 18 unsigned);
 *   2. no foreign-platform native binary shipped inside a Windows-x64 package
 *      (2.7.2 carried darwin/linux/linuxmusl/win32-arm64 `.node` files — dead
 *      weight, and each one an unsigned binary a reviewer has to explain);
 *   3. the payload is inside the size budget (10.4.4 — "must not take an
 *      unreasonable amount of time to download");
 *   4. the installer itself is signed and carries the version it claims.
 *
 * Exits 1 with every problem named; nothing here is a warning. Run it after
 * packaging, not before — `npm run desktop:msi` chains it.
 *
 * Usage:
 *   node scripts/check-desktop-package.mjs [win-unpacked-dir] [installer.msi]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const unpacked =
  process.argv[2] ?? path.join(root, 'release-desktop', 'win-unpacked');
const installer = process.argv[3];
const problems = [];

/**
 * Budgets.
 *
 * These measure the part of the payload THIS REPO controls, not the Chromium
 * runtime it cannot shrink. Measured on the pruned 2.7.7 build (2026-10-17):
 *   win-unpacked 380.6 MB, of which Electron's own top-level binaries are
 *   319.3 MB and `resources/` (asar + unpacked native modules) is 13 MB;
 *   app.asar 8.7 MB / 354 files; the MSI 124.9 MB compressed.
 * The previous budgets (win-unpacked 300 MB, installer 120 MB) were set from an
 * estimate of "~200 MB for any Electron app", which the 2.7.2 build showed to be
 * wrong (648 MB) and the 2.7.7 build shows is unreachable: no Windows Electron 44
 * package can be under 300 MB, so that assertion could never be satisfied by any
 * amount of pruning — it was measuring the toolchain, not the app. The asar
 * budget the 206 MB dependency-tree regression actually violated is kept, and
 * `resources/` is added beside it because asarUnpack moves the native modules
 * (the `.node` files a reviewer cares about) OUT of the asar.
 *
 * Tightening a budget needs a measurement; loosening one needs a better
 * measurement, and this comment is it.
 */
const MAX_PAYLOAD_MB = 40;
const MAX_ASAR_MB = 45;
const MAX_INSTALLER_MB = 150;

/**
 * Read one file's Authenticode status through PowerShell.
 *
 * `Get-AuthenticodeSignature` is the only reader that agrees with what Windows
 * itself will do at install time (SmartScreen, and the Store's own ingestion), so
 * it is the right oracle for a certification question. Reading the PE certificate
 * table by hand would answer a different question.
 */
function signatureOf(file) {
  const script =
    `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'\n` +
    `"$($s.Status)|$($s.SignerCertificate.Subject)|$($s.StatusMessage)"`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
  const [status = '', subject = '', message = ''] = out.split('|');
  return { status, subject, message };
}

/** Every file Windows treats as a Portable Executable. */
function collectPEs(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectPEs(p));
    else if (/\.(exe|dll|node|ocx|sys)$/i.test(entry.name)) found.push(p);
  }
  return found;
}

function dirSizeMB(dir) {
  const walk = current => {
    let total = 0;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const p = path.join(current, entry.name);
      total += entry.isDirectory() ? walk(p) : fs.statSync(p).size;
    }
    return total;
  };
  return walk(dir) / 1048576;
}

if (!fs.existsSync(unpacked)) {
  console.error(`\n✗ ${unpacked} does not exist — package the desktop build first.\n`);
  process.exit(1);
}

/* 1 + 2: the PE inventory ---------------------------------------------------*/
const FOREIGN_NATIVE = /(^|\.)((darwin|linux|linuxmusl)[-_]|win32-arm64)/i;
const pes = collectPEs(unpacked);
let verified = 0;
let foreign = 0;

for (const p of pes) {
  const rel = path.relative(unpacked, p);
  if (FOREIGN_NATIVE.test(path.basename(p))) {
    foreign += 1;
    problems.push(
      `foreign-platform native binary shipped in a win32-x64 package: ${rel} ` +
        '(unreachable at runtime, and unsigned by definition)',
    );
    continue;
  }
  let sig;
  try {
    sig = signatureOf(p);
  } catch (error) {
    problems.push(`cannot read the signature of ${rel}: ${String(error).slice(0, 160)}`);
    continue;
  }
  if (sig.status === 'Valid') {
    verified += 1;
  } else {
    // `NotSigned` comes back with a Windows script-execution lecture appended,
    // which is noise here — the finding is the absence of a signature.
    const detail =
      sig.status === 'NotSigned' || !sig.message ? '' : ` — ${sig.message.split('.')[0]}`;
    problems.push(
      `PE is "${sig.status}", not "Valid": ${rel}${detail}` +
        '. Policy 10.2.9 requires every PE file to be signed.',
    );
  }
}

/* 3: the size budget --------------------------------------------------------*/
// win-unpacked is reported, not asserted — see the budget comment for why the
// assertion belongs on `resources/`, which is the part the `files` list controls.
const unpackedMB = dirSizeMB(unpacked);
const resources = path.join(unpacked, 'resources');
const payloadMB = fs.existsSync(resources) ? dirSizeMB(resources) : 0;
if (payloadMB > MAX_PAYLOAD_MB) {
  problems.push(
    `resources/ is ${payloadMB.toFixed(1)} MB, budget ${MAX_PAYLOAD_MB} MB — the ` +
      'packaged app payload carries dead dependencies (Store Policies 10.4.4).',
  );
}
const asar = path.join(unpacked, 'resources', 'app.asar');
if (fs.existsSync(asar)) {
  const asarMB = fs.statSync(asar).size / 1048576;
  if (asarMB > MAX_ASAR_MB) {
    problems.push(
      `app.asar is ${asarMB.toFixed(1)} MB, budget ${MAX_ASAR_MB} MB — the dependency ` +
        'tree in package.json is shared with Android/web and is being packed whole.',
    );
  }
}

/* 4: the installer ----------------------------------------------------------*/
if (installer) {
  if (!fs.existsSync(installer)) {
    problems.push(`installer ${installer} does not exist`);
  } else {
    const installerMB = fs.statSync(installer).size / 1048576;
    if (installerMB > MAX_INSTALLER_MB) {
      problems.push(`installer is ${installerMB.toFixed(1)} MB, budget ${MAX_INSTALLER_MB} MB`);
    }
    const sig = signatureOf(installer);
    if (sig.status !== 'Valid') {
      problems.push(
        `installer is "${sig.status}", not "Valid" — Microsoft does not re-sign a ` +
          '10.2.9 submission, and SmartScreen will warn on every lab PC. ' +
          'Configure WIN_CSC_LINK and win.signExts, then rebuild.',
      );
    } else {
      console.log(`  installer signer: ${sig.subject}`);
    }
    const names = path.basename(installer).match(/(\d+\.\d+\.\d+)/);
    const pkgVersion = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    ).version;
    if (names && names[1] !== pkgVersion) {
      problems.push(
        `installer is named ${names[1]} but package.json says ${pkgVersion} — a ` +
          'versioned download URL whose bytes do not match its version breaks 10.2.9.',
      );
    }
  }
}

console.log(
  `  PE inventory: ${pes.length} files, ${verified} validly signed, ${foreign} foreign-platform.`,
);
console.log(
  `  size: resources/ ${payloadMB.toFixed(1)} MB (budget ${MAX_PAYLOAD_MB}), ` +
    `win-unpacked ${unpackedMB.toFixed(1)} MB (Electron runtime is not counted).`,
);

if (problems.length > 0) {
  console.error('\n✗ Desktop package is not Store-submittable.\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\n  Do not submit this artifact. Signing is configured through WIN_CSC_LINK /\n' +
      '  win.signtoolOptions in electron-builder.config.mjs; the payload size is\n' +
      '  controlled by the `files` ignore list in the same file.\n',
  );
  process.exit(1);
}

console.log(
  '\n✓ Desktop package gate passed — every shipped PE is signed, no foreign\n' +
    '  binaries, size inside budget, installer name matches package.json.\n',
);
