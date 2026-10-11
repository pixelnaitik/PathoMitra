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

const api = {
  kind: 'desktop' as const,
  version: process.versions.electron,

  db: {
    init: (): Promise<void> => ipcRenderer.invoke('pm:db:init'),
    load: (entity: string): Promise<string | null> => ipcRenderer.invoke('pm:db:load', entity),
    save: (entity: string, json: string): Promise<void> =>
      ipcRenderer.invoke('pm:db:save', entity, json),
    clear: (): Promise<void> => ipcRenderer.invoke('pm:db:clear'),
  },

  files: {
    save: (
      args: Readonly<{ relPath: string; data: string; base64: boolean; publicFirst: boolean }>,
    ): Promise<{ name: string; uri: string; path: string; isPrivate: boolean }> =>
      ipcRenderer.invoke('pm:files:save', args),
    readText: (rel: string): Promise<string> => ipcRenderer.invoke('pm:files:readText', rel),
    list: (relDir: string, extension?: string): Promise<string[]> =>
      ipcRenderer.invoke('pm:files:list', relDir, extension),
    uri: (rel: string): Promise<string> => ipcRenderer.invoke('pm:files:uri', rel),
  },

  print: {
    pdfBase64: (base64: string, nameHint: string): Promise<void> =>
      ipcRenderer.invoke('pm:print:pdf', base64, nameHint),
  },

  shell: {
    /** Open a saved file with the user's default handler (the desktop stand-in
     *  for the Android share sheet AND the PdfViewerPlugin). */
    show: (target: string): Promise<void> => ipcRenderer.invoke('pm:shell:show', target),
  },

  keyring: {
    set: (account: string, secret: string): Promise<void> =>
      ipcRenderer.invoke('pm:keyring:set', account, secret),
    get: (account: string): Promise<string | null> => ipcRenderer.invoke('pm:keyring:get', account),
    remove: (account: string): Promise<boolean> => ipcRenderer.invoke('pm:keyring:delete', account),
  },
};

contextBridge.exposeInMainWorld('pathomitraDesktop', api);
