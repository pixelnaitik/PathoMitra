/**
 * Bills — the money desk.
 *
 * Everything about an invoice that is not the report: raise a bill from a
 * patient's order, print it, take payment against it, void one that was raised
 * in error, and read the day's collection.
 *
 * Why "raise a bill" reads the patient's *stored* order rather than the live
 * price list: a bill is a frozen document. `invoices/{id}.items[]` carries the
 * price as charged, so a reprint months later shows what was charged then, not
 * what the tariff says now. Editing a price here must therefore never change an
 * already-printed bill — that is the whole reason `items[]` is stored at all.
 *
 * The panel deliberately surfaces unpriced tests as its own warning strip. A bill
 * that silently prints `₹0` for a test the lab forgot to price is not a bug the
 * operator sees until a patient complains, and by then the money has gone.
 */
import { useMemo, useState, useEffect } from 'react';
import {
  Banknote,
  Receipt,
  Printer,
  Search,
  ShieldAlert,
  Trash2,
  FileDown,
  Plus,
  Loader2,
  XCircle,
  BadgeIndianRupee,
  Layers,
} from 'lucide-react';
import {
  Button,
  CalendarRangePicker,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  IconButton,
  ListGroup,
  ListRow,
  SearchField,
  SectionTitle,
  Select,
  Sheet,
  StatusPill,
  TextInput,
  useToast,
} from '../../components/ui';
import { useCollectionList, type ListFilter } from '../../hooks/useCollectionList';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import {
  balanceOf,
  buildInvoiceDraft,
  deleteInvoice,
  generateMissingBills,
  planMissingBills,
  raiseInvoice,
  recordPayment,
  voidInvoice,
  summarise,
  type InvoiceDraft,
  type MissingBillPlan,
  type MissingBillsResult,
} from '../../lib/invoices';
import {
  isInvoiceOutstanding,
  operatorStamp,
  readInvoices,
  readPatients,
  readDoctors,
  type InvoiceItem,
  type InvoiceRecord,
  type PatientRecord,
  type PaymentMode,
  type DoctorRecord,
} from '../../lib/models';
import {
  formatMoney,
  getBillingPrefs,
  getPriceList,
  loadPriceList,
  PRICE_LIST_UPDATED_EVENT,
  type PriceList,
} from '../../lib/price-list';
import { buildInvoicePdf, outputInvoicePdf, type InvoiceOutput } from '../../lib/invoice-pdf';
import { readSettings } from '../../lib/settings';
import { downloadCsv, toCsv } from '../../lib/export-csv';
import { createdAtRangeFilters } from '../../lib/date-range';
import { PrintDialog, type PrintJob } from '../../components/PrintDialog';

type StatusFilter = 'all' | 'outstanding' | 'paid' | 'void';

const MODE_LABEL: Record<PaymentMode, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank transfer',
  credit: 'Credit / on account',
  advance: 'Advance balance',
};

