import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  userData: '',
  documents: '',
  saveEntity: vi.fn(),
  loadEntity: vi.fn(),
  getDocument: vi.fn(async () => null),
  queryDocuments: vi.fn(async () => '[]'),
  countDocuments: vi.fn(() => 0),
  saveDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  openDatabase: vi.fn(),
  eraseDatabase: vi.fn(),
  saveEntitiesBulk: vi.fn(),
  openPath: vi.fn(async () => ''),
  printPdfFile: vi.fn(async () => 'printed'),
  beginPrintJob: vi.fn(() => ({ ok: true, jobId: 'job-1' })),
  appendPrintPage: vi.fn(() => ({ ok: true, pageNumber: 1 })),
  commitPrintJob: vi.fn(async () => ({ ok: true })),
  cancelPrintJob: vi.fn(() => ({ ok: true })),
}));

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  app: { getPath: (name: string) => (name === 'documents' ? h.documents : h.userData) },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => h.handlers.set(channel, handler),
  },
  shell: { openPath: h.openPath },
}));
vi.mock('../../electron/db', () => ({
  saveEntity: h.saveEntity,
  loadEntity: h.loadEntity,
  getDocument: h.getDocument,
  queryDocuments: h.queryDocuments,
  countDocuments: h.countDocuments,
  saveDocument: h.saveDocument,
  updateDocument: h.updateDocument,
  deleteDocument: h.deleteDocument,
  openDatabase: h.openDatabase,
  eraseDatabase: h.eraseDatabase,
  saveEntitiesBulk: h.saveEntitiesBulk,
}));
vi.mock('../../electron/keyring', () => ({
  setSecret: vi.fn(),
  getSecret: vi.fn(async () => null),
  deleteSecret: vi.fn(),
}));
vi.mock('../../electron/print', () => ({ printPdfFile: h.printPdfFile }));
vi.mock('../../electron/print-window', () => ({
  printJob: vi.fn(),
  listPrinters: vi.fn(async () => []),
  beginPrintJob: h.beginPrintJob,
  appendPrintPage: h.appendPrintPage,
  commitPrintJob: h.commitPrintJob,
  cancelPrintJob: h.cancelPrintJob,
}));
vi.mock('../../electron/session', () => ({
  getDesktopPrincipal: vi.fn(() => ({ uid: 'test-admin', role: 'admin', name: 'Test Admin' })),
  closeDesktopSession: vi.fn(),
  openDesktopSession: vi.fn(),
  openBiometricSession: vi.fn(),
}));

import { registerIpc } from '../../electron/ipc';
import { ENTITY_NAMES } from '../data/entities';

const SESSION_TOKEN = 'test-session';
const event = (url = 'pathomitra://app/index.html') => {
  const senderFrame = { url };
  return { senderFrame, sender: { mainFrame: senderFrame } };
};

let temp = '';

beforeEach(() => {
  vi.clearAllMocks();
  h.handlers.clear();
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ipc-'));
  h.userData = path.join(temp, 'userData');
  h.documents = path.join(temp, 'Documents');
  fs.mkdirSync(path.join(h.userData, 'PathoMitra'), { recursive: true });
  fs.mkdirSync(path.join(h.documents, 'PathoMitra'), { recursive: true });
  registerIpc();
});

afterEach(() => {
  fs.rmSync(temp, { recursive: true, force: true });
});

