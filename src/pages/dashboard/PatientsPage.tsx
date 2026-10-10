import React, { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import { motion } from 'motion/react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  where,
  getDocs,
  getDoc,
  setDoc,
  db,
} from '../../data/fs';
import { deletePatientCascade } from '../../lib/cascades';
import { useCollectionList, type ListFilter } from '../../hooks/useCollectionList';
import { createdAtRangeFilters } from '../../lib/date-range';
import { readPatients, type PatientRecord } from '../../lib/models';
import { downloadCsv, toCsv, type CsvColumn } from '../../lib/export-csv';
import { handleFirestoreError, OperationType } from '../../lib/firestore-errors';
import { Search, Plus, UserPlus, FileSpreadsheet, Loader2, Trash2, Edit2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { listStaggerProps } from '../../lib/motion';
import { useAuth } from '../../contexts/AuthContext';
import {
  Button,
  Card,
  IconButton,
  Sheet,
  ConfirmSheet,
  StatusPill,
  SearchField,
  Field,
  TextInput,
  TextArea,
  Select,
  ListGroup,
  ListRow,
  EmptyState,
  CalendarRangePicker,
  Skeleton,
  toIsoDay,
  useToast,
} from '../../components/ui';

import {
  getPathologyTests,
  getSearchableTests,
  searchPathologyTests,
} from '../../lib/pathology-tests';
import { DEFAULT_DOCTORS } from '../../lib/doctors';

/** Ceiling for how far a name search walks into older pages. */
const SEARCH_SCAN_CEILING = 250;

export default function PatientsPage({
  initialAction,
  clearAction,
}: {
  initialAction?: string | null;
  clearAction?: () => void;
}) {
  const { role, user } = useAuth();
  const toast = useToast();
  const [doctors, setDoctors] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<any>(null);

  useEffect(() => {
    if (initialAction === 'add') {
      setIsModalOpen(true);
      clearAction?.();
    }
  }, [initialAction, clearAction]);

  const [testSearchQuery, setTestSearchQuery] = useState('');
  const [isTestDropdownOpen, setIsTestDropdownOpen] = useState(false);
  const [testActiveIdx, setTestActiveIdx] = useState(0);
  const testListRef = useRef<HTMLDivElement>(null);
  const [isDoctorDropdownOpen, setIsDoctorDropdownOpen] = useState(false);
  const [isAddingDoctor, setIsAddingDoctor] = useState(false);
  const [patientToDelete, setPatientToDelete] = useState<any>(null);

  const [formData, setFormData] = useState({
    name: '',
    age: '',
    gender: 'male',
    phone: '',
    doctorName: '',
    address: '',
    testSelection: [] as string[],
  });

  // Registration range is evaluated by Firestore, so the page window already
  // holds what the filter asks for instead of filtering whatever was loaded.
  // The bounds are the local day's first and last millisecond — matching the
  // `toIsoDay` grouping the calendar dots use — not UTC midnight.
  const patientFilters = useMemo<ListFilter[]>(() => {
    const list: ListFilter[] = [];
    const { since, until } = createdAtRangeFilters(fromDate, toDate);
    if (since) list.push({ field: 'createdAt', op: '>=', value: since });
    if (until) list.push({ field: 'createdAt', op: '<=', value: until });
    return list;
  }, [fromDate, toDate]);

  // Live first page + cursor-loaded older pages, replacing the subscription that
  // used to keep every patient ever registered in memory.
  const patientsList = useCollectionList({
    path: 'patients',
    map: readPatients,
    pageSize: 25,
    filters: patientFilters,
    onError: error => handleFirestoreError(error, OperationType.GET, 'patients'),
  });
  const patients = patientsList.items;

  const activePatientDates = useMemo(() => {
    // Local day, matching the calendar grid the dots are painted into.
    return new Set(patients.filter(p => p.createdAt).map(p => toIsoDay(new Date(p.createdAt))));
  }, [patients]);

  useEffect(() => {
    const qDocs = query(collection(db, 'doctors'), orderBy('createdAt', 'desc'));
    const unsubDocs = onSnapshot(
      qDocs,
      snapshot => {
        setDoctors(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      },
      error => {
        handleFirestoreError(error, OperationType.GET, 'doctors');
      },
    );

    return () => {
      unsubDocs();
    };
  }, []);

  const addNewDoctor = async (name: string) => {
    if (!name.trim()) return;
    setIsAddingDoctor(true);
    try {
      await addDoc(collection(db, 'doctors'), {
        name: name.trim(),
        createdAt: new Date().toISOString(),
      });
      setFormData(prev => ({ ...prev, doctorName: name.trim() }));
      setIsDoctorDropdownOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'doctors');
    } finally {
      setIsAddingDoctor(false);
    }
  };

  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!formData.name.trim()) {
      setFormError('Patient Full Name is required.');
      return;
    }
    if (!formData.age) {
      setFormError('Patient Age is required.');
      return;
    }

    const path = 'patients';
    try {
      if (editingPatient) {
        await updateDoc(doc(db, path, editingPatient.id), {
          ...formData,
          age: parseInt(formData.age),
        });

        // Synchronize with related reports
        try {
          const reportsRef = collection(db, 'reports');
          const q = query(reportsRef, where('patientId', '==', editingPatient.id));
          const querySnapshot = await getDocs(q);

          for (const reportDoc of querySnapshot.docs) {
            const currentReport = reportDoc.data();
            try {
              // Offline: no signing, no QR mirror — just carry the updated test
              // selection onto the report and version the amendment.
              await updateDoc(doc(db, 'reports', reportDoc.id), {
                testSelection: formData.testSelection,
                version: (Number(currentReport.version) || 1) + 1,
                updatedBy: user?.uid || 'unknown',
                updatedAt: new Date().toISOString(),
              });
            } catch (reportSyncErr) {
              console.error('Failed to update report', reportDoc.id, reportSyncErr);
            }
          }
        } catch (syncErr) {
          console.error('Failed to sync reports: ', syncErr);
        }
      } else {
        // Patient ids are human-readable (YYMM + 3 digits = 1000 ids/month),
        // so collisions are likely at modest volumes. Blindly calling setDoc
        // with a colliding id would silently overwrite another patient's
        // record — probe first and retry with a fresh suffix.
        const d = new Date();
        const yy = d.getFullYear().toString().slice(-2);
        const mm = (d.getMonth() + 1).toString().padStart(2, '0');
        const chars = '0123456789';
        let patientId = '';
        for (let attempt = 0; attempt < 10; attempt++) {
          let randomPart = '';
          for (let i = 0; i < 3; i++) {
            randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
          }
          const candidate = `${yy}${mm}${randomPart}`;
          const existing = await getDoc(doc(db, path, candidate));
          if (!existing.exists()) {
            patientId = candidate;
            break;
          }
        }
        if (!patientId) {
          throw new Error(
            'Could not allocate a unique patient id (ID space nearly full for this month). Please try again.',
          );
        }

        await setDoc(doc(db, path, patientId), {
          ...formData,
          age: parseInt(formData.age),
          createdAt: new Date().toISOString(),
        });
      }
      setIsModalOpen(false);
      resetForm();
      toast.success(
        editingPatient ? `${formData.name}'s record updated.` : `${formData.name} registered.`,
      );
    } catch (err) {
      setFormError('Failed to save patient.');
      try {
        handleFirestoreError(err, OperationType.WRITE, path);
      } catch (e) {
        // Logged
      }
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      age: '',
      gender: 'male',
      phone: '',
      doctorName: '',
      address: '',
      testSelection: [],
    });
    setEditingPatient(null);
    setFormError('');
  };

  // Only the name can be matched client-side (Firestore has no substring
  // query), so an empty window must send the list walking into older pages
  // instead of reporting "no patients found" for someone who exists.
  const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase());
  const filteredPatients = useMemo(
    () => patients.filter(p => !deferredSearch || p.name.toLowerCase().includes(deferredSearch)),
    [patients, deferredSearch],
  );

  const searching = deferredSearch.length > 0 && filteredPatients.length === 0;
  const scanning = searching && patientsList.hasMore && patients.length < SEARCH_SCAN_CEILING;
  const scanCapped = searching && patientsList.hasMore && patients.length >= SEARCH_SCAN_CEILING;

  useEffect(() => {
    if (!scanning || patientsList.loadingMore) return;
    void patientsList.loadMore();
  }, [scanning, patientsList]);

  const CSV_COLUMNS: CsvColumn<PatientRecord>[] = [
    { label: 'Patient ID', value: p => p.id },
    { label: 'Name', value: p => p.name },
    { label: 'Age', value: p => p.age },
    { label: 'Gender', value: p => p.gender },
    { label: 'Phone', value: p => p.phone || '' },
    { label: 'Doctor', value: p => p.doctorName || '' },
    { label: 'Registered', value: p => p.createdAt },
  ];

  const exportFilteredCsv = async () => {
    if (filteredPatients.length === 0) {
      toast.warning('Nothing to export — widen the filter first.');
      return;
    }
    try {
      const message = await downloadCsv(
        `pathlab-patients-${toIsoDay(new Date())}.csv`,
        toCsv(CSV_COLUMNS, filteredPatients),
      );
      toast.success(message ?? `Exported ${filteredPatients.length} patients to CSV.`);
    } catch (err) {
      console.error('Error writing the CSV export:', err);
      toast.error('Could not write the CSV on this device.');
    }
  };

  const filteredAvailableTests = useMemo(
    () =>
      searchPathologyTests(
        testSearchQuery,
        getSearchableTests(formData.testSelection, testSearchQuery),
      ),
    [formData.testSelection, testSearchQuery],
  );
  // Clamp where it is read so narrowing the list can never strand the highlight
  // past the end — avoids a reset-in-effect (which would cascade a render).
  const activeTestIdx = filteredAvailableTests.length
    ? Math.min(testActiveIdx, filteredAvailableTests.length - 1)
    : 0;

  // Arrow-key navigation must keep the highlighted test visible.
  useEffect(() => {
    if (!isTestDropdownOpen) return;
    const el = testListRef.current?.children[activeTestIdx] as HTMLElement | undefined;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [activeTestIdx, isTestDropdownOpen]);

  const handleTestKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isTestDropdownOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIsTestDropdownOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      setIsTestDropdownOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setTestActiveIdx(Math.min(activeTestIdx + 1, filteredAvailableTests.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setTestActiveIdx(Math.max(activeTestIdx - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      const picked = filteredAvailableTests[activeTestIdx];
      if (picked) {
        e.preventDefault();
        addTest(picked.name);
      }
    }
  };

  const addTest = (test: string) => {
    const testInfo = getPathologyTests().find(t => t.name === test);
    let testsToAdd = [test];
    if (testInfo?.isGroup && testInfo.includedTests) {
      testsToAdd = [test, ...testInfo.includedTests];
    }

    // Auto-add Direct and Indirect Bilirubin when Total Serum Bilirubin is selected
    if (test === 'Total Serum Bilirubin') {
      testsToAdd = ['Total Serum Bilirubin', 'Direct Bilirubin', 'Indirect Bilirubin'];
    }

    setFormData(prev => {
      const newAdditions = testsToAdd.filter(t => !prev.testSelection.includes(t));
      return {
        ...prev,
        testSelection: [...prev.testSelection, ...newAdditions],
      };
    });
    setTestSearchQuery('');
    setIsTestDropdownOpen(false);
  };

  const removeTest = (test: string) => {
    const testInfo = getPathologyTests().find(t => t.name === test);
    let toRemove = [test];
    if (testInfo?.isGroup && testInfo.includedTests) {
      toRemove = [...toRemove, ...testInfo.includedTests];
    }
    setFormData(prev => ({
      ...prev,
      testSelection: prev.testSelection.filter(t => !toRemove.includes(t)),
    }));
  };

  const allDoctors = React.useMemo(() => {
    const uniqueDynamic = doctors.filter(
      d => !DEFAULT_DOCTORS.some(defaultName => defaultName.toLowerCase() === d.name.toLowerCase()),
    );
    return [...DEFAULT_DOCTORS.map(name => ({ id: `default_${name}`, name })), ...uniqueDynamic];
  }, [doctors]);

  const filteredDoctorsDropdown = allDoctors.filter(d =>
    d.name.toLowerCase().includes(formData.doctorName.toLowerCase()),
  );

  const showAddDoctorButton =
    formData.doctorName.trim().length > 0 &&
    !allDoctors.some(d => d.name.toLowerCase() === formData.doctorName.trim().toLowerCase());

  const openEditForm = (patient: any) => {
    setEditingPatient(patient);
    setFormData({
      name: patient.name || '',
      age: patient.age ? patient.age.toString() : '',
      gender: patient.gender || 'male',
      phone: patient.phone || '',
      doctorName: patient.doctorName || '',
      address: patient.address || '',
      testSelection: patient.testSelection || [],
    });
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div className="flex flex-col sm:flex-row flex-1 max-w-lg items-stretch gap-2">
          <SearchField
            className="flex-1"
            placeholder="Search patients by name..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onClear={() => setSearchTerm('')}
            aria-label="Search patients by name"
          />

          <CalendarRangePicker
            fromDate={fromDate}
            toDate={toDate}
            activeDates={activePatientDates}
            onChange={({ fromDate: from, toDate: to }) => {
              setFromDate(from);
              setToDate(to);
            }}
            className="z-30 w-full sm:w-60"
          />
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          <Button variant="outline" size="sm" onClick={exportFilteredCsv}>
            <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" />
            Export CSV
          </Button>
          {role !== 'guest' && (
            <Button variant="brand" size="lg" shine onClick={() => setIsModalOpen(true)}>
              <UserPlus className="w-5 h-5" />
              Register Patient
            </Button>
          )}
        </div>
      </div>

      {patientsList.loading && (
        <Card pad="none">
          <div className="p-6 space-y-4" aria-busy="true" aria-label="Loading patients">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </Card>
      )}

      {scanning && (
        <p
          role="status"
          className="flex items-center justify-center gap-2 py-4 text-sm font-semibold text-on-surface-variant"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Searching older records…
        </p>
      )}

      {!patientsList.loading && !scanning && filteredPatients.length === 0 ? (
        <Card pad="none">
          <EmptyState
            icon={<UserPlus className="h-7 w-7" />}
            title={deferredSearch ? `No patient matches “${searchTerm.trim()}”` : 'No patients yet'}
            description={
              deferredSearch
                ? 'Nothing matched in the loaded records. Clear the filter, or widen the registration range.'
                : 'Register your first patient to start issuing reports.'
            }
            action={
              deferredSearch ? (
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
              ) : undefined
            }
          />
        </Card>
      ) : filteredPatients.length > 0 ? (
        <>
          <Card pad="none" className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-surface-container-low/60 border-b border-outline-variant/40">
                    <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                      Name
                    </th>
                    <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                      Age / Gender
                    </th>
                    <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                      Registered
                    </th>
                    <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40">
                  {filteredPatients.map((patient, idx) => (
                    <motion.tr
                      key={patient.id}
                      {...listStaggerProps(idx)}
                      className={cn(
                        'transition-colors',
                        role !== 'guest' && 'hover:bg-surface-container-low cursor-pointer',
                      )}
                      onClick={() => {
                        if (role === 'guest') return;
                        openEditForm(patient);
                      }}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent font-bold">
                            {patient.name[0]}
                          </div>
                          <span className="font-semibold text-on-surface">{patient.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <StatusPill tone="neutral">{patient.age}y</StatusPill>
                          <StatusPill tone="accent" className="capitalize">
                            {patient.gender}
                          </StatusPill>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-on-surface-variant">
                        {new Date(patient.createdAt).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1">
                          {role !== 'guest' && (
                            <>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  openEditForm(patient);
                                }}
                                aria-label={`Edit ${patient.name}`}
                                className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-accent/12 hover:text-accent"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  setPatientToDelete(patient);
                                }}
                                aria-label={`Delete ${patient.name}`}
                                className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-error-container hover:text-error"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile inset list — edit/delete actions, staggered entrance */}
          <div className="md:hidden">
            <ListGroup>
              {filteredPatients.map((patient, pIdx) => (
                <motion.div key={patient.id} {...listStaggerProps(pIdx)}>
                  <ListRow
                    leading={
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/12 text-[15px] font-bold text-accent">
                        {patient.name[0]}
                      </span>
                    }
                    title={patient.name}
                    subtitle={`${patient.age}y · ${patient.gender} · ${new Date(patient.createdAt).toLocaleDateString('en-IN')}`}
                    trailing={
                      role !== 'guest' ? (
                        <>
                          <IconButton
                            label={`Edit ${patient.name}`}
                            size="sm"
                            className="text-on-surface-variant hover:bg-accent/12 hover:text-accent"
                            onClick={() => openEditForm(patient)}
                          >
                            <Edit2 className="w-4 h-4" />
                          </IconButton>
                          <IconButton
                            label={`Delete ${patient.name}`}
                            size="sm"
                            className="text-on-surface-variant hover:bg-error-container hover:text-error"
                            onClick={() => setPatientToDelete(patient)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </IconButton>
                        </>
                      ) : undefined
                    }
                  />
                </motion.div>
              ))}
            </ListGroup>
          </div>
        </>
      ) : null}

      {/* Older pages are fetched on demand; the live subscription only keeps the
          newest window so the table cannot grow without bound. */}
      {!patientsList.loading && patientsList.hasMore && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="outline"
            loading={patientsList.loadingMore}
            onClick={() => void patientsList.loadMore()}
          >
            {deferredSearch ? 'Keep searching older records' : 'Load older records'}
          </Button>
          <span className="text-xs text-on-surface-variant">
            {patients.length} patients loaded in this session
          </span>
        </div>
      )}

      {scanCapped && (
        <p role="status" className="text-center text-xs font-semibold text-warning">
          Scan stopped after {patients.length} records — a name search only walks so far. Narrow the
          registration range to search deeper history.
        </p>
      )}

      {/* Register / edit patient sheet */}
      <Sheet
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          resetForm();
        }}
        title={editingPatient ? 'Edit patient' : 'Register patient'}
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
            <Button type="submit" form="patient-form" variant="brand" size="lg" fullWidth>
              {editingPatient ? 'Save Changes' : 'Register'}
            </Button>
          </div>
        }
      >
        <form id="patient-form" onSubmit={handleSubmit} className="space-y-4 py-1">
          {formError && (
            <div
              role="alert"
              className="rounded-xl bg-error-container px-4 py-3 text-sm font-semibold text-on-error-container"
            >
              {formError}
            </div>
          )}
          <Field label="Full Name" required>
            <TextInput
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="Patient Name"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Age" required>
              <TextInput
                type="number"
                inputMode="numeric"
                value={formData.age}
                onChange={e => setFormData({ ...formData, age: e.target.value })}
                placeholder="Age"
              />
            </Field>
            <Field label="Gender">
              <Select
                value={formData.gender}
                onChange={e => setFormData({ ...formData, gender: e.target.value })}
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </Select>
            </Field>
          </div>

          <Field label="Referred By (Doctor Name)">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
              <TextInput
                type="text"
                value={formData.doctorName}
                onChange={e => {
                  setFormData({ ...formData, doctorName: e.target.value });
                  setIsDoctorDropdownOpen(true);
                }}
                onFocus={() => setIsDoctorDropdownOpen(true)}
                onBlur={() => setTimeout(() => setIsDoctorDropdownOpen(false), 200)}
                className="pl-10"
                placeholder="Search or add doctor (e.g. Dr. Rahul Pande)"
              />

              {isDoctorDropdownOpen && (
                <div className="absolute z-50 w-full mt-1 bg-surface-container-lowest border border-[var(--elevated-border)] rounded-2xl shadow-float max-h-48 overflow-y-auto top-full left-0">
                  {filteredDoctorsDropdown.length > 0
                    ? filteredDoctorsDropdown.map(docItem => (
                        <button
                          key={docItem.id}
                          type="button"
                          onMouseDown={e => {
                            e.preventDefault();
                            setFormData({ ...formData, doctorName: docItem.name });
                            setIsDoctorDropdownOpen(false);
                          }}
                          className="w-full text-left px-4 py-3 text-sm font-medium text-on-surface hover:bg-surface-container-low transition-colors border-b border-outline-variant/40 last:border-0"
                        >
                          {docItem.name}
                        </button>
                      ))
                    : !showAddDoctorButton && (
                        <div className="px-4 py-3 text-sm text-on-surface-variant text-center border-b border-outline-variant/40 last:border-0">
                          No matching doctors found.
                        </div>
                      )}

                  {showAddDoctorButton && (
                    <button
                      type="button"
                      onMouseDown={e => {
                        e.preventDefault();
                        addNewDoctor(formData.doctorName);
                      }}
                      disabled={isAddingDoctor}
                      className="w-full text-left px-4 py-3 text-sm font-bold text-accent hover:bg-accent/12 transition-colors flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      {isAddingDoctor ? 'Adding...' : `Add "${formData.doctorName}" as new doctor`}
                    </button>
                  )}
                </div>
              )}
            </div>
          </Field>
          <Field label="Address">
            <TextArea
              value={formData.address}
              onChange={e => setFormData({ ...formData, address: e.target.value })}
              placeholder="Patient Address"
            />
          </Field>
          <Field label="Test Selection">
            <div className="space-y-2">
              {formData.testSelection.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {formData.testSelection.map(test => (
                    <span
                      key={test}
                      className="flex items-center gap-1.5 rounded-full bg-accent/12 px-3 py-1 text-xs font-semibold text-accent"
                    >
                      {test}
                      <button
                        type="button"
                        onClick={() => removeTest(test)}
                        aria-label={`Remove ${test}`}
                        className="rounded-full p-0.5 transition-colors hover:bg-error-container hover:text-error"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="relative">
                <SearchField
                  role="combobox"
                  aria-expanded={isTestDropdownOpen}
                  aria-controls="patient-test-listbox"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    isTestDropdownOpen && filteredAvailableTests[activeTestIdx]
                      ? `patient-test-opt-${activeTestIdx}`
                      : undefined
                  }
                  value={testSearchQuery}
                  onChange={e => {
                    setTestSearchQuery(e.target.value);
                    setTestActiveIdx(0);
                    setIsTestDropdownOpen(true);
                  }}
                  onFocus={() => setIsTestDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setIsTestDropdownOpen(false), 150)}
                  onClear={() => setTestSearchQuery('')}
                  onKeyDown={handleTestKeyDown}
                  placeholder="Search and add tests..."
                  aria-label="Search and add tests"
                />

                {isTestDropdownOpen && (
                  <div
                    ref={testListRef}
                    id="patient-test-listbox"
                    role="listbox"
                    aria-label="Available tests"
                    className="absolute z-50 w-full mt-1 bg-surface-container-lowest border border-[var(--elevated-border)] rounded-2xl shadow-float max-h-48 overflow-y-auto top-full left-0"
                  >
                    {filteredAvailableTests.length > 0 ? (
                      filteredAvailableTests.map((test, idx) => (
                        <button
                          key={test.id}
                          id={`patient-test-opt-${idx}`}
                          role="option"
                          aria-selected={idx === activeTestIdx}
                          type="button"
                          onMouseDown={e => {
                            e.preventDefault();
                            addTest(test.name);
                          }}
                          onMouseEnter={() => setTestActiveIdx(idx)}
                          className={cn(
                            'w-full text-left px-4 py-3 text-sm font-medium transition-colors border-b border-outline-variant/40 last:border-0',
                            idx === activeTestIdx
                              ? 'bg-surface-container-low text-on-surface'
                              : 'text-on-surface hover:bg-surface-container-low',
                          )}
                        >
                          {test.name}
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-on-surface-variant text-center border-b border-outline-variant/40 last:border-0">
                        No unselected tests found.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Field>
        </form>
      </Sheet>

      <ConfirmSheet
        open={!!patientToDelete}
        onClose={() => setPatientToDelete(null)}
        title="Delete Patient"
        message={`Are you sure you want to delete ${patientToDelete?.name}? This action cannot be undone.`}
        onConfirm={async () => {
          if (!patientToDelete) return;
          const path = 'patients';
          try {
            const patientId = patientToDelete.id;

            // Removes the patient together with their reports, public mirrors,
            // staff notes and invoices in committed batches, so a partial
            // failure cannot leave orphaned records behind.
            await deletePatientCascade(patientId);

            setPatientToDelete(null);
            toast.success(`${patientToDelete.name} and their records removed.`);
          } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, path);
            toast.error('Delete failed — nothing was removed.');
          }
        }}
      />
    </div>
  );
}
