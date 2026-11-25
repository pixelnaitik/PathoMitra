/**
 * The in-app print dialog's backend: enumerate printers, stage raster pages,
 * and spool an already-rendered job through Chromium's print pipeline.
 *
 * Electron ships no PDF viewer, so `webContents.print()` cannot consume the PDF
 * directly. The renderer rasterises selected pages with pdf.js and streams each
 * PNG to this module. Main writes one page at a time under the app profile and
 * releases the renderer's data URL after the acknowledgement; only file names,
 * not every decoded image, remain in memory when the job is committed.
 */
import { BrowserWindow, app, webContents } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readPrintQueue } from './print';

export interface PrinterEntry {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
}

const KNOWN_PAGE_SIZES = new Set(['A4', 'A5', 'Letter', 'Legal']);
type NamedPageSize = 'A4' | 'A5' | 'Letter' | 'Legal';

export interface PrintJobRequest {
  title: string;
  /** Legacy one-shot shape. The dialog uses begin/page/commit instead. */
  pages: string[];
  sheetWidthMm: number;
  sheetHeightMm: number;
  imageWidthMm: number;
  imageHeightMm: number;
  options: {
    deviceName: string;
    copies: number;
    collate: boolean;
    duplex: 'simplex' | 'shortEdge' | 'longEdge';
    landscape: boolean;
    pageSize: string;
    scale: 'fit' | 'actual' | 'shrink';
  };
}

export type PrintJobStartRequest = Omit<PrintJobRequest, 'pages'>;

export interface PrintJobResult {
  ok: boolean;
  error?: string;
}

export interface PrintJobBeginResult extends PrintJobResult {
  jobId?: string;
}

export interface PrintPageResult extends PrintJobResult {
  pageNumber?: number;
}

const MAX_PAGES = 200;
const MAX_TOTAL_BASE64_CHARS = 128 * 1024 * 1024;
const MAX_TOTAL_PIXELS = 120_000_000;
const MAX_PAGE_PIXELS = 20_000_000;
const MAX_PAGE_BASE64_CHARS = 32 * 1024 * 1024;
const MM_TO_PX = 96 / 25.4;
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

interface ActivePrintJob {
  id: string;
  dir: string;
  request: PrintJobStartRequest;
  parent?: BrowserWindow;
  pageFiles: string[];
  totalChars: number;
  totalPixels: number;
}

const activeJobs = new Map<string, ActivePrintJob>();

function printStagingDir(): string {
  return path.join(app.getPath('userData'), 'Print');
}

function cleanupJob(job: ActivePrintJob): void {
  activeJobs.delete(job.id);
  fs.rm(job.dir, { recursive: true, force: true }, () => {});
}

/** Remove only inactive job directories older than 24 hours. */
function sweepStaleStaging(root: string): void {
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || activeJobs.has(entry.name)) continue;
      const full = path.join(root, entry.name);
      if (Date.now() - fs.statSync(full).mtimeMs < 86_400_000) continue;
      fs.rm(full, { recursive: true, force: true }, () => {});
    }
  } catch {
    // Housekeeping must never fail a print job.
  }
}

export async function listPrinters(parent?: BrowserWindow): Promise<PrinterEntry[]> {
  const contents =
    parent?.webContents ??
    webContents.getAllWebContents().find(c => !c.isDestroyed() && c.getType() === 'window');
  if (!contents) return [];

  let entries: PrinterEntry[];
  try {
    entries = (await contents.getPrintersAsync()).map(printer => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      description: printer.description ?? '',
      isDefault: (printer.options as { isDefault?: boolean } | undefined)?.isDefault === true,
    }));
  } catch {
    return [];
  }

  const { defaultPrinter } = await readPrintQueue();
  if (defaultPrinter) {
    for (const entry of entries) {
      if (entry.name === defaultPrinter) entry.isDefault = true;
    }
  }
  return entries;
}

