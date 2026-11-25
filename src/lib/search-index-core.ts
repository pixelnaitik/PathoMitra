import type { LocalDoc } from '../data/types';

export type SearchRecordType = 'patient' | 'report' | 'doctor' | 'order' | 'sample';

export interface SearchResult {
  id: string;
  type: SearchRecordType;
  title: string;
  subtitle: string;
  timestamp: number;
}

export interface IndexedResult extends SearchResult {
  haystack: string;
}

export interface SearchFilterResult {
  items: IndexedResult[];
  totalMatches: number;
  omitted: number;
}

const TYPE_RANK: Record<SearchRecordType, number> = {
  patient: 0,
  report: 1,
  doctor: 2,
  order: 3,
  sample: 4,
};
export const PER_TYPE_LIMIT = 6;

function fold(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\s+/g, ' ')
    .trim();
}

function haystackOf(...parts: unknown[]): string {
  const flat: string[] = [];
  for (const part of parts) {
    if (Array.isArray(part)) flat.push(...part.map(item => fold(item)));
    else if (part !== undefined && part !== null && part !== '') flat.push(fold(part));
  }
  return flat.filter(Boolean).join(' ');
}

function timestampOf(value: unknown): number {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');

/** Convert one stored row into the display record and its folded search text. */
export function indexRecord(type: SearchRecordType, doc: LocalDoc): IndexedResult {
  const data = doc.data();
  const phone = String(data.phone ?? '');
  if (type === 'patient') {
    return {
      id: doc.id,
      type,
      title: String(data.name || 'Unknown Patient'),
      subtitle: `${data.age || '?'}y · ${data.gender || '—'} · #${doc.id}`,
      timestamp: timestampOf(data.createdAt),
      haystack: haystackOf(
        data.name,
        doc.id,
        phone,
        digits(phone),
        data.doctorName,
        data.gender,
        data.age,
        data.dateOfBirth,
        data.externalId,
        data.testSelection,
      ),
    };
  }
  if (type === 'report') {
    const issued = data.status !== 'draft';
    return {
      id: doc.id,
      type,
      title: String(data.patientName || 'Report'),
      subtitle: issued
        ? `${data.testType ? `${data.testType} · ` : ''}issued ${
            data.createdAt ? new Date(String(data.createdAt)).toLocaleDateString() : '—'
          }`
        : `Draft · ${data.testType ?? 'no panel named'}`,
      timestamp: timestampOf(data.createdAt),
      haystack: haystackOf(
        data.patientName,
        doc.id,
        data.patientId,
        data.testType,
        data.testSelection,
        data.signature,
        Object.keys((data.resultData as Record<string, unknown>) ?? {}),
      ),
    };
  }
  if (type === 'doctor') {
    return {
      id: doc.id,
      type,
      title: String(data.name || 'Unknown Doctor'),
      subtitle: phone || 'No phone',
      timestamp: timestampOf(data.createdAt),
      haystack: haystackOf(
        data.name,
        doc.id,
        phone,
        digits(phone),
        data.registration,
        data.registrationNo,
      ),
    };
  }
  if (type === 'order') {
    return {
      id: doc.id,
      type,
      title: String(data.orderNo || doc.id),
      subtitle: `${data.patientName || 'Unknown patient'} · ${data.status || 'ordered'}`,
      timestamp: timestampOf(data.createdAt),
      haystack: haystackOf(
        data.orderNo,
        doc.id,
        data.patientName,
        data.patientId,
        data.doctorName,
        data.status,
        data.priority,
        data.clinicalHistory,
        (data.items as Array<{ name?: string }> | undefined)?.map(item => item.name),
      ),
    };
  }
  return {
    id: doc.id,
    type,
    title: String(data.accessionNo || data.barcode || doc.id),
    subtitle: `${data.patientName || data.patientId || 'Unknown patient'} · ${data.status || 'expected'}`,
    timestamp: timestampOf(data.createdAt),
    haystack: haystackOf(
      data.accessionNo,
      data.barcode,
      doc.id,
      data.orderId,
      data.orderItemId,
      data.patientId,
      data.specimen,
      data.container,
      data.source,
      data.status,
    ),
  };
}

/** Sort the complete match pool before applying display caps. */
export function searchIndex(items: IndexedResult[], query: string): SearchFilterResult {
  const terms = fold(query).split(' ').filter(Boolean);
  const pool = (
    terms.length === 0
      ? [...items]
      : items.filter(item => terms.every(term => item.haystack.includes(term)))
  ).sort(
    (a, b) =>
      TYPE_RANK[a.type] - TYPE_RANK[b.type] ||
      b.timestamp - a.timestamp ||
      a.title.localeCompare(b.title),
  );
  const taken: Record<SearchRecordType, number> = {
    patient: 0,
    report: 0,
    doctor: 0,
    order: 0,
    sample: 0,
  };
  const displayed = pool.filter(item => {
    if (taken[item.type] >= PER_TYPE_LIMIT) return false;
    taken[item.type] += 1;
    return true;
  });
  return { items: displayed, totalMatches: pool.length, omitted: pool.length - displayed.length };
}

export function filterSearchResults(items: IndexedResult[], query: string): IndexedResult[] {
  return searchIndex(items, query).items;
}