export default function BillsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const actor = operatorStamp(user);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** New-bill sheet. */
  const [newBillOpen, setNewBillOpen] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [discount, setDiscount] = useState('');
  const [taxPercent, setTaxPercent] = useState(() => String(getBillingPrefs().taxPercent));
  const [paidAmount, setPaidAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [creating, setCreating] = useState(false);

  /** Payment sheet. */
  const [payTarget, setPayTarget] = useState<InvoiceRecord | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState<PaymentMode>('cash');
  const [voidTarget, setVoidTarget] = useState<InvoiceRecord | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<InvoiceRecord | null>(null);
  const [detailTarget, setDetailTarget] = useState<InvoiceRecord | null>(null);

  /**
   * Bulk run. The plan is read from the store *before* the sheet opens, so the
   * operator confirms against a count they have seen rather than against the word
   * "generate" — and the result stays on screen afterwards with every patient that
   * was skipped and why, because a silent partial run is how a lab ends up with
   * unbilled patients it believes were done.
   */
  const [bulkPlan, setBulkPlan] = useState<MissingBillPlan | null>(null);
  const [bulkResult, setBulkResult] = useState<MissingBillsResult | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Prices can change from the Settings screen while this page is open. The
  // first read is async so the encrypted store (not just the mirror) has a say
  // before the register paints its totals.
  const [priceList, setPriceList] = useState<PriceList>(() => getPriceList());
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      if (!cancelled) setPriceList(getPriceList());
    };
    void loadPriceList().then(apply, apply);
    window.addEventListener(PRICE_LIST_UPDATED_EVENT, apply);
    return () => {
      cancelled = true;
      window.removeEventListener(PRICE_LIST_UPDATED_EVENT, apply);
    };
  }, []);

  const dateFilters = useMemo<ListFilter[]>(() => {
    const list: ListFilter[] = [];
    const { since, until } = createdAtRangeFilters(fromDate, toDate);
    if (since) list.push({ field: 'createdAt', op: '>=', value: since });
    if (until) list.push({ field: 'createdAt', op: '<=', value: until });
    return list;
  }, [fromDate, toDate]);

  const bills = useCollectionList<InvoiceRecord>({
    path: 'invoices',
    map: readInvoices,
    pageSize: 40,
    filters: dateFilters,
  });

  const patients = useCollectionList<PatientRecord>({
    path: 'patients',
    map: readPatients,
    pageSize: 500,
  });

  const doctors = useCollectionList<DoctorRecord>({
    path: 'doctors',
    map: readDoctors,
    pageSize: 200,
  });

  const rows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return bills.items.filter(invoice => {
      switch (statusFilter) {
        case 'outstanding':
          if (!isInvoiceOutstanding(invoice.status)) return false;
          break;
        case 'paid':
          if (invoice.status !== 'paid') return false;
          break;
        case 'void':
          if (invoice.status !== 'void') return false;
          break;
      }
      if (!term) return true;
      return (
        invoice.patientName.toLowerCase().includes(term) ||
        invoice.invoiceNo.toLowerCase().includes(term) ||
        invoice.doctorName.toLowerCase().includes(term) ||
        invoice.items.some(item => item.name.toLowerCase().includes(term))
      );
    });
  }, [bills.items, searchTerm, statusFilter]);

  const summary = useMemo(() => summarise(rows), [rows]);
  const unpricedBills = useMemo(
    () => rows.filter(invoice => invoice.items.some(item => item.unpriced)),
    [rows],
  );

  const selectedPatient = useMemo(
    () => patients.items.find(p => p.id === patientId) ?? null,
    [patientId, patients.items],
  );

  /**
   * The preview is derived, not stored. A draft recomputed in an effect would
   * render one total and then re-render another, and the operator could press
   * Print in the frame between the two.
   */
  const draft = useMemo<InvoiceDraft | null>(() => {
    if (!newBillOpen || !selectedPatient) return null;
    return buildInvoiceDraft({
      patient: selectedPatient,
      discount: Number(discount) || 0,
      taxPercent: Number(taxPercent) || 0,
      doctors: doctors.items,
      priceList,
      issuedBy: actor,
    });
  }, [actor, discount, doctors.items, newBillOpen, priceList, selectedPatient, taxPercent]);

  const patientOptions = useMemo(
    () =>
      patients.items
        .filter(p => (p.testSelection?.length ?? 0) > 0)
        .map(p => `${p.name} — ${p.id}`)
        .sort((a, b) => a.localeCompare(b)),
    [patients.items],
  );

  const runOutput = async (invoice: InvoiceRecord, action: InvoiceOutput) => {
    setBusyId(invoice.id);
    try {
      const built = await buildInvoicePdf({
        invoice,
        patient: patients.items.find(p => p.id === invoice.patientId) ?? null,
        settings: readSettings(),
      });
      const { printJob: job, message } = await outputInvoicePdf(
        built,
        `Bill ${invoice.invoiceNo || invoice.id}.pdf`,
        action,
        `Bill ${invoice.invoiceNo || invoice.id} — ${invoice.patientName}`,
      );
      if (job) setPrintJob(job);
      else if (message) toast.info(message);
    } catch (err) {
      console.error('Bill output failed:', err);
      toast.error('Could not build the bill PDF.');
    } finally {
      setBusyId(null);
    }
  };

  const createBill = async (then: InvoiceOutput | null) => {
    if (!selectedPatient) {
      toast.error('Pick a patient first.');
      return;
    }
    setCreating(true);
    try {
      const invoice = await raiseInvoice({
        patient: selectedPatient,
        discount: Number(discount) || 0,
        taxPercent: Number(taxPercent) || 0,
        paidAmount: Number(paidAmount) || 0,
        paymentMode: Number(paidAmount) > 0 ? paymentMode : undefined,
        doctors: doctors.items,
        issuedBy: actor,
      });
      toast.success(`Bill ${invoice.invoiceNo} raised — ${formatMoney(invoice.amount)}.`);
      setNewBillOpen(false);
      resetNewBill();
      if (then) await runOutput(invoice, then);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not raise the bill.');
    } finally {
      setCreating(false);
    }
  };

  const resetNewBill = () => {
    setPatientId('');
    setDiscount('');
    setPaidAmount('');
  };

  /** Read the bulk plan from the store, then ask before writing anything. */
  const openBulkRun = async () => {
    setBulkBusy(true);
    try {
      const plan = await planMissingBills();
      if (plan.billable.length === 0) {
        setBulkPlan(null);
        toast.info(
          plan.skipped.length === 0
            ? 'No patients are registered yet — nothing to bill.'
            : 'Every patient with an order already has a bill of their own.',
        );
        return;
      }
      setBulkResult(null);
      setBulkPlan(plan);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read the patients to bill.');
    } finally {
      setBulkBusy(false);
    }
  };

  const runBulk = async () => {
    if (!bulkPlan) return;
    setBulkBusy(true);
    try {
      const result = await generateMissingBills({
        doctors: doctors.items,
        issuedBy: actor,
        priceList,
      });
      setBulkPlan(null);
      setBulkResult(result);
      if (result.raised.length === 0) {
        toast.warning(`No bills were raised — ${result.skipped.length} patient(s) were skipped.`);
      } else {
        toast.success(
          `${result.raised.length} bill${result.raised.length === 1 ? '' : 's'} raised — ${formatMoney(result.billed)}` +
            (result.commission > 0
              ? `, ${formatMoney(result.commission)} commission stamped.`
              : '.'),
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The bills were not generated.');
    } finally {
      setBulkBusy(false);
    }
  };

  const applyPayment = async () => {
    if (!payTarget) return;
    setBusyId(payTarget.id);
    try {
      const amount = payAmount.trim() === '' ? payTarget.amount : Number(payAmount);
      const updated = await recordPayment(payTarget.id, {
        amount: Number.isFinite(amount) ? amount : 0,
        mode: payMode,
      });
      toast.success(
        updated.status === 'paid'
          ? `${updated.patientName}'s bill is settled.`
          : `Recorded ${formatMoney(updated.paidAmount)} of ${formatMoney(updated.amount)}.`,
      );
      setPayTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Payment not recorded.');
    } finally {
      setBusyId(null);
    }
  };

  const exportRegister = async () => {
    const csv = toCsv(
      [
        { label: 'Bill No', value: (i: InvoiceRecord) => i.invoiceNo || i.id },
        { label: 'Date', value: (i: InvoiceRecord) => i.createdAt },
        { label: 'Patient', value: (i: InvoiceRecord) => i.patientName },
        { label: 'Patient No', value: (i: InvoiceRecord) => i.patientId },
        { label: 'Doctor', value: (i: InvoiceRecord) => i.doctorName },
        {
          label: 'Items',
          value: (i: InvoiceRecord) => i.items.map(x => `${x.name} x${x.qty}`).join(' | '),
        },
        { label: 'Subtotal', value: (i: InvoiceRecord) => i.subtotal },
        { label: 'Discount', value: (i: InvoiceRecord) => i.discount },
        { label: 'Tax', value: (i: InvoiceRecord) => i.tax },
        { label: 'Total', value: (i: InvoiceRecord) => i.amount },
        { label: 'Paid', value: (i: InvoiceRecord) => i.paidAmount },
        { label: 'Balance', value: (i: InvoiceRecord) => balanceOf(i) },
        { label: 'Status', value: (i: InvoiceRecord) => i.status },
        { label: 'Mode', value: (i: InvoiceRecord) => i.paymentMode ?? '' },
        { label: 'Raised by', value: (i: InvoiceRecord) => i.issuedBy },
        {
          label: 'Referral commission',
          value: (i: InvoiceRecord) => i.referral?.commission ?? '',
        },
      ],
      rows,
    );
    const saved = await downloadCsv(`pathomitra-bills-${Date.now()}.csv`, csv);
    toast.success(saved ?? 'Bill register exported.');
  };

  const loading = bills.loading && bills.items.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex-1">
          <h2 className="text-2xl font-bold tracking-tight text-primary">Bills</h2>
          <p className="text-sm text-on-surface-variant">
            Raise a bill from a patient's order, print it, take payment, and read the day's
            collection.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" onClick={exportRegister} disabled={rows.length === 0}>
            <FileDown className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => void openBulkRun()}
            disabled={bulkBusy}
            title="Raise a bill for every registered patient who does not have one yet"
          >
            {bulkBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Layers className="h-4 w-4" aria-hidden="true" />
            )}
            Generate pending bills
          </Button>
          <Button
            variant="brand"
            size="lg"
            shine
            onClick={() => {
              setNewBillOpen(true);
              resetNewBill();
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New bill
          </Button>
        </div>
      </div>

      {/* What the last bulk run did — kept on screen until dismissed, because the
          skipped list is the part that needs a human afterwards. */}
      {bulkResult && (
        <Card pad="md" className="animate-rise-in">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-on-surface">
                {bulkResult.raised.length} of {bulkResult.attempted} pending patients billed —{' '}
                {formatMoney(bulkResult.billed)} raised
                {bulkResult.commission > 0
                  ? `, ${formatMoney(bulkResult.commission)} commission stamped`
                  : ''}
                .
              </p>
              {bulkResult.skipped.length > 0 && (
                <>
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                    Skipped, not billed
                  </p>
                  <ul className="mt-1 space-y-1 text-[13px] text-on-surface-variant">
                    {bulkResult.skipped.slice(0, 8).map(row => (
                      <li key={row.patientId}>
                        {row.name} — {row.reason}
                      </li>
                    ))}
                    {bulkResult.skipped.length > 8 && (
                      <li>… and {bulkResult.skipped.length - 8} more</li>
                    )}
                  </ul>
                </>
              )}
            </div>
            <IconButton
              label="Dismiss the bill-generation summary"
              size="sm"
              className="shrink-0 text-on-surface-variant"
              onClick={() => setBulkResult(null)}
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
        </Card>
      )}

      {/* Money strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MoneyCard
          label="Billed"
          value={formatMoney(summary.billed)}
          hint={`${summary.bills} bill${summary.bills === 1 ? '' : 's'}`}
          icon={<Receipt className="h-4 w-4" />}
        />
        <MoneyCard
          label="Collected"
          value={formatMoney(summary.collected)}
          hint={`discounts ${formatMoney(summary.discount)}`}
          icon={<Banknote className="h-4 w-4" />}
          tone="success"
        />
        <MoneyCard
          label="Outstanding"
          value={formatMoney(summary.outstanding)}
          hint={`${summary.unpaidBills} unpaid bill${summary.unpaidBills === 1 ? '' : 's'}`}
          icon={<BadgeIndianRupee className="h-4 w-4" />}
          tone={summary.outstanding > 0 ? 'warning' : 'neutral'}
        />
        <MoneyCard
          label="Referral payable"
          value={formatMoney(summary.commission)}
          hint="stamped on these bills"
          icon={<ShieldAlert className="h-4 w-4" />}
          tone="neutral"
        />
      </div>

      {unpricedBills.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning-container/40 px-4 py-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-on-surface">
              {unpricedBills.length} bill{unpricedBills.length === 1 ? '' : 's'} printed a test with
              no price
            </p>
            <p className="mt-0.5 text-xs text-on-surface-variant">
              Those lines went out as "not priced", not as ₹0. Set the tariff in Settings → Manage
              Tests, then reprint the bill from its own lines if the patient needs a corrected copy.
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card pad="sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <SearchField
            className="flex-1"
            placeholder="Search by patient, bill number, doctor or test…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onClear={() => setSearchTerm('')}
            aria-label="Search bills"
          />
          <CalendarRangePicker
            fromDate={fromDate}
            toDate={toDate}
            onChange={({ fromDate: from, toDate: to }) => {
              setFromDate(from);
              setToDate(to);
            }}
            className="w-full md:w-60"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(
            [
              ['all', 'All'],
              ['outstanding', 'Unpaid'],
              ['paid', 'Paid'],
              ['void', 'Cancelled'],
            ] as Array<[StatusFilter, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatusFilter(id)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                statusFilter === id
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-on-surface-variant hover:text-on-surface',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      {bills.error && (
        <p role="alert" className="rounded-xl bg-error-container px-3 py-2 text-xs text-error">
          {bills.error}
        </p>
      )}

      {/* Register */}
      {loading ? (
        <Card pad="none">
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-on-surface-variant">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading the bill register…
          </div>
        </Card>
      ) : rows.length === 0 ? (
        <Card pad="none">
          <EmptyState
            icon={<Search className="h-7 w-7" aria-hidden="true" />}
            title={
              bills.items.length === 0 ? 'No bills raised yet' : 'No bill matches these filters'
            }
            description={
              bills.items.length === 0
                ? 'Pick a patient with tests on their order and raise the first bill.'
                : `${bills.items.length} bill${bills.items.length === 1 ? '' : 's'} on record. Widen the date range or clear the search.`
            }
            action={
              bills.items.length === 0 ? (
                <Button
                  variant="brand"
                  onClick={() => {
                    setNewBillOpen(true);
                    resetNewBill();
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New bill
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchTerm('');
                    setStatusFilter('all');
                    setFromDate('');
                    setToDate('');
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <ListGroup>
            {rows.map(invoice => (
              <BillRow
                key={invoice.id}
                invoice={invoice}
                busy={busyId === invoice.id}
                onOpen={() => setDetailTarget(invoice)}
                onPrint={() => runOutput(invoice, 'print')}
                onPay={() => {
                  setPayTarget(invoice);
                  setPayAmount(String(balanceOf(invoice)));
                  setPayMode('cash');
                }}
                onVoid={() => {
                  setVoidTarget(invoice);
                  setVoidReason('');
                }}
                onDelete={() => setDeleteTarget(invoice)}
              />
            ))}
          </ListGroup>
          {bills.hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void bills.loadMore()}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      {/* --------------------------- bulk generation --------------------------- */}
      <ConfirmSheet
        open={!!bulkPlan}
        onClose={() => setBulkPlan(null)}
        onConfirm={() => void runBulk()}
        loading={bulkBusy}
        title="Generate pending bills"
        confirmLabel={`Raise ${bulkPlan?.billable.length ?? 0} bill${bulkPlan?.billable.length === 1 ? '' : 's'}`}
        message={
          <div className="space-y-2">
            <p>
              {bulkPlan?.billable.length ?? 0} registered patient
              {bulkPlan?.billable.length === 1 ? '' : 's'} have an order and no bill. A bill will be
              raised for each at the prices saved in Settings today, with the referring doctor’s
              commission stamped on it.
            </p>
            <p className="text-on-surface-variant">
              Bills already raised are never touched, and a patient with no tests on the order is
              skipped and listed afterwards. A test the tariff has no price for still becomes a
              bill, flagged by the warning below the money strip as it always has been.
            </p>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-[13px] text-on-surface-variant">
              {(bulkPlan?.billable ?? []).map(patient => (
                <li key={patient.id}>{patient.name}</li>
              ))}
            </ul>
          </div>
        }
      />

      {/* ------------------------------ new bill ------------------------------ */}
      <Sheet
        open={newBillOpen}
        onClose={() => setNewBillOpen(false)}
        title="New bill"
        width="lg"
        footer={
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="lg"
              disabled={creating || !draft || draft.items.length === 0}
              onClick={() => createBill('preview')}
            >
              Raise &amp; preview
            </Button>
            <Button
              variant="brand"
              size="lg"
              loading={creating}
              disabled={!draft || draft.items.length === 0}
              onClick={() => createBill('print')}
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Raise &amp; print
            </Button>
          </div>
        }
      >
        <div className="space-y-4 py-1">
          <Field
            label="Patient"
            hint="Only patients with tests on their order can be billed."
            required
          >
            <Select
              value={patientId}
              onChange={e => {
                const picked = e.target.value;
                const match = patientOptions.find(option => option.startsWith(`${picked} — `));
                setPatientId(match ? picked : e.target.value);
              }}
            >
              <option value="">Select a patient…</option>
              {patients.items
                .filter(p => (p.testSelection?.length ?? 0) > 0)
                .map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.id} ({p.testSelection?.length} tests)
                  </option>
                ))}
            </Select>
          </Field>

          {!selectedPatient ? (
            <p className="rounded-xl bg-surface-container px-3 py-3 text-xs text-on-surface-variant">
              Pick a patient to see the charges. A profile is one line and does not also charge its
              member tests.
            </p>
          ) : !draft || draft.items.length === 0 ? (
            <p className="rounded-xl bg-warning-container/40 px-3 py-3 text-xs text-on-surface-variant">
              {selectedPatient.name} has no orderable tests on record. Add tests on the Patients tab
              first.
            </p>
          ) : (
            <>
              <div className="overflow-hidden rounded-2xl border border-outline-variant/30">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-container-low/60">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Test / profile</th>
                      <th className="px-3 py-2 text-center font-semibold">Qty</th>
                      <th className="px-3 py-2 text-right font-semibold">Rate</th>
                      <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/40">
                    {draft.items.map((item: InvoiceItem) => (
                      <tr key={`${item.kind}-${item.name}`}>
                        <td className="px-3 py-2">
                          <span className="font-semibold text-on-surface">{item.name}</span>
                          {item.kind === 'panel' && (
                            <span className="ml-1.5 text-[10px] uppercase text-on-surface-variant">
                              profile · covers {item.covers.length}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums">{item.qty}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {item.unpriced ? (
                            <StatusPill tone="error">not priced</StatusPill>
                          ) : (
                            formatMoney(item.unitPrice)
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {item.unpriced ? '—' : formatMoney(item.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {draft.unpriced.length > 0 && (
                <p className="rounded-xl bg-error-container/50 px-3 py-2 text-xs text-error">
                  No price yet for: {draft.unpriced.join(', ')}. Price them in Settings → Manage
                  Tests, or the bill prints these lines unpriced.
                </p>
              )}

              <div className="grid grid-cols-1 gap-4 fold:grid-cols-3">
                <Field label="Discount (₹)">
                  <TextInput
                    value={discount}
                    onChange={e => setDiscount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </Field>
                <Field label="Tax (%)">
                  <TextInput
                    value={taxPercent}
                    onChange={e => setTaxPercent(e.target.value)}
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Paid now (₹)">
                  <TextInput
                    value={paidAmount}
                    onChange={e => setPaidAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </Field>
              </div>

              {Number(paidAmount) > 0 && (
                <Field label="Payment mode">
                  <Select
                    value={paymentMode}
                    onChange={e => setPaymentMode(e.target.value as PaymentMode)}
                  >
                    {(Object.keys(MODE_LABEL) as PaymentMode[]).map(mode => (
                      <option key={mode} value={mode}>
                        {MODE_LABEL[mode]}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <Card pad="sm">
                <dl className="space-y-1 text-sm">
                  <MoneyLine label="Subtotal" value={formatMoney(draft.totals.subtotal)} />
                  {draft.totals.discount > 0 && (
                    <MoneyLine label="Discount" value={`- ${formatMoney(draft.totals.discount)}`} />
                  )}
                  {draft.totals.tax > 0 && (
                    <MoneyLine
                      label={`Tax @ ${draft.totals.taxPercent}%`}
                      value={formatMoney(draft.totals.tax)}
                    />
                  )}
                  <MoneyLine label="Total" value={formatMoney(draft.totals.amount)} strong />
                  {draft.referral && draft.referral.percent > 0 && (
                    <div className="mt-2 border-t border-outline-variant/30 pt-2">
                      <MoneyLine
                        label={`Referral to ${draft.referral.doctorName} (${draft.referral.percent}%)`}
                        value={formatMoney(draft.referral.commission)}
                      />
                      <p className="mt-1 text-[11px] text-on-surface-variant">
                        Internal only — this line never prints on the patient's copy.
                      </p>
                    </div>
                  )}
                </dl>
              </Card>
            </>
          )}
        </div>
      </Sheet>

      {/* ------------------------------ payment ------------------------------ */}
      <Sheet
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        title={payTarget ? `Payment — ${payTarget.patientName}` : 'Payment'}
        width="sm"
        footer={
          <div className="flex gap-3">
            <Button variant="outline" size="lg" fullWidth onClick={() => setPayTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              size="lg"
              fullWidth
              loading={busyId === payTarget?.id}
              onClick={applyPayment}
            >
              Record payment
            </Button>
          </div>
        }
      >
        {payTarget && (
          <div className="space-y-4 py-1">
            <p className="text-sm text-on-surface-variant">
              Bill {payTarget.invoiceNo || payTarget.id} — total{' '}
              <strong>{formatMoney(payTarget.amount)}</strong>, already collected{' '}
              <strong>{formatMoney(payTarget.paidAmount)}</strong>.
            </p>
            <Field label="Amount received (₹)" hint="Leave blank for the full balance.">
              <TextInput
                value={payAmount}
                onChange={e => setPayAmount(e.target.value)}
                inputMode="decimal"
              />
            </Field>
            <Field label="Mode">
              <Select value={payMode} onChange={e => setPayMode(e.target.value as PaymentMode)}>
                {(Object.keys(MODE_LABEL) as PaymentMode[]).map(mode => (
                  <option key={mode} value={mode}>
                    {MODE_LABEL[mode]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </Sheet>

      {/* ------------------------------- details ------------------------------ */}
      <Sheet
        open={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        title={detailTarget ? `Bill ${detailTarget.invoiceNo || detailTarget.id}` : 'Bill'}
        width="md"
        footer={
          <div className="flex gap-3">
            <Button variant="outline" size="lg" fullWidth onClick={() => setDetailTarget(null)}>
              Close
            </Button>
            <Button
              variant="brand"
              size="lg"
              fullWidth
              disabled={!detailTarget}
              onClick={() => detailTarget && runOutput(detailTarget, 'print')}
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Reprint
            </Button>
          </div>
        }
      >
        {detailTarget && (
          <div className="space-y-3 py-1">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <DetailCell label="Patient" value={detailTarget.patientName} />
              <DetailCell label="Registered" value={detailTarget.patientId} />
              <DetailCell label="Date" value={formatDate(detailTarget.createdAt)} />
              <DetailCell label="Raised by" value={detailTarget.issuedBy || '—'} />
              <DetailCell label="Referrer" value={detailTarget.doctorName || 'Self'} />
              <DetailCell label="Status" value={detailTarget.status} />
            </dl>
            <Card pad="sm">
              <SectionTitle title="As printed" />
              <ul className="mt-2 space-y-1 text-xs">
                {detailTarget.items.map((item, idx) => (
                  <li key={`${item.name}-${idx}`} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">
                      {item.name}
                      {item.qty > 1 ? ` ×${item.qty}` : ''}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {item.unpriced ? 'not priced' : formatMoney(item.lineTotal)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 space-y-1 border-t border-outline-variant/30 pt-2 text-sm">
                <MoneyLine label="Subtotal" value={formatMoney(detailTarget.subtotal)} />
                {detailTarget.discount > 0 && (
                  <MoneyLine label="Discount" value={`- ${formatMoney(detailTarget.discount)}`} />
                )}
                {detailTarget.tax > 0 && (
                  <MoneyLine
                    label={`Tax @ ${detailTarget.taxPercent}%`}
                    value={formatMoney(detailTarget.tax)}
                  />
                )}
                <MoneyLine label="Total" value={formatMoney(detailTarget.amount)} strong />
                <MoneyLine label="Paid" value={formatMoney(detailTarget.paidAmount)} />
                {balanceOf(detailTarget) > 0 && (
                  <MoneyLine label="Balance" value={formatMoney(balanceOf(detailTarget))} strong />
                )}
              </div>
            </Card>
            {detailTarget.notes && (
              <p className="rounded-xl bg-surface-container px-3 py-2 text-xs text-on-surface-variant">
                {detailTarget.notes}
              </p>
            )}
            {detailTarget.voidReason && (
              <p className="rounded-xl bg-error-container/50 px-3 py-2 text-xs text-error">
                Voided: {detailTarget.voidReason}
              </p>
            )}
          </div>
        )}
      </Sheet>

      {/* A void needs a reason typed into it, so it is a Sheet rather than a
          ConfirmSheet — the confirm surface has no room for a field. */}
      <Sheet
        open={!!voidTarget}
        onClose={() => setVoidTarget(null)}
        title={voidTarget ? `Cancel bill ${voidTarget.invoiceNo || voidTarget.id}` : 'Cancel bill'}
        width="sm"
        footer={
          <div className="flex gap-3">
            <Button variant="outline" size="lg" fullWidth onClick={() => setVoidTarget(null)}>
              Keep the bill
            </Button>
            <Button
              variant="danger"
              size="lg"
              fullWidth
              disabled={voidReason.trim() === ''}
              loading={busyId === voidTarget?.id}
              onClick={async () => {
                if (!voidTarget) return;
                setBusyId(voidTarget.id);
                try {
                  await voidInvoice(voidTarget.id, voidReason, actor);
                  toast.info(`Bill ${voidTarget.invoiceNo || voidTarget.id} cancelled.`);
                  setVoidTarget(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Nothing was changed.');
                } finally {
                  setBusyId(null);
                }
              }}
            >
              Cancel bill
            </Button>
          </div>
        }
      >
        <div className="space-y-3 py-1">
          <p className="text-sm text-on-surface-variant">
            The bill stays on record and drops out of every money total. A printed copy the patient
            already holds does not disappear.
          </p>
          <Field
            label="Reason"
            required
            hint="Kept on the record — a gap nobody can explain is worse."
          >
            <TextInput
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
              placeholder="Raised for the wrong patient"
            />
          </Field>
        </div>
      </Sheet>

      <ConfirmSheet
        open={!!deleteTarget}
        title="Delete bill record"
        confirmLabel="Delete"
        message="This removes the bill entirely — not a cancellation. Use it only for a bill that was never printed and never paid."
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteInvoice(deleteTarget.id);
            toast.info('Bill record deleted.');
            setDeleteTarget(null);
          } catch (err) {
            toast.error('Delete failed.');
            console.error(err);
          }
        }}
      />

      <PrintDialog
        open={!!printJob}
        job={printJob}
        onClose={() => setPrintJob(null)}
        onPrinted={() => toast.success('Bill sent to the printer.')}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function BillRow({
  invoice,
  busy,
  onOpen,
  onPrint,
  onPay,
  onVoid,
  onDelete,
}: {
  invoice: InvoiceRecord;
  busy: boolean;
  onOpen: () => void;
  onPrint: () => void;
  onPay: () => void;
  onVoid: () => void;
  onDelete: () => void;
}) {
  const balance = balanceOf(invoice);
  const tone =
    invoice.status === 'paid'
      ? 'success'
      : invoice.status === 'void'
        ? 'neutral'
        : invoice.status === 'partial'
          ? 'warning'
          : 'error';
  return (
    <ListRow
      title={
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate">{invoice.patientName || 'Unnamed patient'}</span>
          <StatusPill tone={tone}>{invoice.status}</StatusPill>
          {invoice.items.some(item => item.unpriced) && (
            <StatusPill tone="warning">unpriced line</StatusPill>
          )}
          {invoice.referral && invoice.referral.commission > 0 && (
            <StatusPill tone="info">referral</StatusPill>
          )}
        </span>
      }
      subtitle={`${invoice.invoiceNo || invoice.id} · ${formatDate(invoice.createdAt)} · ${invoice.items.length} line${invoice.items.length === 1 ? '' : 's'} · ${formatMoney(invoice.amount)}${balance > 0 ? ` · ${formatMoney(balance)} due` : ''}`}
      primaryLabel={`Open bill for ${invoice.patientName}`}
      onClick={onOpen}
      trailing={
        <div className="flex items-center gap-1">
          {busy && (
            <Loader2 className="h-4 w-4 animate-spin text-on-surface-variant" aria-hidden="true" />
          )}
          <IconButton
            label={`Print bill for ${invoice.patientName}`}
            size="sm"
            className="text-on-surface-variant hover:bg-accent/12 hover:text-accent"
            onClick={e => {
              e.stopPropagation();
              onPrint();
            }}
          >
            <Printer className="h-4 w-4" />
          </IconButton>
          {isInvoiceOutstanding(invoice.status) && (
            <IconButton
              label={`Record payment for ${invoice.patientName}`}
              size="sm"
              className="text-on-surface-variant hover:bg-success-container hover:text-on-success-container"
              onClick={e => {
                e.stopPropagation();
                onPay();
              }}
            >
              <Banknote className="h-4 w-4" />
            </IconButton>
          )}
          {invoice.status !== 'void' && (
            <IconButton
              label={`Cancel bill for ${invoice.patientName}`}
              size="sm"
              className="text-on-surface-variant hover:bg-error-container hover:text-error"
              onClick={e => {
                e.stopPropagation();
                onVoid();
              }}
            >
              <XCircle className="h-4 w-4" />
            </IconButton>
          )}
          {invoice.status === 'void' && (
            <IconButton
              label={`Delete voided bill for ${invoice.patientName}`}
              size="sm"
              className="text-on-surface-variant hover:bg-error-container hover:text-error"
              onClick={e => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      }
    />
  );
}

function MoneyCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-on-success-container bg-success-container'
      : tone === 'warning'
        ? 'text-on-warning-container bg-warning-container'
        : 'text-on-surface-variant bg-surface-container-high';
  return (
    <Card pad="sm" className="min-w-0">
      <div className="flex items-center gap-2">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-xl', toneClass)}>
          {icon}
        </span>
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
          {label}
        </p>
      </div>
      <p className="mt-2 truncate text-xl font-bold tabular-nums text-on-surface">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-on-surface-variant">{hint}</p>
    </Card>
  );
}

function MoneyLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd
        className={cn(
          'tabular-nums',
          strong ? 'text-base font-bold text-on-surface' : 'text-on-surface',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
        {label}
      </dt>
      <dd className="truncate text-on-surface">{value}</dd>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(String(iso ?? ''));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
