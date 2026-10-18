/**
 * <PatientDetailSheet> — read-only timeline of a single patient.
 *
 * Opens when a patient row is tapped. Groups every report issued for the
 * patient by calendar day; each day shows the referring doctor, the panels that
 * were run, and every result flagged normal / low / high against the patient's
 * age- and gender-adjusted reference range (same decision the signed report
 * makes — see `resolveValueStatus`).
 *
 * Reports are streamed with a targeted `where('patientId' == id)` subscription
 * that lives only while the sheet is open, so the parent list page never has to
 * hold the whole reports collection in memory.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { collection, db, onSnapshot, orderBy, query, where } from '../data/fs';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import {
  readReports,
  ageAsNumber,
  dueOf,
  type InvoiceRecord,
  type PatientDueInput,
  type PatientRecord,
  type ReportRecord,
} from '../lib/models';
import { invoicesForPatient, outstandingForPatient } from '../lib/invoices';
import { formatMoney } from '../lib/price-list';
import { resolveValueStatus, collapseToProfiles } from '../lib/pathology-tests';
import {
  CalendarClock,
  CheckCircle2,
  MinusCircle,
  PencilLine,
  Stethoscope,
  TrendingDown,
  TrendingUp,
  ReceiptText,
  BadgeIndianRupee,
  Loader2,
} from 'lucide-react';
import { Button, Card, EmptyState, Field, Sheet, StatusPill, TextInput, type PillTone } from './ui';

const STATUS_TONE: Record<'normal' | 'low' | 'high', PillTone> = {
  normal: 'success',
  low: 'warning',
  high: 'error',
};

const STATUS_ICON = {
  normal: CheckCircle2,
  low: TrendingDown,
  high: TrendingUp,
};

/** `2 Oct 2026` — the compact day label used on every timeline node. */
function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Local calendar day — the same bucket the rest of the dashboard groups by. */
function isoDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface TimelineEntry {
  day: string;
  dayLabel: string;
  reports: ReportRecord[];
}

