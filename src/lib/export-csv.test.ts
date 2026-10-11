import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadCsv, toCsv, type CsvColumn } from './export-csv';

// The on-device branch is what the anchor-click cannot do: the WebView has no
// download handler, so a CSV export in the APK only works if it reaches the
// Filesystem plugin. Stubbing the seam keeps the test off the native bridge.
const { mockIsNativeShell, mockSaveTextDocument } = vi.hoisted(() => ({
  mockIsNativeShell: vi.fn((): boolean => false),
  mockSaveTextDocument: vi.fn(async (_filename: string, _contents: string): Promise<SavedStub> => ({
    name: 'patients.csv',
    uri: 'file:///sdcard/Documents/PathoMitra/patients.csv',
    path: 'PathoMitra/patients.csv',
  })),
}));
type SavedStub = { name: string; uri: string; path: string };
vi.mock('./native-files', () => ({
  isNativeShell: mockIsNativeShell,
  saveTextDocument: mockSaveTextDocument,
  describeSavedLocation: (file: { name: string }) => `Documents/PathoMitra/${file.name}`,
}));

type Row = { name: string; age: number | string; note?: string };

const COLUMNS: CsvColumn<Row>[] = [
  { label: 'Name', value: row => row.name },
  { label: 'Age', value: row => row.age },
  { label: 'Note', value: row => row.note },
];

afterEach(() => {
  vi.restoreAllMocks();
  mockIsNativeShell.mockReturnValue(false);
  mockSaveTextDocument.mockClear();
});

describe('toCsv', () => {
  it('writes a header row and one line per record', () => {
    const csv = toCsv(COLUMNS, [
      { name: 'Asha', age: 34 },
      { name: 'Vikram', age: '51' },
    ]);
    expect(csv.split('\r\n')).toEqual(['Name,Age,Note', 'Asha,34,', 'Vikram,51,']);
  });

  it('quotes anything that could break the grid and doubles inner quotes', () => {
    const csv = toCsv(COLUMNS, [
      { name: 'Kaur, Simran', age: 20, note: 'said "fasting"' },
      { name: 'Line\nBreak', age: 20 },
    ]);
    const [header, ...rows] = csv.split('\r\n');
    expect(header).toBe('Name,Age,Note');
    expect(rows[0]).toBe('"Kaur, Simran",20,"said ""fasting"""');
    // An embedded newline is escaped inside quotes rather than ending the record.
    expect(rows).toHaveLength(2);
    expect(rows[1]?.startsWith('"Line\nBreak"')).toBe(true);
  });
});

describe('downloadCsv', () => {
  it('sends a BOM-prefaced file to the browser and cleans up after itself', async () => {
    let captured: Blob | undefined;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
      captured = blob as Blob;
      return 'blob:temp';
    });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    await expect(
      downloadCsv('patients.csv', toCsv(COLUMNS, [{ name: 'Asha', age: 34 }])),
    ).resolves.toBeNull();

    expect(click).toHaveBeenCalledTimes(1);
    // The anchor is appended only long enough to fire, then removed.
    expect(document.querySelector('a[download="patients.csv"]')).toBeNull();
    // Asserted on the raw bytes: `text()` decodes UTF-8 and strips the BOM, which
    // is exactly the behaviour Excel needs but would hide from this test.
    const bytes = new Uint8Array(await captured!.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(await captured!.text()).toContain('Name,Age,Note');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:temp');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(mockSaveTextDocument).not.toHaveBeenCalled();
  });

  it('writes through the Filesystem plugin on the device instead of the anchor', async () => {
    mockIsNativeShell.mockReturnValue(true);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const message = await downloadCsv('patients.csv', toCsv(COLUMNS, [{ name: 'Asha', age: 34 }]));

    // A silent no-op is the bug being fixed: on device there must be no anchor
    // click at all, and the caller has to be told where the file went.
    expect(click).not.toHaveBeenCalled();
    expect(mockSaveTextDocument).toHaveBeenCalledWith(
      'patients.csv',
      expect.stringContaining('Name,Age,Note'),
    );
    // The BOM still leads the text so Excel reads UTF-8 names correctly.
    const [, writtenText] = mockSaveTextDocument.mock.calls[0] ?? [];
    expect(writtenText?.startsWith('\uFEFF')).toBe(true);
    expect(message).toContain('patients.csv');
  });
});
