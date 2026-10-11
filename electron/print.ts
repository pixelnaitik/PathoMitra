/**
 * Printing a finished report PDF on Windows.
 *
 * Electron deliberately does NOT render a PDF inside a BrowserWindow — Chromium's
 * PDF viewer component is not shipped — so the @capgo printer's Android
 * equivalent cannot be "load the pdf, hit print". Instead we hand the file to
 * the Windows shell verb `Print`, which asks the user's registered PDF handler
 * (Edge/Adobe/Foxit) to spool it to the default printer — the same path a
 * double-click+Ctrl+P would take, minus the dialogs.
 *
 * Known v1 limits, both acceptable for a scaffold and tracked for the Core
 * Functionality phase: no printer picker (default printer only), and the
 * handler may flash a window briefly. `pm:shell:show` remains the manual
 * fallback the renderer can always reach for.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function printVerb(filePath: string, verb: 'Print' | 'PrintTo'): Promise<void> {
  return new Promise((resolve, reject) => {
    // -Verb is a shell operation; Start-Process is how scripts invoke it.
    // The path is embedded as a single-quoted PowerShell literal with quote
    // doubling — execFile argv tokens would re-split on spaces in a patient
    // name, and unescaped quotes would be an injection surface.
    const script = `Start-Process -FilePath '${filePath.replace(/'/g, "''")}' -Verb ${verb} -WindowStyle Hidden`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true },
      err => (err ? reject(err) : resolve()),
    );
  });
}

/**
 * Print base64 PDF bytes without touching the user's document folders: the
 * payload lands in a temp file (unique per call), is handed to the shell
 * print verb, and is removed once spooling has been dispatched.
 */
export async function printPdfBase64(base64: string, nameHint: string): Promise<void> {
  const safe = nameHint.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'report.pdf';
  const tmp = path.join(os.tmpdir(), `pathomitra-print-${Date.now()}-${safe}`);
  fs.writeFileSync(tmp, Buffer.from(base64, 'base64'));
  try {
    await printVerb(tmp, 'Print');
  } finally {
    // The shell verb returns once the print spawn is dispatched; the handler
    // may still be reading the file, so unlink is best-effort, not guaranteed.
    setTimeout(() => fs.rmSync(tmp, { force: true }), 60_000).unref?.();
  }
}
