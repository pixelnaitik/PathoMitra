/**
 * CSV export for the list pages.
 *
 * Labs hand spreadsheets to referring doctors far more often than they hand over
 * PDFs, and the only way to get data out of the app today is to read it off the
 * screen. Column values are declared per page so the export always matches the
 * columns on display, never the raw document shape.
 */
import { describeSavedLocation, hasShellOutput, saveTextDocument } from './native-files';

export interface CsvColumn<T> {
  /** Header text. */
  label: string;
  /** Row value; anything non-primitive is stringified by the caller. */
  value: (row: T) => string | number | boolean | null | undefined;
}

/** RFC 4180 quoting: wrap when the value could break the grid, double the quotes. */
function escapeCell(input: string | number | boolean | null | undefined): string {
  const text = input === null || input === undefined ? '' : String(input);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map(column => escapeCell(column.label)).join(',')];
  for (const row of rows)
    lines.push(columns.map(column => escapeCell(column.value(row))).join(','));
  return lines.join('\r\n');
}

/**
 * Trigger a browser download, or a real file on the device.
 *
 * The BOM keeps Excel from reading UTF-8 names as mojibake, which matters for
 * the patient records this app holds. On the APK the anchor-click below is
 * inert — the WebView has no download handler — so the CSV goes through the
 * Filesystem plugin instead and the caller reports where it landed.
 *
 * @returns a message naming the saved file (native), or null when the browser
 *   handled the download itself.
 */
export async function downloadCsv(filename: string, csv: string): Promise<string | null> {
  const text = `\uFEFF${csv}`;
  if (hasShellOutput()) {
    const saved = await saveTextDocument(filename, text);
    return `Saved as ${describeSavedLocation(saved)}`;
  }

  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return null;
}
