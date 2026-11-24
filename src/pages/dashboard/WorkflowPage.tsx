import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, FlaskConical, Plus, Printer, RefreshCw, Search, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/utils';
import { getRepository } from '../../data';
import type { LocalDoc } from '../../data/types';
import {
  OrderSchema,
  SampleSchema,
  operatorStamp,
  type OrderRecord,
  type OrderStatus,
  type SampleRecord,
  type SampleStatus,
} from '../../lib/models';
import {
  amendOrder,
  collectionToReceiptHours,
  createOrderWithSamples,
  createRecollection,
  hoursSinceCollection,
  recordCustodyEvent,
  transitionOrder,
  transitionSample,
  verifyCustodyChain,
} from '../../lib/clinical-workflow';
import { getSearchableTests, searchPathologyTests } from '../../lib/pathology-tests';
import { formatMoney, getPriceList, resolvePriceDetails } from '../../lib/price-list';
import { Button, Card, EmptyState, Field, SectionTitle, Sheet, TextArea, TextInput, useToast } from '../../components/ui';
import { PrintDialog, type PrintJob } from '../../components/PrintDialog';
import { buildSampleLabelPdf } from '../../lib/sample-label';
import { outputInvoicePdf } from '../../lib/invoice-pdf';

type Mode = 'orders' | 'samples';

const ORDER_STATUSES: OrderStatus[] = ['ordered', 'collected', 'processing', 'resulted', 'issued', 'billed', 'cancelled', 'amended'];
const SAMPLE_STATUSES: SampleStatus[] = ['expected', 'collected', 'received', 'processing', 'rejected', 'lost', 'disposed'];

function parseOrder(doc: LocalDoc): OrderRecord {
  return OrderSchema.parse({ id: doc.id, ...doc.data() }) as OrderRecord;
}

function parseSample(doc: LocalDoc): SampleRecord {
  return SampleSchema.parse({ id: doc.id, ...doc.data() }) as SampleRecord;
}

function formatWhen(value?: string): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid timestamp' : date.toLocaleString();
}

