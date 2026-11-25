/**
 * Sandboxed preload — the ONLY bridge between the renderer (the shared web
 * bundle) and the main process.
 *
 * Bundled separately to `dist-electron/preload.cjs` (sandboxed preload scripts
 * must be CJS and may only require('electron')). Nothing here imports app
 * code or native modules; the surface is plain `ipcRenderer.invoke` wrappers
 * matching `src/lib/desktop-bridge.ts`, which is the typed consumer on the
 * renderer side.
 */
import { contextBridge, ipcRenderer } from 'electron';

/** Mirror of `PrintChoice` in electron/print.ts (a sandboxed preload imports nothing). */
type PrintChoice = 'printed' | 'opened' | 'cancelled';

/** Mirror of `DesktopPrinter` in src/lib/desktop-bridge.ts. */
type PrinterEntry = {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
};

let sessionToken = '';
const privileged = (channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, sessionToken, ...args);

const api = {
  kind: 'desktop' as const,
  version: process.versions.electron,

  db: {
    init: (): Promise<void> => ipcRenderer.invoke('pm:db:init'),
    load: (entity: string): Promise<string | null> => privileged('pm:db:load', entity),
    get: (entity: string, id: string): Promise<string | null> =>
      privileged('pm:db:get', entity, id),
    query: (entity: string, options: unknown): Promise<string> =>
      privileged('pm:db:query', entity, options),
    count: (entity: string, where: unknown): Promise<number> =>
      privileged('pm:db:count', entity, where),
    set: (entity: string, id: string, json: string): Promise<void> =>
      privileged('pm:db:set', entity, id, json),
    update: (entity: string, id: string, patchJson: string): Promise<void> =>
      privileged('pm:db:update', entity, id, patchJson),
    delete: (entity: string, id: string): Promise<void> => privileged('pm:db:delete', entity, id),
    save: (entity: string, json: string): Promise<void> => privileged('pm:db:save', entity, json),
    clear: (): Promise<void> => privileged('pm:db:clear'),
    /** Write several collections as ONE main-process SQLite transaction. */
    commit: (entries: Array<{ entity: string; json: string }>): Promise<void> =>
      privileged('pm:db:commit', entries),
  },

  files: {
    save: (
      args: Readonly<{ relPath: string; data: string; base64: boolean; publicFirst: boolean }>,
    ): Promise<{ name: string; uri: string; path: string; isPrivate: boolean }> =>
      privileged('pm:files:save', args),
    readText: (rel: string): Promise<string> => privileged('pm:files:readText', rel),
    rename: (from: string, to: string): Promise<void> => privileged('pm:files:rename', from, to),
    list: (relDir: string, extension?: string): Promise<string[]> =>
      privileged('pm:files:list', relDir, extension),
    uri: (rel: string): Promise<string> => privileged('pm:files:uri', rel),
    /** Delete one app-owned file (a stored backup snapshot). Main process
     *  confines it to the private root and refuses the database files. */
    remove: (rel: string): Promise<void> => privileged('pm:files:delete', rel),
    removeTree: (rel: string): Promise<void> => privileged('pm:files:removeTree', rel),
    /**
     * The app's print prompt for a file on disk (see electron/print.ts): the
     * main process asks the operator — print now / choose printer / open in the
     * PDF viewer / cancel — and reports which one was chosen. Opening the viewer
     * is never the default.
     */
    print: (args: Readonly<{ filePath: string }>): Promise<PrintChoice> =>
      privileged('pm:files:print', { filePath: args.filePath }),
  },

  /**
   * The in-app print dialog's backend. The job payload is forwarded untouched —
   * it is validated in the main process, which is the trusted side.
   */
  print: {
    printers: (): Promise<PrinterEntry[]> => privileged('pm:print:printers'),
    job: (request: unknown): Promise<{ ok: boolean; error?: string }> =>
      privileged('pm:print:job', request),
    begin: (request: unknown): Promise<{ ok: boolean; jobId?: string; error?: string }> =>
      privileged('pm:print:begin', request),
    page: (
      jobId: string,
      pngDataUrl: string,
    ): Promise<{ ok: boolean; pageNumber?: number; error?: string }> =>
      privileged('pm:print:page', jobId, pngDataUrl),
    commit: (jobId: string): Promise<{ ok: boolean; error?: string }> =>
      privileged('pm:print:commit', jobId),
    cancel: (jobId: string): Promise<{ ok: boolean; error?: string }> =>
      privileged('pm:print:cancel', jobId),
  },

  backupDestination: {
    choose: () => privileged('pm:backup:choose'),
    status: () => privileged('pm:backup:status'),
    copy: (fileName: string, payload: string) => privileged('pm:backup:copy', fileName, payload),
  },
  reportSigning: {
    publicKey: () => privileged('pm:report:public-key'),
    sign: (manifest: string) => privileged('pm:report:sign', manifest),
    verify: (manifest: string, signature: string, keyId?: string) =>
      privileged('pm:report:verify', manifest, signature, keyId),
  },

  shell: {
    /** Open a saved file with the user's default handler (the desktop stand-in
     *  for the Android share sheet AND the PdfViewerPlugin). */
    show: (target: string): Promise<void> => privileged('pm:shell:show', target),
  },

  session: {
    open: async (identifier: string, password: string) => {
      const result = (await ipcRenderer.invoke('pm:session:open', identifier, password)) as {
        token: string;
      } | null;
      sessionToken = result?.token ?? '';
      return result;
    },
    openBiometric: async (operatorId: string) => {
      const result = (await ipcRenderer.invoke('pm:session:open-biometric', operatorId)) as {
        token: string;
      } | null;
      sessionToken = result?.token ?? '';
      return result;
    },
    close: async (): Promise<void> => {
      const token = sessionToken;
      sessionToken = '';
      if (token) await ipcRenderer.invoke('pm:session:close', token);
    },
    onState: (callback: (state: 'lock') => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: 'lock') => callback(state);
      ipcRenderer.on('pm:session:state', listener);
      return () => ipcRenderer.removeListener('pm:session:state', listener);
    },
  },

  system: {
    storagePressure: (): Promise<{ usage: number; quota: number }> =>
      ipcRenderer.invoke('pm:system:storage'),
  },

  keyring: {
    set: (account: string, secret: string): Promise<void> =>
      ipcRenderer.invoke('pm:keyring:set', account, secret),
    get: (account: string): Promise<string | null> => ipcRenderer.invoke('pm:keyring:get', account),
    remove: (account: string): Promise<boolean> => ipcRenderer.invoke('pm:keyring:delete', account),
  },
};

contextBridge.exposeInMainWorld('pathomitraDesktop', api);
