/**
 * Renderer-side view of the Electron shell.
 *
 * `electron/preload.ts` injects `window.pathomitraDesktop` only in the desktop
 * build; on web and Android it is `undefined`, so every existing code path
 * keeps working untouched and the platform check is one cheap property read —
 * the same role `Capacitor.isNativePlatform()` plays for the APK.
 *
 * The shape here must stay in lockstep with the preload's `api` object; the
 * preload is a sandboxed CJS bundle and cannot import from `src/`, so the
 * pairing is enforced by matching channel names, not by the compiler.
 */

/** Result of a desktop file write — superset of the Android SavedFile shape. */
export interface DesktopSavedResult {
  name: string;
  uri: string;
  /** Absolute Windows path — meaningful to the lab operator, unlike the Android one. */
  path: string;
  /** False when it landed in public Documents (the allowPublicExports opt-in). */
  isPrivate: boolean;
}

export interface DesktopBridge {
  readonly kind: 'desktop';
  readonly version: string;
  db: {
    init(): Promise<void>;
    load(entity: string): Promise<string | null>;
    save(entity: string, json: string): Promise<void>;
    clear(): Promise<void>;
  };
  files: {
    save(args: {
      relPath: string;
      data: string;
      base64: boolean;
      publicFirst: boolean;
    }): Promise<DesktopSavedResult>;
    readText(rel: string): Promise<string>;
    list(relDir: string, extension?: string): Promise<string[]>;
    uri(rel: string): Promise<string>;
  };
  print: {
    pdfBase64(base64: string, nameHint: string): Promise<void>;
  };
  shell: {
    /** Open with the user's default handler — the desktop stand-in for both
     *  the Android share sheet and the PdfViewerPlugin ACTION_VIEW. */
    show(target: string): Promise<void>;
  };
  keyring: {
    set(account: string, secret: string): Promise<void>;
    get(account: string): Promise<string | null>;
    remove(account: string): Promise<boolean>;
  };
}

declare global {
  interface Window {
    pathomitraDesktop?: DesktopBridge;
  }
}

/** True only inside the Electron desktop build. */
export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && window.pathomitraDesktop?.kind === 'desktop';
}

/** The bridge when present — every call site still branches on null first. */
export function desktopBridge(): DesktopBridge | null {
  return isDesktopShell() ? (window.pathomitraDesktop ?? null) : null;
}
