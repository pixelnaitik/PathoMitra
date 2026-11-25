import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  writeBatch,
  db,
} from '../../data/fs';
import { deleteReportCascade } from '../../lib/cascades';
import { useCollectionList, type ListFilter } from '../../hooks/useCollectionList';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { handleFirestoreError, OperationType } from '../../lib/firestore-errors';
import { captureError } from '../../lib/telemetry';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../lib/permissions';
import {
  FilePlus,
  FileText,
  Search,
  FileSpreadsheet,
  FileSignature,
  Printer,
  Download,
  ShieldCheck,
  X,
  Plus,
  // Per-status card icon: the check-circle used to sit on every report (draft
  // or issued) and read as a success mark regardless of state. The state model
  // in lib/report-status maps each view status to its own glyph.
  Send,
  GitCompare,
  FileClock,
  AlertCircle,
  Info,
  Loader2,
  Trash2,
  MoreVertical,
  Share2,
  Eye,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { reportStatusView, ISSUE_REPORT_LABEL, SAVE_DRAFT_LABEL } from '../../lib/report-status';
import {
  CalendarRangePicker,
  Card,
  Combobox,
  EmptyState,
  SearchField,
  Sheet,
  ConfirmSheet,
  Button,
  Field,
  Skeleton,
  StatusPill,
  TextInput,
  toIsoDay,
  useToast,
} from '../../components/ui';

import {
  getSearchableTests,
  resolveReferenceRange,
  findTestInfo,
  searchPathologyTests,
  isNumericTest,
  expandTestSelection,
  type PathologyTest,
} from '../../lib/pathology-tests';
import { recalculateCBC } from '../../lib/report-calculations';
import { DEFAULT_SETTINGS, readSettings } from '../../lib/settings';
import { countPageUnits, estimatePrintedPages, resolveReportLayout } from '../../lib/report-layout';
import { buildReportDocument } from '../../lib/report-pdf';
import {
  buildReportLegalLines,
  resolveSigner,
  type ReportLegalInput,
} from '../../lib/report-compliance';
import { pdfToBase64, printPdf, previewPdf, savePdf, sharePdf } from '../../lib/native-print';
import { getShellKind, hasShellOutput } from '../../lib/native-files';
import { FILE_CHANNEL_ID, showBannerWithPermission } from '../../lib/desktop-notifications';
import { ReportViewerDashboard } from '../../components/ReportViewerDashboard';
import { PrintDialog, type PrintJob } from '../../components/PrintDialog';
import { ReportResultsEditor } from '../../components/ReportResultsEditor';
import { createdAtRangeFilters } from '../../lib/date-range';
import { generateDefaultTemplateImage } from '../../lib/default-template';
import {
  readReports,
  readReport,
  readPatients,
  ageAsNumber,
  normalizeReportStatus,
  operatorStamp,
  type PatientRecord,
  type ReportRecord,
  type ReportStatus,
} from '../../lib/models';
import {
  findMissingResults,
  planReportWrite,
  type StoredReport,
  type ReportWriteOp,
} from '../../lib/report-workflow';
import { downloadCsv, toCsv } from '../../lib/export-csv';
import { normalisePhone } from '../../lib/patient-registry';
import { buildReportIssuanceSnapshot } from '../../lib/report-snapshot';
import { signReportIssuance } from '../../lib/report-signing';
import { createOrderWithSamples, createSamplesForOrder } from '../../lib/clinical-workflow';
import { listOperatorProfiles, type OperatorIdentity } from '../../lib/operator-accounts';
import { generateId } from '../../data/query';
import { getRepository } from '../../data';
import type { DataRepository } from '../../data/types';
import { validateReportResults } from '../../lib/result-validation';
import {
  clearReportDraft,
  loadReportDraft,
  saveReportDraft,
  type ReportDraftAutosave,
} from '../../lib/report-drafts';

/** A report plus the staff-only note hydrated from `reportNotes`. */
type SelectedReport = ReportRecord & { privateNotes?: string };

/** One card in the mixed grid: an existing report, or a patient still waiting for one. */
type ListEntry =
  | (ReportRecord & { itemType: 'report'; timestamp: string })
  | (PatientRecord & { itemType: 'patient'; timestamp: string });

/**
 * `resultData` is validated loosely at the boundary (legacy documents hold
 * numbers, blanks and the occasional object), while the derived-value math works
 * on strings only. Coerce once here instead of at every keystroke.
 */
const asResultMap = (data: Record<string, unknown> | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(data ?? {}).map(([key, value]) => [key, String(value ?? '')]));

const reportBaseOf = (report: ReportRecord): StoredReport => ({
  id: report.id,
  orderId: report.orderId,
  sampleIds: report.sampleIds,
  patientId: report.patientId,
  patientName: report.patientName,
  resultData: report.resultData,
  signature: report.signature,
  createdAt: report.createdAt,
  createdBy: report.createdBy,
  testType: report.testType,
  testSelection: report.testSelection ?? [],
  issuanceSnapshot: report.issuanceSnapshot,
  criticalReview: report.criticalReview,
  deltaReview: report.deltaReview,
  status: report.status,
  version: report.version,
  updatedAt: report.updatedAt,
});

const sameReportRevision = (a: StoredReport, b: StoredReport): boolean =>
  a.id === b.id &&
  (a.version ?? 1) === (b.version ?? 1) &&
  (a.updatedAt ?? '') === (b.updatedAt ?? '');

const resolvedRangeFor = (name: string, patient?: PatientRecord) => {
  const info = findTestInfo(name);
  return patient
    ? resolveReferenceRange(info?.ranges, ageAsNumber(patient), patient.gender).values
    : undefined;
};

const isDeltaWarning = (message: string) => message.includes('changed materially');

async function loadPreviousIssuedReport(
  patientId: string,
  excludeReportId?: string,
  before?: string,
): Promise<ReportRecord | null> {
  if (!patientId) return null;
  const rows = await getRepository().list('reports', {
    where: [
      { field: 'patientId', op: '==', value: patientId },
      { field: 'status', op: '==', value: 'final' },
    ],
    orderBy: 'createdAt',
    direction: 'desc',
    limit: 50,
  });
  for (const row of rows) {
    const report = readReport(row.id, row.data());
    if (report.id === excludeReportId) continue;
    if (before && report.createdAt >= before) continue;
    return report;
  }
  return null;
}

/** Older forms saved names with stray padding; announcements must not repeat it. */
const spokenName = (name: string | undefined) => (name || '').trim() || 'this report';

/**
 * The desktop results table: one column plan shared by the header row and every
 * entry row, which is the only reason the columns line up across a 27-member
 * profile. Test | Reference | Result | Unit | remove.
 */
const COMPOSER_COLS =
  'grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.15fr)_minmax(0,1.25fr)_5.5rem_2.25rem] items-center gap-3';

/** Same field the stacked card draws, sized for its own column. */
const COMPOSER_INPUT =
  'test-result-input w-full min-w-0 px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/30 rounded-lg focus:border-accent focus:outline-none transition font-bold text-primary';

/** `lg` in Tailwind's scale — the edge where a 5-column table has room to breathe. */
const COMPOSER_WIDE_MQ = '(min-width: 1024px)';

export default function ReportsPage({
  initialReportId,
  clearAction,
  initialCreateReportPatientId,
  clearCreateAction,
}: {
  initialReportId?: string | null;
  clearAction?: () => void;
  initialCreateReportPatientId?: string | null;
  clearCreateAction?: () => void;
}) {
  const { user, role } = useAuth();
  const toast = useToast();
  /** A PC gets the aligned entry table; a phone keeps its stacked cards. */
  const isWideComposer = useMediaQuery(COMPOSER_WIDE_MQ);
  const canEdit = can(role, 'enterResults');
  const canIssue = can(role, 'issueReports');
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<SelectedReport | null>(null);
  const [editorBase, setEditorBase] = useState<StoredReport | null>(null);
  const [previousReport, setPreviousReport] = useState<ReportRecord | null>(null);
  const [recoveredDraft, setRecoveredDraft] = useState<ReportDraftAutosave | null>(null);
  const [draftSaveState, setDraftSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [draftSavedAt, setDraftSavedAt] = useState('');
  const selectedValidation = useMemo(
    () =>
      selectedReport
        ? validateReportResults(
            expandTestSelection(selectedReport.testSelection ?? []),
            selectedReport.resultData,
            findTestInfo,
            undefined,
            name =>
              resolvedRangeFor(
                name,
                patients.find(patient => patient.id === selectedReport.patientId),
              ),
            previousReport?.resultData,
          )
        : null,
    [selectedReport, patients, previousReport],
  );
  // The read-only viewing dashboard: card taps and Preview land here, while the
  // editable Report Details sheet is reached through Edit / Finish draft.
  const [viewerReport, setViewerReport] = useState<ReportRecord | null>(null);
  /** The Windows print sheet's document — set by the Print action, cleared on close. */
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [reportToDelete, setReportToDelete] = useState<ReportRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingResults, setSavingResults] = useState(false);
  // P0.4: an edit to an already-issued report must carry an amendment reason, so
  // the change is attributable. Kept in state (not just the function argument)
  // so an inline field-level error can name it without discarding typed values.
  const [amendReason, setAmendReason] = useState('');
  const [criticalReviewReason, setCriticalReviewReason] = useState('');
  const [deltaReviewReason, setDeltaReviewReason] = useState('');
  const [composerPreviousReport, setComposerPreviousReport] = useState<ReportRecord | null>(null);
  const previousReportRequest = useRef(0);
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerUid, setReviewerUid] = useState('');
  const [reviewers, setReviewers] = useState<OperatorIdentity[]>([]);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listOperatorProfiles()
      .then(profiles => {
        if (active)
          setReviewers(
            profiles.filter(
              profile =>
                profile.role === 'pathologist' && !profile.disabled && profile.uid !== user?.uid,
            ),
          );
      })
      .catch(() => {
        if (active) setReviewers([]);
      });
    return () => {
      active = false;
    };
  }, [user?.uid]);

  // Row menus: dismiss on any outside click or Escape, and only while a menu is
  // actually open — the listener used to run for the whole life of the page.
  useEffect(() => {
    if (!activeMenuId) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      setActiveMenuId(null);
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', close);
    };
  }, [activeMenuId]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (e.target instanceof HTMLSelectElement) {
        if (e.key === 'Enter') {
          e.preventDefault();
          const inputs = Array.from(
            document.querySelectorAll('.test-result-input'),
          ) as HTMLElement[];
          const currentIndex = inputs.indexOf(e.target as HTMLElement);
          if (currentIndex !== -1 && currentIndex + 1 < inputs.length) {
            inputs[currentIndex + 1].focus();
          }
        }
        return;
      }

      const inputs = Array.from(document.querySelectorAll('.test-result-input')) as HTMLElement[];
      const currentIndex = inputs.indexOf(e.target as HTMLElement);
      if (currentIndex !== -1) {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          const nextInput = inputs[currentIndex + 1];
          if (nextInput) nextInput.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prevInput = inputs[currentIndex - 1];
          if (prevInput) prevInput.focus();
        }
      }
    }
  };

  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [isPatientDropdownOpen, setIsPatientDropdownOpen] = useState(false);
  const [testSearchQuery, setTestSearchQuery] = useState('');
  const [isTestDropdownOpen, setIsTestDropdownOpen] = useState(false);
  const [testActiveIdx, setTestActiveIdx] = useState(0);
  const testListRef = useRef<HTMLDivElement>(null);

  const [newReport, setNewReport] = useState({
    patientId: '',
    testSelection: [] as string[],
    results: {} as Record<string, string>,
  });
  const [newCriticalReviewReason, setNewCriticalReviewReason] = useState('');
  const [newDeltaReviewReason, setNewDeltaReviewReason] = useState('');
  const [newReviewerName, setNewReviewerName] = useState('');
  const [newReviewerUid, setNewReviewerUid] = useState('');

  // How many ordered tests (panels expanded to members) are still blank. Purely
  // advisory since 2026-10-15: the composer shows the count so the operator knows
  // which lines will print empty, but issuing is never blocked by it. Computed
  // from `findMissingResults` — the same source the note describes.
  const composerMissing = useMemo(() => {
    if (!isModalOpen || newReport.testSelection.length === 0) return [];
    return findMissingResults(
      {
        patientId: newReport.patientId,
        patientName: '',
        resultData: newReport.results,
        signature: '',
        createdAt: '',
        createdBy: '',
        testSelection: newReport.testSelection,
      },
      expandTestSelection,
    );
  }, [isModalOpen, newReport.patientId, newReport.testSelection, newReport.results]);

  const composerTotal = useMemo(
    () => (isModalOpen ? expandTestSelection(newReport.testSelection).length : 0),
    [isModalOpen, newReport.testSelection],
  );
  const composerValidation = useMemo(
    () =>
      validateReportResults(
        expandTestSelection(newReport.testSelection),
        newReport.results,
        findTestInfo,
        undefined,
        name =>
          resolvedRangeFor(
            name,
            patients.find(patient => patient.id === newReport.patientId),
          ),
        composerPreviousReport?.resultData,
      ),
    [
      newReport.results,
      newReport.testSelection,
      newReport.patientId,
      patients,
      composerPreviousReport,
    ],
  );

  useEffect(() => {
    let active = true;
    setComposerPreviousReport(null);
    setNewDeltaReviewReason('');
    if (!newReport.patientId)
      return () => {
        active = false;
      };
    void loadPreviousIssuedReport(newReport.patientId)
      .then(report => {
        if (active) setComposerPreviousReport(report);
      })
      .catch(() => {
        if (active) setComposerPreviousReport(null);
      });
    return () => {
      active = false;
    };
  }, [newReport.patientId]);

  /**
   * Approximate page count for the report about to be issued.
   *
   * A lab that prints one sheet per patient finds out here rather than at the
   * printer, which is the only place the mistake used to surface. It is an
   * estimate on purpose — the truth is whatever `buildReportDocument` returns,
   * and after issuing the operator is told the real number. This line never
   * gates anything.
   */
  const composerPages = useMemo(() => {
    if (!isModalOpen || composerTotal === 0) return 1;
    const layout = resolveReportLayout(readSettings());
    const groupRows = newReport.testSelection.filter(name => findTestInfo(name)?.isGroup).length;
    // Rows per category — that is what decides the sheet breaks, because a big
    // package (a CBC, a full urine analysis) takes a sheet to itself and every
    // smaller section shares the one sheet after the packages. Without this the
    // hint promises one page for a CBC plus a urine analysis that prints on two.
    const rowsByCategory = new Map<string, number>();
    newReport.testSelection.forEach(name => {
      const info = findTestInfo(name);
      if (info?.isHeader) return;
      const category = info?.category || 'GENERAL';
      rowsByCategory.set(category, (rowsByCategory.get(category) ?? 0) + 1);
    });
    return estimatePrintedPages(layout, {
      bodyRows: composerTotal,
      bandRows: rowsByCategory.size + groupRows,
      units: countPageUnits([...rowsByCategory.values()]),
    });
  }, [isModalOpen, composerTotal, newReport.testSelection]);

  const filteredAvailableTests = useMemo(
    () =>
      searchPathologyTests(
        testSearchQuery,
        getSearchableTests(newReport.testSelection, testSearchQuery),
      ),
    [newReport.testSelection, testSearchQuery],
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

  const addReportTest = (test: PathologyTest) => {
    let testsToAdd = [test.name];
    if (test.isGroup && test.includedTests) testsToAdd = [test.name, ...test.includedTests];
    const newAdditions = testsToAdd.filter(t => !newReport.testSelection.includes(t));
    if (newAdditions.length > 0) {
      setNewReport({
        ...newReport,
        testSelection: [...newReport.testSelection, ...newAdditions],
      });
    }
    setTestSearchQuery('');
    setIsTestDropdownOpen(false);
  };

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
        addReportTest(picked);
      }
    }
  };

  // Date bounds go to Firestore, so filtering narrows what is *read* instead of
  // narrowing whatever happens to be loaded. `createdAt` is a full ISO string,
  // and the picker selects a *local* calendar day — the same day the calendar
  // dots are grouped by — so the bounds come from lib/date-range rather than a
  // hand-padded `${day}T00:00:00.000Z`, which silently means UTC midnight and
  // would drop early-morning reports into the previous day.
  const reportFilters = useMemo<ListFilter[]>(() => {
    const list: ListFilter[] = [];
    const { since, until } = createdAtRangeFilters(fromDate, toDate);
    if (since) list.push({ field: 'createdAt', op: '>=', value: since });
    if (until) list.push({ field: 'createdAt', op: '<=', value: until });
    return list;
  }, [fromDate, toDate]);

  // Live, cursor-paginated window over `reports`. This used to subscribe to the
  // entire collection, so every edit anywhere in the lab re-read every report
  // ever created. `map: readReports` also validates each document at the
  // boundary instead of letting a malformed one surface mid-render.
  const reportsList = useCollectionList<ReportRecord>({
    path: 'reports',
    map: readReports,
    pageSize: 25,
    filters: reportFilters,
    onError: error => handleFirestoreError(error, OperationType.GET, 'reports'),
  });
  const reports = reportsList.items;

  useEffect(() => {
    if (!initialReportId) return;
    let active = true;
    void getDoc(doc(db, 'reports', initialReportId))
      .then(snapshot => {
        if (!active || !snapshot.exists()) return;
        setViewerReport(readReport(snapshot.id, snapshot.data()));
        clearAction?.();
      })
      .catch(error => handleFirestoreError(error, OperationType.GET, 'reports'));
    return () => {
      active = false;
    };
  }, [initialReportId, clearAction]);

  // Private notes live in the staff-only reportNotes collection; hydrate the
  // selected report with its note when opened. Guests cannot read that
  // collection, so asking only produces a permission error in the console.
  useEffect(() => {
    const reportId = selectedReport?.id;
    if (!reportId || !canEdit) return;
    let cancelled = false;
    getDoc(doc(db, 'reportNotes', reportId))
      .then(noteDoc => {
        if (cancelled || !noteDoc.exists()) return;
        const note = noteDoc.data().note || '';
        setSelectedReport((current: any) =>
          current && current.id === reportId ? { ...current, privateNotes: note } : current,
        );
      })
      .catch(error => captureError(error, { scope: 'reports:note-load', entity: 'reportNotes' }));
    return () => {
      cancelled = true;
    };
  }, [selectedReport?.id, canEdit]);

  useEffect(() => {
    if (initialCreateReportPatientId && patients.length > 0) {
      const foundPatient = patients.find(p => p.id === initialCreateReportPatientId);
      if (foundPatient) {
        setNewReport({
          patientId: foundPatient.id,
          testSelection: foundPatient.testSelection || [],
          results: {},
        });
        setPatientSearchQuery(foundPatient.name);
        setIsModalOpen(true);
        clearCreateAction?.();
      }
    }
  }, [initialCreateReportPatientId, patients, clearCreateAction]);

  useEffect(() => {
    const path = 'patients';
    // Ordered by name for the patient picker, which filters this list
    // client-side — so it is deliberately not paginated.
    const q = query(collection(db, path), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        setPatients(readPatients(snapshot.docs));
      },
      error => {
        handleFirestoreError(error, OperationType.GET, path);
      },
    );
    return () => unsubscribe();
  }, []);

  /**
   * Commit a domain write plan as one unit.
   *
   * The plan from `planReportWrite` is executed through `writeBatch` so the
   * amendment-history row and the report row land together (a real SQLCipher
   * transaction on the native store). Reports merge (so an immutable field like
   * `createdBy` is never blanked by a patch); history rows are written whole.
   */
  const commitReportOpsInTx = async (
    tx: DataRepository,
    ops: ReportWriteOp[],
    audit?: { action: string; details?: Record<string, unknown> },
  ): Promise<void> => {
    if (ops.length === 0) return;
    for (const op of ops) {
      if (op.entity === 'reports') {
        const current = await tx.get('reports', op.id);
        await tx.set('reports', op.id, { ...(current?.data() ?? {}), ...op.value });
      } else {
        await tx.set(op.entity, op.id, op.value);
      }
    }
    if (audit) {
      await tx.add('auditEvents', {
        action: audit.action,
        entity: 'reports',
        entityId: ops.find(op => op.entity === 'reports')?.id ?? '',
        actor: operatorStamp(user),
        at: new Date().toISOString(),
        details: audit.details ?? {},
      });
    }
  };

  const commitReportOps = async (
    ops: ReportWriteOp[],
    audit?: { action: string; details?: Record<string, unknown> },
  ): Promise<void> => {
    if (ops.length === 0) return;
    const batch = writeBatch(db);
    for (const op of ops) {
      const ref = doc(collection(db, op.entity), op.id);
      if (op.entity === 'reports') batch.set(ref, op.value, { merge: true });
      else batch.set(ref, op.value);
    }
    if (audit) {
      const ref = doc(collection(db, 'auditEvents'));
      batch.set(ref, {
        action: audit.action,
        entity: 'reports',
        entityId: ops.find(op => op.entity === 'reports')?.id ?? '',
        actor: operatorStamp(user),
        at: new Date().toISOString(),
        details: audit.details ?? {},
      });
    }
    await batch.commit();
  };

  /**
   * The stored copy of the report a sheet is showing.
   *
   * Read from the database rather than taken from state, because the editor
   * mutates its copy as the operator types: a "before" built from that copy is
   * identical to the "after" by construction, and the amendment gate then
   * reports a change it never made. Falling back to the on-screen values keeps
   * the write working if the document has already gone (deleted in another
   * window), which is the lesser risk than silently discarding a correction.
   */
  const readStoredReport = async (target: SelectedReport): Promise<StoredReport> => {
    const onScreen: StoredReport = {
      patientId: target.patientId,
      patientName: target.patientName,
      resultData: target.resultData ?? {},
      signature: target.signature ?? '',
      createdAt: target.createdAt ?? '',
      createdBy: target.createdBy ?? '',
      testType: target.testType,
      testSelection: target.testSelection ?? [],
      orderId: target.orderId,
      sampleIds: target.sampleIds,
      criticalReview: target.criticalReview,
      deltaReview: target.deltaReview,
      updatedAt: target.updatedAt,
      id: target.id,
      status: target.status,
      version: target.version,
      issuanceSnapshot: target.issuanceSnapshot,
    };
    const snap = await getDoc(doc(db, 'reports', target.id));
    if (!snap.exists()) return onScreen;
    const stored = normalizeReportStatus(snap.data()) as Partial<ReportRecord> | null;
    if (!stored) return onScreen;
    return { ...onScreen, ...stored, id: target.id };
  };

  const openReportEditor = (report: ReportRecord) => {
    const base = reportBaseOf(report);
    setSelectedReport({ ...report });
    setEditorBase(base);
    setRecoveredDraft(null);
    setDraftSaveState('idle');
    setDraftSavedAt('');
    setAmendReason('');
    setCriticalReviewReason('');
    setDeltaReviewReason('');
    setPreviousReport(null);
    setReviewerName('');
    setReviewerUid('');
    setDetailError(null);
    const request = ++previousReportRequest.current;
    void loadPreviousIssuedReport(report.patientId, report.id, report.createdAt)
      .then(previous => {
        if (previousReportRequest.current === request) setPreviousReport(previous);
      })
      .catch(() => {
        if (previousReportRequest.current === request) setPreviousReport(null);
      });
    void loadReportDraft(report.id)
      .then(draft => {
        if (previousReportRequest.current === request) setRecoveredDraft(draft);
      })
      .catch(() => {
        if (previousReportRequest.current === request) setDraftSaveState('error');
      });
  };

  const closeReportEditor = () => {
    previousReportRequest.current += 1;
    setPreviousReport(null);
    setSelectedReport(null);
    setEditorBase(null);
    setRecoveredDraft(null);
    setDraftSaveState('idle');
    setDraftSavedAt('');
    setAmendReason('');
    setCriticalReviewReason('');
    setDeltaReviewReason('');
    setReviewerName('');
    setReviewerUid('');
    setDetailError(null);
  };

  useEffect(() => {
    if (!selectedReport || !editorBase || !canEdit || recoveredDraft) return;
    const current = asResultMap(selectedReport.resultData);
    const resultsChanged =
      JSON.stringify(current) !== JSON.stringify(asResultMap(editorBase.resultData));
    if (
      !resultsChanged &&
      !amendReason &&
      !criticalReviewReason &&
      !deltaReviewReason &&
      !reviewerUid
    )
      return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setDraftSaveState('saving');
      void saveReportDraft({
        reportId: selectedReport.id,
        baseVersion: editorBase.version ?? 1,
        baseUpdatedAt: editorBase.updatedAt,
        resultData: current,
        ...(reviewerUid && reviewerName
          ? { reviewer: { uid: reviewerUid, name: reviewerName, role: 'pathologist' as const } }
          : {}),
        ...(criticalReviewReason ? { criticalReviewReason } : {}),
        ...(amendReason ? { amendReason } : {}),
        ...(deltaReviewReason ? { deltaReviewReason } : {}),
      })
        .then(saved => {
          if (cancelled) return;
          setDraftSaveState('saved');
          setDraftSavedAt(saved.savedAt);
        })
        .catch(() => {
          if (!cancelled) setDraftSaveState('error');
        });
    }, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    selectedReport,
    editorBase,
    canEdit,
    recoveredDraft,
    amendReason,
    criticalReviewReason,
    deltaReviewReason,
    reviewerUid,
    reviewerName,
  ]);

  /**
   * One report write at a time, from this screen.
   *
   * `loading` only reaches the buttons after React re-renders, so a second tap
   * in the same frame started a second batch while the first was still open. The
   * store refuses a second BEGIN ("Already in transaction") and the rollback the
   * failed batch issued undid the batch that was actually working — the operator
   * saw "Could not issue the report" and, on the retry, no report at all.
   */
  const reportWriteInFlight = useRef(false);

  const handleCreateReport = async (e: React.FormEvent, status: ReportStatus = 'final') => {
    e.preventDefault();
    if (!canEdit || (status === 'final' && !canIssue)) {
      setModalError('Your operator role cannot perform this report action.');
      return;
    }
    if (reportWriteInFlight.current) return;
    reportWriteInFlight.current = true;
    setLoading(true);
    setModalError(null);
    try {
      if (!newReport.patientId) {
        throw new Error('No patient selected. Please search and select a patient first.');
      }
      if (newReport.testSelection.length === 0) {
        throw new Error('Add at least one test before creating a report.');
      }

      // Ensure all selected tests have at least an empty string entry if not filled, to prevent undefined values in Firestore
      const sanitizedResults: Record<string, string> = {};
      expandTestSelection(newReport.testSelection).forEach(testName => {
        sanitizedResults[testName] = newReport.results[testName] || '';
      });

      const patient = patients.find(p => p.id === newReport.patientId);
      if (!patient)
        throw new Error('The selected patient no longer exists. No report was created.');
      const timestamp = new Date().toISOString();
      const patientName = patient.name;
      const previous =
        status === 'final'
          ? await loadPreviousIssuedReport(patient.id, undefined, timestamp)
          : null;
      const validation = validateReportResults(
        expandTestSelection(newReport.testSelection),
        sanitizedResults,
        findTestInfo,
        undefined,
        name => resolvedRangeFor(name, patient),
        previous?.resultData,
      );
      if (!validation.valid)
        throw new Error(validation.errors.map(item => `${item.test}: ${item.message}`).join('; '));
      if (validation.warnings.some(item => item.critical) && !newCriticalReviewReason.trim()) {
        throw new Error('Record a clinical review reason for the critical result before issue.');
      }
      if (
        status === 'final' &&
        validation.warnings.some(item => isDeltaWarning(item.message)) &&
        !newDeltaReviewReason.trim()
      ) {
        throw new Error('Record a delta review reason for the material change before issue.');
      }
      const orderId = generateId();
      // Offline: no patient-facing QR mirror and no remote signing service. The
      // device-backed signature is added below before the aggregate commits.
      const reportRef = doc(collection(db, 'reports'));
      const content = {
        orderId,
        patientId: newReport.patientId,
        patientName,
        resultData: sanitizedResults,
        signature: (user?.displayName ?? '').slice(0, 128),
        createdAt: timestamp,
        createdBy: operatorStamp(user),
        testSelection: newReport.testSelection,
        ...(status === 'final'
          ? {
              issuanceSnapshot: buildReportIssuanceSnapshot(
                {
                  orderId,
                  patientId: patient.id,
                  testSelection: newReport.testSelection,
                  resultData: sanitizedResults,
                },
                patient,
                readSettings(),
                timestamp,
              ),
            }
          : {}),
      };
      // Blank results do not block issuing (owner, 2026-10-15): a panel whose
      // members were not all done is a normal report here, and gating it pushed
      // operators to invent values. The composer still counts the blanks so the
      // screen can say what will print empty.
      const plan = planReportWrite({
        existing: null,
        newId: reportRef.id,
        next: { ...content, status },
        operator: operatorStamp(user),
        operatorName: user?.displayName ?? '',
        actor: user ? { uid: user.uid, role: role ?? 'guest' } : undefined,
        criticalOverrideReason: newCriticalReviewReason,
        ...(status === 'final' && previous
          ? { previousResults: previous.resultData, previousReportId: previous.id }
          : {}),
        deltaReviewReason: newDeltaReviewReason,
        reviewer:
          status === 'final'
            ? { uid: newReviewerUid, name: newReviewerName, role: 'pathologist' }
            : undefined,
        now: timestamp,
      });
      if (!plan.ok) throw new Error(plan.error ?? 'Report could not be saved.');
      let issuanceHash: string | undefined;
      if (status === 'final') {
        const reportOp = plan.ops.find(op => op.entity === 'reports');
        if (reportOp) {
          const sealed = await signReportIssuance({
            ...reportOp.value,
            id: reportOp.id,
            status,
            version: 1,
          } as unknown as ReportRecord);
          reportOp.value.issuanceSignature = sealed;
          issuanceHash = sealed.manifestHash;
        }
      }
      await createOrderWithSamples(
        {
          patientId: patient.id,
          doctorName: patient.doctorName,
          doctorId: patient.doctorId,
          tests: newReport.testSelection,
          actor: operatorStamp(user),
          allowDuplicate: true,
          now: new Date(timestamp),
        },
        {
          id: orderId,
          operationId: `report-create-${reportRef.id}`,
          afterCreate: async (tx, _order, samples) => {
            const reportOp = plan.ops.find(op => op.entity === 'reports');
            if (reportOp) reportOp.value.sampleIds = samples.map(sample => sample.id);
            await commitReportOpsInTx(tx, plan.ops, {
              action: status === 'final' ? 'report.issued' : 'report.draft_created',
              details: {
                orderId,
                patientId: patient.id,
                ...(issuanceHash ? { issuanceHash } : {}),
              },
            });
          },
        },
      );

      setIsModalOpen(false);
      setNewReport({ patientId: '', testSelection: [], results: {} });
      setNewCriticalReviewReason('');
      setNewDeltaReviewReason('');
      setNewReviewerName('');
      setNewReviewerUid('');
      setPatientSearchQuery('');
      setTestSearchQuery('');
      setModalError(null);
      toast.success(
        status === 'final'
          ? `Report issued for ${patientName}.`
          : `Draft saved for ${patientName}.`,
      );
    } catch (err: any) {
      captureError(err, { scope: 'reports:create', entity: 'reports' });
      setModalError(err instanceof Error ? err.message : String(err));
    } finally {
      reportWriteInFlight.current = false;
      setLoading(false);
    }
  };

  /**
   * Persist edited results through the report-workflow domain rules.
   *
   * The decision (may this issue? does it need a reason? must the prior version
   * be retained?) is made once, in `planReportWrite`. This screen only collects
   * input, runs the plan, and reports the outcome — it cannot walk past a rule.
   */
  const handleSaveResults = async (reasonOverride?: string, issue = false) => {
    if (!selectedReport) return;
    if (!canEdit || (issue && !canIssue)) {
      setDetailError('Your operator role cannot perform this report action.');
      return;
    }
    if (reportWriteInFlight.current) return;
    reportWriteInFlight.current = true;
    setSavingResults(true);
    setDetailError(null);
    const target = selectedReport;
    try {
      const stored = await readStoredReport(target);
      if (editorBase && !sameReportRevision(editorBase, stored)) {
        setDetailError(
          'This report changed in another session. Close and reopen it before saving; your unsaved edits are still available.',
        );
        return;
      }
      const now = new Date().toISOString();
      const targetStatus: ReportStatus =
        issue && target.status === 'draft' ? 'final' : target.status;
      const issuePatient =
        targetStatus === 'final' ? patients.find(p => p.id === target.patientId) : undefined;
      if (targetStatus === 'final' && !issuePatient) {
        throw new Error('The patient no longer exists. The report was not changed.');
      }
      const previous =
        targetStatus === 'final'
          ? await loadPreviousIssuedReport(target.patientId, target.id, target.createdAt)
          : null;
      if (previous) setPreviousReport(previous);
      const validation = validateReportResults(
        expandTestSelection(target.testSelection ?? []),
        target.resultData,
        findTestInfo,
        undefined,
        name => resolvedRangeFor(name, issuePatient),
        previous?.resultData,
      );
      if (targetStatus === 'final' && !validation.valid) {
        setDetailError(validation.errors.map(item => `${item.test}: ${item.message}`).join('; '));
        return;
      }
      if (
        targetStatus === 'final' &&
        validation.warnings.some(item => item.critical) &&
        !criticalReviewReason.trim()
      ) {
        setDetailError('Record a clinical review reason for the critical result before issue.');
        return;
      }
      if (
        targetStatus === 'final' &&
        validation.warnings.some(item => isDeltaWarning(item.message)) &&
        !deltaReviewReason.trim()
      ) {
        setDetailError(
          'Record a delta review reason for the material change before issue or amendment.',
        );
        return;
      }
      let orderId = target.orderId;
      if (!orderId) {
        const created = await createOrderWithSamples({
          patientId: target.patientId,
          doctorName: issuePatient?.doctorName,
          doctorId: issuePatient?.doctorId,
          tests: target.testSelection ?? [],
          actor: operatorStamp(user),
          allowDuplicate: true,
          now: new Date(now),
        });
        orderId = created.order.id;
      } else {
        await createSamplesForOrder(orderId, operatorStamp(user));
      }
      const content = {
        orderId,
        sampleIds: target.sampleIds,
        patientId: target.patientId,
        patientName: target.patientName,
        resultData: target.resultData,
        signature: target.signature,
        createdAt: target.createdAt,
        createdBy: target.createdBy,
        testType: target.testType,
        testSelection: target.testSelection ?? [],
        ...(targetStatus === 'final'
          ? {
              issuanceSnapshot: buildReportIssuanceSnapshot(
                { ...target, orderId },
                issuePatient!,
                readSettings(),
                now,
              ),
            }
          : {}),
      };
      const plan = planReportWrite({
        // `existing` has to be what is STORED, not what is on screen. The editor
        // writes every keystroke straight into `selectedReport`, so deriving the
        // "before" from it makes any amendment look like a no-op:
        // `isReportContentChanged(existing, next)` is false by construction,
        // `planReportWrite` returns `{ ok: true, ops: [] }` ("nothing to
        // persist"), this sheet closes and toasts success — and the corrected
        // value never reaches the database, on the one path whose whole purpose
        // is to retain what was handed out before it was changed.
        existing: stored,
        next: { ...content, status: targetStatus },
        reason: reasonOverride ?? amendReason,
        operator: operatorStamp(user),
        operatorName: user?.displayName ?? '',
        actor: user ? { uid: user.uid, role: role ?? 'guest' } : undefined,
        criticalOverrideReason: criticalReviewReason,
        ...(targetStatus === 'final' && previous
          ? { previousResults: previous.resultData, previousReportId: previous.id }
          : {}),
        deltaReviewReason,
        reviewer:
          targetStatus === 'final'
            ? { uid: reviewerUid, name: reviewerName, role: 'pathologist' }
            : undefined,
        now,
      });
      if (!plan.ok) {
        // A domain rule refused the write. Keep the sheet open and every value
        // already entered; only tell the operator what is blocking them.
        setDetailError(plan.error ?? 'The report could not be saved.');
        return;
      }
      let issuanceHash: string | undefined;
      if (targetStatus === 'final') {
        const reportOp = plan.ops.find(op => op.entity === 'reports');
        if (reportOp) {
          const sealed = await signReportIssuance({
            ...stored,
            ...reportOp.value,
            id: reportOp.id,
            status: targetStatus,
            version: plan.nextVersion ?? 1,
          } as unknown as ReportRecord);
          reportOp.value.issuanceSignature = sealed;
          issuanceHash = sealed.manifestHash;
        }
      }
      await commitReportOps(plan.ops, {
        action: plan.amended
          ? 'report.amended'
          : plan.issuing
            ? 'report.issued'
            : 'report.results_saved',
        details: {
          orderId,
          version: plan.nextVersion,
          ...(issuanceHash ? { issuanceHash } : {}),
          ...(plan.verification ? { verification: plan.verification } : {}),
          ...(plan.criticalReview ? { criticalReview: plan.criticalReview } : {}),
          ...(plan.deltaReview ? { deltaReview: plan.deltaReview } : {}),
        },
      });
      await clearReportDraft(target.id).catch(error =>
        captureError(error, { scope: 'reports:draft-cleanup', entity: 'meta' }),
      );
      closeReportEditor();
      toast.success(
        plan.amended
          ? `Report amended (v${plan.nextVersion}).`
          : plan.issuing
            ? `Report issued for ${target.patientName}.`
            : 'Results saved.',
      );
      // Updating UI is handled by the local store subscription
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'reports');
      toast.error('Saving failed — the report was left unchanged.');
    } finally {
      reportWriteInFlight.current = false;
      setSavingResults(false);
    }
  };

  const handleSaveNote = async () => {
    if (!selectedReport) return;
    setSavingNote(true);
    try {
      // Private notes live in a staff-only collection, never on the publicly
      // readable report document.
      await setDoc(doc(db, 'reportNotes', selectedReport.id), {
        reportId: selectedReport.id,
        note: selectedReport.privateNotes || '',
        updatedAt: new Date().toISOString(),
      });
      setSelectedReport(null);
      toast.success('Private note saved.');
      // Updating UI is handled by onSnapshot
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'reports');
    } finally {
      setSavingNote(false);
    }
  };

  /**
   * Render the report and hand it to the requested destination.
   *
   * The document itself is built by `lib/report-pdf`, which takes a plain input
   * object and returns the page count it actually produced. Everything that
   * decides what lands on paper now lives in one module with tests, instead of
   * in this closure — which is how a wrong printout went unnoticed for this long.
   *
   * What stays here is what genuinely belongs to the page: reading the store,
   * resolving the share letterhead (a canvas round-trip, so it cannot live in
   * the builder if the builder is to stay testable), and dispatching to the
   * printer, the viewer, the filesystem or the share sheet.
   */
  const patient_report = async (
    report: ReportRecord,
    action: 'print' | 'preview' | 'download' | 'share' = 'print',
  ) => {
    const legacyFinal = report.status === 'final' && !report.issuanceSnapshot;
    const s = (report.issuanceSnapshot?.settings ??
      (legacyFinal ? DEFAULT_SETTINGS : readSettings())) as ReturnType<typeof readSettings>;
    const patient =
      report.issuanceSnapshot?.patient ??
      (legacyFinal
        ? {
            id: report.patientId,
            name: report.patientName,
            age: '',
            gender: '' as PatientRecord['gender'],
            createdAt: report.createdAt,
          }
        : (patients.find(p => p.id === report.patientId) ?? null));

    // Credential / issuance wording for this document, derived rather than typed
    // inline: an accreditation only prints when the operator has attested it, and
    // the signer is whoever issued the stored report, never whoever is viewing it.
    const signerName = resolveSigner(report);
    const legalInput: ReportLegalInput = {
      accreditationBody: s.accreditationBody,
      accreditationNumber: s.accreditationNumber,
      licenceNumber: s.licenceNumber,
      accreditationAttestedAt: s.accreditationAttestedAt,
      signerName,
      signedAt: report.updatedAt || report.createdAt,
    };
    const legal = buildReportLegalLines(legalInput);

    // The share letterhead is a full-bleed image behind the text. A stored upload
    // wins; otherwise the shipped default is fetched and re-encoded, and if the
    // device can do neither, the canvas-drawn template is generated. A missing
    // letterhead is a plain report, never a failed one.
    const resolveShareLetterhead = async (): Promise<string> => {
      if (s.sharingTemplateImage) return s.sharingTemplateImage;
      const labTitle = s.labName || 'PathoMitra Lab';
      try {
        return await new Promise<string>(resolve => {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(generateDefaultTemplateImage(labTitle, legalInput));
              return;
            }
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/jpeg'));
          };
          img.onerror = () => resolve(generateDefaultTemplateImage(labTitle, legalInput));
          img.src = '/default-share-template.png';
        });
      } catch (err) {
        captureError(err, { scope: 'reports:letterhead', entity: 'reports' });
        return '';
      }
    };

    const shareTemplateImage = action === 'share' ? await resolveShareLetterhead() : '';

    const built = await buildReportDocument({
      report,
      patient,
      settings: s,
      mode: action === 'share' ? 'share' : 'print',
      signerName,
      legal,
      shareTemplateImage,
    }).catch((err: unknown) => {
      captureError(err, { scope: 'reports:pdf', operation: action, entity: 'reports' });
      toast.error('The report could not be prepared. Try again or use Download.');
      return null;
    });
    if (!built) return;
    const { doc, filename, pageCount, compacted } = built;

    // Printing a draft stays possible on purpose — a bench prints one to review
    // it with the pathologist — but the paper is stamped DRAFT by the builder and
    // the operator is told, because the document used to print the literal word
    // 'FINAL' on an unissued report while the share action was gated.
    if (report.status === 'draft') {
      toast.warning('Draft printout — this copy is stamped DRAFT and is not an issued report.');
    }

    // The lab set the typography; a one-page fit was achieved by reducing it, and
    // the operator is told rather than left to notice it on paper.
    if (compacted) {
      toast.info(
        'Fitted onto one page — row spacing and result text were reduced from the saved settings.',
      );
    } else if (pageCount > 1) {
      toast.info(`This report prints as ${pageCount} pages.`);
    }

    if (action === 'print') {
      // Windows gets the app's own print sheet: printer, page range, copies,
      // orientation and a live preview, spooled through webContents.print().
      // On the APK this raises the system print sheet (printers + "Save as
      // PDF"); in a browser it keeps opening the autoPrint blob in a tab.
      if (getShellKind() === 'desktop') {
        setPrintJob({
          title: `Report — ${spokenName(report.patientName)}`,
          filename,
          pdfBase64: pdfToBase64(doc),
          actor: operatorStamp(user),
          actorUid: user?.uid ?? '',
          actorRole: role ?? 'guest',
          entityType: 'reports',
          recordId: report.id,
          recordVersion: Number(report.version) || 1,
        });
        return;
      }
      try {
        await printPdf(doc, filename, {
          actor: operatorStamp(user),
          actorUid: user?.uid ?? '',
          actorRole: role ?? 'guest',
          entityType: 'reports' as const,
          recordId: report.id,
          recordVersion: Number(report.version) || 1,
        });
      } catch (err) {
        captureError(err, { scope: 'reports:print', operation: 'print', entity: 'reports' });
        toast.error('Could not open the print dialog. Use Download instead.');
      }
    } else if (action === 'preview') {
      // In a browser the PDF opens in a new tab; on the APK previewPdf writes
      // the file and hands it to the device's own PDF viewer (Chrome, Drive,
      // an OEM reader), falling back to the print sheet only when the device
      // has no PDF-capable app at all.
      try {
        const message = await previewPdf(doc, filename, {
          actor: operatorStamp(user),
          actorUid: user?.uid ?? '',
          actorRole: role ?? 'guest',
          entityType: 'reports' as const,
          recordId: report.id,
          recordVersion: Number(report.version) || 1,
        });
        // Non-null only when the tab was refused — the file was downloaded then,
        // so this is a detour to report, not a failure.
        if (message) toast.warning(message);
      } catch (err) {
        captureError(err, { scope: 'reports:preview', operation: 'preview', entity: 'reports' });
        toast.error('Could not open the report preview. Use Download instead.');
      }
    } else if (action === 'share') {
      // The WebView has no `navigator.share` and ignores `window.open`, so the
      // old Web-Share-plus-wa.me fallback did nothing at all on a phone. On
      // device the PDF is written to storage and handed to the system sheet,
      // where the user picks the real destination (WhatsApp, Drive, email…).
      try {
        const message = await sharePdf(
          doc,
          filename,
          'Diagnostic Report',
          `Diagnostic report for ${patient?.name || report.patientName || 'the patient'}`,
          {
            actor: operatorStamp(user),
            actorUid: user?.uid ?? '',
            actorRole: role ?? 'guest',
            entityType: 'reports' as const,
            recordId: report.id,
            recordVersion: Number(report.version) || 1,
          },
        );
        // Non-null only for outcomes worth a word: saved-but-no-share-target, or
        // a browser that had to download instead. A dismissed sheet is null.
        if (message) toast.info(message);
      } catch (err) {
        captureError(err, { scope: 'reports:share', operation: 'share', entity: 'reports' });
        toast.error('Could not share the report. Use Download instead.');
      }
    } else {
      // Download. `doc.save()` is silently dead in the WebView — including from
      // the two error toasts above that tell the user to use it — so on device
      // the file goes through the Filesystem plugin and names where it landed.
      try {
        const message = await savePdf(doc, filename, {
          actor: operatorStamp(user),
          actorUid: user?.uid ?? '',
          actorRole: role ?? 'guest',
          entityType: 'reports' as const,
          recordId: report.id,
          recordVersion: Number(report.version) || 1,
        });
        if (message) toast.success(message);
        // A toast is gone in three seconds and the operator is usually already
        // looking at the next screen, so on a device the same receipt is posted to
        // the notification shade — named by file, which is what gets checked before
        // anything is printed. A browser download needs neither: its own bar says
        // it, and prompting for notification permission for that would be noise.
        if (hasShellOutput()) {
          void showBannerWithPermission({
            key: `download:${filename}`,
            title: 'Downloaded',
            body: message ?? filename,
            channelId: FILE_CHANNEL_ID,
          });
        }
      } catch (err) {
        captureError(err, { scope: 'reports:download', operation: 'download', entity: 'reports' });
        toast.error('Could not save the report to this device.');
      }
    }
  };

  // Days that actually hold activity, for the calendar dots. `toIsoDay` is the
  // local day — the same one the grid and the range filter compare against, so
  // an evening record cannot be painted into the wrong box.
  const activeReportDates = useMemo(
    () => new Set(reports.filter(r => r.createdAt).map(r => toIsoDay(new Date(r.createdAt)))),
    [reports],
  );

  const combinedList = useMemo<ListEntry[]>(
    () =>
      [
        ...reports.map((r): ListEntry => ({ ...r, itemType: 'report', timestamp: r.createdAt })),
        ...patients
          .filter(p => !reports.some(r => r.patientId === p.id))
          .map((p): ListEntry => ({ ...p, itemType: 'patient', timestamp: p.createdAt })),
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [reports, patients],
  );

  // What is left for the client is the substring match. Every word typed has to
  // appear somewhere on the row, and the row is matched on more than the name: a
  // patient's registration number, a report id, a phone in any formatting and the
  // ordered panel/test names all identify a report at the bench, and none of them
  // used to be searchable — "Filter by patient name" was the only door.
  const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase());
  const filteredCombinedList = useMemo(() => {
    const terms = deferredSearch.split(/\s+/).filter(Boolean);
    return combinedList.filter(item => {
      if (terms.length > 0) {
        const haystack = [
          item.itemType === 'report' ? item.patientName : item.name || '',
          item.id,
          item.itemType === 'report' ? item.patientId : '',
          'phone' in item ? (item.phone ?? '') : '',
          'phone' in item ? normalisePhone(String(item.phone ?? '')) : '',
          item.testType ?? '',
          ...(item.testSelection ?? []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!terms.every(term => haystack.includes(term))) return false;
      }
      if (!item.createdAt) return true;
      const day = toIsoDay(new Date(item.createdAt));
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    });
  }, [combinedList, deferredSearch, fromDate, toDate]);

  // An empty window used to look like an empty lab: searching for last month's
  // patient returned "no results" because only the newest page was loaded, and the
  // walk stopped at 250 records — so a settled lab's older history was simply
  // unfindable. The local store keeps the collection in memory already, so walking
  // the rest costs a re-slice and nothing else.
  const scanning =
    deferredSearch.length > 0 && filteredCombinedList.length === 0 && reportsList.hasMore;

  useEffect(() => {
    if (!scanning || reportsList.loadingMore) return;
    void reportsList.loadMore();
  }, [scanning, reportsList]);

  const exportFilteredCsv = async () => {
    const allReports = reportsList.allItems;
    const terms = deferredSearch.split(/\s+/).filter(Boolean);
    const exportRows = [
      ...allReports.map((report): ListEntry => ({
        ...report,
        itemType: 'report',
        timestamp: report.createdAt,
      })),
      ...patients
        .filter(patient => !allReports.some(report => report.patientId === patient.id))
        .map((patient): ListEntry => ({
          ...patient,
          itemType: 'patient',
          timestamp: patient.createdAt,
        })),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .filter(item => {
        if (terms.length > 0) {
          const haystack = [
            item.itemType === 'report' ? item.patientName : item.name || '',
            item.id,
            item.itemType === 'report' ? item.patientId : '',
            'phone' in item ? (item.phone ?? '') : '',
            'phone' in item ? normalisePhone(String(item.phone ?? '')) : '',
            item.testType ?? '',
            ...(item.testSelection ?? []),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!terms.every(term => haystack.includes(term))) return false;
        }
        if (!item.createdAt) return true;
        const day = toIsoDay(new Date(item.createdAt));
        if (fromDate && day < fromDate) return false;
        if (toDate && day > toDate) return false;
        return true;
      });
    if (exportRows.length === 0) {
      toast.warning('Nothing to export — widen the filter first.');
      return;
    }
    const csv = toCsv<ListEntry>(
      [
        {
          label: 'Type',
          value: item => (item.itemType === 'report' ? 'Report' : 'Awaiting report'),
        },
        {
          label: 'Patient',
          value: item => (item.itemType === 'report' ? item.patientName : item.name),
        },
        { label: 'Status', value: item => (item.itemType === 'report' ? item.status : 'pending') },
        { label: 'Tests', value: item => (item.testSelection || []).join(' | ') },
        { label: 'Date', value: item => item.createdAt },
        { label: 'Record ID', value: item => item.id },
      ],
      exportRows,
    );
    try {
      const message = await downloadCsv(`pathomitra-reports-${toIsoDay(new Date())}.csv`, csv, {
        actor: operatorStamp(user),
        actorUid: user?.uid ?? '',
        actorRole: role ?? 'guest',
        entityType: 'exports' as const,
        rowCount: exportRows.length,
        filters: { fromDate, toDate },
      });
      toast.success(message ?? `Exported ${exportRows.length} records to CSV.`);
    } catch (err) {
      captureError(err, { scope: 'reports:csv', operation: 'export', entity: 'reports' });
      toast.error('Could not write the CSV on this device.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div className="flex flex-col sm:flex-row flex-1 max-w-md gap-2">
          <SearchField
            className="flex-1"
            placeholder="Filter by name, patient number, report id or test…"
            aria-label="Filter reports by patient name"
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            onClear={() => setSearchTerm('')}
          />

          <CalendarRangePicker
            fromDate={fromDate}
            toDate={toDate}
            activeDates={activeReportDates}
            onChange={({ fromDate: from, toDate: to }) => {
              setFromDate(from);
              setToDate(to);
            }}
            className="z-30 w-full sm:w-60"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
          <Button variant="outline" size="sm" onClick={exportFilteredCsv}>
            <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" />
            Export CSV
          </Button>
          {role !== 'guest' && (
            <Button variant="brand" size="sm" shine onClick={() => setIsModalOpen(true)}>
              <FilePlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              New Report
            </Button>
          )}
        </div>
      </div>

      {reportsList.loading && (
        <div
          className="grid grid-cols-1 fold:grid-cols-2 lg:grid-cols-3 gap-6"
          aria-busy="true"
          aria-label="Loading reports"
        >
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6"
            >
              <Skeleton className="h-12 w-12 rounded-2xl" />
              <Skeleton className="mt-4 h-5 w-2/3" />
              <Skeleton className="mt-2 h-3.5 w-1/3" />
              <Skeleton className="mt-6 h-3 w-full" />
            </div>
          ))}
        </div>
      )}

      {/* A listener failure must be visible: silently showing an empty list in a
          lab that has records is worse than admitting the read failed. */}
      {!reportsList.loading && reportsList.error && reports.length === 0 && (
        <Card pad="none">
          <EmptyState
            icon={<AlertCircle className="h-7 w-7" />}
            title="Reports could not be loaded"
            description={`${reportsList.error} — your data is safe; reloading will try again.`}
            action={
              <Button variant="outline" onClick={() => window.location.reload()}>
                Reload
              </Button>
            }
          />
        </Card>
      )}

      {!reportsList.loading && scanning && (
        <p
          role="status"
          className="flex items-center justify-center gap-2 py-6 text-sm font-semibold text-on-surface-variant"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Searching older records…
        </p>
      )}

      {!reportsList.loading && filteredCombinedList.length === 0 && !scanning && (
        <Card pad="none">
          <EmptyState
            icon={<Search className="h-7 w-7" />}
            title={deferredSearch ? `No record matches “${searchTerm.trim()}”` : 'No reports yet'}
            description={
              deferredSearch
                ? 'Nothing matched in the loaded records. Narrow the date range, or clear the filter to browse everything.'
                : 'Register a patient, then build their first issued report.'
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
              ) : (
                role !== 'guest' && (
                  <Button onClick={() => setIsModalOpen(true)}>
                    <FilePlus className="mr-2 h-4 w-4" aria-hidden="true" />
                    New report
                  </Button>
                )
              )
            }
          />
        </Card>
      )}

      {filteredCombinedList.length > 0 && (
        <div className="grid grid-cols-1 fold:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCombinedList.map((item, idx) => {
            if (item.itemType === 'report') {
              const report = item;
              // One source of truth for every state visual on the card. Before
              // this, the same Draft card wore a check-circle "success" mark,
              // a green test-type pill that read as an issued badge, AND a
              // small amber "Draft" pill lower down — three different visual
              // answers to "has this report gone out?". The state model picks
              // the icon, tone, label and distribution gate from one lookup.
              const statusView = reportStatusView({
                status: report.status,
                version: report.version,
              });
              const StatusIcon =
                statusView.icon === 'draft'
                  ? FileClock
                  : statusView.icon === 'amended'
                    ? GitCompare
                    : Send;
              const statusTint =
                statusView.tone === 'warning'
                  ? 'bg-warning-container text-on-warning-container'
                  : statusView.tone === 'info'
                    ? 'bg-info-container text-on-info-container'
                    : 'bg-success-container text-on-success-container';
              return (
                <motion.div
                  key={`report-${report.id}`}
                  onClick={() => setViewerReport({ ...report })}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{
                    delay: Math.min(idx * 0.04, 0.5),
                    type: 'spring',
                    stiffness: 260,
                    damping: 24,
                  }}
                  className="cursor-pointer bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/30 shadow-card hover:shadow-raised transition-shadow relative overflow-hidden group"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-accent/5 rounded-full -mr-8 -mt-8 transition duration-300 group-hover:scale-150 group-hover:bg-accent/10" />

                  <div className="flex justify-between items-start mb-6 relative z-20">
                    <div
                      className={cn(
                        'w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner',
                        statusTint,
                      )}
                      aria-hidden="true"
                    >
                      <StatusIcon className="w-6 h-6" />
                    </div>
                    <div className="flex items-center gap-2">
                      {/* The old pill printed the test type against a hard-coded
                          success container — every card looked issued-green. The
                          state pill is now the only upper-right badge, and it
                          reads from the same statusView that drives the icon. */}
                      <StatusPill tone={statusView.tone} dot>
                        {statusView.label}
                        {statusView.icon === 'amended' && ` v${Number(report.version) || 2}`}
                      </StatusPill>
                      <div className="relative">
                        <button
                          type="button"
                          aria-label={`More actions for ${spokenName(report.patientName)}`}
                          aria-haspopup="menu"
                          aria-expanded={activeMenuId === report.id}
                          onClick={e => {
                            e.stopPropagation();
                            setActiveMenuId(activeMenuId === report.id ? null : report.id);
                          }}
                          className="p-1.5 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors"
                        >
                          <MoreVertical className="w-5 h-5" />
                        </button>
                        <AnimatePresence>
                          {activeMenuId === report.id && (
                            <motion.div
                              role="menu"
                              aria-label="Report actions"
                              initial={{ opacity: 0, scale: 0.95, y: -10 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, y: -10 }}
                              className="absolute right-0 top-full mt-2 w-44 bg-surface-container-lowest/90 backdrop-blur-md rounded-xl shadow-float border border-outline-variant/20 overflow-hidden z-30"
                            >
                              {report.status === 'draft' && (
                                <button
                                  role="menuitem"
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    openReportEditor(report);
                                    setActiveMenuId(null);
                                  }}
                                  className="w-full text-left px-4 py-3 text-sm font-bold text-secondary hover:bg-surface-container transition-colors flex items-center gap-2 border-b border-outline-variant/10"
                                >
                                  <FileSignature className="w-4 h-4 text-on-surface-variant" />
                                  Finish draft
                                </button>
                              )}
                              <button
                                role="menuitem"
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  setViewerReport({ ...report });
                                  setActiveMenuId(null);
                                }}
                                className="w-full text-left px-4 py-3 text-sm font-bold text-on-surface hover:bg-surface-container transition-colors flex items-center gap-2 border-b border-outline-variant/10"
                              >
                                <Eye className="w-4 h-4 text-on-surface-variant" />
                                Preview
                              </button>
                              <button
                                role="menuitem"
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  patient_report(report, 'download');
                                  setActiveMenuId(null);
                                }}
                                className="w-full text-left px-4 py-3 text-sm font-bold text-on-surface hover:bg-surface-container transition-colors flex items-center gap-2 border-b border-outline-variant/10"
                              >
                                <Download className="w-4 h-4 text-on-surface-variant" />
                                Download
                              </button>
                              <button
                                role="menuitem"
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  setReportToDelete(report);
                                  setActiveMenuId(null);
                                }}
                                className="w-full text-left px-4 py-3 text-sm font-bold text-error hover:bg-error-container/20 transition-colors flex items-center gap-2"
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1 mb-6 relative z-10">
                    <h3 className="text-xl font-bold text-primary truncate">
                      {report.patientName}
                    </h3>
                    {/* Test type moved here from the removed upper-right badge so
                        the card still tells the operator what panel was ordered.
                        The status pill sits top-right and reads from the same
                        state model as the icon — no duplicate Draft / Issued
                        chip further down the card. */}
                    <p className="text-xs text-on-surface-variant font-medium">
                      {statusView.description}
                    </p>
                    {report.testType && (
                      <p className="text-[13px] font-semibold text-on-surface-variant truncate">
                        {report.testType}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-6 border-t border-outline-variant/10 relative z-10">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-on-surface-variant uppercase tracking-tighter">
                        Patient ID
                      </span>
                      <span className="text-xs font-mono font-bold text-primary">
                        {report.patientId
                          ? report.patientId.length > 10
                            ? report.patientId.substring(0, 8) + '...'
                            : report.patientId
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        aria-label={`View report for ${spokenName(report.patientName)}`}
                        onClick={() => setViewerReport({ ...report })}
                        className="p-2 bg-surface-container hover:bg-primary-container hover:text-on-primary-container hover:-translate-y-0.5 rounded-xl transition shadow-card z-20"
                        title="View report"
                      >
                        <Eye className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Print report for ${spokenName(report.patientName)}`}
                        onClick={() => patient_report(report, 'print')}
                        className="p-2 bg-surface-container hover:bg-primary-container hover:text-on-primary-container hover:-translate-y-0.5 rounded-xl transition shadow-card z-20"
                        title={
                          report.status === 'draft'
                            ? 'Print a working copy (stamped DRAFT)'
                            : 'Print report'
                        }
                      >
                        <Printer className="w-5 h-5" />
                      </button>
                      {/* A draft has no patient-facing copy at all: sharing it would put an
                    unverifiable report in front of the patient, so the action is
                    disabled rather than silently producing a different PDF. */}
                      <button
                        type="button"
                        disabled={report.status === 'draft'}
                        aria-label={
                          report.status === 'draft'
                            ? 'Share is unavailable until the report is issued'
                            : `Share report for ${spokenName(report.patientName)}`
                        }
                        onClick={() => patient_report(report, 'share')}
                        className={cn(
                          'p-2 bg-surface-container hover:-translate-y-0.5 rounded-xl transition shadow-card z-20',
                          report.status === 'draft'
                            ? 'opacity-40 cursor-not-allowed text-on-surface-variant'
                            : 'hover:bg-secondary text-secondary hover:text-on-secondary',
                        )}
                        title={
                          report.status === 'draft'
                            ? 'Issue the report to share it'
                            : 'Share Report'
                        }
                      >
                        <Share2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            } else {
              const patient = item;
              return (
                <motion.div
                  key={`patient-${patient.id}`}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: Math.min(idx * 0.04, 0.5),
                    type: 'spring',
                    stiffness: 260,
                    damping: 24,
                  }}
                  onClick={() => {
                    setNewReport({
                      patientId: patient.id,
                      testSelection: patient.testSelection || [],
                      results: {},
                    });
                    setPatientSearchQuery(patient.name);
                    setIsModalOpen(true);
                  }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.98 }}
                  className="cursor-pointer bg-surface-container-lowest p-6 rounded-3xl border border-secondary/30 shadow-card hover:shadow-raised transition-shadow relative overflow-hidden group"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-secondary/5 rounded-full -mr-8 -mt-8 transition duration-300 group-hover:scale-150 group-hover:bg-secondary/10" />

                  <div className="flex justify-between items-start mb-6 relative z-10">
                    <div className="w-12 h-12 bg-secondary/10 rounded-2xl flex items-center justify-center text-secondary shadow-inner">
                      <AlertCircle className="w-6 h-6" />
                    </div>
                    <span className="px-3 py-1 bg-error-container/50 text-error font-black text-xs uppercase tracking-widest rounded-full">
                      Awaiting Report
                    </span>
                  </div>

                  <div className="space-y-1 mb-6 relative z-10">
                    <h3 className="text-xl font-bold text-primary truncate">{patient.name}</h3>
                    <p className="text-xs text-on-surface-variant font-medium">
                      Age: {patient.age}y • Gender:{' '}
                      {patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1)}{' '}
                      {(patient.testSelection?.length ?? 0) > 0
                        ? `• Tests: ${patient.testSelection?.length}`
                        : ''}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-6 border-t border-outline-variant/10 relative z-10">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-on-surface-variant uppercase tracking-tighter">
                        Registered
                      </span>
                      <span className="text-xs font-mono font-bold text-primary">
                        {new Date(patient.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <button className="text-xs font-bold bg-secondary text-on-secondary px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-card">
                      <Plus className="w-3 h-3" /> Fill Details
                    </button>
                  </div>
                </motion.div>
              );
            }
          })}
        </div>
      )}

      {/* Older reports are fetched on demand: the live subscription only holds
          the most recent page, so the list cannot grow without bound. */}
      {!reportsList.loading && reportsList.hasMore && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="outline"
            loading={reportsList.loadingMore}
            onClick={() => void reportsList.loadMore()}
          >
            {deferredSearch ? 'Keep searching older records' : 'Load older records'}
          </Button>
          <span className="text-xs text-on-surface-variant">
            {reports.length} reports loaded in this session
          </span>
        </div>
      )}

      {!scanning && !reportsList.loading && !reportsList.hasMore && (
        <p className="text-center text-xs text-on-surface-variant">
          {deferredSearch
            ? `${reports.length + patients.length} record${reports.length + patients.length === 1 ? '' : 's'} searched — nothing matched that`
            : `${reports.length} report${reports.length === 1 ? '' : 's'} loaded in this session`}
        </p>
      )}

      {/* Create Report Modal */}
      <Sheet
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setNewReport({ patientId: '', testSelection: [], results: {} });
          setNewDeltaReviewReason('');
          setPatientSearchQuery('');
          setTestSearchQuery('');
          setModalError(null);
        }}
        title="Generate Diagnostic Report"
        width="xl"
        className="sm:max-w-[min(1240px,94vw)]"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
            <Button
              variant="outline"
              className="w-full sm:w-auto sm:px-6"
              onClick={() => {
                setIsModalOpen(false);
                setNewReport({ patientId: '', testSelection: [], results: {} });
                setNewDeltaReviewReason('');
                setPatientSearchQuery('');
                setTestSearchQuery('');
                setModalError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full sm:w-auto sm:px-6"
              disabled={!newReport.patientId || loading}
              onClick={e => handleCreateReport(e, 'draft')}
            >
              <span className="truncate">{SAVE_DRAFT_LABEL}</span>
            </Button>
            <Button
              type="submit"
              form="create-report-form"
              variant="brand"
              className="w-full sm:w-auto sm:px-6"
              loading={loading}
              disabled={!newReport.patientId}
              title={!newReport.patientId ? 'Search and select a patient first' : undefined}
            >
              {!loading && <Send className="h-5 w-5 shrink-0" aria-hidden="true" />}
              <span className="truncate">{ISSUE_REPORT_LABEL}</span>
            </Button>
          </div>
        }
      >
        <form id="create-report-form" onSubmit={handleCreateReport} className="space-y-6">
          {modalError && (
            <div className="p-4 bg-error-container border border-error/30 text-on-error-container rounded-2xl flex items-start gap-2.5 shadow-card text-sm">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-error" />
              <div className="flex-1">
                <h5 className="font-bold">Could not issue the report</h5>
                <p className="text-xs mt-0.5 opacity-90">{modalError}</p>
              </div>
              <button
                type="button"
                onClick={() => setModalError(null)}
                className="p-1 hover:bg-error-container rounded"
              >
                <X className="w-4 h-4 text-error" />
              </button>
            </div>
          )}
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="space-y-1 flex-1 relative">
                <label
                  htmlFor="report-patient-search"
                  className="text-xs font-black text-primary uppercase ml-1"
                >
                  Search & Select Patient
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
                  <input
                    id="report-patient-search"
                    required={!newReport.patientId}
                    type="text"
                    value={patientSearchQuery}
                    onChange={e => {
                      setPatientSearchQuery(e.target.value);
                      setIsPatientDropdownOpen(true);
                      if (newReport.patientId) {
                        setNewReport({ ...newReport, patientId: '' });
                      }
                    }}
                    onFocus={() => setIsPatientDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setIsPatientDropdownOpen(false), 200)}
                    className="w-full pl-9 pr-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-xl focus:border-accent focus:outline-none transition font-bold text-primary"
                    placeholder="Type to search patients..."
                  />
                  {isPatientDropdownOpen && (
                    <div className="absolute z-50 w-full mt-1 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-float max-h-48 overflow-y-auto top-full left-0">
                      {(() => {
                        const filteredPatients = patients.filter(p =>
                          p.name.toLowerCase().includes(patientSearchQuery.toLowerCase()),
                        );
                        return filteredPatients.length > 0 ? (
                          filteredPatients.map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onMouseDown={e => {
                                e.preventDefault();
                                setNewReport({
                                  ...newReport,
                                  patientId: p.id,
                                  testSelection: p.testSelection || [],
                                });
                                setPatientSearchQuery(p.name);
                                setIsPatientDropdownOpen(false);
                              }}
                              className="w-full text-left px-4 py-3 text-sm hover:bg-surface-container-low transition-colors border-b border-outline-variant/5 last:border-0"
                            >
                              <div className="flex justify-between items-center">
                                <span className="font-bold">{p.name}</span>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-sm text-on-surface-variant text-center border-b border-outline-variant/5 last:border-0">
                            No patients found.
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1 md:w-1/3 relative">
                <label className="text-xs font-black text-primary uppercase ml-1">
                  Add Additional Test
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
                  <input
                    type="text"
                    role="combobox"
                    aria-expanded={isTestDropdownOpen}
                    aria-controls="report-test-listbox"
                    aria-autocomplete="list"
                    aria-activedescendant={
                      isTestDropdownOpen && filteredAvailableTests[activeTestIdx]
                        ? `report-test-opt-${activeTestIdx}`
                        : undefined
                    }
                    aria-label="Search and add tests"
                    value={testSearchQuery}
                    onChange={e => {
                      setTestSearchQuery(e.target.value);
                      setTestActiveIdx(0);
                      setIsTestDropdownOpen(true);
                    }}
                    onFocus={() => setIsTestDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setIsTestDropdownOpen(false), 150)}
                    onKeyDown={handleTestKeyDown}
                    className="w-full pl-9 pr-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-xl focus:border-accent focus:outline-none transition font-bold text-primary"
                    placeholder="Search and add tests..."
                  />

                  {isTestDropdownOpen && (
                    <div
                      ref={testListRef}
                      id="report-test-listbox"
                      role="listbox"
                      aria-label="Available tests"
                      className="absolute z-50 w-full mt-1 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-float max-h-48 overflow-y-auto top-full left-0"
                    >
                      {filteredAvailableTests.length > 0 ? (
                        filteredAvailableTests.map((test, idx) => (
                          <button
                            key={test.id}
                            id={`report-test-opt-${idx}`}
                            role="option"
                            aria-selected={idx === activeTestIdx}
                            type="button"
                            onMouseDown={e => {
                              e.preventDefault();
                              addReportTest(test);
                            }}
                            onMouseEnter={() => setTestActiveIdx(idx)}
                            className={cn(
                              'w-full text-left px-4 py-3 text-sm font-medium transition-colors border-b border-outline-variant/5 last:border-0',
                              idx === activeTestIdx
                                ? 'bg-surface-container-low text-on-surface'
                                : 'text-on-surface hover:bg-surface-container-low',
                            )}
                          >
                            {test.name}
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-3 text-sm text-on-surface-variant text-center border-b border-outline-variant/5 last:border-0">
                          No tests found.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-4">
              <div className="flex items-center justify-between border-b border-outline-variant/10 pb-2">
                <h4 className="text-sm font-bold text-primary">Test Results Data</h4>
              </div>

              {/* Blank results are a note, not a block (owner, 2026-10-15). The
                  warning panel used to read "issue is blocked" and list every
                  unfilled member; a report with tests not done is ordinary
                  practice here, so this is now one quiet line saying what will
                  print empty. It disappears as soon as nothing is blank. */}
              {composerMissing.length > 0 && (
                <p
                  role="status"
                  aria-live="polite"
                  className="flex items-start gap-1.5 text-[12px] leading-relaxed text-on-surface-variant"
                >
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {composerMissing.length} of {composerTotal} ordered result
                    {composerTotal === 1 ? '' : 's'} left blank
                    {composerTotal === 1 ? ' prints as' : ' will print as'} an em dash on the
                    report. Fill them now, or issue as it stands.
                  </span>
                </p>
              )}

              {composerValidation.errors.length > 0 && (
                <div
                  role="alert"
                  className="rounded-xl border border-error/30 bg-error-container p-3 text-xs text-on-error-container"
                >
                  {composerValidation.errors.slice(0, 4).map(item => (
                    <p key={item.test}>
                      <strong>{item.test}:</strong> {item.message}
                    </p>
                  ))}
                </div>
              )}
              {composerValidation.warnings.length > 0 && (
                <div
                  role="status"
                  className="rounded-xl border border-outline-variant bg-surface-container p-3 text-xs text-on-surface-variant"
                >
                  {composerValidation.warnings.map(item => (
                    <p key={item.test}>
                      <strong>{item.test}:</strong> {item.message}
                    </p>
                  ))}
                </div>
              )}
              <Field
                label="Independent pathologist reviewer"
                hint="Required before issue and must be different from the issuing operator."
                required
              >
                <select
                  className="w-full rounded-xl border border-outline-variant/40 bg-surface px-3 py-2 text-sm text-on-surface"
                  value={newReviewerUid}
                  onChange={event => {
                    const profile = reviewers.find(item => item.uid === event.target.value);
                    setNewReviewerUid(event.target.value);
                    setNewReviewerName(profile?.name ?? '');
                  }}
                  required
                >
                  <option value="">Select an independent pathologist</option>
                  {reviewers.map(profile => (
                    <option key={profile.uid} value={profile.uid}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </Field>
              {composerValidation.warnings.some(item => item.critical) && (
                <Field
                  label="Clinical review reason for critical result"
                  hint="Record who reviewed the analyser trace or repeat result and why issue is safe."
                  required
                >
                  <TextInput
                    value={newCriticalReviewReason}
                    onChange={event => setNewCriticalReviewReason(event.target.value)}
                    placeholder="Required before issue"
                  />
                </Field>
              )}
              {composerValidation.warnings.some(item => isDeltaWarning(item.message)) && (
                <Field
                  label="Delta review reason"
                  hint="Required when a result changed materially from the previous issued report."
                  required
                >
                  <TextInput
                    value={newDeltaReviewReason}
                    onChange={event => setNewDeltaReviewReason(event.target.value)}
                    placeholder="Why is the material change clinically expected?"
                  />
                </Field>
              )}

              {/* The same panel now sizes the sheet too, because "it fits" used to
                  be discoverable only at the printer. */}
              <p
                role="status"
                aria-live="polite"
                className="flex items-start gap-1.5 text-[12px] leading-relaxed text-on-surface-variant"
              >
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Prints as about {composerPages} {composerPages === 1 ? 'page' : 'pages'}
                  {composerPages > 1
                    ? readSettings().reportFitToOnePage
                      ? ' — the one-page fit will tighten spacing if it can.'
                      : ' — one-page fit is off in Settings → Report template.'
                    : '.'}
                </span>
              </p>

              {/* A CBC alone is 27 parameters and a full panel runs to 44, so on a PC
                  the results are an entry table — one row per test, five aligned
                  columns, a sticky header, no card chrome eating the height. Below
                  1024 px it is the stacked cards the phone has always had, rendered
                  *instead of* hidden: the Enter / Arrow-down bench navigation walks
                  `.test-result-input` by index and cannot have a second invisible
                  set of fields in the document. */}
              <div
                className={
                  isWideComposer
                    ? 'rounded-2xl border border-outline-variant/30 bg-surface'
                    : 'space-y-3'
                }
              >
                {isWideComposer && newReport.testSelection.length > 0 && (
                  <div
                    className={cn(
                      COMPOSER_COLS,
                      'sticky top-0 z-10 rounded-t-2xl border-b border-outline-variant/40 bg-surface-container-low px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant',
                    )}
                  >
                    <span>Test</span>
                    <span>Reference</span>
                    <span>Result</span>
                    <span>Unit</span>
                    <span className="sr-only">Remove</span>
                  </div>
                )}

                {newReport.testSelection.length === 0 && (
                  <div className="p-4 text-center text-sm text-on-surface-variant bg-surface-container-low rounded-xl">
                    No tests selected. Please select a patient or add tests above.
                  </div>
                )}

                {newReport.testSelection.map(testName => {
                  const testInfo = findTestInfo(testName);
                  /** Takes a profile / section heading out of the order with its members. */
                  const dropGroup = () => {
                    const toRemove = [
                      testName,
                      ...(testInfo?.isGroup ? (testInfo.includedTests ?? []) : []),
                    ];
                    setNewReport({
                      ...newReport,
                      testSelection: newReport.testSelection.filter(t => !toRemove.includes(t)),
                    });
                  };

                  // If it's a Group or Header, just show it distinctively without input
                  if (testInfo?.isGroup || testInfo?.isHeader) {
                    if (isWideComposer) {
                      return (
                        <div
                          key={testName}
                          className={cn(
                            COMPOSER_COLS,
                            'border-b border-outline-variant/25 px-3 py-1.5',
                            testInfo.isGroup ? 'bg-primary/10' : 'bg-surface-container-low/70',
                          )}
                        >
                          <h4
                            className="col-span-4 truncate text-[11px] font-bold uppercase tracking-[0.06em] text-primary"
                            title={testName}
                          >
                            {testName}
                          </h4>
                          <button
                            type="button"
                            onClick={dropGroup}
                            aria-label={`Remove ${testName}`}
                            className="justify-self-end rounded p-1 text-primary opacity-50 transition hover:bg-primary hover:text-on-primary hover:opacity-100"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={testName}
                        className={`flex justify-between items-center p-3 mt-4 rounded-lg border-l-4 ${testInfo.isGroup ? 'bg-primary/10 border-primary' : 'bg-surface-container-low border-outline-variant/50'}`}
                      >
                        <h4 className="font-bold text-primary text-sm uppercase tracking-wider">
                          {testName}
                        </h4>
                        <button
                          type="button"
                          onClick={dropGroup}
                          aria-label={`Remove ${testName}`}
                          className="p-1 text-primary opacity-50 hover:bg-primary hover:text-on-primary rounded transition"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  }

                  // Try to get patient to determine reference range
                  const patient = patients.find(p => p.id === newReport.patientId);
                  const resolvedRange = testInfo
                    ? resolveReferenceRange(
                        testInfo.ranges,
                        patient ? ageAsNumber(patient) : undefined,
                        patient?.gender,
                      )
                    : null;
                  const rangeLabel = resolvedRange?.label ?? '';
                  const refValues = resolvedRange?.values ?? null;
                  const enteredValue = newReport.results[testName] || '';

                  let valueStatus: 'normal' | 'low' | 'high' | null = null;
                  if (enteredValue && refValues && !isNaN(Number(enteredValue))) {
                    const numVal = Number(enteredValue);
                    if (refValues.min !== undefined && numVal < refValues.min) {
                      valueStatus = 'low';
                    } else if (refValues.max !== undefined && numVal > refValues.max) {
                      valueStatus = 'high';
                    } else {
                      valueStatus = 'normal';
                    }
                  }

                  const flagPill = valueStatus ? (
                    <StatusPill
                      tone={
                        valueStatus === 'high'
                          ? 'error'
                          : valueStatus === 'low'
                            ? 'warning'
                            : 'success'
                      }
                      dot
                    >
                      {valueStatus === 'high' ? 'High' : valueStatus === 'low' ? 'Low' : 'Normal'}
                    </StatusPill>
                  ) : null;

                  /** Takes this one test out of the order. */
                  const dropTest = () =>
                    setNewReport({
                      ...newReport,
                      testSelection: newReport.testSelection.filter(t => t !== testName),
                    });

                  /** Writing a value, through the same derived-cell recompute the
                   *  card layout has always used — both layouts must derive alike. */
                  const setResult = (next: string) =>
                    setNewReport({
                      ...newReport,
                      results: recalculateCBC(newReport.results, testName, next),
                    });

                  if (isWideComposer) {
                    return (
                      <div
                        key={testName}
                        className={cn(
                          COMPOSER_COLS,
                          'border-b border-outline-variant/20 px-3 py-1.5 transition-colors last:border-b-0 hover:bg-accent/5',
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="truncate text-[13px] font-bold text-primary"
                            title={testName}
                          >
                            {testName}
                          </span>
                          {flagPill}
                        </div>
                        <div
                          className="min-w-0 truncate text-xs text-on-surface-variant"
                          title={`Ref: ${rangeLabel}${testInfo?.unit ? ` ${testInfo.unit}` : ''}`}
                        >
                          <span className="font-medium">Ref:</span> {rangeLabel || '—'}
                          {patient && resolvedRange && resolvedRange.kind !== 'none' && (
                            <span className="ml-1 rounded bg-secondary-container/10 px-1 text-[10px] font-medium text-secondary">
                              adjusted
                            </span>
                          )}
                        </div>
                        <div className="min-w-0">
                          {testInfo?.options ? (
                            <Combobox
                              className="w-full min-w-0"
                              inputClassName={COMPOSER_INPUT}
                              value={enteredValue}
                              options={testInfo.options}
                              placeholder="Select…"
                              ariaLabel={`Result for ${testName}`}
                              onChange={setResult}
                              onNavigate={handleInputKeyDown}
                            />
                          ) : (
                            <input
                              type="text"
                              inputMode={isNumericTest(testInfo) ? 'decimal' : undefined}
                              aria-label={`Result for ${testName}`}
                              value={enteredValue}
                              onChange={e => setResult(e.target.value)}
                              onKeyDown={handleInputKeyDown}
                              className={COMPOSER_INPUT}
                              placeholder="Result…"
                            />
                          )}
                        </div>
                        <span
                          className="truncate text-xs font-semibold text-on-surface-variant"
                          title={testInfo?.unit}
                        >
                          {testInfo?.unit || '—'}
                        </span>
                        <button
                          type="button"
                          onClick={dropTest}
                          aria-label={`Remove ${testName}`}
                          className="justify-self-end rounded-lg p-1.5 text-error opacity-40 transition hover:bg-error-container hover:opacity-100"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={testName}
                      className="flex flex-col gap-2 p-4 bg-surface-container-low rounded-xl border border-outline-variant/30 relative group"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center flex-wrap gap-2">
                            <label className="text-sm font-bold text-primary">{testName}</label>
                            {flagPill}
                          </div>
                          {testInfo && (
                            <div className="text-xs text-on-surface-variant mt-0.5">
                              <span className="font-medium">Ref:</span> {rangeLabel} {testInfo.unit}
                              {patient && resolvedRange && resolvedRange.kind !== 'none' && (
                                <span className="ml-1 text-xs bg-secondary-container/10 text-secondary px-1 rounded font-medium">
                                  (Adjusted for{' '}
                                  {patient.gender === 'male'
                                    ? 'Male'
                                    : patient.gender === 'female'
                                      ? 'Female'
                                      : patient.gender}
                                  {' • '}
                                  {patient.age} Yrs)
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={dropTest}
                          aria-label={`Remove ${testName}`}
                          className="p-1.5 text-error opacity-50 hover:bg-error-container hover:opacity-100 rounded-lg transition"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1 w-full min-w-0">
                        {testInfo?.options ? (
                          <Combobox
                            className="min-w-0 flex-1"
                            inputClassName="test-result-input w-full px-4 py-2.5 bg-surface-container-lowest border border-outline-variant/30 rounded-lg focus:border-accent focus:outline-none transition font-bold text-primary"
                            value={newReport.results[testName] || ''}
                            options={testInfo.options}
                            placeholder="Select or type result..."
                            ariaLabel={`Result for ${testName}`}
                            onChange={setResult}
                            onNavigate={handleInputKeyDown}
                          />
                        ) : (
                          <input
                            type="text"
                            inputMode={isNumericTest(testInfo) ? 'decimal' : undefined}
                            aria-label={`Result for ${testName}`}
                            value={newReport.results[testName] || ''}
                            onChange={e => setResult(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            className="test-result-input flex-1 min-w-0 px-4 py-2.5 bg-surface-container-lowest border border-outline-variant/30 rounded-lg focus:border-accent focus:outline-none transition font-bold text-primary"
                            placeholder={`Enter result...`}
                          />
                        )}
                        {testInfo?.unit && (
                          <span
                            className="text-xs font-bold text-on-surface-variant w-16 px-1 text-right shrink-0 truncate select-none animate-fade-in"
                            title={testInfo.unit}
                          >
                            {testInfo.unit}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="p-4 bg-secondary/10 rounded-2xl flex gap-4 items-start">
            <ShieldCheck className="w-6 h-6 text-secondary shrink-0" aria-hidden="true" />
            <div>
              <h5 className="text-xs font-bold text-on-surface mb-1">Stored on this device</h5>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Saving writes this dataset to the encrypted database on this device, linked to this
                patient and to {user?.displayName || 'you'} as the issuing operator. A finalised
                report can still be amended from the report view; each amendment raises its version
                number and records your reason.
              </p>
            </div>
          </div>
        </form>
      </Sheet>
      {/* Read-only viewing dashboard — card taps and Preview land here */}
      <ReportViewerDashboard
        report={viewerReport}
        patient={viewerReport ? patients.find(p => p.id === viewerReport.patientId) : undefined}
        onClose={() => setViewerReport(null)}
        onEdit={() => {
          if (viewerReport) openReportEditor(viewerReport);
          setViewerReport(null);
        }}
        onOutput={action => {
          // 'pdf' is the generated document in the device viewer / browser tab.
          if (viewerReport) patient_report(viewerReport, action === 'pdf' ? 'preview' : action);
        }}
      />
      {/* The Windows print sheet — desktop only, and it renders nothing at all
          on the other shells, so the APK/web print paths are untouched. */}
      <PrintDialog
        open={!!printJob}
        job={printJob}
        onClose={() => setPrintJob(null)}
        onPrinted={() => toast.success('Report sent to the printer.')}
      />
      {/* Report Details Modal */}
      <Sheet
        open={!!selectedReport}
        onClose={closeReportEditor}
        title={selectedReport ? `Report Details: ${selectedReport.patientName}` : 'Report Details'}
        description={
          selectedReport
            ? selectedReport.status === 'draft'
              ? 'Draft — not issued yet, so nothing has been printed as final.'
              : `Issued v${Number(selectedReport.version) || 1}` +
                (selectedReport.updatedAt
                  ? ` · amended ${new Date(selectedReport.updatedAt).toLocaleDateString('en-IN')}`
                  : '') +
                (selectedReport.amendReason ? ` · ${selectedReport.amendReason}` : '')
            : undefined
        }
        width="lg"
      >
        {selectedReport && (
          <div className="space-y-6">
            {recoveredDraft && (
              <div
                role="status"
                className="rounded-xl border border-warning/40 bg-warning-container/40 p-3 text-xs text-on-surface"
              >
                <p>
                  {editorBase &&
                  recoveredDraft.baseVersion === (editorBase.version ?? 1) &&
                  (recoveredDraft.baseUpdatedAt ?? '') === (editorBase.updatedAt ?? '')
                    ? `Unsaved report edits from ${new Date(recoveredDraft.savedAt).toLocaleString()} are available.`
                    : 'A newer saved report exists. Older unsaved edits were found but were not applied.'}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    disabled={
                      !!editorBase &&
                      (recoveredDraft.baseVersion !== (editorBase.version ?? 1) ||
                        (recoveredDraft.baseUpdatedAt ?? '') !== (editorBase.updatedAt ?? ''))
                    }
                    onClick={() => {
                      setSelectedReport(current =>
                        current ? { ...current, resultData: recoveredDraft.resultData } : current,
                      );
                      setReviewerUid(recoveredDraft.reviewer?.uid ?? '');
                      setReviewerName(recoveredDraft.reviewer?.name ?? '');
                      setCriticalReviewReason(recoveredDraft.criticalReviewReason ?? '');
                      setAmendReason(recoveredDraft.amendReason ?? '');
                      setDeltaReviewReason(recoveredDraft.deltaReviewReason ?? '');
                      setRecoveredDraft(null);
                    }}
                  >
                    Restore edits
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void clearReportDraft(recoveredDraft.reportId)
                        .then(() => setRecoveredDraft(null))
                        .catch(() => setDetailError('The local draft could not be discarded.'));
                    }}
                  >
                    Discard
                  </Button>
                </div>
              </div>
            )}
            {!recoveredDraft && draftSaveState !== 'idle' && (
              <p
                role="status"
                className={cn(
                  'text-xs',
                  draftSaveState === 'error' ? 'text-error' : 'text-on-surface-variant',
                )}
              >
                {draftSaveState === 'saving' &&
                  'Saving unsaved report edits in encrypted local storage…'}
                {draftSaveState === 'saved' &&
                  `Unsaved edits saved locally at ${new Date(draftSavedAt).toLocaleTimeString()}.`}
                {draftSaveState === 'error' &&
                  'Unsaved edits could not be saved locally. Keep this sheet open and use Save.'}
              </p>
            )}
            <div>
              <ReportResultsEditor
                testSelection={selectedReport.testSelection || []}
                testType={selectedReport.testType}
                results={asResultMap(selectedReport.resultData)}
                readOnly={!canEdit}
                onChange={(testName, next) =>
                  setSelectedReport({
                    ...selectedReport,
                    resultData: recalculateCBC(
                      asResultMap(selectedReport.resultData),
                      testName,
                      next,
                    ),
                  })
                }
                onNavigate={handleInputKeyDown}
              />
              {canEdit && (
                <div className="mt-3">
                  {detailError && (
                    <p
                      role="alert"
                      className="mb-3 flex items-start gap-2 rounded-lg bg-error-container/60 px-3 py-2 text-xs font-medium text-on-error-container"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{detailError}</span>
                    </p>
                  )}
                  {/* P0.4: editing a report that is already issued is an amendment
                      — it must state a reason, and the prior version is retained. */}
                  {selectedReport.status === 'final' && (
                    <div className="mb-3">
                      <label
                        htmlFor="amend-reason"
                        className="text-xs font-black text-primary uppercase mb-1 block"
                      >
                        Amendment reason (required)
                      </label>
                      <input
                        id="amend-reason"
                        type="text"
                        value={amendReason}
                        onChange={e => setAmendReason(e.target.value)}
                        placeholder="Why is this issued report being changed?"
                        className="w-full text-sm px-4 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:border-accent focus:outline-none transition"
                      />
                    </div>
                  )}
                  <Field
                    label="Independent pathologist reviewer"
                    hint="Required before issue or amendment and must be different from the issuing operator."
                    required
                  >
                    <select
                      className="w-full rounded-xl border border-outline-variant/40 bg-surface px-3 py-2 text-sm text-on-surface"
                      value={reviewerUid}
                      onChange={event => {
                        const profile = reviewers.find(item => item.uid === event.target.value);
                        setReviewerUid(event.target.value);
                        setReviewerName(profile?.name ?? '');
                      }}
                      required
                    >
                      <option value="">Select an independent pathologist</option>
                      {reviewers.map(profile => (
                        <option key={profile.uid} value={profile.uid}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {selectedValidation &&
                    selectedValidation.warnings.some(item => item.critical) && (
                      <Field
                        label="Clinical review reason for critical result"
                        hint="Required before issue or amendment; retained with operator and timestamp."
                        required
                      >
                        <TextInput
                          value={criticalReviewReason}
                          onChange={event => setCriticalReviewReason(event.target.value)}
                          placeholder="Required before issue or amendment"
                        />
                      </Field>
                    )}
                  {selectedValidation?.warnings.some(item => isDeltaWarning(item.message)) && (
                    <Field
                      label="Delta review reason"
                      hint="Required when a result changed materially from the previous issued report."
                      required
                    >
                      <TextInput
                        value={deltaReviewReason}
                        onChange={event => setDeltaReviewReason(event.target.value)}
                        placeholder="Why is the material change clinically expected?"
                      />
                    </Field>
                  )}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      onClick={() => handleSaveResults()}
                      disabled={savingResults}
                      className="px-4 py-2 bg-secondary text-on-secondary text-sm font-bold rounded-lg hover:opacity-90 transition flex items-center gap-2"
                    >
                      {savingResults ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : selectedReport.status === 'final' ? (
                        'Save amendment'
                      ) : (
                        'Save Results'
                      )}
                    </button>
                    {/* Drafts have no patient-facing copy and no signature of
                          record: issuing is the step that makes the report real. */}
                    {selectedReport.status === 'draft' && (
                      <button
                        onClick={() => handleSaveResults(undefined, true)}
                        disabled={savingResults || !canIssue}
                        className="px-4 py-2 bg-primary-container text-on-primary-container text-sm font-bold rounded-lg hover:opacity-90 transition flex items-center gap-2"
                      >
                        <FileSignature className="w-4 h-4" aria-hidden="true" />
                        Issue &amp; sign report
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {canEdit && (
              <div>
                <h4
                  id="private-notes-label"
                  className="text-xs font-black text-primary uppercase mb-2"
                >
                  Private Notes (Staff Only)
                </h4>
                <textarea
                  aria-labelledby="private-notes-label"
                  value={selectedReport.privateNotes || ''}
                  onChange={e =>
                    setSelectedReport({ ...selectedReport, privateNotes: e.target.value })
                  }
                  placeholder="Add private staff notes here..."
                  className="w-full text-sm px-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-xl focus:border-accent focus:outline-none transition min-h-[120px] resize-y"
                />
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={handleSaveNote}
                    disabled={savingNote}
                    className="px-4 py-2 bg-primary-container text-on-primary-container text-sm font-bold rounded-lg hover:opacity-90 transition flex items-center gap-2"
                  >
                    {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Note'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={!!reportToDelete}
        onClose={() => setReportToDelete(null)}
        onConfirm={async () => {
          if (!reportToDelete) return;
          try {
            // Only an unissued, unbilled draft can be removed. Issued reports and
            // financial documents are retained by the domain guard.
            await deleteReportCascade(reportToDelete.id);
            setReportToDelete(null);
            toast.success(`Report for ${reportToDelete.patientName} deleted.`);
          } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, 'reports');
            toast.error('Delete failed — nothing was removed.');
          }
        }}
        title="Delete Draft Report"
        confirmLabel="Delete"
        message={
          reportToDelete
            ? `Delete the unissued, unbilled draft for ${reportToDelete.patientName}? Issued reports and invoices cannot be hard-deleted.`
            : ''
        }
      />
    </div>
  );
}