describe('Electron IPC trust boundary', () => {
  it('accepts every shared entity so desktop collections cannot drift from IPC', async () => {
    for (const entity of ENTITY_NAMES) {
      await h.handlers.get('pm:db:save')!(event(), SESSION_TOKEN, entity, '{}');
    }
    expect(h.saveEntity).toHaveBeenCalledTimes(ENTITY_NAMES.length);
    expect(h.saveEntity).toHaveBeenCalledWith('reportVersions', '{}');
    expect(h.saveEntity).toHaveBeenCalledWith('orders', '{}');
    expect(h.saveEntity).toHaveBeenCalledWith('samples', '{}');
  });

  it('validates and forwards indexed query options', async () => {
    const options = {
      where: [{ field: 'status', op: '==', value: 'draft' }],
      orderBy: 'createdAt',
      direction: 'desc',
      limit: 25,
      offset: 0,
    };
    await h.handlers.get('pm:db:query')!(event(), SESSION_TOKEN, 'reports', options);
    expect(h.queryDocuments).toHaveBeenCalledWith('reports', options);
    expect(() =>
      h.handlers.get('pm:db:query')!(event(), SESSION_TOKEN, 'reports', { limit: 10001 }),
    ).toThrow(/invalid list limit/);
  });

  it('uses document-level writes without rendering the collection first', async () => {
    await h.handlers.get('pm:db:set')!(
      event(),
      SESSION_TOKEN,
      'patients',
      'p1',
      JSON.stringify({ name: 'Synthetic Patient' }),
    );
    expect(h.saveDocument).toHaveBeenCalledWith(
      'patients',
      'p1',
      JSON.stringify({ name: 'Synthetic Patient' }),
    );
    expect(h.saveEntity).not.toHaveBeenCalled();
  });

  it('rejects an invalid final report at the trusted main-process boundary', async () => {
    const payload = JSON.stringify({
      r1: { status: 'final', patientId: '', patientName: 'Unknown', testSelection: [] },
    });
    await expect(
      h.handlers.get('pm:db:save')!(event(), SESSION_TOKEN, 'reports', payload),
    ).rejects.toThrow(/invalid final report/);
    expect(h.saveEntity).not.toHaveBeenCalled();
  });

  it('streams print pages through privileged staged-job channels', async () => {
    const request = {
      title: 'Synthetic report',
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      imageWidthMm: 210,
      imageHeightMm: 297,
      options: {
        deviceName: 'HP',
        copies: 20,
        collate: true,
        duplex: 'simplex',
        landscape: false,
        pageSize: 'A4',
        scale: 'fit',
      },
    };
    expect(await h.handlers.get('pm:print:begin')!(event(), SESSION_TOKEN, request)).toEqual({
      ok: true,
      jobId: 'job-1',
    });
    expect(
      await h.handlers.get('pm:print:page')!(
        event(),
        SESSION_TOKEN,
        'job-1',
        'data:image/png;base64,AAAA',
      ),
    ).toEqual({ ok: true, pageNumber: 1 });
    expect(await h.handlers.get('pm:print:commit')!(event(), SESSION_TOKEN, 'job-1')).toEqual({
      ok: true,
    });
    expect(h.beginPrintJob).toHaveBeenCalledWith(request, undefined);
    expect(h.appendPrintPage).toHaveBeenCalledWith('job-1', 'data:image/png;base64,AAAA');
    expect(h.commitPrintJob).toHaveBeenCalledWith('job-1');
    expect(() =>
      h.handlers.get('pm:print:page')!(event('https://example.test'), SESSION_TOKEN, 'job-1', 'x'),
    ).toThrow(/Untrusted IPC sender/);
  });

  it('rejects a lookalike custom-scheme origin', () => {
    expect(() =>
      h.handlers.get('pm:db:load')!(
        event('pathomitra://app.evil/index.html'),
        SESSION_TOKEN,
        'patients',
      ),
    ).toThrow(/Untrusted IPC sender/);
  });

  it('writes only supported files inside app-owned folders and replaces atomically', async () => {
    const handler = h.handlers.get('pm:files:save')!;
    const first = await handler(event(), SESSION_TOKEN, {
      relPath: 'PathoMitra/report.pdf',
      data: Buffer.from('first').toString('base64'),
      base64: true,
      publicFirst: true,
    });
    expect(first.path).toBe(path.join(h.documents, 'PathoMitra', 'report.pdf'));
    expect(fs.readFileSync(first.path, 'utf8')).toBe('first');
    const second = await handler(event(), SESSION_TOKEN, {
      relPath: 'PathoMitra/report.pdf',
      data: 'second',
      base64: false,
      publicFirst: true,
    });
    expect(fs.readFileSync(second.path, 'utf8')).toBe('second');
    expect(fs.readdirSync(path.dirname(second.path)).some(name => name.endsWith('.tmp'))).toBe(
      false,
    );
  });

  it('rejects foreign paths, traversal, invalid payloads, and unsupported file types', async () => {
    const handler = h.handlers.get('pm:files:save')!;
    const valid = {
      relPath: 'PathoMitra/report.pdf',
      data: 'cGRm',
      base64: true,
      publicFirst: true,
    };
    expect(() => handler(event(), SESSION_TOKEN, { ...valid, relPath: 'outside.pdf' })).toThrow(
      /app output folder/,
    );
    expect(() =>
      handler(event(), SESSION_TOKEN, { ...valid, relPath: 'PathoMitra/../outside.pdf' }),
    ).toThrow(/invalid file save/);
    expect(() =>
      handler(event(), SESSION_TOKEN, { ...valid, relPath: 'PathoMitra/run.exe' }),
    ).toThrow(/supported file type/);
    expect(() => handler(event(), SESSION_TOKEN, { ...valid, data: 'not base64!' })).toThrow(
      /valid base64/,
    );
    expect(() => handler(event(), SESSION_TOKEN, null)).toThrow(/invalid file save/);
    expect(() => handler(event(), SESSION_TOKEN, { ...valid, publicFirst: 'yes' })).toThrow(
      /invalid file save/,
    );
  });

  it('rejects oversized save payloads before writing', async () => {
    const handler = h.handlers.get('pm:files:save')!;
    expect(() =>
      handler(event(), SESSION_TOKEN, {
        relPath: 'PathoMitra/huge.txt',
        data: 'x'.repeat(64 * 1024 * 1024 + 1),
        base64: false,
        publicFirst: false,
      }),
    ).toThrow(/64 MB limit/);
    expect(fs.existsSync(path.join(h.userData, 'PathoMitra', 'huge.txt'))).toBe(false);
  });

  it('opens only supported files inside app-owned output folders', async () => {
    const good = path.join(h.documents, 'PathoMitra', 'report.pdf');
    const outside = path.join(h.documents, 'outside.pdf');
    const executable = path.join(h.documents, 'PathoMitra', 'run.exe');
    fs.writeFileSync(good, 'pdf');
    fs.writeFileSync(outside, 'pdf');
    fs.writeFileSync(executable, 'exe');
    await h.handlers.get('pm:shell:show')!(event(), SESSION_TOKEN, good);
    expect(h.openPath).toHaveBeenCalledWith(good);
    await expect(h.handlers.get('pm:shell:show')!(event(), SESSION_TOKEN, outside)).rejects.toThrow(
      /outside/,
    );
    await expect(
      h.handlers.get('pm:shell:show')!(event(), SESSION_TOKEN, executable),
    ).rejects.toThrow(/file type/);
    expect(() => h.handlers.get('pm:files:print')!(event(), SESSION_TOKEN, executable)).toThrow(
      /file type/,
    );
  });
});
