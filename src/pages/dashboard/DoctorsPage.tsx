import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
  getDocs,
  db,
} from '../../data/fs';
import { handleFirestoreError, OperationType } from '../../lib/firestore-errors';
import { cn } from '../../lib/utils';
import { Plus, Stethoscope, Users, Trash2, Edit2, FileText, Loader2 } from 'lucide-react';
import { DEFAULT_DOCTORS } from '../../lib/doctors';
import {
  readDoctors,
  readPatients,
  readInvoices,
  type DoctorRecord,
  type PatientRecord,
  type InvoiceRecord,
} from '../../lib/models';
import { DoctorDetailSheet, type DoctorDetailTarget } from '../../components/DoctorDetailSheet';
import { PrintDialog, type PrintJob } from '../../components/PrintDialog';
import { useAuth } from '../../contexts/AuthContext';
import {
  buildDoctorStatements,
  currentMonthKey,
  monthLabel,
  statementsSummary,
} from '../../lib/referrals';
import type { DoctorStatement } from '../../lib/referrals';
import { doctorNameKey } from '../../lib/doctor-registry';
import { formatMoney } from '../../lib/price-list';
import { buildStatementPdf, outputInvoicePdf } from '../../lib/invoice-pdf';
import { readSettings } from '../../lib/settings';
import {
  Button,
  Card,
  IconButton,
  Sheet,
  ConfirmSheet,
  SearchField,
  Field,
  TextInput,
  ListGroup,
  ListRow,
  EmptyState,
  CalendarRangePicker,
  SegmentedControl,
  StatusPill,
  useToast,
  toIsoDay,
} from '../../components/ui';

/** A row in the register: a Firestore doctor, or a seeded default that has no record. */
type DoctorListItem = DoctorRecord & { isDefault?: boolean };

/** The subset of a doctor the statement flow needs (a register row or a tapped detail target). */
type StatementTarget = {
  id: string;
  name: string;
  phone?: string;
  clinic?: string;
  isDefault?: boolean;
};

