import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  collection,
  query,
  onSnapshot,
  getDocs,
  limit,
  orderBy,
  where,
  db,
} from '../../data/fs';
import { getRepository } from '../../data';
import { archivePatient, deleteReportCascade } from '../../lib/cascades';
import { operatorStamp, readReports, readPatients, readOrders, readSamples, readInvoices } from '../../lib/models';
import { handleFirestoreError, OperationType } from '../../lib/firestore-errors';
import { Users, FileText, Plus, Trash2, UserPlus, IndianRupee, ChevronRight, ClipboardList, FlaskConical } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getBillingPrefs } from '../../lib/price-list';
import { readSettings } from '../../lib/settings';
import { cn } from '../../lib/utils';
import { listStaggerProps } from '../../lib/motion';
import { reportStatusView } from '../../lib/report-status';
import { collapseToProfiles } from '../../lib/pathology-tests';
import { useAuth } from '../../contexts/AuthContext';
import CountUp from '../../components/CountUp';
import {
  Button,
  Card,
  SectionTitle,
  StatusPill,
  ConfirmSheet,
  EmptyState,
  useToast,
} from '../../components/ui';

/**
 * A patient's pending order, phrased the way the lab phrases it: one entry per
 * thing that was added.
 *
 * `testSelection` stores a package *and* every parameter inside it (the clinical
 * report needs the members), so joining the raw list put "CBC (COMPLETE BLOOD
 * COUNT), WHITE CELL COUNT(TC), NEUTROPHIL, LYMPHOCYTE …" — twenty-odd names —
 * into one table cell. That wrapped over its own row on a phone and made the
 * recent-activity table read as a wall of text. `collapseToProfiles` folds each
 * package back to its single entry, for every package, not just CBC.
 */
function orderedSummary(testSelection: string[] | undefined): string {
  const units = collapseToProfiles(testSelection);
  return units.length > 0 ? units.join(', ') : 'No test selected';
}

/**
 * One dashboard KPI tile.
 *
 * `to` turns the whole tile into a control that jumps to that tab — the money
 * figure is only useful if the operator can get to the register it came from in
 * one tap.
 */
interface StatCard {
  label: string;
  value: number;
  icon: LucideIcon;
  tint: string;
  meta: string;
  /** Currency symbol in front of the figure, when the number is money. */
  prefix?: string;
  /** Tab to open when the tile is activated. */
  to?: string;
}

