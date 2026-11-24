import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('jsbarcode', () => ({ default: vi.fn() }));
import { buildSampleLabelPdf } from './sample-label';

const sample = {
  accessionNo: 'ACC-20261124-ABC12345',
  barcode: 'ACC-20261124-ABC12345',
  patientId: '26110001',
  specimen: 'Blood',
  container: 'EDTA',
  orderId: 'order-1',
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  );
});

afterEach(() => vi.restoreAllMocks());

describe('sample label', () => {
  it('builds a one-page Code 128 accession label', async () => {
    const doc = await buildSampleLabelPdf(sample, 'Asha Rao', 'ORD-2611-0001');
    expect(doc.getNumberOfPages()).toBe(1);
  });
});
