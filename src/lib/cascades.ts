/**
 * Cascading deletes for the relational local model.
 *
 * A report owns a staff note; a patient owns reports and invoices. Everything
 * goes through these two functions so the behaviour is defined once, is applied
 * in committed chunks, and never touches a document the user did not ask to
 * remove. Backed by the on-device store via `data/fs` — no Firestore.
 */
import { collection, db, doc, getDoc, getDocs, query, updateDoc, where } from '../data/fs';
import { deleteInChunks } from './firestore-batch';

/**
 * Remove a report, its staff note, its amendment history, and any invoice raised
 * for it. The patient record is deliberately left alone. History is removed with
 * the report so a deleted report leaves no recoverable clinical copy behind.
 */
export async function deleteReportCascade(reportId: string): Promise<void> {
  const report = await getDoc(doc(db, 'reports', reportId));
  if (report.exists() && report.data().status === 'final') {
    throw new Error(
      'Issued reports cannot be deleted. Amend or void the report so its clinical history is retained.',
    );
  }
  const [invoices, versions] = await Promise.all([
    getDocs(query(collection(db, 'invoices'), where('reportId', '==', reportId))),
    getDocs(query(collection(db, 'reportVersions'), where('reportId', '==', reportId))),
  ]);
  if (invoices.size > 0) {
    throw new Error(
      'A report linked to an invoice cannot be deleted. Void the bill and amend the report instead.',
    );
  }

  await deleteInChunks([
    doc(db, 'reports', reportId),
    doc(db, 'reportNotes', reportId),
    ...versions.docs.map(versionDoc => versionDoc.ref),
    ...invoices.docs.map(invoiceDoc => invoiceDoc.ref),
  ]);
}

/** Archive a patient without deleting issued clinical or financial history. */
export async function archivePatient(
  patientId: string,
  actor: string,
  reason: string,
): Promise<void> {
  if (!actor.trim()) throw new Error('Archiving a patient requires an operator identity.');
  if (!reason.trim()) throw new Error('Archiving a patient requires a reason.');
  const patient = await getDoc(doc(db, 'patients', patientId));
  if (!patient.exists()) throw new Error('That patient no longer exists.');
  await updateDoc(doc(db, 'patients', patientId), {
    archivedAt: new Date().toISOString(),
    archivedBy: actor.trim(),
    archivedReason: reason.trim().slice(0, 500),
  });
}

/**
 * Remove a patient and every document that belongs to them: their reports,
 * those reports' staff notes and amendment history, and their invoices.
 */
export async function deletePatientCascade(patientId: string): Promise<void> {
  const [reports, invoices, versions] = await Promise.all([
    getDocs(query(collection(db, 'reports'), where('patientId', '==', patientId))),
    getDocs(query(collection(db, 'invoices'), where('patientId', '==', patientId))),
    getDocs(query(collection(db, 'reportVersions'), where('patientId', '==', patientId))),
  ]);
  if (invoices.size > 0 || reports.docs.some(report => report.data().status === 'final')) {
    throw new Error(
      'This patient has issued reports or invoices and cannot be hard-deleted. Anonymize the patient while retaining clinical and financial history.',
    );
  }

  await deleteInChunks([
    doc(db, 'patients', patientId),
    ...reports.docs.map(reportDoc => reportDoc.ref),
    ...reports.docs.map(reportDoc => doc(db, 'reportNotes', reportDoc.id)),
    ...versions.docs.map(versionDoc => versionDoc.ref),
    ...invoices.docs.map(invoiceDoc => invoiceDoc.ref),
  ]);
}