export default function OverviewPage({
  setActiveTab,
  onAddPatient,
  onManageReport,
  onCreateReportForPatient,
}: {
  setActiveTab?: (tab: string) => void;
  onAddPatient?: () => void;
  onManageReport?: (reportId: string) => void;
  onCreateReportForPatient?: (patientId: string) => void;
}) {
  const { role, user } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState({
    patients: 0,
    reports: 0,
    revenue: 0,
    pendingOrders: 0,
    pendingSamples: 0,
    rejectedSamples: 0,
    overdueDrafts: 0,
    unbilledReports: 0,
    outstanding: 0,
  });
  const [recentReports, setRecentReports] = useState<any[]>([]);
  const [recentPatients, setRecentPatients] = useState<any[]>([]);
  const [latestPatientReports, setLatestPatientReports] = useState<Map<string, any>>(new Map());
  const [statsError, setStatsError] = useState('');
  const [statsReload, setStatsReload] = useState(0);

  const [patientToDelete, setPatientToDelete] = useState<any | null>(null);
  const [reportToDelete, setReportToDelete] = useState<any | null>(null);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer = 0;

    // Local aggregates are cheap for this single-device store and, unlike the
    // old count/sum shims, let the overview reconcile joins such as unbilled
    // reports and actual collected cash in one consistent read.
    const loadStats = async () => {
      try {
        const repo = getRepository();
        const [patientDocs, reportDocs, orderDocs, sampleDocs, invoiceDocs] = await Promise.all([
          repo.list('patients'),
          repo.list('reports'),
          repo.list('orders'),
          repo.list('samples'),
          repo.list('invoices'),
        ]);
        if (cancelled) return;
        const patients = readPatients(patientDocs);
        const reports = readReports(reportDocs);
        const orders = readOrders(orderDocs);
        const samples = readSamples(sampleDocs);
        const invoices = readInvoices(invoiceDocs);
        const activeOrders = orders.filter(order => !['cancelled', 'amended', 'billed'].includes(order.status));
        const activeSamples = samples.filter(sample => ['expected', 'collected', 'received', 'processing'].includes(sample.status));
        const nonVoidInvoices = invoices.filter(invoice => invoice.status !== 'void');
        const billedReportIds = new Set(nonVoidInvoices.map(invoice => invoice.reportId).filter(Boolean));
        const finalReports = reports.filter(report => report.status === 'final');
        const draftHours = readSettings().notificationPrefs?.draftHours ?? 24;
        const now = Date.now();
        setStats({
          patients: patients.length,
          reports: finalReports.length,
          revenue: nonVoidInvoices.reduce((sum, invoice) => sum + Math.max(0, invoice.paidAmount ?? 0), 0),
          pendingOrders: activeOrders.length,
          pendingSamples: activeSamples.length,
          rejectedSamples: samples.filter(sample => sample.status === 'rejected').length,
          overdueDrafts: reports.filter(report => report.status === 'draft' && now - Date.parse(report.updatedAt ?? report.createdAt) >= draftHours * 3_600_000).length,
          unbilledReports: finalReports.filter(report => !billedReportIds.has(report.id)).length,
          outstanding: nonVoidInvoices.reduce((sum, invoice) => sum + Math.max(0, invoice.amount - (invoice.paidAmount ?? 0)), 0),
        });
      } catch (error) {
        if (!cancelled) setStatsError('Dashboard totals could not be loaded. This is not an empty lab or zero revenue.');
        handleFirestoreError(error, OperationType.GET, 'stats');
      }
    };

    // The recent-activity listeners below are live; any write that can move a
    // total also changes them, so they double as the invalidation signal.
    // Debounced so a burst of saves costs one refresh, not one per write.
    const scheduleStatsRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(loadStats, 400);
    };

    void loadStats();

    const qReports = query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(10));
    const unsubRecentReports = onSnapshot(
      qReports,
      s => {
        setRecentReports(readReports(s.docs));
        scheduleStatsRefresh();
      },
      error => {
        handleFirestoreError(error, OperationType.GET, 'reports');
      },
    );

    const qInvoices = query(collection(db, 'invoices'), where('status', '!=', 'void'));
    const unsubInvoices = onSnapshot(qInvoices, scheduleStatsRefresh, error => {
      handleFirestoreError(error, OperationType.GET, 'invoices');
    });
    const qOrders = query(collection(db, 'orders'), where('status', 'in', ['ordered', 'collected', 'processing', 'resulted', 'issued']));
    const unsubOrders = onSnapshot(qOrders, scheduleStatsRefresh, error => {
      handleFirestoreError(error, OperationType.GET, 'orders');
    });
    const qSamples = query(collection(db, 'samples'), where('status', 'in', ['expected', 'collected', 'received', 'processing', 'rejected']));
    const unsubSamples = onSnapshot(qSamples, scheduleStatsRefresh, error => {
      handleFirestoreError(error, OperationType.GET, 'samples');
    });

    const qPatients = query(collection(db, 'patients'), orderBy('createdAt', 'desc'), limit(10));
    const unsubRecentPatients = onSnapshot(
      qPatients,
      s => {
        setRecentPatients(readPatients(s.docs));
        scheduleStatsRefresh();
      },
      error => {
        handleFirestoreError(error, OperationType.GET, 'patients');
      },
    );

    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
      unsubRecentReports();
      unsubRecentPatients();
      unsubInvoices();
      unsubOrders();
      unsubSamples();
    };
  }, [statsReload]);

  useEffect(() => {
    const ids = recentPatients.map(patient => patient.id);
    if (ids.length === 0) return;
    let active = true;
    void getDocs(query(
      collection(db, 'reports'),
      where('patientId', 'in', ids),
      orderBy('createdAt', 'desc'),
    )).then(snapshot => {
      if (!active) return;
      const latest = new Map<string, any>();
      for (const report of readReports(snapshot.docs)) {
        if (!latest.has(report.patientId)) latest.set(report.patientId, report);
      }
      setLatestPatientReports(latest);
    }).catch(error => handleFirestoreError(error, OperationType.GET, 'reports'));
    return () => { active = false; };
  }, [recentPatients]);

  const combinedReports = React.useMemo(() => {
    const list = [
      ...recentReports.map(r => ({ ...r, itemType: 'report', timestamp: r.createdAt })),
      ...recentPatients
        .filter(p => !latestPatientReports.has(p.id))
        .map(p => ({ ...p, itemType: 'patient', timestamp: p.createdAt })),
    ];
    return list
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5);
  }, [recentReports, recentPatients, latestPatientReports]);

  const cards: StatCard[] = [
    {
      label: 'Total Patients',
      value: stats.patients,
      icon: Users,
      tint: 'bg-chart-1/12 text-chart-1',
      meta: 'Registered in this lab',
    },
    {
      // Issued is the stored workflow status. Signature verification remains
      // available on the report itself rather than implying every historical
      // report was signed.
      label: 'Reports Issued',
      value: stats.reports,
      icon: FileText,
      tint: 'bg-chart-2/12 text-chart-2',
      meta: 'Given to the patient or referring doctor',
    },
    {
      // The third tile the lab asked for. It is the money that has actually come
      // in — paid bills only, the same figure the Bills page calls COLLECTED —
      // rather than everything ever billed, because a dashboard number is read as
      // cash in the drawer. Tapping it opens Bills, where the figure is made.
      label: 'Total Revenue',
      value: stats.revenue,
      icon: IndianRupee,
      tint: 'bg-chart-3/12 text-chart-3',
      meta: 'Collected from paid bills',
      prefix: getBillingPrefs().currency,
      to: 'bills',
    },
    {
      label: 'Pending Orders',
      value: stats.pendingOrders,
      icon: ClipboardList,
      tint: 'bg-chart-4/12 text-chart-4',
      meta: 'Open requisitions',
      to: 'orders',
    },
    {
      label: 'Samples in Process',
      value: stats.pendingSamples,
      icon: FlaskConical,
      tint: 'bg-chart-5/12 text-chart-5',
      meta: 'Expected through processing',
      to: 'samples',
    },
    {
      label: 'Outstanding Balance',
      value: stats.outstanding,
      icon: IndianRupee,
      tint: 'bg-warning/12 text-warning',
      meta: 'Across non-void bills',
      prefix: getBillingPrefs().currency,
      to: 'bills',
    },
  ];

  return (
    // space-y-6: the same page-section rhythm every other dashboard tab uses, so
    // switching tabs does not change the vertical beat. 16px stays reserved for
    // gutters *inside* a group (the two stat tiles) and the page padding.
    <div className="space-y-6">
      {/* First-run guidance — shown only to a completely empty lab. The activity
          lists have the final say before claiming there is nothing. */}
      {!statsError && stats.patients === 0 &&
        stats.reports === 0 &&
        recentPatients.length === 0 &&
        recentReports.length === 0 && (
          <Card pad="none" className="overflow-hidden">
            <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent/12 text-accent">
                <UserPlus className="h-8 w-8" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-bold tracking-[-0.02em] text-on-surface">
                  Welcome to PathoMitra
                </h2>
                <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-on-surface-variant">
                  Your lab is set up and ready. Get started by registering your first patient, then
                  build and issue their report from their profile.
                </p>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
                {/* Single local operator: there is no guest tier to unlock, so this
                    is always the action rather than a prompt for an access code. */}
                <Button size="lg" shine onClick={() => onAddPatient && onAddPatient()}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Register first patient
                </Button>
              </div>
            </div>
          </Card>
        )}

      {statsError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-error/30 bg-error-container/40 p-4">
          <p className="text-sm font-semibold text-error">{statsError}</p>
          <Button size="sm" variant="outline" onClick={() => { setStatsError(''); setStatsReload(value => value + 1); }}>Retry totals</Button>
        </div>
      )}

      {/* Operational and financial tiles: two across on a folded phone, three
          across from lg up. */}
      {!statsError && <><div className="grid grid-cols-1 fold:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {cards.map((card, idx) => {
          // A tile is only a control when it names a tab *and* the shell can
          // actually switch tabs — otherwise it would advertise itself as
          // clickable and do nothing when pressed.
          const target = card.to && setActiveTab ? card.to : undefined;
          return (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: Math.min(idx * 0.08, 0.32),
                type: 'spring',
                stiffness: 260,
                damping: 24,
              }}
            >
              <Card
                interactive
                className="group relative overflow-hidden"
                {...(target
                  ? {
                      role: 'button' as const,
                      tabIndex: 0,
                      'aria-label': `${card.label}: ${card.prefix ?? ''}${card.value.toLocaleString('en-IN')} \u2014 open ${target}`,
                      onClick: () => setActiveTab?.(target),
                      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        // Space would otherwise scroll the page instead of
                        // activating the card, like any real button.
                        event.preventDefault();
                        setActiveTab?.(target);
                      },
                    }
                  : {})}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={cn(
                      'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-110',
                      card.tint,
                    )}
                  >
                    <card.icon className="w-6 h-6" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
                      {card.label}
                    </p>
                    <h4 className="text-[28px] font-bold leading-tight tracking-[-0.03em] text-on-surface tabular-nums">
                      {card.prefix && (
                        <span aria-hidden="true" className="mr-0.5">
                          {card.prefix}
                        </span>
                      )}
                      <CountUp value={Number(card.value)} />
                    </h4>
                  </div>
                  <p className="ml-auto hidden shrink-0 text-[11px] font-medium text-outline sm:block">
                    {card.meta}
                  </p>
                  {target && (
                    <ChevronRight
                      className="hidden h-4 w-4 shrink-0 text-outline transition-transform duration-300 group-hover:translate-x-0.5 sm:block"
                      aria-hidden="true"
                    />
                  )}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: 'Rejected samples', value: stats.rejectedSamples, tab: 'samples' },
          { label: 'Overdue drafts', value: stats.overdueDrafts, tab: 'reports' },
          { label: 'Unbilled issued reports', value: stats.unbilledReports, tab: 'bills' },
        ].map(item => (
          <button key={item.label} type="button" onClick={() => setActiveTab?.(item.tab)} className="flex items-center justify-between gap-3 rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-3 text-left transition hover:bg-surface-container">
            <span className="text-xs font-semibold text-on-surface-variant">{item.label}</span>
            <span className="text-lg font-bold tabular-nums text-on-surface">{item.value}</span>
          </button>
        ))}
      </div></>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Patients Registry */}
        <Card pad="lg" className="flex md:min-h-[min(400px,60vh)] flex-col">
          <SectionTitle
            title="Recent patients"
            subtitle="Newest registrations in the lab"
            action={
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => onAddPatient && onAddPatient()}>
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Register
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setActiveTab && setActiveTab('patients')}
                >
                  Manage
                </Button>
              </div>
            }
          />

          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline-variant/60 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                  <th className="pb-3 pr-4 font-semibold">Patient</th>
                  <th className="pb-3 px-4 font-semibold">Details</th>
                  <th className="pb-3 px-4 font-semibold">Date</th>
                  {role !== 'guest' && (
                    <th className="pb-3 pl-4 text-right font-semibold">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {recentPatients.map((patient, idx) => (
                  <motion.tr
                    key={patient.id}
                    {...listStaggerProps(idx, 10)}
                    onClick={() => setActiveTab && setActiveTab('patients')}
                    className="cursor-pointer transition-colors hover:bg-surface-container-low"
                  >
                    <td className="py-3.5 pr-4">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/12 text-xs font-bold text-accent">
                          {patient.name ? patient.name[0].toUpperCase() : '?'}
                        </div>
                        <span className="text-sm font-semibold text-on-surface line-clamp-1">
                          {patient.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-md bg-surface-container-high px-1.5 py-0.5 text-xs font-semibold text-on-surface-variant">
                          {patient.age}y
                        </span>
                        <span className="text-xs font-medium capitalize text-on-surface-variant">
                          {patient.gender}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-medium text-on-surface-variant">
                      {patient.createdAt
                        ? new Date(patient.createdAt).toLocaleDateString('en-IN')
                        : 'N/A'}
                    </td>
                    {role !== 'guest' && (
                      <td className="py-3.5 pl-4 text-right">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setPatientToDelete(patient);
                          }}
                          className="rounded-full p-2 text-on-surface-variant transition hover:bg-error-container hover:text-error cursor-pointer"
                          aria-label={`Delete ${patient.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </motion.tr>
                ))}
                {recentPatients.length === 0 && (
                  <tr>
                    <td
                      colSpan={role !== 'guest' ? 4 : 3}
                      className="py-8 text-center text-sm text-on-surface-variant"
                    >
                      No patients registered yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile: iOS inset list */}
          <div className="md:hidden divide-y divide-outline-variant/40 overflow-hidden rounded-2xl border border-[var(--elevated-border)] bg-surface-container-lowest">
            {recentPatients.map(patient => (
              <div
                key={patient.id}
                onClick={() => setActiveTab && setActiveTab('patients')}
                className="flex items-center gap-3 px-3 py-3.5 transition-colors active:bg-surface-container-high"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/12 text-sm font-bold text-accent">
                  {patient.name ? patient.name[0].toUpperCase() : '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-on-surface">
                    {patient.name}
                  </p>
                  <p className="truncate text-[13px] capitalize text-on-surface-variant">
                    {patient.age}y · {patient.gender} ·{' '}
                    {patient.createdAt
                      ? new Date(patient.createdAt).toLocaleDateString('en-IN')
                      : 'N/A'}
                  </p>
                </div>
                {role !== 'guest' && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      setPatientToDelete(patient);
                    }}
                    className="rounded-full p-2.5 text-on-surface-variant hover:bg-error-container hover:text-error active:scale-95"
                    aria-label={`Delete ${patient.name}`}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>
            ))}
            {recentPatients.length === 0 && (
              <EmptyState
                icon={<Users className="h-7 w-7" aria-hidden="true" />}
                title="No patients yet"
                description="Register a patient to see them appear here."
                action={
                  role !== 'guest' ? (
                    <Button size="sm" onClick={() => onAddPatient && onAddPatient()}>
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Register
                    </Button>
                  ) : undefined
                }
                className="py-10"
              />
            )}
          </div>
        </Card>

        {/* Reports Registry */}
        <Card pad="lg" className="flex md:min-h-[min(400px,60vh)] flex-col">
          <SectionTitle
            title="Reports desk"
            subtitle="Latest diagnostics and pending outputs"
            action={
              <Button
                size="sm"
                variant="primary"
                onClick={() => setActiveTab && setActiveTab('reports')}
              >
                Manage
              </Button>
            }
          />

          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline-variant/60 text-[11px] uppercase tracking-[0.06em] text-on-surface-variant">
                  <th className="pb-3 pr-4 font-semibold">Patient & test</th>
                  <th className="pb-3 px-4 font-semibold">Status</th>
                  {/*
                    The "Signature" column used to sit here and read
                    "Unsigned" on every row — the app has no signing service
                    (see lib/report-compliance.ts) and the `signature` field
                    is written empty, so the column could never say anything
                    useful. Deleting it removes a claim the build cannot
                    substantiate (UI-P0-01).
                  */}
                  <th className="pb-3 px-4 font-semibold">Date</th>
                  {role !== 'guest' && (
                    <th className="pb-3 pl-4 text-right font-semibold">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {combinedReports.map((item, idx) => {
                  const isReport = item.itemType === 'report';
                  const name = isReport ? item.patientName : item.name;
                  const testSub = isReport
                    ? item.testType || 'General'
                    : orderedSummary(item.testSelection);
                  // Same state model as the Reports tab card and the detail
                  // sheet — one source of truth for Draft / Issued / Amended
                  // so the overview cannot disagree with the record it links to.
                  const statusView = isReport
                    ? reportStatusView({ status: item.status, version: item.version })
                    : null;
                  const date = item.createdAt
                    ? new Date(item.createdAt).toLocaleDateString('en-IN')
                    : 'N/A';

                  return (
                    <motion.tr
                      key={item.id}
                      {...listStaggerProps(idx, 10)}
                      onClick={() => {
                        if (isReport) {
                          onManageReport?.(item.id);
                        } else {
                          onCreateReportForPatient?.(item.id);
                        }
                      }}
                      className="cursor-pointer transition-colors hover:bg-surface-container-low"
                    >
                      <td className="py-3.5 pr-4">
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-semibold text-on-surface line-clamp-1">
                            {name}
                          </span>
                          <span className="text-xs font-medium text-on-surface-variant line-clamp-1">
                            {testSub}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        {statusView ? (
                          <StatusPill tone={statusView.tone} dot>
                            {statusView.label}
                          </StatusPill>
                        ) : (
                          <StatusPill tone="neutral" dot>
                            Awaiting report
                          </StatusPill>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs font-medium text-on-surface-variant">
                        {date}
                      </td>
                      {role !== 'guest' && (
                        <td className="py-3.5 pl-4 text-right">
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              setReportToDelete(item);
                            }}
                            className="rounded-full p-2 text-on-surface-variant transition hover:bg-error-container hover:text-error cursor-pointer"
                            aria-label="Delete report"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </motion.tr>
                  );
                })}
                {combinedReports.length === 0 && (
                  <tr>
                    <td
                      colSpan={role !== 'guest' ? 4 : 3}
                      className="py-8 text-center text-sm text-on-surface-variant"
                    >
                      No reports yet — create one from the Reports tab
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile: iOS inset list */}
          <div className="md:hidden divide-y divide-outline-variant/40 overflow-hidden rounded-2xl border border-[var(--elevated-border)] bg-surface-container-lowest">
            {combinedReports.map(item => {
              const isReport = item.itemType === 'report';
              const name = isReport ? item.patientName : item.name;
              const testSub = isReport
                ? item.testType || 'General'
                : orderedSummary(item.testSelection);
              const statusView = isReport
                ? reportStatusView({ status: item.status, version: item.version })
                : null;
              const date = item.createdAt
                ? new Date(item.createdAt).toLocaleDateString('en-IN')
                : 'N/A';

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (isReport) onManageReport?.(item.id);
                    else onCreateReportForPatient?.(item.id);
                  }}
                  className="flex items-center gap-3 px-3 py-3.5 transition-colors active:bg-surface-container-high"
                >
                  <div
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
                      isReport
                        ? 'bg-chart-2/12 text-chart-2'
                        : 'bg-surface-container-high text-on-surface-variant',
                    )}
                  >
                    <FileText className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-on-surface">{name}</p>
                    <p className="truncate text-[13px] text-on-surface-variant">{testSub}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {statusView ? (
                        <StatusPill tone={statusView.tone} dot>
                          {statusView.label}
                        </StatusPill>
                      ) : (
                        <StatusPill tone="neutral" dot>
                          Awaiting report
                        </StatusPill>
                      )}
                      <span className="ml-auto text-xs text-on-surface-variant">{date}</span>
                    </div>
                  </div>
                  {role !== 'guest' && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setReportToDelete(item);
                      }}
                      className="rounded-full p-2.5 text-on-surface-variant hover:bg-error-container hover:text-error active:scale-95"
                      aria-label={`Delete report for ${name}`}
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </div>
              );
            })}
            {combinedReports.length === 0 && (
              <EmptyState
                icon={<FileText className="h-7 w-7" aria-hidden="true" />}
                title="No reports yet"
                description="Issue a report from a patient's profile to see it here."
                action={
                  role !== 'guest' ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => setActiveTab && setActiveTab('reports')}
                    >
                      Go to Reports
                    </Button>
                  ) : undefined
                }
                className="py-10"
              />
            )}
          </div>
        </Card>
      </div>

      {/* Delete Patient Confirmation */}
      <ConfirmSheet
        open={!!patientToDelete}
        onClose={() => setPatientToDelete(null)}
        title="Archive patient"
        confirmLabel="Archive"
        message={
          <>
            Archive{' '}
            <strong className="font-semibold text-on-surface">{patientToDelete?.name}</strong>? Their
            issued reports, amendments, and invoices remain in the retained history.
          </>
        }
        onConfirm={async () => {
          if (!patientToDelete) return;
          try {
            await archivePatient(patientToDelete.id, operatorStamp(user), 'Archived from overview');
            toast.success(`Archived ${patientToDelete.name}; retained history is unchanged.`);
            setPatientToDelete(null);
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, 'patients');
            toast.error('Could not archive the patient record');
          }
        }}
      />

      {/* Delete Report Confirmation */}
      <ConfirmSheet
        open={!!reportToDelete}
        onClose={() => setReportToDelete(null)}
        title="Delete draft report"
        message={
          <>
            Only an unissued, unbilled draft can be deleted. This will remove the draft for{' '}
            <strong className="font-semibold text-on-surface">
              {reportToDelete?.patientName || reportToDelete?.name}
            </strong>
            . The patient's own record is kept.
          </>
        }
        onConfirm={async () => {
          if (!reportToDelete) return;
          const isReport = reportToDelete.itemType === 'report';
          try {
            if (isReport) {
              // Deleting a report must never delete the patient: this used to
              // remove the patient record and every invoice under their name.
              await deleteReportCascade(reportToDelete.id);
              setReportToDelete(null);
              toast.success('Report deleted');
            } else {
              await archivePatient(reportToDelete.id, operatorStamp(user), 'Archived from overview');
              setReportToDelete(null);
              toast.success('Patient archived; retained history is unchanged');
            }
          } catch (err) {
            handleFirestoreError(err, isReport ? OperationType.DELETE : OperationType.UPDATE, 'reports');
            toast.error('Could not archive or delete the record');
          }
        }}
      />
    </div>
  );
}
