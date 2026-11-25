import { expect, test, type Page } from '@playwright/test';

type Fixture =
  | 'report-devanagari'
  | 'report-amended-first'
  | 'report-amended-last'
  | 'report-legacy'
  | 'invoice-bengali';

async function warmPdfModules(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: /Precision pathology/i }),
    ).toBeVisible();
    try {
      await page.evaluate(async () => {
        await Promise.all([
          import('/src/lib/report-pdf.ts'),
          import('/src/lib/invoice-pdf.ts'),
          import('/src/lib/settings.ts'),
          import('/src/lib/report-snapshot.ts'),
          import('/src/lib/report-compliance.ts'),
          import('/src/lib/pathology-tests.ts'),
          import('/src/lib/pdf-preview.ts'),
        ]);
      });
      return;
    } catch (error) {
      if (!String(error).includes('Execution context was destroyed') || attempt === 2) throw error;
    }
  }
}

async function renderPdfFixture(
  page: Page,
  fixture: Fixture,
): Promise<{ pageCount: number; shownPage: number }> {
  await page.setViewportSize({ width: 900, height: 1200 });
  await warmPdfModules(page);
  const info = await page.evaluate(async kind => {
    const [
      { buildReportDocument },
      { buildInvoicePdf },
      settingsModule,
      snapshotModule,
      complianceModule,
      testsModule,
      previewModule,
    ] = await Promise.all([
      import('/src/lib/report-pdf.ts'),
      import('/src/lib/invoice-pdf.ts'),
      import('/src/lib/settings.ts'),
      import('/src/lib/report-snapshot.ts'),
      import('/src/lib/report-compliance.ts'),
      import('/src/lib/pathology-tests.ts'),
      import('/src/lib/pdf-preview.ts'),
    ]);
    const settings = {
      ...settingsModule.DEFAULT_SETTINGS,
      labName: 'संजीवनी Diagnostics',
      address: '₹1 crore building',
    };
    const patient = {
      id: 'synthetic-patient-abcdef',
      name: kind === 'invoice-bengali' ? 'অনিরুদ্ধ শর্মা' : 'राहुल शर्मा',
      age: 34,
      gender: 'male',
      phone: '9999999999',
      doctorName: kind === 'invoice-bengali' ? 'Dr √2 Mehta' : 'Dr Mehta',
      address: 'Pune',
      createdAt: '2026-10-15T09:30:00.000Z',
    };
    let base64: string;
    let pageCount: number;
    let shownPage = 1;
    if (kind === 'invoice-bengali') {
      const invoice = {
        id: 'synthetic-invoice-1',
        invoiceNo: 'INV-SYNTH-42',
        patientId: patient.id,
        patientName: patient.name,
        doctorName: patient.doctorName,
        items: [
          {
            name: 'CBC (COMPLETE BLOOD COUNT)',
            kind: 'panel',
            detail: 'Blood',
            qty: 1,
            unitPrice: 450,
            lineTotal: 450,
            unpriced: false,
          },
        ],
        subtotal: 450,
        discount: 0,
        tax: 0,
        taxPercent: 0,
        amount: 450,
        paidAmount: 450,
        status: 'paid',
        createdAt: '2026-10-15T09:30:00.000Z',
      };
      const doc = await buildInvoicePdf({ invoice, patient, settings });
      pageCount = doc.getNumberOfPages();
      base64 = doc.output('datauristring').split(',')[1];
    } else {
      const count = kind.startsWith('report-amended') ? 70 : 8;
      const names = testsModule.DEFAULT_PATHOLOGY_TESTS.filter(
        (test: { isGroup?: boolean; isHeader?: boolean }) => !test.isGroup && !test.isHeader,
      )
        .slice(0, count)
        .map((test: { name: string }) => test.name);
      const report: Record<string, unknown> = {
        id: 'synthetic-report-abcdef',
        patientId: patient.id,
        patientName: patient.name,
        testSelection: names,
        resultData: Object.fromEntries(
          names.map((name: string, index: number) => [name, String(10 + (index % 9))]),
        ),
        status: 'final',
        version: kind.startsWith('report-amended') ? 2 : 1,
        amendReason: kind.startsWith('report-amended')
          ? 'Synthetic amendment retained for visual regression.'
          : '',
        createdBy: 'Synthetic Pathologist',
        createdAt: '2026-10-15T09:30:00.000Z',
        updatedAt: '2026-10-17T11:00:00.000Z',
      };
      if (kind !== 'report-legacy') {
        report.issuanceSnapshot = snapshotModule.buildReportIssuanceSnapshot(
          report,
          patient,
          settings,
          report.createdAt,
        );
      }
      const built = await buildReportDocument({
        report,
        patient,
        settings,
        legal: complianceModule.buildReportLegalLines({}),
        signerName: 'Synthetic √2 Pathologist',
      });
      pageCount = built.pageCount;
      shownPage = kind === 'report-amended-last' ? pageCount : 1;
      base64 = built.doc.output('datauristring').split(',')[1];
    }
    const pdf = await previewModule.openPdf(base64);
    const canvas = document.createElement('canvas');
    canvas.id = 'pdf-visual-fixture';
    canvas.style.cssText = 'position:fixed;left:0;top:0;background:#fff;z-index:2147483647;';
    document.body.append(canvas);
    await previewModule.renderPageInto(pdf, canvas, { pageNumber: shownPage, cssWidthPx: 794 });
    await pdf.destroy();
    return { pageCount, shownPage };
  }, fixture);
  await expect(page.locator('#pdf-visual-fixture')).toBeVisible();
  return info;
}

test('PDF visual fixtures preserve Unicode, caveats, amendments, and pagination', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixtures: Fixture[] = [
    'report-devanagari',
    'report-amended-first',
    'report-amended-last',
    'report-legacy',
    'invoice-bengali',
  ];
  for (const fixture of fixtures) {
    const info = await renderPdfFixture(page, fixture);
    if (fixture === 'report-amended-first') expect(info.pageCount).toBeGreaterThan(1);
    if (fixture === 'report-amended-last') expect(info.shownPage).toBe(info.pageCount);
    await expect(page.locator('#pdf-visual-fixture')).toHaveScreenshot(`${fixture}.png`, {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  }
});
