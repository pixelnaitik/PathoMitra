import { ShieldAlert } from 'lucide-react';
import { UNPROTECTED_STORAGE_WARNING, isUnprotectedProductionStore } from '../lib/storage-mode';

/**
 * A persistent, non-dismissible disclosure shown only when a production build is
 * storing clinical records in unprotected browser storage (P0.1).
 *
 * Renders nothing in an installed shell or in dev/test — the point is not to nag
 * during development, it is to make sure a hosted browser build can never quietly
 * pass its plain localStorage off as the protected on-device store. The operator
 * sees the boundary before they can create or import a record.
 */
export function StorageModeBanner() {
  if (!isUnprotectedProductionStore()) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-error/30 bg-error-container/70 px-4 py-2.5 text-xs font-medium text-on-error-container"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{UNPROTECTED_STORAGE_WARNING}</span>
    </div>
  );
}

/** Production browser builds are a marketing surface, not a clinical store. */
export function WebClinicalGate() {
  if (!isUnprotectedProductionStore()) return null;
  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="max-w-xl rounded-3xl border border-error/30 bg-surface p-8 text-center shadow-float">
        <ShieldAlert className="mx-auto mb-5 h-12 w-12 text-error" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-on-surface">Clinical workspace is disabled on the web</h1>
        <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
          This production browser build does not provide encrypted clinical storage. To protect patient data,
          patient, order, sample, report, billing, and settings workflows are available only in the Android or Windows app.
        </p>
        <a href="/" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-on-primary">
          Return to the PathoMitra website
        </a>
      </section>
    </main>
  );
}

export default StorageModeBanner;