export default function WorkflowPage({
  mode,
  initialOrderId,
  initialSampleId,
  clearInitial,
}: {
  mode: Mode;
  initialOrderId?: string | null;
  initialSampleId?: string | null;
  clearInitial?: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const repo = getRepository();
  const [records, setRecords] = useState<Array<OrderRecord | SampleRecord>>([]);
  const [patients, setPatients] = useState<Array<{ id: string; name: string; doctorName?: string }>>([]);
  const [doctors, setDoctors] = useState<Array<{ id: string; name: string }>>([]);
  const [samples, setSamples] = useState<SampleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | OrderStatus | SampleStatus>('all');
  const [selected, setSelected] = useState<OrderRecord | SampleRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<{ kind: 'reason' | 'custody' | 'collection'; title: string; confirmLabel: string; target?: OrderStatus | SampleStatus | 'recollect' } | null>(null);
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');
  const [custodyAction, setCustodyAction] = useState<'transferred' | 'aliquoted' | 'stored'>('transferred');
  const [collectionSource, setCollectionSource] = useState('');
  const [collectionSite, setCollectionSite] = useState('');
  const [collectionTemperature, setCollectionTemperature] = useState('');
  const [collectionContainer, setCollectionContainer] = useState('');
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [workDocs, patientDocs, doctorDocs, sampleDocs] = await Promise.all([
        repo.list(mode === 'orders' ? 'orders' : 'samples'),
        repo.list('patients'),
        repo.list('doctors'),
        repo.list('samples'),
      ]);
      setRecords(workDocs.map(doc => (mode === 'orders' ? parseOrder(doc) : parseSample(doc))));
      setPatients(patientDocs.map(doc => ({ id: doc.id, name: String(doc.data().name ?? ''), doctorName: doc.data().doctorName as string | undefined })));
      setDoctors(doctorDocs.map(doc => ({ id: doc.id, name: String(doc.data().name ?? '') })));
      setSamples(sampleDocs.map(parseSample));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The workflow register could not be read.');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [mode, repo]);

  useEffect(() => {
    queueMicrotask(() => void load());
    const entity = mode === 'orders' ? 'orders' : 'samples';
    const fail = () => setError('The workflow register stopped updating. Retry the read.');
    const unsubscribeWork = repo.subscribe(entity, docs => {
      setRecords(docs.map(doc => (mode === 'orders' ? parseOrder(doc) : parseSample(doc))));
    }, fail);
    const unsubscribePatients = repo.subscribe('patients', docs => {
      setPatients(docs.map(doc => ({ id: doc.id, name: String(doc.data().name ?? ''), doctorName: doc.data().doctorName as string | undefined, doctorId: doc.data().doctorId as string | undefined })));
    }, fail);
    const unsubscribeDoctors = repo.subscribe('doctors', docs => {
      setDoctors(docs.map(doc => ({ id: doc.id, name: String(doc.data().name ?? '') })));
    }, fail);
    const unsubscribeSamples = repo.subscribe('samples', docs => setSamples(docs.map(parseSample)), fail);
    return () => {
      unsubscribeWork();
      unsubscribePatients();
      unsubscribeDoctors();
      unsubscribeSamples();
    };
  }, [load, mode, repo]);

  useEffect(() => {
    const id = mode === 'orders' ? initialOrderId : initialSampleId;
    if (!id) return;
    void repo.get(mode === 'orders' ? 'orders' : 'samples', id).then(doc => {
      if (doc) setSelected(mode === 'orders' ? parseOrder(doc) : parseSample(doc));
      else toast.error('That workflow record no longer exists.');
      clearInitial?.();
    });
  }, [clearInitial, initialOrderId, initialSampleId, mode, repo, toast]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records
      .filter(record => status === 'all' || record.status === status)
      .filter(record => {
        if (!needle) return true;
        const values = mode === 'orders'
          ? [(record as OrderRecord).orderNo, (record as OrderRecord).patientName, ...(record as OrderRecord).items.map(item => item.name)]
          : [(record as SampleRecord).accessionNo, (record as SampleRecord).barcode, (record as SampleRecord).specimen];
        return values.some(value => String(value ?? '').toLowerCase().includes(needle));
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [mode, query, records, status]);

  const selectedSamples = selected && mode === 'orders'
    ? samples.filter(sample => sample.orderId === selected.id)
    : [];

  const run = async <T,>(task: () => Promise<T>, success: string): Promise<T | null> => {
    setBusy(true);
    try {
      const result = await task();
      toast.success(success);
      setAction(null);
      setReason('');
      setLocation('');
      await load();
      if (selected) {
        const entity = mode === 'orders' ? 'orders' : 'samples';
        const fresh = await repo.get(entity, selected.id);
        setSelected(fresh ? (mode === 'orders' ? parseOrder(fresh) : parseSample(fresh)) : null);
      }
      return result;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The workflow change could not be saved.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const orderAction = (next: OrderStatus) => {
    if (!selected || mode !== 'orders') return;
    if (next === 'cancelled' || next === 'amended') {
      setAction({ kind: 'reason', title: next === 'cancelled' ? 'Cancel order' : 'Amend order', confirmLabel: next === 'cancelled' ? 'Cancel order' : 'Mark amended', target: next });
      return;
    }
    void run(() => transitionOrder(selected.id, next, operatorStamp(user)), `Order marked ${next}.`);
  };

  const sampleAction = (next: SampleStatus) => {
    if (!selected || mode !== 'samples') return;
    if (next === 'collected') {
      const sample = selected as SampleRecord;
      setCollectionSource(sample.source);
      setCollectionSite(sample.collectionSite ?? '');
      setCollectionTemperature(sample.temperatureC === undefined ? '' : String(sample.temperatureC));
      setCollectionContainer(sample.container);
      setAction({ kind: 'collection', title: 'Collect sample', confirmLabel: 'Record collection', target: next });
      return;
    }
    if (next === 'rejected' || next === 'lost') {
      setAction({ kind: 'reason', title: `Mark sample ${next}`, confirmLabel: `Mark ${next}`, target: next });
      return;
    }
    void run(() => transitionSample(selected.id, next, operatorStamp(user)), `Sample marked ${next}.`);
  };

  const submitAction = async () => {
    if (!selected || !action) return;
    if (action.kind === 'collection') {
      const sample = selected as SampleRecord;
      const temperature = collectionTemperature.trim() === '' ? undefined : Number(collectionTemperature);
      if (temperature !== undefined && !Number.isFinite(temperature)) throw new Error('Temperature must be numeric.');
      await run(() => transitionSample(sample.id, 'collected', operatorStamp(user), {
        source: collectionSource,
        collectionSite: collectionSite,
        temperatureC: temperature,
        container: collectionContainer,
      }), 'Collection metadata and custody event recorded.');
    } else if (action.kind === 'reason') {
      if (!action.target) throw new Error('The requested workflow action is incomplete.');
      if (action.target === 'recollect') {
        await run(() => createRecollection((selected as SampleRecord).id, operatorStamp(user), reason), action.confirmLabel);
      } else if (mode === 'orders' && action.target === 'amended') {
        const amended = await run(
          () => amendOrder((selected as OrderRecord).id, operatorStamp(user), reason),
          'Replacement order created.',
        );
        if (amended) setSelected(amended.replacement);
      } else {
        await run(
          async () => mode === 'orders'
            ? transitionOrder((selected as OrderRecord).id, action.target as OrderStatus, operatorStamp(user), reason)
            : transitionSample((selected as SampleRecord).id, action.target as SampleStatus, operatorStamp(user), { reason }),
          action.confirmLabel,
        );
      }
    } else {
      await run(
        () => recordCustodyEvent((selected as SampleRecord).id, custodyAction, operatorStamp(user), { location, note: reason }),
        'Custody event recorded.',
      );
    }
  };

  const printSampleLabel = async (sample: SampleRecord) => {
    const duplicates = await repo.list('samples', { where: [{ field: 'accessionNo', op: '==', value: sample.accessionNo }] });
    if (duplicates.length !== 1) throw new Error('Accession labels require exactly one matching sample.');
    const built = await buildSampleLabelPdf(sample, patients.find(patient => patient.id === sample.patientId)?.name ?? sample.patientId);
    const { printJob: job, message } = await outputInvoicePdf(built, `Accession ${sample.accessionNo}.pdf`, 'print', 'Specimen label');
    if (job) setPrintJob(job);
    else if (message) toast.info(message);
  };

  return (
    <div className="page-min-h space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Laboratory workflow</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-on-surface">{mode === 'orders' ? 'Orders' : 'Samples & custody'}</h1>
          <p className="mt-1 max-w-2xl text-sm text-on-surface-variant">
            {mode === 'orders'
              ? 'Track each requisition from acceptance through collection, processing, result, issue, and billing.'
              : 'Track accessions, collection milestones, rejection, recollection, storage, and every custody handoff.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} aria-label="Refresh workflow register"><RefreshCw className="h-4 w-4" aria-hidden="true" /></Button>
          {mode === 'orders' && <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" />New order</Button>}
        </div>
      </header>

      <Card pad="sm" className="grid gap-3 md:grid-cols-[1fr_auto]">
        <label className="relative block">
          <span className="sr-only">Search {mode}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" aria-hidden="true" />
          <input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
                      if (event.key !== 'Enter' || mode !== 'samples') return;
                      const exact = records.filter(record => (record as SampleRecord).barcode === query.trim() || (record as SampleRecord).accessionNo === query.trim());
                      if (exact.length === 1) setSelected(exact[0]);
                    }} className="h-11 w-full rounded-xl border border-outline-variant bg-surface pl-10 pr-10 text-sm" placeholder={mode === 'orders' ? 'Search order, patient, or test' : 'Scan barcode or search accession/specimen'} />
          {query && <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1" aria-label="Clear search"><X className="h-4 w-4" aria-hidden="true" /></button>}
        </label>
        <label className="flex items-center gap-2 text-sm text-on-surface-variant">
          Status
          <select value={status} onChange={event => setStatus(event.target.value as typeof status)} className="h-11 rounded-xl border border-outline-variant bg-surface px-3 text-on-surface">
            <option value="all">All</option>
            {(mode === 'orders' ? ORDER_STATUSES : SAMPLE_STATUSES).map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </Card>

      {error && <div role="alert" className="rounded-2xl border border-error/30 bg-error-container p-4 text-sm text-on-error-container">{error}</div>}

      <section aria-busy={loading}>
        <SectionTitle title={mode === 'orders' ? 'Requisitions' : 'Accessions'} subtitle={`${filtered.length} shown`} />
        {loading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(value => <div key={value} className="h-40 animate-pulse rounded-3xl bg-surface-container" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={mode === 'orders' ? <ClipboardList /> : <FlaskConical />} title={query || status !== 'all' ? 'No matching records' : mode === 'orders' ? 'No orders yet' : 'No samples yet'} description={mode === 'orders' ? 'Create an order to freeze its tests, provider, priority, and tariff.' : 'Create an order first; its expected specimens appear here.'} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map(record => {
              const order = mode === 'orders' ? record as OrderRecord : null;
              const sample = mode === 'samples' ? record as SampleRecord : null;
              return (
                <button key={record.id} type="button" onClick={() => setSelected(record)} className="rounded-3xl border border-outline-variant/50 bg-surface-container-lowest p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-on-surface">{order?.patientName ?? sample?.specimen ?? 'Specimen not set'}</p>
                      <p className="mt-1 text-xs font-medium text-accent">{order?.orderNo ?? sample?.accessionNo}</p>
                    </div>
                    <span className="rounded-full bg-surface-container px-2.5 py-1 text-xs font-semibold capitalize text-on-surface-variant">{record.status}</span>
                  </div>
                  <p className="mt-4 line-clamp-2 text-sm text-on-surface-variant">{order ? order.items.map(item => item.name).join(', ') : `${sample?.container || 'Container not set'} · ${sample?.orderId.slice(0, 8) || 'No order'}`}</p>
                  <div className="mt-4 flex items-center justify-between text-xs text-on-surface-variant">
                    <span>{order ? `${order.items.length} test${order.items.length === 1 ? '' : 's'}` : formatWhen(sample?.collectedAt)}</span>
                    <span>{order?.priority ?? (sample ? `${collectionToReceiptHours(sample) ?? '—'} h transit` : '')}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <CreateOrderSheet open={createOpen} onClose={() => setCreateOpen(false)} patients={patients} doctors={doctors} actor={operatorStamp(user)} onCreated={async () => { setCreateOpen(false); await load(); }} />

      <Sheet open={Boolean(selected)} onClose={() => setSelected(null)} title={selected && mode === 'orders' ? (selected as OrderRecord).orderNo : selected ? (selected as SampleRecord).accessionNo : 'Workflow record'} description={selected && mode === 'orders' ? (selected as OrderRecord).patientName : selected ? formatWhen((selected as SampleRecord).collectedAt) : undefined} width="lg" footer={selected && mode === 'orders' ? (
        <div className="flex flex-wrap justify-end gap-2">
          {!['cancelled', 'amended'].includes((selected as OrderRecord).status) && <Button variant="outline" onClick={() => orderAction('amended')}>Amend</Button>}
          {(selected as OrderRecord).status === 'ordered' && <Button variant="outline" onClick={() => setAction({ kind: 'reason', title: 'Cancel order', confirmLabel: 'Cancel order', target: 'cancelled' })}>Cancel</Button>}
          {(selected as OrderRecord).status === 'ordered' && <Button onClick={() => orderAction('collected')} disabled={selectedSamples.length === 0 || selectedSamples.some(sample => !['collected', 'received', 'processing'].includes(sample.status))}>Mark collected</Button>}
          {(selected as OrderRecord).status === 'collected' && <Button onClick={() => orderAction('processing')}>Start processing</Button>}
          {(selected as OrderRecord).status === 'processing' && <Button onClick={() => orderAction('resulted')}>Mark resulted</Button>}
          {(selected as OrderRecord).status === 'resulted' && <Button onClick={() => orderAction('issued')}>Mark issued</Button>}
          {(selected as OrderRecord).status === 'issued' && <Button onClick={() => orderAction('billed')}>Mark billed</Button>}
        </div>
      ) : selected && mode === 'samples' ? (
        <div className="flex flex-wrap justify-end gap-2">
          {(selected as SampleRecord).status === 'expected' && <><Button variant="outline" onClick={() => setAction({ kind: 'reason', title: 'Mark sample lost', confirmLabel: 'Mark lost', target: 'lost' })}>Mark lost</Button><Button onClick={() => sampleAction('collected')}>Collect</Button></>}
          {(selected as SampleRecord).status === 'collected' && <><Button variant="outline" onClick={() => setAction({ kind: 'reason', title: 'Mark sample rejected', confirmLabel: 'Mark rejected', target: 'rejected' })}>Reject</Button><Button onClick={() => sampleAction('received')}>Receive</Button></>}
          {(selected as SampleRecord).status === 'received' && <><Button variant="outline" onClick={() => setAction({ kind: 'reason', title: 'Mark sample rejected', confirmLabel: 'Mark rejected', target: 'rejected' })}>Reject</Button><Button onClick={() => sampleAction('processing')}>Start processing</Button></>}
          {['processing', 'rejected', 'lost'].includes((selected as SampleRecord).status) && (selected as SampleRecord).status !== 'disposed' && <Button variant="outline" onClick={() => setAction({ kind: 'reason', title: 'Dispose sample', confirmLabel: 'Dispose', target: 'disposed' })}>Dispose</Button>}
          {['rejected', 'lost'].includes((selected as SampleRecord).status) && <Button onClick={() => setAction({ kind: 'reason', title: 'Recollect sample', confirmLabel: 'Create recollection', target: 'recollect' })}>Recollect</Button>}
          {!['disposed', 'rejected', 'lost'].includes((selected as SampleRecord).status) && <Button variant="outline" onClick={() => setAction({ kind: 'custody', title: 'Record custody event', confirmLabel: 'Record event' })}>Custody event</Button>}
        </div>
      ) : undefined}>
        {selected && mode === 'orders' ? <OrderDetail order={selected as OrderRecord} samples={selectedSamples} /> : selected ? <SampleDetail sample={selected as SampleRecord} now={new Date()} onPrintLabel={() => void printSampleLabel(selected as SampleRecord).catch(err => toast.error(err instanceof Error ? err.message : 'Label could not be prepared.'))} /> : null}
      </Sheet>

      <Sheet open={Boolean(action)} onClose={() => { setAction(null); setReason(''); setLocation(''); }} title={action?.title} width="md" footer={<><Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button><Button onClick={() => void submitAction()} loading={busy} disabled={(action?.kind === 'reason' && !reason.trim()) || (action?.kind === 'collection' && !collectionSource.trim())}>{action?.confirmLabel}</Button></>}>
        <div className="space-y-4">
          {action?.kind === 'collection' && <div className="grid gap-3 sm:grid-cols-2"><Field label="Specimen source" required><TextInput value={collectionSource} onChange={event => setCollectionSource(event.target.value)} placeholder="Blood / urine / tissue source" /></Field><Field label="Collection site"><TextInput value={collectionSite} onChange={event => setCollectionSite(event.target.value)} placeholder="Ward, OPD, home collection" /></Field><Field label="Temperature (°C)"><TextInput type="number" value={collectionTemperature} onChange={event => setCollectionTemperature(event.target.value)} /></Field><Field label="Actual container"><TextInput value={collectionContainer} onChange={event => setCollectionContainer(event.target.value)} /></Field></div>}
          {action?.kind === 'custody' && <Field label="Custody action"><select value={custodyAction} onChange={event => setCustodyAction(event.target.value as typeof custodyAction)} className="h-11 w-full rounded-xl border border-outline-variant bg-surface px-3"><option value="transferred">Transfer</option><option value="aliquoted">Create aliquot</option><option value="stored">Store</option></select></Field>}
          {action?.kind !== 'collection' && <Field label={action?.kind === 'custody' ? 'Location or destination' : 'Reason'} required hint="This is retained in the immutable audit trail."><TextArea value={action?.kind === 'custody' ? location : reason} onChange={event => action?.kind === 'custody' ? setLocation(event.target.value) : setReason(event.target.value)} placeholder={action?.kind === 'custody' ? 'Rack, shelf, destination, or handoff location' : 'Explain why this change is required'} /></Field>}
          {action?.kind === 'custody' && <Field label="Note"><TextInput value={reason} onChange={event => setReason(event.target.value)} placeholder="Optional custody note" /></Field>}
        </div>
      </Sheet>

      <PrintDialog open={!!printJob} job={printJob} onClose={() => setPrintJob(null)} onPrinted={() => toast.success('Specimen label sent to the printer.')} />
    </div>
  );
}

function OrderDetail({ order, samples }: { order: OrderRecord; samples: SampleRecord[] }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Status" value={order.status} />
        <Metric label="Priority" value={order.priority} />
        <Metric label="Revision" value={String(order.revision)} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-on-surface">Ordered tests</h3>
        <div className="mt-3 divide-y divide-outline-variant/40 rounded-2xl border border-outline-variant/50">
          {order.items.map(item => <div key={item.id} className="flex items-start justify-between gap-4 p-4"><div><p className="text-sm font-medium text-on-surface">{item.name}</p><p className="mt-1 text-xs text-on-surface-variant">{[item.specimen, item.container, item.preparation].filter(Boolean).join(' · ') || 'No specimen instructions'}</p></div><span className="text-xs text-on-surface-variant">{item.priceApproved ? `${formatMoney(item.unitPrice)} · ${item.priceSource ?? 'lab'}` : 'Price needs approval'}</span></div>)}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-on-surface">Specimens</h3>
        {samples.length === 0 ? <p className="mt-2 text-sm text-on-surface-variant">No specimens have been created for this order.</p> : <ul className="mt-3 space-y-2">{samples.map(sample => <li key={sample.id} className="rounded-xl bg-surface-container p-3 text-sm"><span className="font-medium text-on-surface">{sample.accessionNo}</span><span className="ml-2 text-on-surface-variant">{sample.status} · {sample.specimen || 'specimen not set'}</span></li>)}</ul>}
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-on-surface-variant">Ordering provider</dt><dd className="font-medium text-on-surface">{order.doctorName || 'Not recorded'}</dd></div><div><dt className="text-on-surface-variant">Accepted by</dt><dd className="font-medium text-on-surface">{order.createdBy}</dd></div><div><dt className="text-on-surface-variant">Created</dt><dd className="font-medium text-on-surface">{formatWhen(order.createdAt)}</dd></div><div><dt className="text-on-surface-variant">Clinical history</dt><dd className="font-medium text-on-surface">{order.clinicalHistory || 'None recorded'}</dd></div></dl>
    </div>
  );
}

function SampleDetail({ sample, now, onPrintLabel }: { sample: SampleRecord; now: Date; onPrintLabel: () => void }) {
  const age = hoursSinceCollection(sample, now);
  const [custodyStatus, setCustodyStatus] = useState<{ valid: boolean; reason?: string } | null>(null);
  useEffect(() => {
    let active = true;
    void verifyCustodyChain(sample).then(result => { if (active) setCustodyStatus(result); });
    return () => { active = false; };
  }, [sample]);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3"><Metric label="Status" value={sample.status} /><Metric label="Specimen" value={sample.specimen || 'Not set'} /><Metric label="Hours since collection" value={age === null ? 'Not collected' : String(age)} /></div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-on-surface-variant">Barcode</dt><dd className="font-mono text-on-surface">{sample.barcode}</dd></div><div><dt className="text-on-surface-variant">Container</dt><dd className="text-on-surface">{sample.container || 'Not recorded'}</dd><dt className="text-on-surface-variant">Source / site</dt><dd className="text-on-surface">{[sample.source, sample.collectionSite].filter(Boolean).join(' · ') || 'Not recorded'}</dd><dt className="text-on-surface-variant">Temperature</dt><dd className="text-on-surface">{sample.temperatureC === undefined ? 'Not recorded' : `${sample.temperatureC} °C`}</dd></div><div><dt className="text-on-surface-variant">Collected by</dt><dd className="text-on-surface">{sample.collector || 'Not recorded'}</dd></div><div><dt className="text-on-surface-variant">Storage</dt><dd className="text-on-surface">{sample.storageLocation || 'Not recorded'}</dd></div>{sample.rejectionReason && <div className="sm:col-span-2"><dt className="text-on-surface-variant">Rejection reason</dt><dd className="text-error">{sample.rejectionReason}</dd></div>}</dl>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-on-surface">Chain of custody</h3>
          {custodyStatus && <p className={cn('mt-1 text-xs', custodyStatus.valid ? 'text-success' : 'text-warning')}>{custodyStatus.valid ? 'Hash chain verified' : custodyStatus.reason}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={onPrintLabel}><Printer className="h-4 w-4" aria-hidden="true" />Print label</Button>
      </div>
        {sample.custody.length === 0 ? <p className="mt-2 text-sm text-on-surface-variant">No custody events recorded yet.</p> : <ol className="mt-3 space-y-3">{sample.custody.map(event => <li key={event.id} className="border-l-2 border-accent/40 pl-3"><p className="text-sm font-medium capitalize text-on-surface">{event.action} · {event.actor}</p><p className="text-xs text-on-surface-variant">{formatWhen(event.at)}{event.location ? ` · ${event.location}` : ''}</p>{event.note && <p className="mt-1 text-sm text-on-surface-variant">{event.note}</p>}</li>)}</ol>}
      {sample.aliquots.length > 0 && <div><h3 className="text-sm font-semibold text-on-surface">Aliquots</h3><ul className="mt-2 space-y-1 text-sm text-on-surface-variant">{sample.aliquots.map(aliquot => <li key={aliquot.id}>{aliquot.label} · {aliquot.location || 'location not set'}</li>)}</ul></div>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-surface-container p-3"><p className="text-xs text-on-surface-variant">{label}</p><p className="mt-1 truncate text-sm font-semibold capitalize text-on-surface" title={value}>{value}</p></div>;
}

function CreateOrderSheet({ open, onClose, patients, doctors, actor, onCreated }: { open: boolean; onClose: () => void; patients: Array<{ id: string; name: string; doctorName?: string; doctorId?: string }>; doctors: Array<{ id: string; name: string }>; actor: string; onCreated: () => Promise<void> }) {
  const toast = useToast();
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const [history, setHistory] = useState('');
  const [prepared, setPrepared] = useState(false);
  const [tests, setTests] = useState<string[]>([]);
  const [testQuery, setTestQuery] = useState('');
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [tariffAcknowledged, setTariffAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = useMemo(() => searchPathologyTests(testQuery, getSearchableTests(tests, testQuery)).slice(0, 60), [testQuery, tests]);
  const patient = patients.find(item => item.id === patientId);
  const priceList = getPriceList();
  const tariffRows = tests.map(name => ({ name, ...(resolvePriceDetails(name, priceList) ?? { price: 0, source: 'suggested' as const, approved: false }) }));
  const tariffTotal = tariffRows.reduce((sum, row) => sum + (row.approved ? row.price : 0), 0);
  const needsTariffReview = tariffRows.some(row => !row.approved);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => setError(null));
  }, [open]);

  useEffect(() => {
    queueMicrotask(() => setTariffAcknowledged(false));
  }, [open, tests]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { order } = await createOrderWithSamples({ patientId, doctorName: doctors.find(item => item.id === doctorId)?.name ?? patient?.doctorName,
        doctorId: doctorId || patient?.doctorId, priority, clinicalHistory: history, preparationAcknowledged: prepared, tests, actor, allowDuplicate });
      toast.success(`Order ${order.orderNo} created with expected specimens.`);
      setPatientId(''); setDoctorId(''); setTests([]); setHistory(''); setPrepared(false); setAllowDuplicate(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The order could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="New lab order" description="Review the patient, provider, preparation, tests, and captured tariff before acceptance." width="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void submit()} loading={busy} disabled={!patientId || tests.length === 0 || (needsTariffReview && !tariffAcknowledged)}>Create order & specimens</Button></>}>
      <div className="space-y-5">
        {error && <div role="alert" className="rounded-xl bg-error-container p-3 text-sm text-on-error-container">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient" required><select value={patientId} onChange={event => setPatientId(event.target.value)} className="h-11 w-full rounded-xl border border-outline-variant bg-surface px-3"><option value="">Select patient</option>{patients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Ordering provider"><select value={doctorId} onChange={event => setDoctorId(event.target.value)} className="h-11 w-full rounded-xl border border-outline-variant bg-surface px-3"><option value="">No linked doctor</option>{doctors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Priority"><select value={priority} onChange={event => setPriority(event.target.value as typeof priority)} className="h-11 w-full rounded-xl border border-outline-variant bg-surface px-3"><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="stat">STAT</option></select></Field>
          <Field label="Clinical history"><TextInput value={history} onChange={event => setHistory(event.target.value)} placeholder="Relevant diagnosis or reason" /></Field>
        </div>
        <label className="flex items-start gap-3 rounded-xl bg-surface-container p-3 text-sm"><input type="checkbox" checked={prepared} onChange={event => setPrepared(event.target.checked)} className="mt-1" /><span><span className="font-medium text-on-surface">Preparation acknowledged</span><span className="block text-xs text-on-surface-variant">Required for STAT orders. Review fasting, timing, and container instructions for every selected test.</span></span></label>
        <Field label="Tests" required hint="Panels are captured as one order item; specimen instructions come from the catalogue."><TextInput value={testQuery} onChange={event => setTestQuery(event.target.value)} placeholder="Search tests or panels" /></Field>
        {tests.length > 0 && <div className="flex flex-wrap gap-2">{tests.map(name => <button key={name} type="button" onClick={() => setTests(current => current.filter(item => item !== name))} className="rounded-full bg-primary-container px-3 py-1.5 text-xs font-medium text-on-primary-container">{name}<X className="ml-1 inline h-3 w-3" aria-hidden="true" /></button>)}</div>}
        {tariffRows.length > 0 && (
          <div className="rounded-2xl border border-outline-variant/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-on-surface">Tariff review</h3>
              <span className="text-sm font-bold text-primary">{formatMoney(tariffTotal)}</span>
            </div>
            <ul className="mt-2 divide-y divide-outline-variant/20 text-xs">
              {tariffRows.map(row => (
                <li key={row.name} className="flex justify-between gap-3 py-2">
                  <span>{row.name}</span>
                  <span className={row.approved ? 'text-on-surface-variant' : 'text-warning'}>
                    {row.approved ? `${formatMoney(row.price)} · ${row.source}` : 'Needs approved tariff'}
                  </span>
                </li>
              ))}
            </ul>
            {needsTariffReview && (
              <label className="mt-2 flex items-start gap-2 text-xs text-on-surface-variant">
                <input type="checkbox" checked={tariffAcknowledged} onChange={event => setTariffAcknowledged(event.target.checked)} className="mt-0.5" />
                I reviewed the unpriced or suggested lines. They will remain uncharged until approved in Settings.
              </label>
            )}
          </div>
        )}
        <div className="max-h-64 overflow-y-auto rounded-2xl border border-outline-variant/50">{candidates.length === 0 ? <p className="p-4 text-sm text-on-surface-variant">No matching tests.</p> : candidates.map(test => <label key={test.id} className="flex cursor-pointer items-start gap-3 border-b border-outline-variant/30 p-3 last:border-0"><input type="checkbox" checked={tests.includes(test.name)} onChange={() => setTests(current => current.includes(test.name) ? current.filter(item => item !== test.name) : [...current, test.name])} className="mt-1" /><span><span className="block text-sm font-medium text-on-surface">{test.name}</span><span className="block text-xs text-on-surface-variant">{test.category}{test.specimen ? ` · ${test.specimen}` : ''}</span></span></label>)}</div>
        <label className="flex items-center gap-2 text-sm text-on-surface-variant"><input type="checkbox" checked={allowDuplicate} onChange={event => setAllowDuplicate(event.target.checked)} />Allow a duplicate active order after review</label>
      </div>
    </Sheet>
  );
}