export function PatientDetailSheet({
  patient,
  onClose,
  onEdit,
  onPrintBill,
  onSaveDue,
}: {
  patient: PatientRecord | null;
  onClose: () => void;
  onEdit?: (patient: PatientRecord) => void;
  /** Raise (or reprint) the bill for this patient's current order. */
  onPrintBill?: (patient: PatientRecord) => void;
  /**
   * Record (or clear, with 0) the amount this patient is carrying as a due.
   * The sheet collects what a human typed; the page stamps who typed it.
   * Resolves to an error message when the entry was refused — the form stays open
   * and shows it, because the operator is mid-entry and knows the fix.
   */
  onSaveDue?: (
    patient: PatientRecord,
    input: Omit<PatientDueInput, 'actor'>,
  ) => Promise<string | null>;
}) {
  // The parent keys this sheet by patient id, so switching patients remounts
  // it with a clean slate — no stale timeline flashes and no need to reset
  // state synchronously inside the effect below.
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const patientId = patient?.id;

  /** This patient's bills — read once per open, to seed and explain the due. */
  const [bills, setBills] = useState<InvoiceRecord[]>([]);
  const [dueOpen, setDueOpen] = useState(false);
  const [dueAmount, setDueAmount] = useState('');
  const [dueNote, setDueNote] = useState('');
  const [duePhone, setDuePhone] = useState('');
  const [dueError, setDueError] = useState<string | null>(null);
  const [dueSaving, setDueSaving] = useState(false);

  useEffect(() => {
    if (!patientId) return;
    let active = true;
    void invoicesForPatient(patientId).then(rows => {
      if (active) setBills(rows);
    });
    return () => {
      active = false;
    };
  }, [patientId]);

  useEffect(() => {
    if (!patientId) return;
    const path = 'reports';
    const q = query(
      collection(db, path),
      where('patientId', '==', patientId),
      orderBy('createdAt', 'desc'),
    );
    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        setReports(readReports(snapshot.docs));
        setLoading(false);
      },
      error => {
        handleFirestoreError(error, OperationType.GET, path);
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [patientId]);

  // Newest-first reports collapse into per-day entries; the timeline reads top
  // (most recent visit) to bottom.
  const timeline = useMemo<TimelineEntry[]>(() => {
    const buckets = new Map<string, TimelineEntry>();
    for (const report of reports) {
      const day = isoDay(report.createdAt);
      const existing = buckets.get(day);
      if (existing) existing.reports.push(report);
      else {
        buckets.set(day, { day, dayLabel: formatDay(report.createdAt), reports: [report] });
      }
    }
    return Array.from(buckets.values());
  }, [reports]);

  const age = patient ? ageAsNumber(patient) : undefined;
  const gender = patient?.gender;

  /** What the bills say is still owed — the seed for the due, not its authority. */
  const unpaid = useMemo(() => outstandingForPatient(bills), [bills]);
  const due = dueOf(patient ?? { dueAmount: 0 });

  const openDueForm = () => {
    setDueAmount(unpaid > 0 ? String(unpaid) : '');
    setDueNote('');
    setDuePhone(patient?.phone ?? '');
    setDueError(null);
    setDueOpen(true);
  };

  const saveDue = async () => {
    if (!patient || !onSaveDue) return;
    setDueSaving(true);
    setDueError(null);
    try {
      const failure = await onSaveDue(patient, {
        amount: dueAmount,
        note: dueNote,
        phone: duePhone,
      });
      if (failure) setDueError(failure);
      else setDueOpen(false);
    } finally {
      setDueSaving(false);
    }
  };

  const abnormalCount = useMemo(
    () =>
      reports.reduce(
        (sum, r) =>
          sum +
          Object.entries(r.resultData ?? {}).filter(([name, value]) => {
            const { status } = resolveValueStatus(name, value, age, gender);
            return status === 'low' || status === 'high';
          }).length,
        0,
      ),
    [reports, age, gender],
  );

  return (
    <Sheet
      open={!!patient}
      onClose={onClose}
      width="lg"
      title={patient?.name}
      description={
        patient
          ? `${patient.age}y · ${patient.gender}${patient.phone ? ` · ${patient.phone}` : ''} · ID ${patient.id}`
          : undefined
      }
      footer={
        patient && (onEdit || onPrintBill) ? (
          <div className="flex gap-3">
            <Button variant="primary" size="lg" fullWidth onClick={onClose}>
              Close
            </Button>
            {onPrintBill && (
              <Button variant="outline" size="lg" fullWidth onClick={() => onPrintBill(patient)}>
                <ReceiptText className="w-4 h-4" />
                Print bill
              </Button>
            )}
            {onEdit && (
              <Button
                variant="brand"
                size="lg"
                fullWidth
                onClick={() => {
                  onEdit(patient);
                  onClose();
                }}
              >
                <PencilLine className="w-4 h-4" />
                Edit record
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {!patient ? null : (
        <div className="space-y-5 pb-2">
          {/* Referral + summary strip */}
          <Card pad="sm" className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/12 text-accent">
                <Stethoscope className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                  Referred by
                </p>
                <p className="text-sm font-bold text-on-surface">{patient.doctorName || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill tone="neutral">
                {reports.length} report{reports.length === 1 ? '' : 's'}
              </StatusPill>
              {abnormalCount > 0 && (
                <StatusPill tone="warning" dot>
                  {abnormalCount} out of range
                </StatusPill>
              )}
            </div>
          </Card>

          {/* Money. Two figures side by side on purpose: what the bills say is
              unpaid, and what the counter has recorded against the patient. They
              are allowed to differ — an advance taken in cash, or a debt that
              predates this app, moves one and not the other — and hiding either
              figure is how a lab reconciles at midnight instead of at the desk. */}
          <Card pad="sm" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-warning/12 text-warning">
                  <BadgeIndianRupee className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                    Due recorded
                  </p>
                  <p className="text-sm font-bold text-on-surface tabular-nums">
                    {formatMoney(due)}
                    {due > 0 && patient.dueNote ? (
                      <span className="ml-1 text-[12px] font-medium text-on-surface-variant">
                        · {patient.dueNote}
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={unpaid > 0 ? 'warning' : 'neutral'}>
                  {formatMoney(unpaid)} unpaid on {bills.length} bill{bills.length === 1 ? '' : 's'}
                </StatusPill>
                {onSaveDue && (
                  <Button variant="outline" size="sm" onClick={openDueForm}>
                    {due > 0 ? 'Edit due' : 'Record due'}
                  </Button>
                )}
              </div>
            </div>
            {due > 0 && patient.dueRecordedBy && (
              <p className="text-[11px] text-on-surface-variant">
                Entered by {patient.dueRecordedBy}
                {patient.dueUpdatedAt ? ` on ${formatDay(patient.dueUpdatedAt)}` : ''} — it stays
                until someone sets it to 0.
              </p>
            )}
            {dueOpen && (
              <form
                className="space-y-3 rounded-2xl bg-surface-container-low p-3.5"
                onSubmit={event => {
                  event.preventDefault();
                  void saveDue();
                }}
              >
                <p className="text-[13px] text-on-surface-variant">
                  Pre-filled with the {formatMoney(unpaid)} still outstanding on this patient’s
                  bills. Change it if part has been paid by hand, or enter 0 to clear the due.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Due amount" required htmlFor="patient-due-amount">
                    <TextInput
                      id="patient-due-amount"
                      inputMode="decimal"
                      placeholder="0"
                      value={dueAmount}
                      onChange={event => setDueAmount(event.target.value)}
                    />
                  </Field>
                  <Field
                    label="Patient phone"
                    required
                    htmlFor="patient-due-phone"
                    hint="Typed to confirm whose debt this is."
                  >
                    <TextInput
                      id="patient-due-phone"
                      type="tel"
                      value={duePhone}
                      onChange={event => setDuePhone(event.target.value)}
                    />
                  </Field>
                </div>
                <Field
                  label="Note"
                  htmlFor="patient-due-note"
                  hint="Optional — up to 200 characters."
                >
                  <TextInput
                    id="patient-due-note"
                    maxLength={200}
                    value={dueNote}
                    onChange={event => setDueNote(event.target.value)}
                  />
                </Field>
                {dueError && (
                  <p role="alert" className="text-xs font-semibold text-error">
                    {dueError}
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" variant="brand" size="lg" disabled={dueSaving}>
                    {dueSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {due > 0 ? 'Save due' : 'Record due'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={() => setDueOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </Card>

          {loading ? (
            <p
              role="status"
              className="py-8 text-center text-sm font-semibold text-on-surface-variant"
            >
              Loading history…
            </p>
          ) : timeline.length === 0 ? (
            <Card pad="none">
              <EmptyState
                icon={<CalendarClock className="h-7 w-7" />}
                title="No reports yet"
                description={
                  patient.testSelection && patient.testSelection.length > 0
                    ? 'Tests are ordered but no result has been entered yet.'
                    : 'No tests recorded for this patient.'
                }
              />
            </Card>
          ) : (
            <ol className="relative space-y-5 border-l-2 border-outline-variant/50 pl-5">
              {timeline.map((entry, idx) => (
                <motion.li
                  key={entry.day}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx * 0.05, 0.4), duration: 0.25 }}
                  className="relative"
                >
                  {/* Timeline node */}
                  <span
                    aria-hidden="true"
                    className="absolute -left-[27px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-accent bg-surface"
                  />
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 className="text-[15px] font-bold tracking-[-0.01em] text-on-surface">
                        {entry.dayLabel}
                      </h3>
                      <span className="text-xs text-on-surface-variant">
                        {entry.reports.length} report{entry.reports.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    {entry.reports.map(report => (
                      <ReportCard
                        key={report.id}
                        report={report}
                        doctorName={patient.doctorName}
                        age={age}
                        gender={gender}
                      />
                    ))}
                  </div>
                </motion.li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Sheet>
  );
}

function ReportCard({
  report,
  doctorName,
  age,
  gender,
}: {
  report: ReportRecord;
  doctorName?: string;
  age?: number;
  gender?: string;
}) {
  const results = Object.entries(report.resultData ?? {});
  // Show the ordered *profiles* (a CBC counts as one), not the expanded list of
  // every member parameter that `addTest` also stored.
  const panels = collapseToProfiles(report.testSelection);

  return (
    <Card pad="sm" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          {report.testType && (
            <p className="truncate text-sm font-bold text-on-surface">{report.testType}</p>
          )}
          <p className="flex items-center gap-1.5 text-xs text-on-surface-variant">
            <Stethoscope className="h-3 w-3" aria-hidden="true" />
            {doctorName || 'Self / walk-in'}
          </p>
        </div>
        <StatusPill tone={report.status === 'final' ? 'success' : 'neutral'} dot>
          {report.status === 'final' ? 'Issued' : 'Draft'}
          {report.version > 1 ? ` · v${report.version}` : ''}
        </StatusPill>
      </div>

      {panels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {panels.map(name => (
            <span
              key={name}
              className="rounded-full bg-accent/12 px-2.5 py-0.5 text-[11px] font-semibold text-accent"
            >
              {name}
            </span>
          ))}
        </div>
      )}

      {results.length === 0 ? (
        <p className="text-xs italic text-on-surface-variant">
          Results pending — no values entered for this panel yet.
        </p>
      ) : (
        <ul className="divide-y divide-outline-variant/40">
          {results.map(([name, value]) => {
            const { status, rangeLabel, unit } = resolveValueStatus(name, value, age, gender);
            const Icon = status ? STATUS_ICON[status] : MinusCircle;
            return (
              <li key={name} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-on-surface">{name}</p>
                  {rangeLabel && (
                    <p className="text-[11px] text-on-surface-variant">
                      Ref: {rangeLabel} {unit}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[13px] font-bold tabular-nums text-on-surface">
                    {String(value)}
                    {unit ? (
                      <span className="ml-1 font-normal text-on-surface-variant">{unit}</span>
                    ) : null}
                  </span>
                  {status ? (
                    <StatusPill tone={STATUS_TONE[status]}>
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      <span className="capitalize">{status}</span>
                    </StatusPill>
                  ) : (
                    <span
                      className="text-[11px] font-medium text-on-surface-variant"
                      title="Not a range-checked value"
                    >
                      —
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
