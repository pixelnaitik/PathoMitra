/**
 * Handing a finished report PDF to the printer, the file system, or another app.
 *
 * In the APK a blob URL is a dead end: the Android WebView has no built-in PDF
 * viewer, ignores `window.open`, has no download handler for `doc.save()` and no
 * `navigator.share`. Each of those was a silent no-op on the device — including
 * the "use Download instead" escape hatch the error toasts recommend. So every
 * output path branches here on the platform:
 *
 *   print   → PrintManager via the printer plugin (native) / autoPrint tab (web)
 *   preview → a PDF viewer app via ACTION_VIEW (native) / a blob tab (web)
 *   save    → Filesystem plugin (native) / browser download (web)
 *   share   → Filesystem + the system share sheet (native) / Web Share (web)
 *
 * All plugins are imported lazily and only on native, so the web build never
 * loads any of them and its behaviour is unchanged.
 */
import { Capacitor } from '@capacitor/core';
import type { jsPDF } from 'jspdf';
import {
  describeSavedLocation,
  openSavedFileInViewer,
  saveBinaryDocument,
  shareSavedFile,
} from './native-files';

/**
 * Put a blob URL in front of the user in a browser tab.
 *
 * `noopener` is deliberately *not* in the feature string: per spec the call then
 * returns `null` even when the tab did open, so every successful preview was
 * being reported as a blocked pop-up. The document behind the URL is a blob this
 * page created — same-origin and fully ours — so there is nothing to harden by
 * detaching the opener, and doing it would cost us the only honest signal the
 * return value gives.
 *
 * @returns false only when the browser actually refused the tab.
 */
function openInTab(blobUrl: URL | string, title: string): boolean {
  const tab = window.open(blobUrl, '_blank');
  if (!tab) return false;
  try {
    // Name the tab so the viewer / print dialog offers a sane filename.
    tab.document.title = title;
  } catch {
    /* the PDF viewer replaced the document before we could name it — cosmetic */
  }
  return true;
}

/**
 * Raw base64 of a finished document.
 *
 * jsPDF only hands base64 out inside a data URI, and both the printer plugin and
 * the filesystem plugin want the bare payload, so the prefix is stripped once
 * here instead of at every call site.
 */
function pdfBase64(doc: jsPDF): string {
  return doc.output('datauristring').replace(/^data:[^,]+,/, '');
}

/**
 * @param doc   A fully-rendered jsPDF document (nothing output yet).
 * @param filename Job name shown in the print dialog / used for "Save as PDF".
 */
export async function printPdf(doc: jsPDF, filename: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    doc.autoPrint();
    // A refused tab is not a dead end here: saving the file still lands it in
    // the browser, where its own print sheet is one keystroke away.
    if (!openInTab(doc.output('bloburl'), filename)) doc.save(filename);
    return;
  }

  const { Printer } = await import('@capgo/capacitor-printer');
  await Printer.printBase64({
    data: pdfBase64(doc),
    mimeType: 'application/pdf',
    name: filename,
  });
}

/**
 * Show a finished report PDF to the user without sending it anywhere.
 *
 * In a browser the blob opens in a new tab and the platform's own PDF viewer
 * renders it; when the tab really is refused the file is saved instead, so the
 * tap always produces something. The APK WebView has no inline renderer and
 * ignores `window.open`, so there the file is written into the app's storage
 * and handed to an ACTION_VIEW intent — the device's own PDF viewer (Chrome,
 * Drive, an OEM reader) opens it with paging and zoom. Only a device with no
 * PDF-capable app at all falls back to the system print sheet, which still
 * renders every page.
 *
 * @returns A message when the preview could not open in a tab, else null.
 */
export async function previewPdf(doc: jsPDF, filename: string): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) {
    if (openInTab(doc.output('bloburl'), filename)) return null;
    doc.save(filename);
    return 'Pop-ups are blocked, so the PDF was downloaded instead — open it from your downloads.';
  }

  // Writing the file first is what makes it addressable: the viewer is handed a
  // content:// URI over the saved copy through the manifest's FileProvider.
  const saved = await saveBinaryDocument(filename, pdfBase64(doc));
  try {
    await openSavedFileInViewer(saved, 'application/pdf');
    return null;
  } catch (err) {
    // Rare but real: a device with no PDF-capable app. The print sheet renders
    // every page and offers "Save as PDF", so it stays the last-resort viewer.
    console.warn('PathoMitra: no PDF viewer app on the device, using the print sheet', err);
    await printPdf(doc, filename);
    return 'No PDF viewer app is installed, so the report opened in the print sheet instead.';
  }
}

/**
 * Keep a copy of the report on the machine the user is holding.
 *
 * `doc.save()` is the obvious implementation and it is a no-op in the APK, so on
 * the device the file goes through the Filesystem plugin and the caller reports
 * where it landed. On the web the browser download still applies.
 *
 * @returns A message naming the saved location (native), or null when the
 *   browser handled the download itself.
 */
export async function savePdf(doc: jsPDF, filename: string): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) {
    doc.save(filename);
    return null;
  }
  const saved = await saveBinaryDocument(filename, pdfBase64(doc));
  return `Saved as ${describeSavedLocation(saved)}`;
}

/**
 * Send the report to another app — Drive, WhatsApp, email, a second device.
 *
 * `navigator.share` is not implemented in Android WebView (only in Chrome), so
 * the previous feature check always failed on the APK and fell through to a
 * `wa.me` link plus `doc.save()` — neither of which does anything there. The
 * native path writes the PDF and raises the system share sheet with the real
 * file attached.
 *
 * @returns A message when the outcome needs reporting, else null.
 */
export async function sharePdf(
  doc: jsPDF,
  filename: string,
  subject: string,
  body?: string,
): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) {
    const blob = doc.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: subject, text: body });
      return null;
    }
    // No Web Share on this browser — download it, which the browser can do.
    doc.save(filename);
    return 'This browser cannot share files directly, so the PDF was downloaded instead.';
  }

  const saved = await saveBinaryDocument(filename, pdfBase64(doc));
  try {
    await shareSavedFile(saved, subject, body);
  } catch (err) {
    // Pulling back out of the sheet is a normal outcome, not a failure.
    if (isUserCancellation(err)) return null;
    // The file exists whether or not a share target accepted it, so say where it
    // is rather than reporting a bare error.
    return `Saved as ${describeSavedLocation(saved)}, but it could not be handed to another app.`;
  }
  return null;
}

/**
 * Did the user change their mind?
 *
 * The Share plugin rejects when the sheet is dismissed. That must not raise a
 * red error toast for a tap that simply meant "no". Every *other* rejection — no
 * app on the phone accepts a PDF, the provider refused the grant — is a real
 * failure and keeps its message.
 */
function isUserCancellation(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return message.includes('cancel');
}
