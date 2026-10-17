/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

/**
 * Vitest configuration — standalone (the app's vite.config.ts exports a
 * function-form config, which cannot be merged). jsdom environment with
 * React Testing Library and globals enabled.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      /**
       * The gate covers the data-integrity layer — the modules whose silent
       * failure corrupts clinical output: document parsing, the wording printed
       * on an issued report, settings persistence, pagination and the error
       * boundary. Route components are covered by the Playwright flow still on
       * the roadmap; adding a module here means adding tests for it first, and
       * the thresholds are a ratchet that should only ever move up.
       */
      include: [
        'src/lib/models.ts',
        'src/lib/date-range.ts',
        'src/lib/telemetry.ts',
        'src/lib/report-compliance.ts',
        // The document the laboratory hands over. It used to live inside a
        // 2,843-line page component and had no test at all, while the module
        // that merely parses the print dialog's page ranges did: a wrong
        // printout is the failure this gate exists to catch.
        'src/lib/report-pdf.ts',
        'src/lib/report-layout.ts',
        'src/lib/print-contrast.ts',
        'src/lib/pdf-text.ts',
        'src/lib/settings.ts',
        'src/lib/notification-engine.ts',
        'src/lib/notification-state.ts',
        'src/lib/pathology-tests.ts',
        'src/lib/report-calculations.ts',
        'src/lib/report-layout-spec.ts',
        'src/lib/report-visibility.ts',
        // Billing is money that leaves the device on paper, so it is held to the
        // same gate as the clinical data layer: the price walk, the bill totals,
        // the bill number, and the referral arithmetic.
        'src/lib/price-list.ts',
        'src/lib/referrals.ts',
        'src/lib/invoice-registry.ts',
        'src/lib/invoices.ts',
        'src/hooks/useCollectionList.ts',
        'src/components/ErrorBoundary.tsx',
      ],
      exclude: ['**/*.test.{ts,tsx}'],
      thresholds: {
        statements: 82,
        branches: 68,
        functions: 82,
        lines: 85,
      },
    },
  },
});
