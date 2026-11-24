import { initDataStore } from '../data';
import type { EntityName, LocalDoc } from '../data/types';
import { readInvoice } from './models';

export interface IntegrityIssue {
  id: string;
  severity: 'P0' | 'P1';
  entity: EntityName;
  entityId: string;
  message: string;
}

export interface IntegrityReport {
  issues: IntegrityIssue[];
  scanned: Record<string, number>;
}

function values(docs: LocalDoc[]): Array<{ id: string; data: Record<string, unknown> }> {
  return docs.map(doc => ({ id: doc.id, data: doc.data() }));
}

function duplicates(items: Array<{ id: string; key: string }>, entity: EntityName, label: string): IntegrityIssue[] {
  const seen = new Map<string, string>();
  const issues: IntegrityIssue[] = [];
  for (const item of items) {
    if (!item.key) continue;
    const previous = seen.get(item.key);
    if (previous && previous !== item.id) {
      issues.push({ id: `${entity}:duplicate:${item.key}`, severity: 'P0', entity, entityId: item.id, message: `${label} "${item.key}" is also used by ${previous}.` });
    } else {
      seen.set(item.key, item.id);
    }
  }
  return issues;
}

/** Read-only integrity and orphan audit used by Settings → Data & Diagnostics. */
export async function auditDataIntegrity(): Promise<IntegrityReport> {
  const repo = await initDataStore();
  const [patientDocs, orderDocs, sampleDocs, reportDocs, invoiceDocs, versionDocs] = await Promise.all([
    repo.list('patients'), repo.list('orders'), repo.list('samples'), repo.list('reports'), repo.list('invoices'), repo.list('reportVersions'),
  ]);
  const patients = values(patientDocs);
  const orders = values(orderDocs);
  const samples = values(sampleDocs);
  const reports = values(reportDocs);
  const invoices = values(invoiceDocs);
  const versions = values(versionDocs);
  const patientIds = new Set(patients.map(item => item.id));
  const orderIds = new Set(orders.map(item => item.id));
  const reportIds = new Set(reports.map(item => item.id));
  const issues: IntegrityIssue[] = [];

  for (const order of orders) {
    if (!patientIds.has(String(order.data.patientId))) {
      issues.push({ id: `orders:orphan:${order.id}`, severity: 'P0', entity: 'orders', entityId: order.id, message: 'Order references a patient that no longer exists.' });
    }
  }
  for (const sample of samples) {
    if (!patientIds.has(String(sample.data.patientId))) {
      issues.push({ id: `samples:patient:${sample.id}`, severity: 'P0', entity: 'samples', entityId: sample.id, message: 'Sample references a patient that no longer exists.' });
    }
    if (!orderIds.has(String(sample.data.orderId))) {
      issues.push({ id: `samples:order:${sample.id}`, severity: 'P0', entity: 'samples', entityId: sample.id, message: 'Sample references an order that no longer exists.' });
    }
  }
  for (const report of reports) {
    if (!patientIds.has(String(report.data.patientId))) {
      issues.push({ id: `reports:patient:${report.id}`, severity: 'P0', entity: 'reports', entityId: report.id, message: 'Report references a patient that no longer exists.' });
    }
    if (report.data.status === 'final' && !report.data.issuanceSnapshot) {
      issues.push({ id: `reports:snapshot:${report.id}`, severity: 'P1', entity: 'reports', entityId: report.id, message: 'Legacy final report has no issuance snapshot and is explicitly non-reproducible.' });
    }
  }
  for (const invoice of invoices) {
    if (!patientIds.has(String(invoice.data.patientId))) {
      issues.push({ id: `invoices:patient:${invoice.id}`, severity: 'P0', entity: 'invoices', entityId: invoice.id, message: 'Invoice references a patient that no longer exists.' });
    }
    const parsed = readInvoice(invoice.id, invoice.data);
    if (parsed.paidAmount > parsed.amount) {
      issues.push({ id: `invoices:overpaid:${invoice.id}`, severity: 'P0', entity: 'invoices', entityId: invoice.id, message: 'Paid amount exceeds invoice total.' });
    }
    for (const item of parsed.items) {
      if (item.kind !== 'adjustment' && Math.abs(item.lineTotal - item.qty * item.unitPrice) > 0.01) {
        issues.push({ id: `invoices:arithmetic:${invoice.id}:${item.name}`, severity: 'P0', entity: 'invoices', entityId: invoice.id, message: `Line "${item.name}" does not equal quantity × unit price.` });
      }
    }
  }
  for (const version of versions) {
    if (!reportIds.has(String(version.data.reportId))) {
      issues.push({ id: `reportVersions:orphan:${version.id}`, severity: 'P1', entity: 'reportVersions', entityId: version.id, message: 'Report version references a report that no longer exists.' });
    }
  }

  issues.push(...duplicates(orders.map(item => ({ id: item.id, key: String(item.data.orderNo ?? '') })), 'orders', 'Order number'));
  issues.push(...duplicates(samples.map(item => ({ id: item.id, key: String(item.data.accessionNo ?? '') })), 'samples', 'Accession number'));
  issues.push(...duplicates(invoices.map(item => ({ id: item.id, key: String(item.data.invoiceNo ?? '') })), 'invoices', 'Invoice number'));

  return {
    issues,
    scanned: { patients: patients.length, orders: orders.length, samples: samples.length, reports: reports.length, invoices: invoices.length, reportVersions: versions.length },
  };
}