export default function DoctorsPage() {
  const { role } = useAuth();
  const [doctors, setDoctors] = useState<DoctorRecord[]>([]);
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDoctor, setEditingDoctor] = useState<DoctorRecord | null>(null);
  const [doctorToDelete, setDoctorToDelete] = useState<DoctorListItem | null>(null);
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorDetailTarget | null>(null);
  /**
   * Quick commission-rate editor, opened by long-pressing a doctor row. Only the
   * referral rate is touched here — the full edit sheet still owns the rest.
   */
  const [commissionDoctor, setCommissionDoctor] = useState<DoctorListItem | null>(null);
  const [commissionValue, setCommissionValue] = useState('');
  const [commissionSaving, setCommissionSaving] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    clinic: '',
    referralPercent: '',
  });
  /** `YYYY-MM` for the statement sheet, defaulted to the running month. */
  const [statementMonth, setStatementMonth] = useState(() => currentMonthKey());
  /** How the open statement is scoped: one calendar month, or a custom day range. */
  const [statementMode, setStatementMode] = useState<'month' | 'range'>('month');
  const [statementFrom, setStatementFrom] = useState('');
  const [statementTo, setStatementTo] = useState('');
  const [statementDoctor, setStatementDoctor] = useState<StatementTarget | null>(null);
  const [statement, setStatement] = useState<DoctorStatement | null>(null);
  /**
   * Which `doctor:month` request the displayed statement answers. Loading is
   * derived from it rather than from a boolean flipped inside the effect, so the
   * screen cannot paint the previous month's numbers as the new month's answer.
   */
  const [settledKey, setSettledKey] = useState('');
  /** Every bill read for the open statement — reused for the all-doctor line below. */
  const [allInvoices, setAllInvoices] = useState<InvoiceRecord[]>([]);
  const [printing, setPrinting] = useState(false);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const toast = useToast();

  const activeDoctorDates = useMemo(() => {
    // Local day, matching the calendar grid the dots are painted into.
    return new Set(doctors.filter(d => d.createdAt).map(d => toIsoDay(new Date(d.createdAt))));
  }, [doctors]);

  useEffect(() => {
    const path = 'doctors';
    const q = query(collection(db, path), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        // Parsed through the domain model like every other list: a doctor
        // document missing `name` would otherwise crash the search filter
        // below on `undefined.toLowerCase()` and blank the whole page.
        setDoctors(readDoctors(snapshot.docs));
      },
      error => {
        handleFirestoreError(error, OperationType.GET, path);
      },
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const qPatients = query(collection(db, 'patients'));
    const unsubscribePatients = onSnapshot(
      qPatients,
      snapshot => setPatients(readPatients(snapshot.docs)),
      error => handleFirestoreError(error, OperationType.GET, 'patients'),
    );
    return () => unsubscribePatients();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const path = 'doctors';
    // A blank box means "no rate agreed", not "0%" — and a stray `500` from a
    // mistyped field must never reach a payout, so the value is clamped here at
    // the only write door rather than trusted from the input.
    const rawPercent = formData.referralPercent.trim();
    const referralPercent =
      rawPercent === '' ? 0 : Math.min(100, Math.max(0, Number(rawPercent) || 0));
    const payload = {
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      clinic: formData.clinic.trim(),
      referralPercent,
    };
    try {
      if (editingDoctor) {
        await updateDoc(doc(db, path, editingDoctor.id), payload);
      } else {
        await addDoc(collection(db, path), {
          ...payload,
          createdAt: new Date().toISOString(),
        });
      }
      setIsModalOpen(false);
      resetForm();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', phone: '', clinic: '', referralPercent: '' });
    setEditingDoctor(null);
  };

  const openEditForm = (doctor: DoctorRecord) => {
    setEditingDoctor(doctor);
    setFormData({
      name: doctor.name || '',
      phone: doctor.phone || '',
      clinic: doctor.clinic || '',
      // `0` renders as an empty box rather than a planted zero: a rate the lab
      // never set should read as "not set", not as an agreed 0%.
      referralPercent: doctor.referralPercent ? String(doctor.referralPercent) : '',
    });
    setIsModalOpen(true);
  };

  /** Open the quick commission-rate editor for a row (long-press / right-click). */
  const openCommission = (doctor: DoctorListItem) => {
    setCommissionDoctor(doctor);
    // A rate the lab never set reads as an empty box, not a planted "0".
    setCommissionValue(doctor.referralPercent ? String(doctor.referralPercent) : '');
  };

  /**
   * Save just the commission rate.
   *
   * The clamp mirrors `handleSubmit`: a blank box means "no rate agreed" (0), and
   * a stray out-of-range value must never reach a payout. For a seeded default
   * name there is no record to patch, so saving a rate registers the doctor with
   * that name and rate — the only way a commission can attach to them.
   */
  const saveCommission = async () => {
    if (!commissionDoctor) return;
    const name = commissionDoctor.name.trim();
    const raw = commissionValue.trim();
    const referralPercent = raw === '' ? 0 : Math.min(100, Math.max(0, Number(raw) || 0));
    const path = 'doctors';
    setCommissionSaving(true);
    try {
      if (commissionDoctor.isDefault) {
        await addDoc(collection(db, path), {
          name,
          phone: commissionDoctor.phone || '',
          clinic: '',
          referralPercent,
          active: true,
          createdAt: new Date().toISOString(),
        });
      } else {
        await updateDoc(doc(db, path, commissionDoctor.id), { referralPercent });
      }
      setCommissionDoctor(null);
      toast.success(
        referralPercent > 0
          ? `${name}: ${referralPercent}% commission saved.`
          : `${name}: commission cleared.`,
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setCommissionSaving(false);
    }
  };

  const allDoctors = useMemo<DoctorListItem[]>(() => {
    const uniqueDynamic = doctors.filter(
      d => !DEFAULT_DOCTORS.some(defaultName => defaultName.toLowerCase() === d.name.toLowerCase()),
    );
    return [
      ...DEFAULT_DOCTORS.map(name => ({
        id: `default_${name}`,
        name,
        phone: '',
        createdAt: new Date().toISOString(),
        // Seeded suggestions are not the lab's register: no rate, still active.
        referralPercent: 0,
        active: true,
        isDefault: true,
      })),
      ...uniqueDynamic,
    ];
  }, [doctors]);

  const filteredDoctors = allDoctors.filter(d => {
    const matchesSearch =
      d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (!!d.phone && d.phone.includes(searchTerm));

    // Compare on the *local* day, the same bucket the calendar dots above use.
    // `toISOString()` here would shift records created before ~05:30 IST into
    // the previous day, so a lit dot could filter to an empty list.
    const matchesDate = (() => {
      if (!d.createdAt) return true;
      const day = toIsoDay(new Date(d.createdAt));
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    })();

    return matchesSearch && matchesDate;
  });

  const dnameMatches = (n1?: string, n2?: string) => {
    if (!n1 || !n2) return false;
    return n1.trim().toLowerCase() === n2.trim().toLowerCase();
  };

  const getDoctorStats = (doctorName: string) => {
    // Find all patients referred by this doctor
    const referrals = patients.filter(p => dnameMatches(p.doctorName, doctorName));
    const patientsCount = referrals.length;
    // Count total tests across those patients
    const testsCount = referrals.reduce(
      (sum, p) => sum + (p.testSelection ? p.testSelection.length : 0),
      0,
    );
    return { patientsCount, testsCount };
  };

  /**
   * Open the month-end statement sheet for one practitioner.
   * The statement is read live rather than cached: rates and payments change,
   * and a stale preview that prints differently from what it showed is worse
   * than no preview.
   */
  const openStatement = (doctor: StatementTarget, seed?: { from: string; to: string }) => {
    if (seed) {
      // Opened from the doctor detail sheet — honour the window it shows as a
      // custom range, and allow it even for a seeded/default doctor (matched by name).
      setStatementMode('range');
      setStatementFrom(seed.from);
      setStatementTo(seed.to);
    } else {
      if (doctor.isDefault) return;
      setStatementMode('month');
      setStatementMonth(currentMonthKey());
    }
    setStatementDoctor(doctor);
  };

  const statementKey = statementDoctor
    ? `${statementDoctor.id}:${statementMode}:${
        statementMode === 'month' ? statementMonth : `${statementFrom}..${statementTo}`
      }`
    : '';
  const statementLoading = !!statementDoctor && settledKey !== statementKey;

  /** The active period, in the shape `buildDoctorStatements` expects. */
  const statementPeriod =
    statementMode === 'month'
      ? { month: statementMonth }
      : { from: statementFrom, to: statementTo };

  /** A human label for the sheet heading, the PDF heading and the filename. */
  const statementPeriodLabel = useMemo(() => {
    if (statementMode === 'month') return monthLabel(statementMonth);
    const fmt = (day: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(day)
        ? new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : '';
    const a = fmt(statementFrom);
    const b = fmt(statementTo);
    if (a && b) return `${a} - ${b}`;
    if (a) return `from ${a}`;
    if (b) return `up to ${b}`;
    return 'All dates';
  }, [statementMode, statementMonth, statementFrom, statementTo]);

  useEffect(() => {
    if (!statementDoctor) {
      // Clearing happens in the render path via `statementKey`, not here.
      return undefined;
    }
    let cancelled = false;
    const request = statementKey;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'invoices'), orderBy('createdAt', 'desc')));
        const bills = readInvoices(snap.docs);
        const statements = buildDoctorStatements(bills, patients, {
          ...statementPeriod,
          doctors,
        });
        const key = doctorNameKey(statementDoctor.name);
        if (cancelled) return;
        setAllInvoices(bills);
        setStatement(statements.find(s => s.doctorKey === key) ?? null);
        setSettledKey(request);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'invoices');
        if (cancelled) return;
        setStatement(null);
        // Settled even on failure, or the sheet spins forever over an error it
        // has already been told about.
        setSettledKey(request);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `patients` and `doctors` are the registers the statement groups against.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statementKey]);

  const printStatement = async (mode: 'print' | 'preview' | 'download') => {
    if (!statementDoctor || !statement) {
      toast.info('Nothing to print — no referred bills in this month.');
      return;
    }
    setPrinting(true);
    try {
      const doc = await buildStatementPdf(statement, readSettings(), statementPeriodLabel);
      const { printJob, message } = await outputInvoicePdf(
        doc,
        `Referral statement ${statementDoctor.name} ${statementPeriodLabel}.pdf`,
        mode,
        `Referral statement ${statementDoctor.name}`,
      );
      if (printJob) setPrintJob(printJob);
      else if (message) toast.info(message);
      else toast.success('Statement ready.');
    } catch (err) {
      console.error('Statement export failed:', err);
      toast.error('Could not build the statement.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div className="flex flex-col sm:flex-row flex-1 max-w-lg items-stretch gap-2">
          <SearchField
            className="flex-1"
            placeholder="Search doctors..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onClear={() => setSearchTerm('')}
            aria-label="Search doctors"
          />

          <CalendarRangePicker
            fromDate={fromDate}
            toDate={toDate}
            activeDates={activeDoctorDates}
            onChange={({ fromDate: from, toDate: to }) => {
              setFromDate(from);
              setToDate(to);
            }}
            className="z-30 w-full sm:w-60"
          />
        </div>
        {role !== 'guest' && (
          <Button
            variant="brand"
            size="lg"
            shine
            onClick={() => setIsModalOpen(true)}
            className="self-start sm:self-auto shrink-0"
          >
            <Plus className="w-5 h-5" />
            Add Doctor
          </Button>
        )}
      </div>

      {filteredDoctors.length === 0 ? (
        // Two different empty states, not one generic. The audit (UI-P1-05)
        // calls out the older copy — "No doctors found. Add a doctor, or
        // adjust your search and date filters." — because the operator reads
        // that as either "the register is empty" or "my filters are too
        // tight" without any way to tell which. The action and the wording
        // now split by state, and the guest role never sees an "Add Doctor"
        // CTA it cannot trigger.
        <Card pad="none">
          {doctors.length === 0 && !searchTerm.trim() && !fromDate && !toDate ? (
            <EmptyState
              icon={<Users className="h-7 w-7" aria-hidden="true" />}
              title="No doctors registered yet"
              description="Add the physicians who refer patients here; the register will start showing their referrals."
              action={
                role !== 'guest' ? (
                  <Button
                    variant="brand"
                    onClick={() => {
                      setIsModalOpen(true);
                    }}
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    Add first doctor
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              icon={<Users className="h-7 w-7" aria-hidden="true" />}
              title="No doctor matches the current filters"
              description={`${doctors.length} doctor${doctors.length === 1 ? '' : 's'} in the register, none match this search or date range.`}
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchTerm('');
                    setFromDate('');
                    setToDate('');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          )}
        </Card>
      ) : (
        <>
          <Card pad="none" className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-surface-container-low/60 border-b border-outline-variant/40">
                    <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                      Doctor Name
                    </th>
                    <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                      Patients Referred
                    </th>
                    <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                      Referral Rate
                    </th>
                    {role !== 'guest' && (
                      <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant text-right">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40">
                  {filteredDoctors.map(docItem => {
                    const stats = getDoctorStats(docItem.name);
                    return (
                      <tr
                        key={docItem.id}
                        aria-selected={selectedDoctor?.id === docItem.id}
                        className={cn(
                          'cursor-pointer transition-colors hover:bg-surface-container-low',
                          selectedDoctor?.id === docItem.id &&
                            'bg-accent/8 ring-1 ring-inset ring-accent/40',
                        )}
                        onClick={() =>
                          setSelectedDoctor({
                            id: docItem.id,
                            name: docItem.name,
                            phone: docItem.phone,
                          })
                        }
                        onContextMenu={
                          role !== 'guest'
                            ? e => {
                                // Right-click on desktop mirrors the mobile long-press.
                                e.preventDefault();
                                openCommission(docItem);
                              }
                            : undefined
                        }
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent font-bold">
                              <Stethoscope className="w-5 h-5" />
                            </div>
                            <div>
                              <span className="font-semibold text-on-surface block">
                                {docItem.name}
                              </span>
                              <span className="text-xs text-on-surface-variant">
                                {docItem.phone}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold text-on-surface">
                          {stats.patientsCount}
                        </td>
                        <td className="px-6 py-4">
                          {docItem.referralPercent > 0 ? (
                            <StatusPill tone="info">{docItem.referralPercent}% of bill</StatusPill>
                          ) : (
                            <span className="text-xs text-on-surface-variant">none agreed</span>
                          )}
                        </td>
                        {role !== 'guest' && (
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-1">
                              {!docItem.isDefault && (
                                <>
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      openStatement(docItem);
                                    }}
                                    aria-label={`Monthly statement for ${docItem.name}`}
                                    title="Monthly referral statement"
                                    className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-accent/12 hover:text-accent"
                                  >
                                    <FileText className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      openEditForm(docItem);
                                    }}
                                    aria-label={`Edit ${docItem.name}`}
                                    className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-accent/12 hover:text-accent"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      setDoctorToDelete(docItem);
                                    }}
                                    aria-label={`Delete ${docItem.name}`}
                                    className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-error-container hover:text-error"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile inset list — staggered entrance. Same shape as the
              patient list: primary button for "open the referral sheet",
              sibling IconButtons for Edit / Delete. Nesting actions inside
              a row-sized `role="button"` wrapper (which this used to be)
              gave TalkBack one announcement instead of three and left
              Tab to walk through an interactive element inside another
              interactive element (UI-P0-04). */}
          <div className="md:hidden">
            <ListGroup>
              {filteredDoctors.map((docItem, dIdx) => {
                const stats = getDoctorStats(docItem.name);
                return (
                  <motion.div
                    key={docItem.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(dIdx * 0.045, 0.45), duration: 0.25 }}
                    className={cn(
                      'transition-colors',
                      selectedDoctor?.id === docItem.id && 'bg-accent/8',
                    )}
                  >
                    <ListRow
                      leading={
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/12 text-accent">
                          <Stethoscope className="w-5 h-5" />
                        </span>
                      }
                      title={docItem.name}
                      subtitle={`${stats.patientsCount} patient${stats.patientsCount === 1 ? '' : 's'} referred${docItem.referralPercent > 0 ? ` · ${docItem.referralPercent}%` : ''}${docItem.phone ? ` · ${docItem.phone}` : ''}`}
                      primaryLabel={`View ${docItem.name}'s referrals`}
                      onClick={() =>
                        setSelectedDoctor({
                          id: docItem.id,
                          name: docItem.name,
                          phone: docItem.phone,
                        })
                      }
                      onLongPress={role !== 'guest' ? () => openCommission(docItem) : undefined}
                      trailing={
                        role !== 'guest' && !docItem.isDefault ? (
                          <>
                            <IconButton
                              label={`Monthly statement for ${docItem.name}`}
                              size="sm"
                              className="text-on-surface-variant hover:bg-accent/12 hover:text-accent"
                              onClick={e => {
                                e.stopPropagation();
                                openStatement(docItem);
                              }}
                            >
                              <FileText className="w-4 h-4" />
                            </IconButton>
                            <IconButton
                              label={`Edit ${docItem.name}`}
                              size="sm"
                              className="text-on-surface-variant hover:bg-accent/12 hover:text-accent"
                              onClick={e => {
                                e.stopPropagation();
                                openEditForm(docItem);
                              }}
                            >
                              <Edit2 className="w-4 h-4" />
                            </IconButton>
                            <IconButton
                              label={`Delete ${docItem.name}`}
                              size="sm"
                              className="text-on-surface-variant hover:bg-error-container hover:text-error"
                              onClick={e => {
                                e.stopPropagation();
                                setDoctorToDelete(docItem);
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </IconButton>
                          </>
                        ) : undefined
                      }
                    />
                  </motion.div>
                );
              })}
            </ListGroup>
          </div>
        </>
      )}

      {/* Add / edit doctor sheet */}
      <Sheet
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          resetForm();
        }}
        title={editingDoctor ? 'Edit doctor' : 'Add doctor'}
        width="md"
        footer={
          <div className="flex gap-3">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => {
                setIsModalOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="doctor-form" variant="brand" size="lg" fullWidth>
              {editingDoctor ? 'Save Changes' : 'Add Doctor'}
            </Button>
          </div>
        }
      >
        <form id="doctor-form" onSubmit={handleSubmit} className="space-y-4 py-1">
          <Field label="Doctor Name" required>
            <TextInput
              required
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="Dr. Rahul Pande"
            />
          </Field>
          <Field label="Phone Number" hint="Optional">
            <TextInput
              type="tel"
              value={formData.phone}
              onChange={e => setFormData({ ...formData, phone: e.target.value })}
              placeholder="+91 98765 43210"
            />
          </Field>
          <Field label="Clinic / Chamber" hint="Optional — printed on the statement">
            <TextInput
              type="text"
              value={formData.clinic}
              onChange={e => setFormData({ ...formData, clinic: e.target.value })}
              placeholder="Kumar Diagnostics, Sector 12"
            />
          </Field>
          <Field
            label="Referral rate (%)"
            hint="Share of each referred patient's discounted bill credited to this doctor. Leave blank for none."
          >
            <TextInput
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={formData.referralPercent}
              onChange={e => setFormData({ ...formData, referralPercent: e.target.value })}
              placeholder="0"
              inputMode="decimal"
            />
          </Field>
        </form>
      </Sheet>

      {/* Quick commission editor — long-press (mobile) or right-click (desktop)
          a doctor row to set just the referral rate. */}
      <Sheet
        open={!!commissionDoctor}
        onClose={() => setCommissionDoctor(null)}
        title={commissionDoctor ? `Commission — ${commissionDoctor.name}` : 'Commission'}
        width="sm"
        footer={
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="lg"
              fullWidth
              onClick={() => setCommissionDoctor(null)}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              size="lg"
              fullWidth
              loading={commissionSaving}
              onClick={saveCommission}
            >
              Save rate
            </Button>
          </div>
        }
      >
        <div className="space-y-4 py-1">
          <Field
            label="Referral commission (%)"
            hint="Share of each referred patient's discounted bill credited to this doctor. Leave blank for none."
          >
            <TextInput
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={commissionValue}
              onChange={e => setCommissionValue(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              autoFocus
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {[0, 10, 20, 30, 50].map(preset => (
              <Button
                key={preset}
                type="button"
                variant={commissionValue === String(preset) ? 'brand' : 'outline'}
                size="sm"
                onClick={() => setCommissionValue(preset === 0 ? '' : String(preset))}
              >
                {preset}%
              </Button>
            ))}
          </div>
          <p className="text-xs text-on-surface-variant">
            {commissionDoctor?.isDefault
              ? 'This practitioner is a suggested name, not yet in the register. Saving a rate adds them to the register.'
              : 'Only the commission rate changes here — the rest of the doctor\u2019s details are untouched.'}
          </p>
        </div>
      </Sheet>

      <ConfirmSheet
        open={!!doctorToDelete}
        onClose={() => setDoctorToDelete(null)}
        title="Delete Doctor"
        message={`Are you sure you want to delete ${doctorToDelete?.name}? This action cannot be undone.`}
        onConfirm={async () => {
          if (!doctorToDelete) return;
          const path = 'doctors';
          try {
            await deleteDoc(doc(db, path, doctorToDelete.id));
            setDoctorToDelete(null);
          } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, path);
          }
        }}
      />

      {/* Month-end referral statement for one practitioner. */}
      <Sheet
        open={!!statementDoctor}
        onClose={() => {
          setStatementDoctor(null);
          setStatement(null);
          setSettledKey('');
        }}
        title={statementDoctor ? `Statement — ${statementDoctor.name}` : 'Statement'}
        width="lg"
        footer={
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="lg"
              disabled={printing || !statement}
              onClick={() => printStatement('preview')}
            >
              Preview PDF
            </Button>
            <Button
              variant="outline"
              size="lg"
              disabled={printing || !statement}
              onClick={() => printStatement('download')}
            >
              Save PDF
            </Button>
            <Button
              variant="brand"
              size="lg"
              loading={printing}
              disabled={!statement}
              onClick={() => printStatement('print')}
            >
              <FileText className="w-4 h-4" aria-hidden="true" />
              Print statement
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field
            label="Period"
            hint={
              statementMode === 'month'
                ? 'Bills are counted in the month they were raised.'
                : 'Bills are counted by the day they were raised, within the range.'
            }
          >
            <SegmentedControl
              id="statement-period-mode"
              aria-label="Statement period mode"
              size="sm"
              className="mb-2"
              value={statementMode}
              onChange={value => setStatementMode(value as 'month' | 'range')}
              items={[
                { value: 'month', label: 'Month' },
                { value: 'range', label: 'Custom range' },
              ]}
            />
            {statementMode === 'month' ? (
              <input
                type="month"
                value={statementMonth}
                onChange={e => setStatementMonth(e.target.value)}
                className="h-11 w-full rounded-xl border border-outline-variant/30 bg-surface-container px-3 text-sm text-on-surface focus:border-accent focus:outline-none"
              />
            ) : (
              <CalendarRangePicker
                fromDate={statementFrom}
                toDate={statementTo}
                onChange={({ fromDate: from, toDate: to }) => {
                  setStatementFrom(from);
                  setStatementTo(to);
                }}
              />
            )}
          </Field>

          {statementLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-on-surface-variant">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Reading bills for this period…
            </div>
          ) : !statement || statement.lines.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-7 w-7" aria-hidden="true" />}
              title="No referred bills in this period"
              description="Nothing was billed to patients carrying this doctor's name in the selected period."
            />
          ) : (
            <>
              <Card pad="sm">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <SummaryCell label="Bills" value={String(statement.totals.bills)} />
                  <SummaryCell label="Patients" value={String(statement.totals.patients)} />
                  <SummaryCell
                    label="Billed value"
                    value={formatMoney(statement.totals.billAmount)}
                  />
                  <SummaryCell label="Collected" value={formatMoney(statement.totals.collected)} />
                  <SummaryCell label="Rate applied" value={`${statement.percent}%`} />
                  <SummaryCell
                    label="Commission"
                    value={formatMoney(statement.totals.commission)}
                    emphasis
                  />
                </div>
              </Card>

              {statement.totals.commissionPending > 0 && (
                <p className="rounded-xl bg-warning-container/40 px-3 py-2 text-xs text-on-surface-variant">
                  {formatMoney(statement.totals.commissionPending)} of that is on bills still
                  uncollected. Pay it when the money comes in, not now.
                </p>
              )}
              {statement.unmatched && (
                <p className="rounded-xl bg-error-container/50 px-3 py-2 text-xs text-error">
                  This practitioner is not in the doctor register — the rate shown is the lab
                  default. Add them to the register to fix the rate per doctor.
                </p>
              )}

              <div className="overflow-x-auto rounded-2xl border border-outline-variant/30">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-container-low/60">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Bill</th>
                      <th className="px-3 py-2 font-semibold">Date</th>
                      <th className="px-3 py-2 font-semibold">Patient</th>
                      <th className="px-3 py-2 font-semibold">Tests</th>
                      <th className="px-3 py-2 text-right font-semibold">Bill value</th>
                      <th className="px-3 py-2 text-right font-semibold">Commission</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/40">
                    {statement.lines.map(line => (
                      <tr key={line.invoiceId}>
                        <td className="px-3 py-2 font-mono">{line.invoiceNo || '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {line.billedAt
                            ? new Date(line.billedAt).toLocaleDateString('en-IN')
                            : '—'}
                        </td>
                        <td className="px-3 py-2">{line.patientName}</td>
                        <td className="px-3 py-2">{line.tests.join(', ') || '—'}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(line.billAmount)}</td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {formatMoney(line.commission)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-on-surface-variant">
                Across the whole register in this period,{' '}
                {(() => {
                  const all = statementsSummary(
                    buildDoctorStatements(allInvoices, patients, { ...statementPeriod, doctors }),
                  );
                  return `${formatMoney(all.commission)} owed to ${all.doctors} practitioner${all.doctors === 1 ? '' : 's'} on ${all.bills} bills`;
                })()}
                .
              </p>
            </>
          )}
        </div>
      </Sheet>

      {/* Windows print sheet — desktop only, renders nothing elsewhere. */}
      <PrintDialog
        open={!!printJob}
        job={printJob}
        onClose={() => setPrintJob(null)}
        onPrinted={() => toast.success('Statement sent to the printer.')}
      />

      {/* Date-filtered referral profile for the selected doctor */}
      <DoctorDetailSheet
        key={selectedDoctor?.id ?? 'none'}
        doctor={selectedDoctor}
        patients={patients}
        doctors={doctors}
        initialFrom={fromDate}
        initialTo={toDate}
        onClose={() => setSelectedDoctor(null)}
        onRequestStatement={(from, to) => {
          if (selectedDoctor) openStatement(selectedDoctor, { from, to });
        }}
      />
    </div>
  );
}

function SummaryCell({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
        {label}
      </p>
      <p
        className={cn(
          'mt-0.5 tabular-nums',
          emphasis ? 'text-lg font-bold text-accent' : 'text-sm font-semibold text-on-surface',
        )}
      >
        {value}
      </p>
    </div>
  );
}