function pageCss(request: PrintJobStartRequest): string {
  const { sheetWidthMm, sheetHeightMm, imageWidthMm, imageHeightMm } = request;
  const imageRule =
    request.options.scale === 'fit'
      ? `width: 100%; height: 100%; object-fit: contain;`
      : request.options.scale === 'shrink'
        ? `max-width: 100%; max-height: 100%; width: ${imageWidthMm}mm; height: ${imageHeightMm}mm; object-fit: contain;`
        : `width: ${imageWidthMm}mm; height: ${imageHeightMm}mm; object-fit: fill;`;
  return `
    @page { size: ${sheetWidthMm}mm ${sheetHeightMm}mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .sheet {
      position: relative;
      width: ${sheetWidthMm}mm; height: ${sheetHeightMm}mm;
      overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      page-break-after: always; break-after: page;
    }
    .sheet:last-child { page-break-after: auto; break-after: auto; }
    .sheet img { display: block; ${imageRule} }
  `;
}

function buildDocument(request: PrintJobStartRequest, pageFiles: readonly string[]): string {
  const title = request.title.replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
  const sheets = pageFiles
    .map(src => `<div class="sheet"><img src="${src}" alt=""></div>`)
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${pageCss(request)}</style></head><body>${sheets}</body></html>`;
}

const isPositiveFinite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

function validateStart(request: PrintJobStartRequest): string | null {
  if (!request || typeof request.title !== 'string' || request.title.length > 300)
    return 'The print job title is invalid.';
  if (
    !request.options ||
    typeof request.options.deviceName !== 'string' ||
    !request.options.deviceName.trim()
  )
    return 'No printer is selected.';
  if (
    !Number.isInteger(request.options.copies) ||
    request.options.copies < 1 ||
    request.options.copies > 20
  )
    return 'Copies must be between 1 and 20.';
  if (!isPositiveFinite(request.sheetWidthMm) || !isPositiveFinite(request.sheetHeightMm))
    return 'The sheet size is invalid.';
  if (!isPositiveFinite(request.imageWidthMm) || !isPositiveFinite(request.imageHeightMm))
    return 'The page image size is invalid.';
  if (
    !['simplex', 'shortEdge', 'longEdge'].includes(request.options.duplex) ||
    !['fit', 'actual', 'shrink'].includes(request.options.scale) ||
    typeof request.options.collate !== 'boolean' ||
    typeof request.options.landscape !== 'boolean'
  )
    return 'Print options are invalid.';
  if (!KNOWN_PAGE_SIZES.has(request.options.pageSize))
    return `Unsupported page size: ${request.options.pageSize}.`;
  return null;
}

function inspectPng(page: unknown): {
  error: string | null;
  chars: number;
  pixels: number;
  binary?: string;
} {
  if (typeof page !== 'string' || !PNG_DATA_URL.test(page) || page.length > MAX_PAGE_BASE64_CHARS) {
    return { error: 'A page of the job was not a valid, bounded PNG image.', chars: 0, pixels: 0 };
  }
  let binary: string;
  try {
    binary = atob(page.slice('data:image/png;base64,'.length));
  } catch {
    return { error: 'A page PNG was not valid base64.', chars: page.length, pixels: 0 };
  }
  if (binary.length < 24)
    return { error: 'A page PNG was truncated.', chars: page.length, pixels: 0 };
  const view = new DataView(Uint8Array.from(binary, char => char.charCodeAt(0)).buffer);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const pixels = width * height;
  if (!width || !height || pixels > MAX_PAGE_PIXELS)
    return { error: 'A print page exceeds the pixel budget.', chars: page.length, pixels };
  return { error: null, chars: page.length, pixels, binary };
}

export function beginPrintJob(
  request: PrintJobStartRequest,
  parent?: BrowserWindow,
): PrintJobBeginResult {
  const invalid = validateStart(request);
  if (invalid) return { ok: false, error: invalid };
  const root = printStagingDir();
  const id = crypto.randomUUID();
  const dir = path.join(root, id);
  const job: ActivePrintJob = {
    id,
    dir,
    request,
    parent,
    pageFiles: [],
    totalChars: 0,
    totalPixels: 0,
  };
  activeJobs.set(id, job);
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    sweepStaleStaging(root);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return { ok: true, jobId: id };
  } catch (err) {
    cleanupJob(job);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function appendPrintPage(jobId: string, page: unknown): PrintPageResult {
  const job = activeJobs.get(jobId);
  if (!job) return { ok: false, error: 'The print job is no longer active.' };
  if (job.pageFiles.length >= MAX_PAGES)
    return { ok: false, error: `A job is limited to ${MAX_PAGES} pages.` };
  const inspected = inspectPng(page);
  if (inspected.error) return { ok: false, error: inspected.error };
  if (
    job.totalChars + inspected.chars > MAX_TOTAL_BASE64_CHARS ||
    job.totalPixels + inspected.pixels > MAX_TOTAL_PIXELS
  ) {
    return { ok: false, error: 'The print job exceeds the total byte or memory budget.' };
  }
  const pageNumber = job.pageFiles.length + 1;
  const name = `page-${String(pageNumber).padStart(4, '0')}.png`;
  try {
    fs.writeFileSync(path.join(job.dir, name), Buffer.from(inspected.binary!, 'binary'), {
      mode: 0o600,
    });
    job.pageFiles.push(name);
    job.totalChars += inspected.chars;
    job.totalPixels += inspected.pixels;
    return { ok: true, pageNumber };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function spool(job: ActivePrintJob): Promise<PrintJobResult> {
  if (job.pageFiles.length === 0)
    return { ok: false, error: 'There are no pages in this print job.' };
  const file = path.join(job.dir, 'index.html');
  let win: BrowserWindow | undefined;
  try {
    fs.writeFileSync(file, buildDocument(job.request, job.pageFiles), {
      encoding: 'utf8',
      mode: 0o600,
    });
    const widthPx = Math.round(job.request.sheetWidthMm * MM_TO_PX);
    const heightPx = Math.round(job.request.sheetHeightMm * MM_TO_PX);
    win = new BrowserWindow({
      show: false,
      width: widthPx,
      height: heightPx,
      skipTaskbar: true,
      resizable: false,
      frame: false,
      parent: job.parent,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    await win.loadFile(file);
    await win.webContents.executeJavaScript(
      'Promise.all([...document.images].map(i => i.decode().catch(() => null)))',
      true,
    );
    const options = job.request.options;
    return await new Promise<PrintJobResult>(resolve => {
      win!.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: options.deviceName,
          copies: Math.max(1, Math.round(options.copies) || 1),
          collate: options.collate,
          duplexMode: options.duplex,
          pageSize: options.pageSize as NamedPageSize,
          margins: { marginType: 'none' },
        },
        (success, failureReason) =>
          resolve({ ok: success, error: success ? undefined : failureReason || 'print failed' }),
      );
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    win?.destroy();
    cleanupJob(job);
  }
}

export async function commitPrintJob(jobId: string): Promise<PrintJobResult> {
  const job = activeJobs.get(jobId);
  if (!job) return { ok: false, error: 'The print job is no longer active.' };
  return spool(job);
}

export function cancelPrintJob(jobId: string): PrintJobResult {
  const job = activeJobs.get(jobId);
  if (!job) return { ok: true };
  cleanupJob(job);
  return { ok: true };
}

/** Compatibility wrapper for callers that still hold a complete page list. */
export async function printJob(
  request: PrintJobRequest,
  parent?: BrowserWindow,
): Promise<PrintJobResult> {
  const { pages, ...start } = request;
  const begun = beginPrintJob(start, parent);
  if (!begun.ok || !begun.jobId)
    return { ok: false, error: begun.error ?? 'The print job could not be started.' };
  for (const page of pages) {
    const appended = appendPrintPage(begun.jobId, page);
    if (!appended.ok) {
      cancelPrintJob(begun.jobId);
      return { ok: false, error: appended.error ?? 'A print page could not be staged.' };
    }
  }
  return commitPrintJob(begun.jobId);
}
