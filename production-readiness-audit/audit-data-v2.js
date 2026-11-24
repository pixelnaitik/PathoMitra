globalThis.AUDIT_DATA = {
  meta: {
    product: 'PathoMitra',
    version: '2.8.9',
    auditDate: '2026-11-24',
    snapshot: 'Current workspace source and local artifacts; no VCS metadata was available.',
    scope: 'Feature tracing from UI to domain rules, repositories, native shells, release workflows, tests, and static UX/security review.',
    method: 'Per-feature 12-dimension scoring, source-linked findings, local command evidence, and manual accessibility review. A P0 finding forces a NO verdict regardless of the numeric average.',
    overallVerdict: 'NO-GO',
    recommendation: 'Do not release broadly. A constrained single-operator pilot is plausible only after the P0 gates are closed, clinical governance approves ranges and critical-value policy, and signed Android/Desktop artifacts pass clean verification.',
    confidence: 'High for source/config findings; medium for workflow impact; device, printer-spool, biometric, and screen-reader behavior remains unverified.',
    limitations: [
      'No .git directory was present, so commit, branch, provenance, and uncommitted-change evidence could not be assessed.',
      'The source changed during the audit as workflow and validation work landed; the report records the latest observed state and reruns typecheck where possible.',
      'No physical Android device, emulator, Windows print spool, or biometric prompt was exercised.',
      'No axe-core package or design.qa.yaml was available; accessibility findings are source-backed and browser-smoke evidence, not a WCAG certification.',
      'The hosted Cloudflare deployment and external privacy URL were not tested.',
      'Current coverage could not be generated because the Vitest runner fails on the declared Node 26 toolchain; historical coverage files are not treated as current proof.',
      'Scores are audit judgments, not certifications or regulatory determinations.'
    ]
  },
  dimensions: [
    { id: 'functionality', label: 'Functionality', short: 'FN', group: 'Product', description: 'Completeness and correctness of the user-facing capability and business rules.', ten: 'End-to-end capability is complete, coherent, and handles real laboratory edge cases.', five: 'Useful core flow exists, but material steps or states are missing.' },
    { id: 'ux', label: 'UI / UX workflow', short: 'UX', group: 'Experience', description: 'Task completion, clarity, navigation, states, error recovery, and operational fit.', ten: 'Primary and recovery flows are clear, efficient, and evidence-based.', five: 'Operable but confusing, misleading, or incomplete in important states.' },
    { id: 'microinteractions', label: 'Micro-interactions', short: 'MI', group: 'Experience', description: 'Feedback, motion, haptics, progress, transitions, and perceived responsiveness.', ten: 'Feedback is timely, durable, accessible, and consistent across the product.', five: 'Polished in places, but synthetic, delayed, or missing feedback remains.' },
    { id: 'a11y', label: 'Accessibility', short: 'A11Y', group: 'Experience', description: 'Keyboard, semantics, focus, contrast, motion, touch, and assistive-technology support.', ten: 'Automated and manual WCAG evidence covers all critical workflows.', five: 'Good foundations, but repeated modal/form/chart barriers remain.' },
    { id: 'security', label: 'Security & privacy', short: 'SEC', group: 'Trust', description: 'Threat boundaries, encryption, secrets, PHI exposure, IPC hardening, and dependencies.', ten: 'Defense in depth with tested boundaries and no unresolved high-risk issues.', five: 'Strong at-rest controls, but renderer, web, file, or diagnostic gaps remain.' },
    { id: 'backend', label: 'Backend & data integrity', short: 'DATA', group: 'Engineering', description: 'Transactions, validation, immutability, reconciliation, concurrency, and migrations.', ten: 'Invariants are enforced transactionally at a trusted boundary with migration evidence.', five: 'Local transactions exist, but cross-entity and renderer-trusted gaps remain.' },
    { id: 'resilience', label: 'Resilience & recovery', short: 'RES', group: 'Engineering', description: 'Failure recovery, durability, offline behavior, backup, crash handling, and continuity.', ten: 'Failure modes are tested, recoverable, and meet measured RPO/RTO targets.', five: 'Offline operation is solid, but recovery and continuity are manual or incomplete.' },
    { id: 'performance', label: 'Performance & scale', short: 'PERF', group: 'Engineering', description: 'Bundle size, memory, query cost, rendering, startup, and large-data behavior.', ten: 'Measured budgets pass on representative low-end and large-data workloads.', five: 'Acceptable at small scale, but full scans, large chunks, or memory spikes remain.' },
    { id: 'testing', label: 'Test coverage', short: 'TEST', group: 'Quality', description: 'Unit, integration, E2E, device, accessibility, visual, and release-gate coverage.', ten: 'Critical workflows and release artifacts have automated, passing evidence.', five: 'Useful unit tests exist, but the gate or platform coverage is incomplete.' },
    { id: 'platform', label: 'Platform readiness', short: 'PLAT', group: 'Quality', description: 'Android, Electron, and Web parity, permissions, packaging, signing, and runtime behavior.', ten: 'Every target has signed artifacts and passing runtime/device evidence.', five: 'Source supports the platform, but release or runtime evidence is incomplete.' },
    { id: 'architecture', label: 'Architecture', short: 'ARCH', group: 'Engineering', description: 'Trust boundaries, domain modeling, modularity, API semantics, and maintainability.', ten: 'Clear domain services and trusted boundaries with consistent contracts.', five: 'Modular domain code exists, but compatibility shims and renderer authority remain.' },
    { id: 'observability', label: 'Observability & audit', short: 'OBS', group: 'Quality', description: 'Attribution, diagnostics, operational metrics, correlation, and auditability.', ten: 'Actions are attributable and support can diagnose failures from redacted evidence.', five: 'Some audit events and crash logs exist, but coverage and privacy controls are incomplete.' }
  ],
  lifecycle: [
    { name: 'Register', feature: 'patients', state: 'partial' },
    { name: 'Order', feature: 'orders', state: 'partial' },
    { name: 'Collect', feature: 'samples', state: 'partial' },
    { name: 'Analyze', feature: 'results', state: 'partial' },
    { name: 'Verify', feature: 'reports', state: 'partial' },
    { name: 'Issue', feature: 'pdf', state: 'partial' },
    { name: 'Bill', feature: 'billing', state: 'partial' },
    { name: 'Archive', feature: 'backup', state: 'risk' }
  ],
  features: [
    {
      id: 'patients', name: 'Patient registration & management', category: 'Core clinical', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Registers and edits patients, assigns monthly MRNs, searches by name/phone/ID, records a manual due note, opens patient details, exports CSV, and cascades deletion into related records.',
      strengths: ['Zod-backed write builders and read boundary.', 'Monthly sequenced IDs with collision probes and a per-process allocation queue.', 'Duplicate warning, local-day filters, patient detail timeline, and direct-ID deep links.', 'Patient edit plus draft report synchronization now runs in one repository transaction.'],
      gaps: [
        { id: 'PAT-01', severity: 'P0', dimension: 'backend', title: 'MRN allocation is still not atomic with patient creation', detail: 'allocatePatientId() reads and advances meta, then savePatient() inserts the patient in a separate transaction. A crash between them burns a number; two processes can still select the same candidate and overwrite a patient.', refs: [{ path: 'src/lib/patient-registry.ts', symbol: 'allocatePatientIdUnlocked' }, { path: 'src/pages/dashboard/PatientsPage.tsx', symbol: 'savePatient' }] },
        { id: 'PAT-02', severity: 'P1', dimension: 'backend', title: 'Duplicate detection is bounded and Latin-centric', detail: 'Registration checks only the newest 500 patients. patientNameKey() strips non-Latin letters, so Devanagari and other scripts can collapse to an empty key; phone is optional and may be only six characters.', refs: [{ path: 'src/pages/dashboard/PatientsPage.tsx', symbol: 'handleSubmit' }, { path: 'src/lib/patient-registry.ts', symbol: 'patientNameKey / validatePatientForm' }] },
        { id: 'PAT-03', severity: 'P1', dimension: 'backend', title: 'Manual dues can diverge from the invoice ledger', detail: 'dueAmount is an operator note, not a projection of invoices/payments. Payments, voids, new bills, and restores do not reconcile it, so the patient chip and Bills register can disagree.', refs: [{ path: 'src/lib/models.ts', symbol: 'PatientSchema / toPatientDueDoc' }, { path: 'src/pages/dashboard/PatientsPage.tsx', symbol: 'saveDue' }] },
        { id: 'PAT-04', severity: 'P1', dimension: 'backend', title: 'Deletion removes clinical and financial history', detail: 'deletePatientCascade() hard-deletes reports, amendment versions, notes, and invoices, including paid or printed bills. There is no tombstone or retention-safe alternative.', refs: [{ path: 'src/lib/cascades.ts', symbol: 'deletePatientCascade' }, { path: 'src/pages/dashboard/PatientsPage.tsx', symbol: 'delete confirmation' }] },
        { id: 'PAT-05', severity: 'P2', dimension: 'functionality', title: 'Demographics are too narrow for laboratory use', detail: 'No DOB, age-in-months for infants, government ID, consent, emergency contact, structured address, sex at birth, or supervised merge workflow. Pediatric range selection remains approximate.', refs: [{ path: 'src/lib/models.ts', symbol: 'PatientSchema' }, { path: 'src/lib/pathology-tests.ts', symbol: 'resolveReferenceRange' }] }
      ],
      improvements: [
        { title: 'Make MRN issuance transactional', detail: 'Allocate and insert in one trusted transaction with a database-enforced unique key.', acceptance: 'Concurrent double-submit and crash tests produce distinct MRNs or one explicit conflict, never an overwrite.' },
        { title: 'Add Unicode-aware duplicate and merge workflows', detail: 'Scan the full register, preserve Indic scripts, normalize phones, and provide supervised merge with history.', acceptance: 'Tests cover >500 records, Indian scripts, shared phones, twins, and same-name/different-age cases.' },
        { title: 'Derive dues from a ledger', detail: 'Compute patient balance from invoices/payments and retain manual adjustments as explicit entries.', acceptance: 'Patient due equals non-void invoice balances after every payment, void, restore, and deletion-policy action.' },
        { title: 'Adopt retention-safe deletion', detail: 'Use soft delete/anonymization and retain issued clinical/financial records under lab policy.', acceptance: 'Deleting a patient never silently removes an issued report or paid invoice.' }
      ],
      scores: [8, 7, 7, 6, 6, 5, 5, 6, 6, 7, 5, 5]
    },
    {
      id: 'orders', name: 'Lab order & requisition management', category: 'Core clinical', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Adds Order/OrderItem schemas, a transactional domain service, duplicate-active-order checks, frozen catalogue/tariff metadata, lifecycle transitions, audit events, and a new Orders workspace.',
      strengths: ['Stable order IDs and frozen test metadata.', 'Priority, clinical history, provider, preparation acknowledgement, cancellation/amendment reasons.', 'Explicit order state machine and audit events.', 'Orders and Samples are now first-class routes and navigation destinations.'],
      gaps: [
        { id: 'ORD-01', severity: 'P0', dimension: 'backend', title: 'Order and expected specimens are created in separate transactions', detail: 'WorkflowPage calls createOrder() and then createSamplesForOrder(). If specimen creation fails, the order persists without samples and a retry can be blocked by the duplicate-order guard.', refs: [{ path: 'src/pages/dashboard/WorkflowPage.tsx', symbol: 'CreateOrderSheet.submit' }, { path: 'src/lib/clinical-workflow.ts', symbol: 'createOrder / createSamplesForOrder' }] },
        { id: 'ORD-02', severity: 'P0', dimension: 'architecture', title: 'Reports and invoices are not linked to orders', detail: 'ReportSchema and InvoiceSchema accept orderId, and ReportContent supports it, but ReportsPage and raiseInvoice() do not populate it. The new order lifecycle therefore does not govern the actual report or bill.', refs: [{ path: 'src/pages/dashboard/ReportsPage.tsx', symbol: 'handleCreateReport / handleSaveResults' }, { path: 'src/lib/invoices.ts', symbol: 'RaiseInvoiceInput / raiseInvoice' }, { path: 'src/lib/models.ts', symbol: 'ReportSchema / InvoiceSchema' }] },
        { id: 'ORD-03', severity: 'P1', dimension: 'functionality', title: 'The UI exposes only part of the order state machine', detail: 'The domain supports issued, billed, cancelled, and amended, but the detail footer only offers collected, processing, resulted, and cancel. Issue/bill integration and amendment creation are absent.', refs: [{ path: 'src/pages/dashboard/WorkflowPage.tsx', symbol: 'order detail footer' }, { path: 'src/lib/clinical-workflow.ts', symbol: 'ORDER_TRANSITIONS' }] },
        { id: 'ORD-04', severity: 'P1', dimension: 'backend', title: 'Human order numbers are random-suffix, not database-unique', detail: 'orderNo uses a date plus random suffix and is not the document primary key. Collision probability is low but not enforced, and there is no monthly sequence or idempotency key.', refs: [{ path: 'src/lib/clinical-workflow.ts', symbol: 'randomSuffix / createOrder' }] },
        { id: 'ORD-05', severity: 'P1', dimension: 'ux', title: 'No tariff review or approval gate', detail: 'The sheet says tariff is captured, but shows no line prices or approval state before acceptance. priceApproved is inferred from catalogue lastReviewed, not a lab-approved tariff.', refs: [{ path: 'src/pages/dashboard/WorkflowPage.tsx', symbol: 'CreateOrderSheet' }, { path: 'src/lib/clinical-workflow.ts', symbol: 'priceApproved' }] },
        { id: 'ORD-06', severity: 'P1', dimension: 'testing', title: 'No workflow domain or UI tests', detail: 'clinical-workflow.ts and WorkflowPage.tsx have no dedicated tests for transitions, duplicate orders, rollback, specimen retry, or navigation.', refs: [{ path: 'src/lib/clinical-workflow.ts', symbol: 'module' }, { path: 'src/pages/dashboard/WorkflowPage.tsx', symbol: 'module' }] }
      ],
      improvements: [
        { title: 'Create order and specimens atomically', detail: 'Expose one domain command that writes the order, expected samples, and audit events in one transaction.', acceptance: 'A forced specimen failure leaves neither an order nor partial samples; retry is idempotent.' },
        { title: 'Link the full clinical chain', detail: 'Require orderId on reports and invoices and derive status transitions from real report/bill events.', acceptance: 'Every report, sample, and invoice resolves to one immutable order and repeat visits never overwrite prior orders.' },
        { title: 'Add order review and amendment screens', detail: 'Show tests, specimen instructions, prices, priority, provider, and preparation before acceptance; support superseding orders.', acceptance: 'Double submission is idempotent and amendments retain the original requisition.' },
        { title: 'Add workflow E2E and scale tests', detail: 'Cover create→collect→process→result→issue→bill plus large patient/test selects and pagination.', acceptance: 'The complete journey passes on Android, Desktop, and Web with no orphaned records.' }
      ],
      scores: [6, 6, 6, 6, 5, 5, 4, 4, 2, 6, 5, 4]
    },
    {
      id: 'samples', name: 'Sample tracking & chain of custody', category: 'Core clinical', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Adds Sample/Custody schemas, expected accessions per order item, collection/receipt/processing/rejection/loss/disposal states, recollection, aliquots, storage, custody events, and a Samples workspace.',
      strengths: ['Accession/barcode fields and order-item linkage.', 'Real collection and receipt timestamps with transit/TAT helpers.', 'Rejection/loss reasons and recollection links.', 'Append-only-style custody history and audit events in the domain service.'],
      gaps: [
        { id: 'SAM-01', severity: 'P1', dimension: 'functionality', title: 'No barcode scanning or label printing', detail: 'Barcodes are generated as text but cannot be scanned or printed. There is no camera permission review, USB/Bluetooth scanner support, duplicate-label guard, or accession label layout.', refs: [{ path: 'src/lib/clinical-workflow.ts', symbol: 'createSamplesForOrder' }, { path: 'src/pages/dashboard/WorkflowPage.tsx', symbol: 'SampleDetail' }] },
        { id: 'SAM-02', severity: 'P1', dimension: 'functionality', title: 'Collection metadata is minimal', detail: 'The UI does not capture specimen source, actual container, collector identity beyond the single account, collection site, temperature, or required aliquot details. source remains blank.', refs: [{ path: 'src/lib/models.ts', symbol: 'SampleSchema' }, { path: 'src/pages/dashboard/WorkflowPage.tsx', symbol: 'sample actions' }] },
        { id: 'SAM-03', severity: 'P1', dimension: 'backend', title: 'Operational alerts still use registration age', detail: 'The new Sample milestones are not consumed by buildNotifications(). Overdue “sample” alerts still measure patient.createdAt and can report the wrong collection age.', refs: [{ path: 'src/lib/notification-engine.ts', symbol: 'buildNotifications overdue branch' }, { path: 'src/lib/clinical-workflow.ts', symbol: 'hoursSinceCollection' }] },
        { id: 'SAM-04', severity: 'P1', dimension: 'observability', title: 'Custody is not tamper-evident or role-separated', detail: 'Custody arrays and auditEvents are ordinary mutable repository documents. A compromised renderer can rewrite/delete them, and the single local account cannot distinguish collector, receiver, technologist, or pathologist.', refs: [{ path: 'src/lib/clinical-workflow.ts', symbol: 'appendAudit / recordCustodyEvent' }, { path: 'src/data/entities.ts', symbol: 'auditEvents' }] },
        { id: 'SAM-05', severity: 'P1', dimension: 'performance', title: 'The workflow register reloads four full collections', detail: 'Every order/sample subscription callback invokes load(), which reads orders/samples plus all patients and doctors with no pagination or incremental update.', refs: [{ path: 'src/pages/dashboard/WorkflowPage.tsx', symbol: 'load / subscribe effect' }] },
        { id: 'SAM-06', severity: 'P1', dimension: 'testing', title: 'No custody, recollection, or TAT tests', detail: 'There are no tests for allowed transitions, rejection reasons, duplicate accessions, custody immutability, recollection links, or transit calculations.', refs: [{ path: 'src/lib/clinical-workflow.ts', symbol: 'module' }, { path: 'src/pages/dashboard/WorkflowPage.tsx', symbol: 'module' }] }
      ],
      improvements: [
        { title: 'Add scanning and label workflows', detail: 'Support scanner input and printable accession labels with duplicate detection and rejection/recollection links.', acceptance: 'A scan resolves exactly one accession and rejected samples trigger a linked recollection.' },
        { title: 'Use sample milestones everywhere', detail: 'Drive TAT, overdue alerts, dashboard worklists, and notifications from collection/receipt/result timestamps.', acceptance: 'TAT tests cover rejected, recollected, multi-aliquot, and partially resulted orders.' },
        { title: 'Enforce custody at a trusted boundary', detail: 'Use append-only audit storage, role checks, and optional hash chaining/signatures.', acceptance: 'No operator can alter prior custody events without detection.' },
        { title: 'Paginate and index workflow registers', detail: 'Query by status/date/patient and update only changed records.', acceptance: 'The register remains responsive with 50k samples and does not reread the full roster on every write.' }
      ],
      scores: [6, 6, 6, 6, 5, 5, 4, 4, 2, 5, 5, 4]
    },
    {
      id: 'catalogue', name: 'Test catalogue, custom tests & profiles', category: 'Clinical configuration', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Ships a large pathology catalogue with profiles, units, specimens, demographic ranges, methods, synonyms, suggested prices, integrity checks, and custom test/profile editors.',
      strengths: ['Catalogue integrity sweep and panel expansion.', 'Search with synonyms and fuzzy matching.', 'Custom demographic ranges and live management UI.', 'Unverified/inherited range decisions are now surfaced on screen and in PDF output.'],
      gaps: [
        { id: 'CAT-01', severity: 'P1', dimension: 'backend', title: 'No clinical approval/versioning for ranges', detail: 'Custom ranges store text only; there is no source, reviewer, approval date, effective date, method validation, min≤max check, or immutable catalogue version on historical reports.', refs: [{ path: 'src/components/ManageTestsPanel.tsx', symbol: 'TestFormSheet.submit' }, { path: 'src/lib/report-snapshot.ts', symbol: 'buildReportIssuanceSnapshot' }] },
        { id: 'CAT-02', severity: 'P1', dimension: 'backend', title: 'Custom-name collision rules are weaker than lookup rules', detail: 'The editor rejects case-insensitive exact duplicates, while price keys strip punctuation and lookup has separate raw/synonym behavior. The integrity sweep is not guaranteed over the combined custom catalogue.', refs: [{ path: 'src/components/ManageTestsPanel.tsx', symbol: 'TestFormSheet.submit' }, { path: 'src/lib/pathology-tests.ts', symbol: 'auditPathologyCatalogue / findTestInfo' }] },
        { id: 'CAT-03', severity: 'P1', dimension: 'resilience', title: 'Custom test and price saves can still be fire-and-forget', detail: 'Settings now awaits durable persistence, but the test editor can still upsert prices without awaiting the result and uses a generic actor label.', refs: [{ path: 'src/components/ManageTestsPanel.tsx', symbol: 'TestFormSheet.submit / upsertPrice' }] },
        { id: 'CAT-04', severity: 'P1', dimension: 'ux', title: 'Suggested market prices can become real charges', detail: 'resolvePrice() can fall back to built-in suggestions. Billing/order creation does not require an approved lab tariff or clearly mark suggested charges before issue.', refs: [{ path: 'src/lib/price-list.ts', symbol: 'resolvePrice' }, { path: 'src/lib/clinical-workflow.ts', symbol: 'createOrder price snapshot' }] }
      ],
      improvements: [
        { title: 'Gate clinical output on approved ranges', detail: 'Require source, method, reviewer, effective date, and version for each demographic interval.', acceptance: 'No issued report presents an unapproved range as authoritative.' },
        { title: 'Snapshot catalogue provenance', detail: 'Store test ID/version, unit, range, method, and specimen in the issuance manifest.', acceptance: 'Reprinting an old report is stable after catalogue edits.' },
        { title: 'Validate the combined catalogue', detail: 'Normalize duplicates, range bounds, panel members, synonyms, and price keys before save and in CI.', acceptance: 'Punctuation variants and invalid/orphan definitions are rejected.' },
        { title: 'Require tariff activation', detail: 'Separate suggested prices from approved lab tariffs and show a setup gate before ordering/billing.', acceptance: 'A new lab cannot accidentally charge market suggestions.' }
      ],
      scores: [8, 7, 7, 6, 5, 5, 4, 7, 7, 7, 5, 5]
    },
    {
      id: 'results', name: 'Result entry & clinical calculations', category: 'Core clinical', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Provides keyboard-first result entry, categorical controls, CBC auto-calculation, numeric/titer validation, critical screening, delta review helpers, and issue-time validation through the report domain planner.',
      strengths: ['Keyboard row navigation and focused editor tests.', 'Derived CBC values clear when inputs become invalid.', 'Typed numeric/categorical/titer validation and critical screening.', 'Issue preflight now calls validateReportResults() through planReportWrite().'],
      gaps: [
        { id: 'RES-01', severity: 'P1', dimension: 'functionality', title: 'Critical-value override has no UI path', detail: 'planReportWrite() requires criticalOverrideReason, but ReportsPage never supplies it and the editor does not surface a critical-review form. A critical result can be blocked with no way to complete review.', refs: [{ path: 'src/lib/report-workflow.ts', symbol: 'criticalOverrideReason' }, { path: 'src/pages/dashboard/ReportsPage.tsx', symbol: 'handleCreateReport / handleSaveResults' }] },
        { id: 'RES-02', severity: 'P1', dimension: 'ux', title: 'Validation is issue-time only', detail: 'ReportResultsEditor does not call validateResult() while typing, so errors appear only after the operator presses Issue and values are not associated with field-level messages.', refs: [{ path: 'src/components/ReportResultsEditor.tsx', symbol: 'result input' }, { path: 'src/lib/result-validation.ts', symbol: 'validateResult' }] },
        { id: 'RES-03', severity: 'P1', dimension: 'backend', title: 'Screen and PDF flag parsing can still diverge', detail: 'The viewer extracts numeric values from text such as “< 5”, while PDF flagging uses Number(result). The stored value can therefore be flagged on screen but not on paper.', refs: [{ path: 'src/components/ReportViewerDashboard.tsx', symbol: 'flagFor' }, { path: 'src/lib/report-pdf.ts', symbol: 'buildReportModel flag calculation' }] },
        { id: 'RES-04', severity: 'P1', dimension: 'resilience', title: 'No autosave or conflict detection', detail: 'The editor mutates React state and persists on Save. A crash, lock, sheet dismissal, or second edit can discard work; there is no draft revision or optimistic concurrency token.', refs: [{ path: 'src/pages/dashboard/ReportsPage.tsx', symbol: 'handleSaveResults' }] },
        { id: 'RES-05', severity: 'P1', dimension: 'testing', title: 'New validation rules have no dedicated tests', detail: 'result-validation.ts and the new critical gate have no focused tests for malformed values, titer formats, demographic ranges, delta thresholds, or override reasons.', refs: [{ path: 'src/lib/result-validation.ts', symbol: 'module' }, { path: 'src/lib/report-workflow.test.ts', symbol: 'test suite' }] }
      ],
      improvements: [
        { title: 'Add a critical-review workflow', detail: 'Show critical warnings inline, require reviewer identity/reason, and retain acknowledgement in the report/audit trail.', acceptance: 'Critical values cannot be silently issued and authorized override is fully testable.' },
        { title: 'Validate while typing', detail: 'Use one pure validator in the editor, issue preflight, viewer, notifications, and PDF.', acceptance: 'Invalid values are explained at the field and identical flags appear on screen and paper.' },
        { title: 'Add autosave and revision conflicts', detail: 'Persist draft revisions, show saved-at state, and detect concurrent changes.', acceptance: 'Closing or locking never loses entered results; conflicts require explicit merge.' },
        { title: 'Add typed not-done/rejected/pending states', detail: 'Replace ambiguous blank cells with explicit result states and comments.', acceptance: 'A blank result can never be mistaken for missing transcription.' }
      ],
      scores: [7, 7, 7, 7, 5, 6, 4, 6, 3, 7, 5, 4]
    },
    {
      id: 'reports', name: 'Report workflow, amendments & compliance', category: 'Core clinical', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Creates draft/final reports, blocks final→draft regression, requires amendment reasons, retains prior versions, snapshots issuance context, attributes the issuer, and gates draft sharing.',
      strengths: ['Central report write planner enforces issue/amendment invariants.', 'Prior versions are retained in reportVersions.', 'Immutable issuance snapshot captures demographics, settings, tests, and ranges.', 'Malformed statuses normalize to reviewable drafts; blank/orphan issuance is rejected.'],
      gaps: [
        { id: 'REP-01', severity: 'P1', dimension: 'observability', title: 'No tamper evidence or verifiable signature', detail: 'The app avoids claiming a digital signature, but there is no hash, signature, trusted timestamp, or issuance manifest authentication. A copied PDF or modified local record cannot be verified.', refs: [{ path: 'src/lib/report-compliance.ts', symbol: 'buildReportLegalLines' }, { path: 'src/lib/report-snapshot.ts', symbol: 'snapshot' }] },
        { id: 'REP-02', severity: 'P1', dimension: 'functionality', title: 'No pathologist verification separation', detail: 'The same single account can enter, amend, issue, print, and delete. There is no technologist/pathologist approval, review queue, or role separation.', refs: [{ path: 'src/contexts/AuthContext.tsx', symbol: 'single local account' }, { path: 'src/pages/dashboard/ReportsPage.tsx', symbol: 'handleSaveResults' }] },
        { id: 'REP-03', severity: 'P1', dimension: 'backend', title: 'Legacy reports still fall back to live context', detail: 'patient_report() uses issuanceSnapshot when present, otherwise current patient/settings/catalogue. Historical reports issued before the snapshot feature can still change on reprint.', refs: [{ path: 'src/pages/dashboard/ReportsPage.tsx', symbol: 'patient_report' }, { path: 'src/lib/report-pdf.ts', symbol: 'buildReportModel' }] },
        { id: 'REP-04', severity: 'P1', dimension: 'backend', title: 'Hard delete removes amendment and billing history', detail: 'deleteReportCascade() deletes the live report, notes, versions, and linked invoices. An issued or amended report can vanish with no tombstone.', refs: [{ path: 'src/lib/cascades.ts', symbol: 'deleteReportCascade' }] },
        { id: 'REP-05', severity: 'P1', dimension: 'architecture', title: 'Issuance invariants remain renderer-authoritative', detail: 'The planner is shared domain code but still runs in the WebView. A rooted device, WebView exploit, or XSS can bypass it even though SQLCipher protects bytes at rest.', refs: [{ path: 'src/lib/report-workflow.ts', symbol: 'planReportWrite' }, { path: 'src/main.tsx', symbol: 'renderer bootstrap' }] }
      ],
      improvements: [
        { title: 'Add an immutable issuance manifest', detail: 'Hash and retain patient, lab, legal claims, catalogue versions, results, issuer, and timestamp.', acceptance: 'Historical reprints are byte-stable and externally verifiable.' },
        { title: 'Add review roles and retention-safe invalidation', detail: 'Separate entry, verification, issue, and deletion permissions; use void/supersede states.', acceptance: 'An issued report cannot be erased by its author and all changes remain attributable.' },
        { title: 'Backfill legacy snapshots safely', detail: 'Mark legacy reports as non-reproducible or capture a reviewed migration snapshot without inventing history.', acceptance: 'Every historical report has an explicit reproducibility status.' },
        { title: 'Move invariants behind a trusted boundary', detail: 'Enforce issue/amendment rules in native/main-process code or a local service.', acceptance: 'Renderer tampering cannot issue, amend, or bypass review.' }
      ],
      scores: [8, 7, 7, 7, 6, 7, 5, 6, 4, 7, 6, 5]
    },
    {
      id: 'pdf', name: 'PDF report generation & localization', category: 'Output & compliance', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Builds A4 pathology PDFs with modern/classic/minimalist/pre-printed templates, pagination, demographic ranges, abnormal flags, amendment text, range caveats, and one-page compaction.',
      strengths: ['Dedicated, heavily tested report builder.', 'Real page counts and bounded typography compaction.', 'Draft/final/amended presentation and print-contrast tests.', 'Unverified range caveats now print inline; issued reports prefer snapshot metadata.'],
      gaps: [
        { id: 'PDF-01', severity: 'P1', dimension: 'functionality', title: 'Unicode names and symbols are lossy', detail: 'Standard-14 Helvetica plus winAnsiSafe() drops unsupported scripts. Devanagari names can lose characters; ₹ becomes Rs. and arrows become text markers.', refs: [{ path: 'src/lib/pdf-text.ts', symbol: 'winAnsiSafe' }, { path: 'src/lib/invoice-pdf.ts', symbol: 'pdfMoney' }] },
        { id: 'PDF-02', severity: 'P1', dimension: 'backend', title: 'Legacy output can change on reprint', detail: 'Reports without issuanceSnapshot still inject current demographics, lab settings, and catalogue definitions at output time.', refs: [{ path: 'src/pages/dashboard/ReportsPage.tsx', symbol: 'patient_report' }, { path: 'src/lib/report-pdf.ts', symbol: 'buildReportModel' }] },
        { id: 'PDF-03', severity: 'P2', dimension: 'ux', title: 'Section bands can orphan at page bottoms', detail: 'The builder documents that jsPDF-autotable v5 lacks per-row pageBreak control, so a category band can be the last row on a page.', refs: [{ path: 'src/lib/report-pdf.ts', symbol: 'renderPass / pageUnits' }] },
        { id: 'PDF-04', severity: 'P2', dimension: 'testing', title: 'No visual regression fixtures for new caveats/snapshots', detail: 'Text/layout tests are strong, but there are no approved page-image fixtures covering long Indic names, caveats, amendments, and snapshot stability.', refs: [{ path: 'src/lib/report-pdf.test.ts', symbol: 'suite' }] }
      ],
      improvements: [
        { title: 'Embed a Unicode font', detail: 'Bundle an approved Devanagari/Latin subset and preserve ₹, arrows, and Indian names.', acceptance: 'Golden tests extract and render representative Hindi/Marathi names and currency correctly.' },
        { title: 'Render only from issuance snapshots', detail: 'Use current data only for new reports; mark legacy output explicitly.', acceptance: 'A reprint hash remains stable after patient, tariff, lab, and catalogue edits.' },
        { title: 'Add visual regression fixtures', detail: 'Maintain approved images for templates, long names, multi-page panels, caveats, and amendments.', acceptance: 'CI detects clipping, orphan bands, and font substitution.' },
        { title: 'Add PDF/A or archival output options', detail: 'Provide a long-term archival profile where required by lab policy.', acceptance: 'Archival reports preserve fonts, metadata, and visual layout across viewers.' }
      ],
      scores: [8, 7, 6, 6, 5, 6, 5, 6, 7, 7, 6, 5]
    },
    {
      id: 'printing', name: 'Printing, preview & sharing', category: 'Output & compliance', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Routes PDFs to Android PrintManager/viewer/share intents, Windows raster or shell PDF printing, and browser auto-print/download/Web Share, with an in-app desktop print dialog.',
      strengths: ['Platform-specific output routing instead of silent browser no-ops.', 'Desktop dialog supports printer, page range, copies, duplex, orientation, sheet, and scale.', 'Saved-file receipts and draft-print warnings.', 'Android printer patch pins portrait A4; desktop shell-open targets are now confined and realpath-checked.'],
      gaps: [
        { id: 'PRT-01', severity: 'P0', dimension: 'security', title: 'Desktop file writes remain over-broad and unbounded', detail: 'pm:files:save accepts any app-relative path under the entire Documents root when publicFirst is true, not just Documents/PathoMitra. It also lacks runtime type/size checks for args, data, base64, and publicFirst. A compromised renderer can overwrite known Documents files or exhaust memory/disk.', refs: [{ path: 'electron/ipc.ts', symbol: 'saveFile / pm:files:save' }, { path: 'src/lib/native-files.ts', symbol: 'writeOnDevice' }] },
        { id: 'PRT-02', severity: 'P1', dimension: 'security', title: 'Recursive output-folder deletion lacks realpath confinement', detail: 'pm:files:removeTree uses lexical containment and recursively removes both private and Documents app folders without the realpath checks used by withinAppRoots(). Junction/symlink behavior needs adversarial tests.', refs: [{ path: 'electron/ipc.ts', symbol: 'pm:files:removeTree' }] },
        { id: 'PRT-03', severity: 'P1', dimension: 'performance', title: 'Raster print jobs have no byte or memory budget', detail: 'PrintDialog renders every selected page at ~300 dpi and retains all PNG data URLs. Main-process validation limits page count but not payload bytes, dimensions, copies, or total decoded pixels.', refs: [{ path: 'src/components/PrintDialog.tsx', symbol: 'submit' }, { path: 'src/lib/pdf-preview.ts', symbol: 'renderPageToPng' }, { path: 'electron/print-window.ts', symbol: 'validate / MAX_PAGES' }] },
        { id: 'PRT-04', severity: 'P1', dimension: 'resilience', title: 'Staging cleanup can race another print job', detail: 'sweepStaleStaging() deletes every file in the shared Print directory except the current job, without tracking active jobs. Concurrent jobs can delete each other’s staging HTML.', refs: [{ path: 'electron/print-window.ts', symbol: 'sweepStaleStaging / printJob' }] },
        { id: 'PRT-05', severity: 'P1', dimension: 'observability', title: 'No print/share audit trail', detail: 'The app does not record who printed, downloaded, or shared which report version, to which printer/app, when, or whether the operation was cancelled.', refs: [{ path: 'src/lib/native-print.ts', symbol: 'printPdf / previewPdf / sharePdf' }] },
        { id: 'PRT-06', severity: 'P2', dimension: 'ux', title: 'Web preview relies on a retained opener', detail: 'openInTab() omits noopener to detect popup success. The blob is same-origin, but the pattern weakens isolation and depends on browser PDF behavior.', refs: [{ path: 'src/lib/native-print.ts', symbol: 'openInTab' }] }
      ],
      improvements: [
        { title: 'Confine and budget desktop file writes', detail: 'Allow only Documents/PathoMitra or private output roots, validate argument types and payload size, and require app-specific subpaths.', acceptance: 'IPC tests reject traversal, foreign files, oversized payloads, and invalid base64.' },
        { title: 'Stream and budget print jobs', detail: 'Set maximum pixels/bytes/copies, render sequentially, and avoid retaining all PNGs.', acceptance: 'Oversized jobs fail before rasterization and valid jobs stay within a measured memory ceiling.' },
        { title: 'Use per-job staging directories', detail: 'Clean only stale job directories by age and never another active job’s files.', acceptance: 'Concurrent print tests cannot remove each other’s staging data.' },
        { title: 'Add output audit events', detail: 'Record report/version, actor, action, destination, timestamp, and result.', acceptance: 'Every print/download/share attempt is attributable and exportable.' }
      ],
      scores: [8, 7, 7, 6, 3, 4, 4, 3, 5, 5, 5, 4]
    },
    {
      id: 'billing', name: 'Billing, invoices & payments', category: 'Finance', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Creates frozen line-item invoices, supports panels, discounts, tax, paid/partial/void states, payments, bulk billing, reprints, referral snapshots, and register CSV export.',
      strengths: ['Invoice line prices are copied at raise time and line arithmetic is recomputed.', 'Totals derive from line items and discount/tax inputs.', 'Monthly invoice numbering with duplicate-panel protection.', 'Pending/partial/paid/void model, bulk-run skip reporting, and full-collection missing-bill planning.'],
      gaps: [
        { id: 'BIL-01', severity: 'P0', dimension: 'backend', title: 'Payments are a mutable snapshot, not a transaction ledger', detail: 'recordPayment() reads, computes, and updates outside one repository transaction. payments exists as a collection and PaymentLedgerSchema exists, but no payment/refund/reversal records are written. Concurrent or failed updates can lose money history.', refs: [{ path: 'src/lib/invoices.ts', symbol: 'recordPayment' }, { path: 'src/lib/models.ts', symbol: 'PaymentLedgerSchema' }, { path: 'src/data/entities.ts', symbol: 'payments' }] },
        { id: 'BIL-02', severity: 'P1', dimension: 'backend', title: 'Invoice numbering still races across processes', detail: 'allocateInvoiceNo() reads/probes/writes the counter separately from insertion. The per-process queue prevents local interleaving but not two app processes or a crash between counter and insert.', refs: [{ path: 'src/lib/invoice-registry.ts', symbol: 'allocateInvoiceNoUnlocked' }, { path: 'src/lib/invoices.ts', symbol: 'raiseInvoice' }] },
        { id: 'BIL-03', severity: 'P1', dimension: 'backend', title: 'No refunds, reversals, split tender, or reconciliation', detail: 'Partial payments overwrite the prior mode/time; overpayment is clamped without a credit record. There is no cash-drawer shift, refund, reversal, waiver ledger, or end-of-day reconciliation.', refs: [{ path: 'src/lib/models.ts', symbol: 'InvoiceSchema / toInvoicePaymentDoc' }, { path: 'src/lib/invoices.ts', symbol: 'recordPayment' }] },
        { id: 'BIL-04', severity: 'P1', dimension: 'functionality', title: 'Indian invoice compliance fields are missing', detail: 'No supplier/patient GSTIN, HSN/SAC, place of supply, CGST/SGST split, legal entity series, e-invoice/e-way fields, or credit/debit note workflow.', refs: [{ path: 'src/lib/invoice-pdf.ts', symbol: 'buildInvoicePdf' }, { path: 'src/components/ManageTestsPanel.tsx', symbol: 'billing preferences' }] },
        { id: 'BIL-05', severity: 'P1', dimension: 'ux', title: 'Register totals and exports cover only loaded rows', detail: 'BillsPage summarises and exports rows derived from the 40-item UI slice; status/search filtering happens after pagination. Totals and CSV can understate the register.', refs: [{ path: 'src/pages/dashboard/BillsPage.tsx', symbol: 'rows / summary / exportRegister' }, { path: 'src/hooks/useCollectionList.ts', symbol: 'items' }] },
        { id: 'BIL-06', severity: 'P1', dimension: 'backend', title: 'Hard deletes undermine financial audit', detail: 'deleteInvoice(), report deletion, and patient deletion can permanently remove invoices, including paid/printed documents. Void exists but does not prevent these paths.', refs: [{ path: 'src/lib/invoices.ts', symbol: 'deleteInvoice' }, { path: 'src/lib/cascades.ts', symbol: 'deleteReportCascade / deletePatientCascade' }] },
        { id: 'BIL-07', severity: 'P1', dimension: 'architecture', title: 'Billing is not linked to the new order aggregate', detail: 'RaiseInvoiceInput has no orderId and raiseInvoice() never persists one, so order status cannot advance to billed and the bill cannot prove which requisition it settles.', refs: [{ path: 'src/lib/invoices.ts', symbol: 'RaiseInvoiceInput / raiseInvoice' }, { path: 'src/lib/models.ts', symbol: 'InvoiceSchema.orderId' }] }
      ],
      improvements: [
        { title: 'Add an append-only payment ledger', detail: 'Record each receipt, split tender, refund, reversal, waiver, and cash-drawer shift with actor/timestamp.', acceptance: 'Invoice paid amount equals the ledger sum after every operation.' },
        { title: 'Make numbering and payment atomic', detail: 'Allocate number plus insert in one transaction and update invoice plus ledger atomically.', acceptance: 'Concurrent billing and crash tests cannot overwrite or mis-add invoices.' },
        { title: 'Support jurisdictional invoice requirements', detail: 'Configure legal entity, GSTIN, tax split, HSN/SAC, place of supply, rounding, and credit/debit notes.', acceptance: 'Printed invoices pass the lab accountant/legal review.' },
        { title: 'Separate aggregates from UI paging', detail: 'Compute totals and exports from the full filtered dataset and link every bill to an order.', acceptance: 'Summary, CSV, order status, and ledger reconcile with >40 invoices.' },
        { title: 'Retain voided and superseded bills', detail: 'Remove hard-delete paths for issued/printed invoices.', acceptance: 'Financial history survives patient/report deletion and remains reconcilable.' }
      ],
      scores: [7, 6, 6, 6, 5, 4, 4, 4, 5, 6, 5, 4]
    },
    {
      id: 'referrals', name: 'Doctors, referrals & statements', category: 'Finance', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Maintains a doctor/referrer register, normalizes names, snapshots referral percentage/commission on invoices, and produces monthly/range statements and summaries.',
      strengths: ['Referral rate and commission are frozen at bill time.', 'Statements support billed vs collected basis.', 'Doctor name normalization reduces spelling fragmentation.', 'Statement PDF and summary outputs share the invoice pipeline.'],
      gaps: [
        { id: 'REF-01', severity: 'P1', dimension: 'functionality', title: 'No payout ledger', detail: 'Statements calculate what is owed but cannot record paid, part-paid, adjusted, recovered, or carried-forward commission. referralPayouts exists only as a collection name.', refs: [{ path: 'src/lib/referrals.ts', symbol: 'buildDoctorStatements / statementsSummary' }, { path: 'src/data/entities.ts', symbol: 'referralPayouts' }] },
        { id: 'REF-02', severity: 'P1', dimension: 'security', title: 'Referral commission is a regulatory/ethical risk', detail: 'The code notes that paying for referrals may violate Indian professional-conduct rules, yet actively calculates and prints payout amounts without compliance mode, legal acknowledgement, or disable switch.', refs: [{ path: 'src/lib/referrals.ts', symbol: 'module compliance note' }, { path: 'src/lib/models.ts', symbol: 'DoctorSchema.referralPercent' }] },
        { id: 'REF-03', severity: 'P1', dimension: 'backend', title: 'Name matching can misattribute money', detail: 'Patients still store doctorName free text rather than a required doctorId. Heuristic folding cannot reliably distinguish same-name practitioners, institutions, qualifications, or spelling variants.', refs: [{ path: 'src/lib/doctor-registry.ts', symbol: 'doctorNameKey' }, { path: 'src/lib/referrals.ts', symbol: 'resolveReferral' }] },
        { id: 'REF-04', severity: 'P2', dimension: 'ux', title: 'Mixed-rate statements can show a misleading headline rate', detail: 'When lines have different snapshot percentages, the statement can retain one headline rate while totals combine multiple rates.', refs: [{ path: 'src/lib/referrals.ts', symbol: 'buildDoctorStatements' }] },
        { id: 'REF-05', severity: 'P2', dimension: 'observability', title: 'Doctor writes lack domain validation and audit', detail: 'Whitespace-only names can pass HTML required and be trimmed empty; duplicates are allowed; registration/phone/rate edits have no updatedBy/updatedAt history.', refs: [{ path: 'src/pages/dashboard/DoctorsPage.tsx', symbol: 'handleSubmit / saveCommission' }] }
      ],
      improvements: [
        { title: 'Add a commission compliance mode', detail: 'Default to tracking only, require legal/owner acknowledgement before payout calculations, and support disabling commission.', acceptance: 'Labs can operate without payout computation; enabling it records policy version and approver.' },
        { title: 'Link patients/orders to doctorId', detail: 'Keep display-name snapshots for history but use stable IDs for attribution.', acceptance: 'Same-name doctors and renamed clinics cannot inherit each other’s referrals.' },
        { title: 'Add payout and adjustment ledger', detail: 'Record reference, amount, mode, date, actor, adjustments, and carry-forward.', acceptance: 'Closing balance equals earned commission minus paid/adjusted amounts.' },
        { title: 'Display mixed-rate statements accurately', detail: 'Show per-line percentages and “mixed rates” when applicable.', acceptance: 'No statement implies one rate when its lines differ.' }
      ],
      scores: [8, 7, 6, 6, 4, 5, 4, 6, 7, 6, 5, 4]
    },
    {
      id: 'dashboard', name: 'Dashboard, overview & analytics', category: 'Operations', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Shows recent patients/reports and three overview KPIs, plus analytics for report volume, tests, categories, repeat behavior, and top referrers.',
      strengths: ['Local-day date handling and issued/draft separation.', 'Charts follow theme and reduced-motion settings.', 'KPI cards and recent activity link to work areas.', 'Analytics uses adaptive day/week/month buckets instead of silently truncating long ranges.'],
      gaps: [
        { id: 'DSH-01', severity: 'P1', dimension: 'backend', title: 'Overview revenue can remain stale', detail: 'Stats refresh is triggered by recent report/patient listeners. Creating a bill or recording payment does not invalidate Total Revenue, so cash can remain stale until another event/reload.', refs: [{ path: 'src/pages/dashboard/OverviewPage.tsx', symbol: 'loadStats / scheduleStatsRefresh' }] },
        { id: 'DSH-02', severity: 'P1', dimension: 'backend', title: 'Recent-report logic can mislabel returning patients', detail: 'combinedReports filters patients against only the newest ten reports. A returning patient with an older report can appear as awaiting a report.', refs: [{ path: 'src/pages/dashboard/OverviewPage.tsx', symbol: 'combinedReports' }] },
        { id: 'DSH-03', severity: 'P1', dimension: 'functionality', title: 'Overview lacks operational worklist KPIs', detail: 'Only Total Patients, Reports Issued, and Total Revenue are shown. There is no pending order/sample, TAT, rejected sample, overdue draft, unbilled report, or outstanding balance summary.', refs: [{ path: 'src/pages/dashboard/OverviewPage.tsx', symbol: 'cards' }, { path: 'src/pages/dashboard/WorkflowPage.tsx', symbol: 'new workflow data' }] },
        { id: 'DSH-04', severity: 'P1', dimension: 'performance', title: 'Analytics still rereads the full roster', detail: 'The referral join needs every patient and the roster effect can reread the collection when reports change. Local aggregate shims also materialize full collections.', refs: [{ path: 'src/pages/dashboard/AnalyticsPage.tsx', symbol: 'roster effect' }, { path: 'src/data/fs.ts', symbol: 'getAggregateFromServer' }] },
        { id: 'DSH-05', severity: 'P2', dimension: 'a11y', title: 'Charts lack complete textual alternatives', detail: 'Most Recharts visualizations do not expose equivalent data tables or detailed summaries; only some wrappers have role/aria labels.', refs: [{ path: 'src/pages/dashboard/AnalyticsPage.tsx', symbol: 'chart wrappers' }] }
      ],
      improvements: [
        { title: 'Invalidate KPIs from every source', detail: 'Listen to invoices/payments or refresh explicitly after every billing mutation.', acceptance: 'Revenue updates immediately after raise, partial/full payment, void, and restore.' },
        { title: 'Compute pending state from full datasets', detail: 'Use order/sample/report joins rather than the newest ten reports.', acceptance: 'Returning patients and partially reported orders are never mislabeled.' },
        { title: 'Add operational KPIs and drill-downs', detail: 'Pending orders/samples, TAT, rejected samples, unbilled reports, drafts, and balances.', acceptance: 'Each KPI opens the exact records that compose it.' },
        { title: 'Cache/index aggregates and add chart tables', detail: 'Maintain incremental local aggregates and expose every plotted value as text.', acceptance: 'Dashboard remains responsive at scale and screen-reader users can retrieve all values.' }
      ],
      scores: [7, 7, 7, 5, 5, 4, 4, 4, 4, 6, 5, 4]
    },
    {
      id: 'notifications', name: 'Notifications & operational worklists', category: 'Operations', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Derives overdue-report, unissued-draft, amended-report, and payment-due alerts with read/mute state, thresholds, privacy-safe banners, and local delivery.',
      strengths: ['Pure notification engine with extensive threshold/severity tests.', 'Banner copy avoids patient names and clinical details.', 'Read/mute IDs are stable across reloads.', 'Partial invoices are now included and auto-refresh no longer depends on navigator.onLine.'],
      gaps: [
        { id: 'NOT-01', severity: 'P1', dimension: 'functionality', title: 'No background reminder delivery', detail: 'Notifications post while the dashboard is open and refresh every ten minutes. No future alarm is scheduled and the boot receiver is removed, so overdue work is not announced when the app is closed.', refs: [{ path: 'src/lib/desktop-notifications.ts', symbol: 'showBanner' }, { path: 'android/app/src/main/AndroidManifest.xml', symbol: 'removed boot receiver' }] },
        { id: 'NOT-02', severity: 'P1', dimension: 'backend', title: 'Bounded windows can miss real work', detail: 'Only 200 patients/reports, 60 drafts/amendments, and 60 invoices are evaluated. A busy lab can have overdue records outside the window with no indication that results are incomplete.', refs: [{ path: 'src/hooks/useNotifications.ts', symbol: 'window constants' }] },
        { id: 'NOT-03', severity: 'P1', dimension: 'backend', title: 'Overdue sample age is still registration age', detail: 'The alert says tests were collected N hours ago but uses patient.createdAt instead of Sample.collectedAt.', refs: [{ path: 'src/lib/notification-engine.ts', symbol: 'overdue alert' }, { path: 'src/lib/clinical-workflow.ts', symbol: 'hoursSinceCollection' }] },
        { id: 'NOT-04', severity: 'P2', dimension: 'resilience', title: 'No delivery/acknowledgement telemetry', detail: 'The app cannot show whether an OS banner was delivered, read, or acted on, and there is no escalation policy for critical work.', refs: [{ path: 'src/lib/desktop-notifications.ts', symbol: 'delivery path' }] }
      ],
      improvements: [
        { title: 'Add approved scheduled reminders', detail: 'Use OS-approved inexact/exact APIs only after Play permission review and respect Do Not Disturb.', acceptance: 'Overdue reminders fire when closed and protect lock-screen privacy.' },
        { title: 'Make completeness visible', detail: 'Show truncation/window limits and provide a full worklist query.', acceptance: 'The UI never implies “no alerts” when records were excluded.' },
        { title: 'Base TAT on sample milestones', detail: 'Consume Sample.collectedAt/receivedAt and report result/issue timestamps.', acceptance: 'Alert age matches the milestone shown to staff.' },
        { title: 'Add delivery and escalation audit', detail: 'Record notification creation, delivery, acknowledgement, and escalation without PHI.', acceptance: 'Critical work has a traceable response path.' }
      ],
      scores: [7, 7, 7, 6, 6, 5, 3, 5, 7, 5, 5, 4]
    },
    {
      id: 'search', name: 'Global search, navigation & keyboard workflow', category: 'UX system', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Adds URL tabs, Android back handling, Ctrl/Cmd+K search across patients/reports/doctors, keyboard result navigation, direct-ID deep links, scroll memory, and pull-to-refresh.',
      strengths: ['Search indexes full local collections and reports failed sources.', 'Token-AND matching and normalized phone search.', 'Patient/report/doctor deep links now resolve records directly by ID.', 'URL tabs and Android Back behavior are centralized.'],
      gaps: [
        { id: 'SEA-01', severity: 'P1', dimension: 'performance', title: 'Search rebuilds all indexes on every open', detail: 'CommandSearch reads and indexes every patient, report, and doctor synchronously on open with no persisted index, debounce, worker, or virtualization.', refs: [{ path: 'src/components/CommandSearch.tsx', symbol: 'load effect' }] },
        { id: 'SEA-02', severity: 'P1', dimension: 'a11y', title: 'Command palette lacks full modal semantics', detail: 'It has role=dialog/aria-modal but no focus trap, inert background, or reliable focus return. Tab can move behind the overlay.', refs: [{ path: 'src/components/CommandSearch.tsx', symbol: 'overlay markup' }] },
        { id: 'SEA-03', severity: 'P2', dimension: 'functionality', title: 'Orders and samples are not searchable', detail: 'The global palette still indexes only patients, reports, and doctors despite new order/sample routes and deep-link parameters.', refs: [{ path: 'src/components/CommandSearch.tsx', symbol: 'SearchResult / load' }, { path: 'src/App.tsx', symbol: 'openOrder / openSample' }] },
        { id: 'SEA-04', severity: 'P2', dimension: 'ux', title: 'No recent searches or query highlighting', detail: 'The palette has no recent-history affordance, match highlighting, or empty-query recent records, which slows repeat counter work.', refs: [{ path: 'src/components/CommandSearch.tsx', symbol: 'results rendering' }] }
      ],
      improvements: [
        { title: 'Build a persistent incremental index', detail: 'Update on writes and query in a worker or indexed store.', acceptance: 'Search remains responsive with a measured 50k-record dataset.' },
        { title: 'Adopt one accessible overlay primitive', detail: 'Use Sheet focus/inert/Escape behavior for search, calendar, drawer, and print.', acceptance: 'Focus never leaves or falls behind an open modal.' },
        { title: 'Index orders and samples', detail: 'Add order number, accession, barcode, patient, test, and status to search.', acceptance: 'Every workflow record opens directly from global search.' },
        { title: 'Add recents and match highlighting', detail: 'Keep privacy-safe recent queries and emphasize matched tokens.', acceptance: 'Repeat lookups are faster without exposing PHI on shared screens.' }
      ],
      scores: [8, 7, 7, 5, 5, 5, 5, 3, 4, 7, 5, 4]
    },
    {
      id: 'auth', name: 'Authentication, biometrics & session locking', category: 'Security', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Provides one local lab account, PBKDF2-SHA256 passcode hashing, secure-store persistence, lockout backoff, optional Android biometrics, terms acceptance, idle/background locking, and erasure.',
      strengths: ['Passcode is never stored in plaintext; random salt and 210k PBKDF2 iterations.', 'Keystore/Credential Manager storage and fail-closed secure-store reads.', 'Database opens lazily after authenticated access rather than at bootstrap.', 'Web now shows a pre-onboarding demo-only notice and honest storage copy.'],
      gaps: [
        { id: 'AUT-01', severity: 'P1', dimension: 'functionality', title: 'Single lab identity is not operator accountability', detail: 'The account name is also the lab name, every unlocked user is admin, and staff/guest roles are unreachable. Clinical and financial actions cannot be attributed to individual staff.', refs: [{ path: 'src/contexts/AuthContext.tsx', symbol: 'LOCAL_UID / role' }, { path: 'src/lib/local-account.ts', symbol: 'LocalAccount' }] },
        { id: 'AUT-02', severity: 'P1', dimension: 'resilience', title: 'No account recovery or break-glass path', detail: 'A forgotten passcode or corrupt secure-store record has no recovery flow. Recreating the account risks orphaning the encrypted database and encourages destructive recovery.', refs: [{ path: 'src/pages/auth/AuthPage.tsx', symbol: 'UnlockForm' }, { path: 'src/contexts/AuthContext.tsx', symbol: 'eraseAllData' }] },
        { id: 'AUT-03', severity: 'P1', dimension: 'platform', title: 'Desktop lacks Windows Hello and suspend/minimize lock', detail: 'Biometric unlock is native-only, and session-lock deliberately omits desktop powerMonitor/minimize handling. Only passcode and idle timeout protect the desktop session.', refs: [{ path: 'src/lib/biometric.ts', symbol: 'authenticate' }, { path: 'src/lib/session-lock.ts', symbol: 'desktop branch' }] },
        { id: 'AUT-04', severity: 'P2', dimension: 'security', title: 'Web acknowledgement is not a technical control', detail: 'The demo notice is a sessionStorage acknowledgement. It reduces misleading claims but does not prevent real PHI entry or protect localStorage.', refs: [{ path: 'src/pages/auth/AuthPage.tsx', symbol: 'WebStorageNotice' }, { path: 'src/data/webRepository.ts', symbol: 'localStorage' }] }
      ],
      improvements: [
        { title: 'Add individual operator accounts and roles', detail: 'Separate lab identity from user identity and support technologist, pathologist, cashier, and admin permissions.', acceptance: 'Every mutation records a unique actor and unauthorized transitions are rejected outside React.' },
        { title: 'Design recovery and break-glass controls', detail: 'Provide recovery keys, supervised reset, dual approval, and auditable emergency access.', acceptance: 'A forgotten passcode can be recovered under a tested, non-destructive policy.' },
        { title: 'Add Windows Hello and powerMonitor locking', detail: 'Use OS credential authentication and lock on suspend/minimize according to policy.', acceptance: 'Desktop session locks reliably and supports Windows Hello.' },
        { title: 'Enforce the web demo boundary technically', detail: 'Use demo watermarks, synthetic data, or an explicit build mode that blocks production clinical use.', acceptance: 'A web user cannot mistake the demo for protected clinical storage.' }
      ],
      scores: [8, 8, 8, 8, 7, 7, 5, 6, 6, 6, 5, 5]
    },
    {
      id: 'persistence', name: 'Data persistence, queries & transactions', category: 'Architecture', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Uses a repository façade with Android SQLCipher rows, Electron encrypted whole-collection JSON, and browser localStorage, plus shared in-memory query semantics and Zod readers.',
      strengths: ['Android and Desktop SQLCipher keys stay in platform key stores.', 'Native and Desktop multi-collection transactions.', 'One shared ENTITY_NAMES contract now covers orders, samples, reportVersions, payments, referralPayouts, and auditEvents.', 'Mutation queues and failed-load cache eviction reduce lost updates and destructive retries.'],
      gaps: [
        { id: 'DAT-01', severity: 'P1', dimension: 'backend', title: 'updateDoc silently creates missing documents', detail: 'All local adapters merge a patch onto an empty object. Several call sites do not read-before-update, so stale IDs can mint partial patients, reports, invoices, or settings.', refs: [{ path: 'src/data/fs.ts', symbol: 'updateDoc' }, { path: 'src/data/sqliteRepository.ts', symbol: 'update' }, { path: 'src/data/webRepository.ts', symbol: 'update' }] },
        { id: 'DAT-02', severity: 'P1', dimension: 'performance', title: 'Desktop rewrites entire collections as JSON', detail: 'One SQLite row per collection means every single-document mutation serializes and rewrites all patients/reports/invoices, causing write amplification and a large corruption blast radius.', refs: [{ path: 'electron/db.ts', symbol: 'entities table' }, { path: 'src/data/desktopRepository.ts', symbol: 'persist' }] },
        { id: 'DAT-03', severity: 'P1', dimension: 'resilience', title: 'No migration framework or upgrade tests', detail: 'Native DB_VERSION is 2 and Desktop uses CREATE TABLE IF NOT EXISTS only. There is no migration runner, rollback plan, or upgrade test from prior releases.', refs: [{ path: 'src/data/sqliteRepository.ts', symbol: 'DB_VERSION / SCHEMA' }, { path: 'electron/db.ts', symbol: 'doOpen' }] },
        { id: 'DAT-04', severity: 'P1', dimension: 'resilience', title: 'Browser writes silently degrade to memory', detail: 'WebRepository catches localStorage quota/private-mode failures and continues with an in-memory copy. The UI can show saved data that disappears on reload.', refs: [{ path: 'src/data/webRepository.ts', symbol: 'writeStore' }] },
        { id: 'DAT-05', severity: 'P2', dimension: 'architecture', title: 'Firestore-shaped shim obscures local semantics', detail: 'serverTimestamp(), getAggregateFromServer(), and Firestore-named errors hide local behavior such as upsert updates and in-memory aggregation.', refs: [{ path: 'src/data/fs.ts', symbol: 'compatibility façade' }, { path: 'src/lib/firestore-errors.ts', symbol: 'handleFirestoreError' }] },
        { id: 'DAT-06', severity: 'P2', dimension: 'backend', title: 'New collections lack complete domain services', detail: 'payments and referralPayouts are in the entity contract and backups but have no write services or reconciliation logic; auditEvents has a writer but no append-only enforcement.', refs: [{ path: 'src/data/entities.ts', symbol: 'ENTITY_NAMES' }, { path: 'src/lib/models.ts', symbol: 'PaymentLedgerSchema' }] }
      ],
      improvements: [
        { title: 'Make updates insert-only by default', detail: 'Require existing records or expose an explicit create operation.', acceptance: 'A stale update ID cannot mint a partial document.' },
        { title: 'Move Desktop storage to row-level SQL', detail: 'Use prepared statements per document and transactions for cross-entity operations.', acceptance: 'Large-dataset benchmarks show bounded write cost.' },
        { title: 'Add migrations and integrity checks', detail: 'Version schemas, migrate transactionally, and verify references after restore/upgrade.', acceptance: 'CI upgrades fixtures from every supported release and detects orphans.' },
        { title: 'Fail closed on persistence errors', detail: 'Surface quota, disk-full, encryption, and serialization errors with retry.', acceptance: 'Every failed write produces a visible error and no success state.' },
        { title: 'Replace the Firestore shim with explicit local services', detail: 'Use honest repository names and semantics.', acceptance: 'New code cannot accidentally rely on server-only or upsert behavior.' }
      ],
      scores: [8, 6, 5, 5, 7, 5, 5, 4, 6, 6, 6, 4]
    },
    {
      id: 'backup', name: 'Backup, restore & data erasure', category: 'Data management', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Exports every entity snapshot to app storage, optionally seals it with PBKDF2 + AES-256-GCM, lists/shares/deletes snapshots, restores transactionally, and erases database/app copies.',
      strengths: ['Backup encryption is on by default in the UI.', 'PBKDF2 + AES-GCM with random salt/IV and authenticated restore.', 'Unique filenames prevent same-minute overwrite.', 'Desktop restore now supports all shared entities; erase uses secure_delete/VACUUM and removes app outputs/logs/mirrors.'],
      gaps: [
        { id: 'BAK-01', severity: 'P1', dimension: 'backend', title: 'Restore validates shape but not clinical/financial records', detail: 'parseBackup() requires IDs and top-level counts but does not validate each entity against Patient/Report/Invoice/Order schemas, verify counts, check references, or cap file/document size.', refs: [{ path: 'src/lib/backup.ts', symbol: 'BackupFileSchema / planRestore' }] },
        { id: 'BAK-02', severity: 'P1', dimension: 'backend', title: 'Older snapshots can overwrite newer records silently', detail: 'Restore is unconditional upsert. An older backup can replace a newer report, invoice, price, or setting with no preview, conflict report, or rollback snapshot.', refs: [{ path: 'src/lib/backup.ts', symbol: 'restoreBackup' }] },
        { id: 'BAK-03', severity: 'P1', dimension: 'resilience', title: 'Snapshot creation is not atomic or verified', detail: 'Collections are read sequentially with no consistent snapshot, and the file is written directly without temp+fsync+rename or read-back verification.', refs: [{ path: 'src/lib/backup.ts', symbol: 'buildBackup / createBackup' }] },
        { id: 'BAK-04', severity: 'P1', dimension: 'resilience', title: 'Settings/custom tests can miss the encrypted backup window', detail: 'The settings mirror is debounced by 900 ms for non-Settings writes. A backup taken immediately after another edit can contain previous settings/custom tests.', refs: [{ path: 'src/lib/settings-sync.ts', symbol: 'queuePush' }, { path: 'src/lib/backup.ts', symbol: 'buildBackup' }] },
        { id: 'BAK-05', severity: 'P2', dimension: 'security', title: 'Erase cannot guarantee destruction of external copies', detail: 'The app can remove its own database, WAL, outputs, logs, and mirrors, but cannot verify shared/emailed/cloud copies or OS backups. The UI needs an explicit retained-copy checklist.', refs: [{ path: 'src/lib/erase-data.ts', symbol: 'eraseLocalArtifacts' }, { path: 'src/lib/native-files.ts', symbol: 'eraseAppOutputs' }] }
      ],
      improvements: [
        { title: 'Validate and preview restore', detail: 'Schema-check every record, verify counts/references, show conflicts, and create a pre-restore safety snapshot.', acceptance: 'Malformed or older backups cannot overwrite data without explicit decisions.' },
        { title: 'Write backups atomically and verify them', detail: 'Use a consistent DB snapshot, temporary file, flush/rename, checksum, and optional restore probe.', acceptance: 'Interrupted writes never appear valid.' },
        { title: 'Add backup policy automation', detail: 'Reminders, retention rotation, multiple destinations, and restore drills without silent cloud transmission.', acceptance: 'Labs can prove freshness and restore on a second device.' },
        { title: 'Make erasure scope explicit', detail: 'Show a per-store checklist and identify external copies that cannot be verified.', acceptance: 'Erase reports verified local outcomes and clearly retained external copies.' }
      ],
      scores: [8, 7, 6, 6, 6, 5, 4, 5, 6, 6, 5, 4]
    },
    {
      id: 'settings', name: 'Settings, branding & report layout', category: 'Configuration', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Manages profile, themes, lab identity, logo, report/share templates, margins/typography, custom tests/prices, notification preferences, security, public exports, and diagnostics.',
      strengths: ['Live report preview and sample PDF.', 'Theme, text scale, reduced motion/transparency, corner style, and forced-colors controls.', 'Layout values are clamped and template edits support undo/redo.', 'SettingsPage now awaits persistSettingsNow() and reports durable failure instead of using a fake delay.'],
      gaps: [
        { id: 'SET-01', severity: 'P1', dimension: 'resilience', title: 'Durable settings are eventually consistent outside Settings', detail: 'localStorage remains the fast cache while the encrypted mirror is debounced by 900 ms. Rapid edits, crash, or backup within that window can lose or omit changes.', refs: [{ path: 'src/lib/settings-sync.ts', symbol: 'queuePush / persistSettingsNow' }] },
        { id: 'SET-02', severity: 'P1', dimension: 'backend', title: 'Large artwork is excluded from encrypted backup', detail: 'Settings allow a large share image, but settings-sync drops images above 400 KB from the encrypted payload. Such artwork exists only in localStorage.', refs: [{ path: 'src/lib/settings.ts', symbol: 'image limits' }, { path: 'src/lib/settings-sync.ts', symbol: 'MAX_SYNCED_IMAGE_CHARS' }] },
        { id: 'SET-03', severity: 'P2', dimension: 'a11y', title: 'Field errors/hints are not automatically associated', detail: 'Field renders role=alert text but does not add aria-describedby or aria-invalid to the control; required is only a visual asterisk unless each caller sets native required.', refs: [{ path: 'src/components/ui/Field.tsx', symbol: 'Field' }] },
        { id: 'SET-04', severity: 'P2', dimension: 'architecture', title: 'Design-system documentation and implementation drift', detail: 'The design doc bans arbitrary pixel type sizes, yet many components use text-[…px]. font-black is used without a loaded 900 weight, and 32 source files currently fail Prettier.', refs: [{ path: 'docs/design/design.md', symbol: 'Typography / accessibility' }, { path: 'src/index.css', symbol: 'type scale' }] }
      ],
      improvements: [
        { title: 'Choose one durable authority', detail: 'Write encrypted settings first or use a write-ahead queue, then update the fast cache.', acceptance: 'A crash immediately after Save preserves the latest settings.' },
        { title: 'Store artwork as files with references', detail: 'Avoid multi-megabyte data URLs in JSON/localStorage and include assets in backup manifests.', acceptance: 'Logos/letterheads survive cache clear, backup, restore, and migration.' },
        { title: 'Strengthen the Field primitive', detail: 'Generate IDs for hint/error and set aria-describedby/aria-invalid/required.', acceptance: 'Automated tests verify every field’s label, description, and error association.' },
        { title: 'Enforce design tokens in CI', detail: 'Ban arbitrary type/color values, self-host intended weights, and include format:check in verify.', acceptance: 'Formatting passes and new UI cannot introduce untracked drift.' }
      ],
      scores: [8, 7, 7, 6, 5, 5, 5, 6, 6, 7, 5, 4]
    },
    {
      id: 'exports', name: 'Data export & interoperability', category: 'Data management', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Exports patient/report/bill registers to CSV and reports/bills/statements to PDF, with native saving/sharing and browser download/Web Share fallbacks.',
      strengths: ['RFC 4180 CSV quoting and formula-injection neutralization.', 'UTF-8 BOM for Excel and native output paths.', 'Public exports are off by default.', 'Report PDFs and billing documents share platform-specific output routing.'],
      gaps: [
        { id: 'EXP-01', severity: 'P1', dimension: 'backend', title: 'Exports silently include only visible rows', detail: 'Patient, report, and bill CSV actions use UI-sliced arrays. Users can export 25 or 40 records while believing they exported the full filtered register.', refs: [{ path: 'src/pages/dashboard/PatientsPage.tsx', symbol: 'exportFilteredCsv' }, { path: 'src/pages/dashboard/ReportsPage.tsx', symbol: 'exportFilteredCsv' }, { path: 'src/pages/dashboard/BillsPage.tsx', symbol: 'exportRegister' }] },
        { id: 'EXP-02', severity: 'P1', dimension: 'observability', title: 'No export audit or destination control', detail: 'The app does not record who exported which records. Public Documents output is a broad opt-in and exported PHI is plaintext.', refs: [{ path: 'src/lib/native-files.ts', symbol: 'candidateDirectories / saveBinaryDocument' }, { path: 'src/lib/export-csv.ts', symbol: 'downloadCsv' }] },
        { id: 'EXP-03', severity: 'P2', dimension: 'functionality', title: 'Interoperability is document-only', detail: 'No FHIR/HL7, structured report export, analyzer interface, barcode standard, or machine-readable audit export. CSV columns differ by page and are not a stable API.', refs: [{ path: 'src/lib/export-csv.ts', symbol: 'toCsv' }] },
        { id: 'EXP-04', severity: 'P2', dimension: 'resilience', title: 'Browser backup path lacks verified download evidence', detail: 'The browser backup UI and native-files routing are not covered by E2E tests for quota, failure, cancel, or actual Downloads output.', refs: [{ path: 'src/components/DataBackupPanel.tsx', symbol: 'browser backup UI' }, { path: 'src/lib/backup.ts', symbol: 'createBackup' }] }
      ],
      improvements: [
        { title: 'Export full filtered datasets', detail: 'Separate export queries from visible pagination and show record counts before writing.', acceptance: 'CSV row count equals the full filtered register.' },
        { title: 'Add an export audit manifest', detail: 'Record actor, timestamp, filters, columns, row count, hash, and destination classification.', acceptance: 'Every export is attributable and tamper-evident.' },
        { title: 'Provide stable structured exports', detail: 'Versioned JSON/CSV schemas, FHIR/HL7 mapping where required, and analyzer contracts.', acceptance: 'External systems can consume records without scraping PDFs.' },
        { title: 'Make browser backup explicit', detail: 'Use Blob download and test quota/failure/cancel behavior.', acceptance: 'Web backup produces a verified file with clear feedback.' }
      ],
      scores: [7, 6, 6, 5, 4, 4, 4, 5, 5, 6, 5, 4]
    },
    {
      id: 'android', name: 'Android/Capacitor platform & release', category: 'Platform', platforms: ['Android'],
      summary: 'Packages React with Capacitor 8, SQLCipher, biometric/secure storage, notifications, filesystem/share, custom PDF viewer/window plugins, and a patched printer plugin.',
      strengths: ['Merged manifest has no INTERNET permission and six allowed permissions.', 'minSdk 28, targetSdk 36, R8/resource shrinking, debuggable false, allowBackup false.', 'FLAG_SECURE and narrowed FileProvider paths.', 'CI now uses sync:android, requires keystore secrets, verifies manifest, and fails on 16 KB alignment errors.'],
      gaps: [
        { id: 'AND-01', severity: 'P0', dimension: 'platform', title: 'Strict Android build still fails on placeholder release identity', detail: 'The current .env uses privacy@your-lab-domain.example and policy.your-lab-domain.example. check-release-config.mjs correctly refuses a production build.', refs: [{ path: 'scripts/check-release-config.mjs', symbol: 'checkEmail / checkUrl' }, { path: '.env.example', symbol: 'release identity placeholders' }] },
        { id: 'AND-02', severity: 'P0', dimension: 'testing', title: 'Declared Node 26 test gate fails', detail: 'Vitest 5.1.1 fails runner/suite initialization on Node 26, including a single isolated test. CI is pinned to Node 26, so the quality gate cannot currently pass.', refs: [{ path: '.github/workflows/ci.yml', symbol: 'node-version: 26' }, { path: 'package.json', symbol: 'engines / vitest' }] },
        { id: 'AND-03', severity: 'P1', dimension: 'testing', title: 'No meaningful native test suite', detail: 'Android tests are template ExampleUnitTest/ExampleInstrumentedTest. There are no device tests for SQLCipher, biometrics, printing, FileProvider, notifications, process death, upgrade, or accessibility.', refs: [{ path: 'android/app/src/test/java/com/getcapacitor/myapp/ExampleUnitTest.java', symbol: 'template test' }, { path: 'android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java', symbol: 'template test' }] },
        { id: 'AND-04', severity: 'P1', dimension: 'resilience', title: 'No process-death/upgrade verification', detail: 'Native transaction recovery exists, but there is no automated activity recreation, DB upgrade, low-storage, or backup/restore device test.', refs: [{ path: 'src/data/sqliteRepository.ts', symbol: 'startNativeTransaction' }] },
        { id: 'AND-05', severity: 'P2', dimension: 'platform', title: 'No background notification strategy', detail: 'Boot and exact-alarm components are intentionally removed because the app only posts while open. Operational reminders therefore stop when the app is closed.', refs: [{ path: 'android/app/src/main/AndroidManifest.xml', symbol: 'removed boot/exact alarm' }] }
      ],
      improvements: [
        { title: 'Set real release identity and prove reachability', detail: 'Use a monitored support mailbox and owned HTTPS privacy policy; run the strict live probe.', acceptance: 'npm run build:android passes without placeholder overrides.' },
        { title: 'Stabilize the Node/Vitest toolchain', detail: 'Align engines, CI, Vitest, and jsdom to a tested runtime.', acceptance: 'Clean npm run verify passes on the exact CI version.' },
        { title: 'Add device/E2E coverage', detail: 'Cover onboarding, unlock, SQLCipher reopen, order/sample/report/bill flows, print/share, backup/restore, process death, upgrade, and TalkBack.', acceptance: 'Critical workflows pass on a representative device matrix.' },
        { title: 'Harden native plugin boundaries', detail: 'Validate PDF viewer URI scheme/path/MIME and test FileProvider grants.', acceptance: 'Plugins cannot open arbitrary content URIs or files outside configured paths.' }
      ],
      scores: [8, 7, 7, 5, 6, 6, 4, 5, 2, 3, 5, 4]
    },
    {
      id: 'desktop', name: 'Desktop/Electron platform & release', category: 'Platform', platforms: ['Desktop'],
      summary: 'Wraps the renderer in a sandboxed custom-scheme Electron window with context isolation, CSP, network blocking, Credential Manager SQLCipher, trusted IPC, native printing, and recovery.',
      strengths: ['sandbox + contextIsolation + nodeIntegration false.', 'Privileged pathomitra:// scheme, SPA fallback, CSP, and remote-scheme blocking.', 'Exact IPC sender protocol/host/main-frame validation and renderer credential namespace.', 'Shell-open/print targets are confined to app folders, realpath-checked, and extension-restricted; DB erase compacts.'],
      gaps: [
        { id: 'DSK-01', severity: 'P0', dimension: 'security', title: 'Desktop file-save IPC is unbounded and over-broad', detail: 'saveFile() permits any relative path under Documents when publicFirst is true and does not validate argument types or payload size. This is a renderer-to-main write/DoS boundary.', refs: [{ path: 'electron/ipc.ts', symbol: 'saveFile / pm:files:save' }] },
        { id: 'DSK-02', severity: 'P0', dimension: 'platform', title: 'Current MSI is not Store-submittable', detail: 'The package gate finds seven unsigned PE files; the local MSI is also unsigned. Two of nine PEs are valid, with no foreign native binaries and payload size within budget.', refs: [{ path: 'scripts/check-desktop-package.mjs', symbol: 'signatureOf / package gate' }, { path: 'release-desktop/PathoMitra-2.8.9.msi', symbol: 'local artifact' }] },
        { id: 'DSK-03', severity: 'P0', dimension: 'testing', title: 'Current source does not pass strict typecheck', detail: 'The new WorkflowPage has an unused React import and an EmptyState icon type error. Desktop:build-renderer can transpile it, but lint/verify cannot pass.', refs: [{ path: 'src/pages/dashboard/WorkflowPage.tsx', symbol: 'import / EmptyState' }, { path: 'package.json', symbol: 'typecheck / lint:ci' }] },
        { id: 'DSK-04', severity: 'P1', dimension: 'platform', title: 'No Windows Hello or suspend/minimize lock', detail: 'Desktop session locking relies on idle timeout; powerMonitor and OS credential authentication are absent.', refs: [{ path: 'src/lib/session-lock.ts', symbol: 'desktop branch' }, { path: 'src/lib/biometric.ts', symbol: 'native-only' }] },
        { id: 'DSK-05', severity: 'P1', dimension: 'testing', title: 'No Desktop CI or main-process integration tests', detail: 'There is no workflow to build/sign/test MSI, and repository tests mock the bridge rather than exercising real IPC, SQLCipher, keyring, protocol, or print-window behavior.', refs: [{ path: '.github/workflows', symbol: 'workflow set' }, { path: 'src/data/desktopRepository.test.ts', symbol: 'bridge mock' }] },
        { id: 'DSK-06', severity: 'P1', dimension: 'resilience', title: 'Print staging and raster memory are not concurrency-safe', detail: 'Shared staging cleanup can race jobs and all page PNGs are held in memory before spooling.', refs: [{ path: 'electron/print-window.ts', symbol: 'sweepStaleStaging' }, { path: 'src/components/PrintDialog.tsx', symbol: 'images array' }] }
      ],
      improvements: [
        { title: 'Harden file-save IPC', detail: 'Restrict to app-specific subfolders, validate every argument, cap bytes, and use atomic writes.', acceptance: 'Electron tests reject foreign paths, invalid payloads, and oversized writes.' },
        { title: 'Produce a signed release', detail: 'Configure Authenticode for installer and every PE/native module and run the package gate in CI.', acceptance: 'Every shipped PE and MSI verifies as Valid.' },
        { title: 'Fix the typecheck gate', detail: 'Resolve WorkflowPage errors and keep lint:ci green on Node 26.', acceptance: 'Clean npm run verify passes.' },
        { title: 'Add Windows session and integration controls', detail: 'Implement powerMonitor/Windows Hello and real main/preload/renderer smoke tests.', acceptance: 'Packaged app passes clean-profile unlock, DB, IPC, print, and lock tests.' }
      ],
      scores: [8, 7, 7, 6, 4, 5, 4, 4, 2, 2, 5, 4]
    },
    {
      id: 'web', name: 'Web/PWA & browser storage', category: 'Platform', platforms: ['Web'],
      summary: 'Serves a responsive React PWA with manifest/service worker, Cloudflare security headers, client-side routing, browser downloads, and a localStorage-backed demo repository.',
      strengths: ['Responsive shell and lazy route chunks.', 'Service worker precaches app shell and supports offline navigation.', 'Cloudflare headers include CSP, HSTS, frame denial, and no-referrer.', 'Auth now clearly labels browser mode as demo-only before onboarding.'],
      gaps: [
        { id: 'WEB-01', severity: 'P0', dimension: 'security', title: 'Clinical records would be plaintext localStorage', detail: 'WebRepository and secure-store use localStorage, readable by same-origin scripts, extensions, profile backups, and shared-device users. There is no encryption, transaction, quota guarantee, or secure deletion.', refs: [{ path: 'src/data/webRepository.ts', symbol: 'WebRepository' }, { path: 'src/lib/secure-store.ts', symbol: 'browser branch' }] },
        { id: 'WEB-02', severity: 'P1', dimension: 'backend', title: 'Multi-tab writes can lose data', detail: 'WebRepository caches collections in memory and rewrites whole localStorage objects without storage-event reconciliation or cross-tab lock.', refs: [{ path: 'src/data/webRepository.ts', symbol: 'memory / writeStore' }] },
        { id: 'WEB-03', severity: 'P1', dimension: 'resilience', title: 'Quota failures silently become memory-only', detail: 'localStorage write failures are swallowed and the in-memory map continues, so “Saved” data can disappear on refresh.', refs: [{ path: 'src/data/webRepository.ts', symbol: 'writeStore' }] },
        { id: 'WEB-04', severity: 'P2', dimension: 'platform', title: 'PWA update/install behavior is minimal', detail: 'No update prompt, install shortcuts, share target, or explicit stale-HTML/new-asset coordination beyond cache v3 and skipWaiting.', refs: [{ path: 'public/sw.js', symbol: 'CACHE_NAME / install / fetch' }, { path: 'public/manifest.json', symbol: 'manifest' }] },
        { id: 'WEB-05', severity: 'P2', dimension: 'security', title: 'CSP retains unsafe-inline', detail: 'Web and Desktop CSP allow inline script/style for bootstrap and splash code, reducing XSS mitigation.', refs: [{ path: 'public/_headers', symbol: 'Content-Security-Policy' }, { path: 'electron/main.ts', symbol: 'CSP' }] }
      ],
      improvements: [
        { title: 'Keep web demo-only or add protected storage', detail: 'Block real patient data technically or adopt a reviewed encrypted IndexedDB/SQLite design with key custody.', acceptance: 'Web security claims match actual controls and clinical use is explicitly prevented or secured.' },
        { title: 'Add cross-tab concurrency control', detail: 'Use BroadcastChannel/storage events, revision tokens, and conflict resolution.', acceptance: 'Concurrent tab edits never silently overwrite.' },
        { title: 'Harden PWA lifecycle', detail: 'Add update prompts, cache validation, install shortcuts, and verified downloads.', acceptance: 'Users update without stale HTML/asset mismatches.' },
        { title: 'Remove unsafe-inline', detail: 'Move bootstrap to external scripts or use nonces/hashes.', acceptance: 'CSP blocks injected inline script/style without breaking first paint.' }
      ],
      scores: [6, 6, 6, 5, 1, 1, 2, 4, 2, 2, 2, 3]
    },
    {
      id: 'errors', name: 'Error handling, diagnostics & observability', category: 'Cross-cutting', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Uses scoped React error boundaries, global error/unhandled-rejection capture, console traces, an on-device crash ring buffer, and Windows renderer/main-process recovery dialogs.',
      strengths: ['Per-tab ErrorBoundary preserves the dashboard shell.', 'Global handlers catch failures outside React.', 'Crash log is bounded and operator-exportable.', 'Electron offers reload/restart after renderer failure.'],
      gaps: [
        { id: 'ERR-01', severity: 'P1', dimension: 'security', title: 'Crash payload scrubbing does not reliably remove PHI', detail: 'buildCrashPayload() truncates but does not redact messages/context. crash-log redacts emails, phones, and long hex IDs, but not patient names, addresses, diagnoses, report filenames, or arbitrary context values.', refs: [{ path: 'src/lib/telemetry.ts', symbol: 'buildCrashPayload' }, { path: 'src/lib/crash-log.ts', symbol: 'REDACT / sanitize' }] },
        { id: 'ERR-02', severity: 'P1', dimension: 'security', title: 'Diagnostics are stored outside SQLCipher', detail: 'Crash logs use Capacitor Preferences, plaintext app storage on Android and localStorage on web/Electron fallback. Error text may still contain PHI.', refs: [{ path: 'src/lib/crash-log.ts', symbol: 'store' }] },
        { id: 'ERR-03', severity: 'P1', dimension: 'ux', title: 'Read failures can still resemble empty states', detail: 'useCollectionList exposes error and keeps previous docs, but Patients/Overview/Analytics do not all render a distinct retryable failure state; a failed initial read can still look like an empty lab.', refs: [{ path: 'src/hooks/useCollectionList.ts', symbol: 'error state' }, { path: 'src/pages/dashboard/OverviewPage.tsx', symbol: 'loadStats catch' }] },
        { id: 'ERR-04', severity: 'P2', dimension: 'resilience', title: 'Error messages can overstate safety', detail: 'ErrorBoundary says “Your saved data is safe” without knowing whether a write, transaction, or restore failed. Electron recovery similarly assumes the current record persisted.', refs: [{ path: 'src/components/ErrorBoundary.tsx', symbol: 'fallback copy' }, { path: 'electron/main.ts', symbol: 'attachRecovery' }] },
        { id: 'ERR-05', severity: 'P2', dimension: 'observability', title: 'No operational metrics or correlation IDs', detail: 'There is no structured event stream, startup timing, transaction latency, DB health, print success rate, or support correlation ID.', refs: [{ path: 'src/lib/telemetry.ts', symbol: 'reportTo' }] }
      ],
      improvements: [
        { title: 'Minimize and protect diagnostics', detail: 'Use allow-listed fields, correlation IDs, and encrypted/secure storage.', acceptance: 'Seeded PHI never appears in crash logs or exports.' },
        { title: 'Standardize failure states', detail: 'Every collection view needs loading, empty, stale, partial, and error states with retry.', acceptance: 'A failed read can never be mistaken for an empty lab or zero revenue.' },
        { title: 'Add local operational health metrics', detail: 'Track startup, DB open, write failures, transaction duration, print failures, backup age, and storage pressure.', acceptance: 'Support can diagnose a device from an opt-in redacted bundle.' },
        { title: 'Make recovery copy evidence-based', detail: 'State what is known about persistence and offer safe retry/export options.', acceptance: 'No error screen claims safety without a verified write result.' }
      ],
      scores: [7, 6, 6, 6, 3, 3, 4, 5, 5, 6, 4, 3]
    },
    {
      id: 'accessibility', name: 'Accessibility & inclusive operation', category: 'Cross-cutting', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Implements a shared Sheet with focus trap/inert background, skip link, focus-visible ring, labels, live regions, reduced motion, forced colors, text scaling, and keyboard-first result entry.',
      strengths: ['Sheet has focus trap, focus return, Escape, inert background, and nested-sheet handling.', 'Global focus ring and prefers-reduced-motion rules.', 'Status uses text/icons rather than color alone.', 'Auth fields and result rows have real labels; KPI cards support keyboard activation.'],
      gaps: [
        { id: 'A11Y-01', severity: 'P1', dimension: 'a11y', title: 'Several overlays are not accessible modals', detail: 'CommandSearch and the mobile drawer lack full focus trap/inert/return behavior. CalendarRangePicker has role=dialog but no focus management or aria-modal.', refs: [{ path: 'src/components/CommandSearch.tsx', symbol: 'overlay' }, { path: 'src/pages/dashboard/DashboardLayout.tsx', symbol: 'mobile drawer' }, { path: 'src/components/ui/CalendarRangePicker.tsx', symbol: 'date dialog' }] },
        { id: 'A11Y-02', severity: 'P1', dimension: 'a11y', title: 'Form errors and required state are incompletely associated', detail: 'Field does not automatically wire aria-describedby/aria-invalid, and its required asterisk is aria-hidden. Callers must remember native required and error IDs.', refs: [{ path: 'src/components/ui/Field.tsx', symbol: 'Field' }] },
        { id: 'A11Y-03', severity: 'P2', dimension: 'a11y', title: 'Charts and dynamic counters lack equivalent text', detail: 'Most analytics charts have no data table or detailed summary; CountUp and progress indicators can change without useful live-region semantics.', refs: [{ path: 'src/pages/dashboard/AnalyticsPage.tsx', symbol: 'Recharts wrappers' }, { path: 'src/components/CountUp.tsx', symbol: 'CountUp' }] },
        { id: 'A11Y-04', severity: 'P2', dimension: 'testing', title: 'No automated or manual accessibility evidence', detail: 'There is no axe/Playwright accessibility job, screen-reader script, contrast matrix, or TalkBack/Narrator acceptance record.', refs: [{ path: 'vitest.config.ts', symbol: 'test configuration' }, { path: '.github/workflows/ci.yml', symbol: 'CI checks' }] }
      ],
      improvements: [
        { title: 'Consolidate on one modal/drawer primitive', detail: 'Apply Sheet focus/inert/Escape behavior to search, calendar, drawer, and print.', acceptance: 'Focus cannot leave or fall behind any overlay.' },
        { title: 'Automate field associations', detail: 'Enhance Field to own IDs, descriptions, errors, and required semantics.', acceptance: 'All forms pass label/error/required association tests.' },
        { title: 'Add accessible chart alternatives', detail: 'Provide summaries and expandable data tables.', acceptance: 'All plotted values are available without color or hover.' },
        { title: 'Add an accessibility release gate', detail: 'Run axe in E2E, manual keyboard scripts, contrast checks, and TalkBack/Narrator smoke tests.', acceptance: 'No critical/serious violations remain on core workflows.' }
      ],
      scores: [8, 7, 7, 4, 5, 4, 5, 6, 3, 6, 5, 4]
    },
    {
      id: 'performance', name: 'Performance & scalability', category: 'Cross-cutting', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Uses lazy routes, manual vendor chunks, local in-memory queries, client-side pagination, CSS transform motion, and on-device data to avoid network latency.',
      strengths: ['Route-level code splitting and lazy PDF/native imports.', 'Reduced-motion and transform-oriented micro-interactions.', 'Native count queries avoid materializing rows for simple counts.', 'No remote fonts, analytics SDK, or backend round trips.'],
      gaps: [
        { id: 'PRF-01', severity: 'P1', dimension: 'performance', title: 'Large initial and vendor chunks', detail: 'The current main chunk is ~593 KB minified, Recharts ~398 KB, jsPDF ~379 KB, pdf.js ~485 KB, plus a 1.26 MB worker. Low-end Android WebViews can struggle on cold start.', refs: [{ path: 'vite.config.ts', symbol: 'manualChunks' }, { path: 'package.json', symbol: 'PDF/chart dependencies' }] },
        { id: 'PRF-02', severity: 'P1', dimension: 'performance', title: 'Full collections are loaded for many tasks', detail: 'useCollectionList stores all docs before slicing; CommandSearch indexes all records; WorkflowPage reloads four full collections; analytics reads the full roster; Desktop serializes whole collections.', refs: [{ path: 'src/hooks/useCollectionList.ts', symbol: 'docs state' }, { path: 'src/pages/dashboard/WorkflowPage.tsx', symbol: 'load' }, { path: 'src/data/desktopRepository.ts', symbol: 'whole-collection JSON' }] },
        { id: 'PRF-03', severity: 'P1', dimension: 'performance', title: 'Print rasterization is memory-heavy', detail: '300 dpi A4 pages are large bitmaps and all selected pages are retained as data URLs before IPC.', refs: [{ path: 'src/components/PrintDialog.tsx', symbol: 'images array' }, { path: 'src/lib/pdf-preview.ts', symbol: 'renderPageToPng' }] },
        { id: 'PRF-04', severity: 'P2', dimension: 'testing', title: 'No performance budgets or large-data benchmarks', detail: 'Bundle warnings are informational and there are no startup, memory, query-latency, or 10k/50k-record tests.', refs: [{ path: 'vite.config.ts', symbol: 'build options' }, { path: 'vitest.config.ts', symbol: 'test scope' }] }
      ],
      improvements: [
        { title: 'Set cold-start and bundle budgets', detail: 'Defer charts/PDF/worker assets further and measure low-end Android startup.', acceptance: 'CI enforces route and initial JS budgets on representative hardware.' },
        { title: 'Introduce indexed queries and virtualization', detail: 'Use SQLite indexes/pagination for lists/search/aggregates and virtualize long tables.', acceptance: '50k-record workflows stay within agreed latency/memory limits.' },
        { title: 'Stream print rendering', detail: 'Render/spool page-by-page or use vector PDF printing where supported.', acceptance: 'Multi-page reports print without memory proportional to total page bytes.' },
        { title: 'Add performance regression tests', detail: 'Track startup, long tasks, heap, query latency, and PDF generation time.', acceptance: 'Regressions fail CI before release.' }
      ],
      scores: [7, 6, 6, 5, 5, 4, 4, 3, 4, 5, 5, 4]
    },
    {
      id: 'security', name: 'Security & privacy architecture', category: 'Cross-cutting', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Uses SQLCipher at rest, platform key stores, PBKDF2 passcodes, renderer isolation, CSP/network blocking on Desktop, no INTERNET permission on Android, FLAG_SECURE, private exports, and local diagnostics.',
      strengths: ['Strong native at-rest encryption and key separation.', 'Exact Electron IPC sender checks and app-only shell-open roots.', 'No stored-XSS sink found in reviewed source; React escaping is used.', 'CSV formula-injection defense, privacy-safe banners, and current production audit has no high/critical finding.'],
      gaps: [
        { id: 'SEC-01', severity: 'P0', dimension: 'security', title: 'Business rules are renderer-trusted on Android', detail: 'There is no backend or native domain-enforcement layer. Zod, order/sample transitions, and report workflow rules run in the WebView, so a rooted device, WebView exploit, or XSS can bypass authorization and issue/amendment rules.', refs: [{ path: 'src/lib/report-workflow.ts', symbol: 'domain rules in renderer' }, { path: 'src/lib/clinical-workflow.ts', symbol: 'domain rules in renderer' }] },
        { id: 'SEC-02', severity: 'P0', dimension: 'security', title: 'Web PHI storage contradicts native posture', detail: 'The production web build stores clinical records and auth bootstrap in localStorage. The demo notice reduces deception but is not a technical barrier to real patient data.', refs: [{ path: 'src/data/webRepository.ts', symbol: 'localStorage' }, { path: 'src/pages/auth/AuthPage.tsx', symbol: 'WebStorageNotice' }] },
        { id: 'SEC-03', severity: 'P0', dimension: 'security', title: 'Desktop file-save IPC is unbounded and over-broad', detail: 'A compromised renderer can write arbitrary app-relative files under Documents and send unbounded payloads because saveFile() lacks strict argument and size validation.', refs: [{ path: 'electron/ipc.ts', symbol: 'saveFile / pm:files:save' }] },
        { id: 'SEC-04', severity: 'P1', dimension: 'security', title: 'Diagnostics and erasure weaken privacy guarantees', detail: 'Crash logs can retain PHI in plaintext Preferences, and external export/backup copies cannot be verified as erased.', refs: [{ path: 'src/lib/crash-log.ts', symbol: 'storage / redaction' }, { path: 'src/lib/erase-data.ts', symbol: 'local artifacts only' }] },
        { id: 'SEC-05', severity: 'P1', dimension: 'security', title: 'Full dependency audit reports 22 findings', detail: 'Current npm audit reports 1 high (undici in tooling), 20 moderate, and 1 low. Production-only audit reports one low DOMPurify finding; no current high/critical production advisory was reported.', refs: [{ path: 'package-lock.json', symbol: 'dependency tree' }] },
        { id: 'SEC-06', severity: 'P2', dimension: 'security', title: 'CSP retains unsafe-inline', detail: 'Desktop and web CSP allow inline script/style for bootstrap and splash code, reducing XSS mitigation.', refs: [{ path: 'electron/main.ts', symbol: 'CSP' }, { path: 'public/_headers', symbol: 'Content-Security-Policy' }] }
      ],
      improvements: [
        { title: 'Move invariants behind a trusted boundary', detail: 'Enforce clinical transitions and permissions in native/main-process code or a local service.', acceptance: 'Renderer tampering cannot issue, amend, delete, or bypass review.' },
        { title: 'Restrict or secure web clinical storage', detail: 'Treat web as demo-only technically or add reviewed encrypted storage and key custody.', acceptance: 'Web controls and claims match the actual threat model.' },
        { title: 'Close Desktop file-write boundaries', detail: 'App-specific roots, strict types, size caps, atomic writes, and adversarial IPC tests.', acceptance: 'Malicious renderer payloads cannot overwrite foreign files or exhaust resources.' },
        { title: 'Remediate dependencies continuously', detail: 'Upgrade affected tooling/transitives and gate audit policy in CI.', acceptance: 'No unresolved high/critical production advisories and documented exceptions for the rest.' },
        { title: 'Minimize PHI in diagnostics and verify erasure', detail: 'Allow-list log fields, encrypt logs, and publish a complete erasure checklist.', acceptance: 'Synthetic PHI is absent from logs and every local store is verified.' }
      ],
      scores: [7, 5, 5, 5, 3, 4, 4, 5, 3, 5, 3, 3]
    },
    {
      id: 'testing', name: 'Testing, CI/CD & release engineering', category: 'Cross-cutting', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Includes strict TypeScript, ESLint, Prettier, 52 Vitest files, selected-module coverage thresholds, build guards, Dependabot, and Android/web/release workflows.',
      strengths: ['Strong historical unit coverage for domain calculations, PDF layout, invoices, referrals, notifications, and repositories.', 'Coverage thresholds are explicit and release guards exist.', 'Production web build currently passes.', 'Android workflow now syncs native assets, requires signing secrets, and fails on alignment errors.'],
      gaps: [
        { id: 'TST-01', severity: 'P0', dimension: 'testing', title: 'Strict typecheck currently fails', detail: 'The latest observed WorkflowPage errors are an unused React import and an EmptyState icon type mismatch. lint:ci cannot proceed to a clean gate.', refs: [{ path: 'src/pages/dashboard/WorkflowPage.tsx', symbol: 'import / EmptyState' }, { path: 'package.json', symbol: 'typecheck / lint:ci' }] },
        { id: 'TST-02', severity: 'P0', dimension: 'testing', title: 'Vitest fails on the declared Node 26 toolchain', detail: 'The full coverage run had 50 of 52 files fail during runner/suite initialization; only 47 tests in two pure-text files ran. An isolated report-status test reproduces the same config error.', refs: [{ path: '.github/workflows/ci.yml', symbol: 'node-version: 26' }, { path: 'package.json', symbol: 'engines / vitest' }, { path: 'vitest.config.ts', symbol: 'jsdom environment' }] },
        { id: 'TST-03', severity: 'P1', dimension: 'testing', title: 'Coverage is a selected subset, not repository coverage', detail: 'The gate includes selected lib modules but excludes AuthContext, local-account/password/session-lock, backup, native-files, settings-sync, Electron main/IPC/DB/print, route pages, and the new workflow/validation modules.', refs: [{ path: 'vitest.config.ts', symbol: 'coverage.include' }] },
        { id: 'TST-04', severity: 'P1', dimension: 'testing', title: 'No E2E, device, Electron, accessibility, or visual regression suite', detail: 'Core workflows are not exercised through real UI/navigation/native shells. Playwright remains a roadmap item.', refs: [{ path: 'vitest.config.ts', symbol: 'coverage comment' }, { path: '.github/workflows', symbol: 'workflow set' }] },
        { id: 'TST-05', severity: 'P1', dimension: 'platform', title: 'No Desktop release workflow or signed artifact gate', detail: 'Android has tag/manual workflows; Desktop packaging is local only and the current MSI fails signature checks.', refs: [{ path: '.github/workflows', symbol: 'workflow set' }, { path: 'scripts/check-desktop-package.mjs', symbol: 'package gate' }] },
        { id: 'TST-06', severity: 'P2', dimension: 'architecture', title: 'Formatting and supply-chain gates are incomplete', detail: 'format:check reports 32 unformatted files and is not part of verify. Actions use tags rather than commit pins and npm audit is not a CI gate.', refs: [{ path: 'package.json', symbol: 'verify' }, { path: '.github/workflows/ci.yml', symbol: 'checks' }] }
      ],
      improvements: [
        { title: 'Stabilize one supported toolchain', detail: 'Align Node, CI, Vitest, and jsdom; fix WorkflowPage type errors and time-sensitive tests.', acceptance: 'Clean npm run verify passes on the exact CI version in any month.' },
        { title: 'Expand the quality gate', detail: 'Add route E2E, Electron integration, Android instrumentation, accessibility, PDF snapshots, format, audit, and artifact checks.', acceptance: 'Every P0/P1 defect has a failing regression test before its fix.' },
        { title: 'Make release workflows fail closed', detail: 'Require native sync, real identity, signing, alignment, package verification, and provenance.', acceptance: 'No unsigned, stale, web-target, misaligned, or high-risk artifact can publish.' },
        { title: 'Pin and scan the supply chain', detail: 'Pin actions by commit, enable dependency review/CodeQL/secret scanning, and enforce audit policy.', acceptance: 'CI blocks new high/critical vulnerabilities and unreviewed action changes.' }
      ],
      scores: [5, 4, 4, 4, 4, 4, 3, 5, 1, 3, 4, 3]
    },
    {
      id: 'ux', name: 'UX, micro-interactions & responsive design', category: 'Cross-cutting', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Implements a polished clinical-modern design system, responsive shells, safe areas, bottom navigation, sheets, skeletons, toasts, haptics, motion, empty states, and live previews.',
      strengths: ['Consistent semantic tokens and shared UI primitives.', 'Height-aware foldable/landscape behavior and safe-area insets.', 'Thoughtful loading, empty, confirmation, and toast patterns.', 'Shared motion vocabulary, capped stagger, reduced motion, haptics, and durable Settings feedback.'],
      gaps: [
        { id: 'UXD-01', severity: 'P1', dimension: 'functionality', title: 'The clinical journey is not yet integrated end to end', detail: 'Orders/samples now exist, but reports and bills are not linked to them and the UI does not automatically advance order status. Staff must reconcile separate screens mentally.', refs: [{ path: 'src/App.tsx', symbol: 'dashboard tabs' }, { path: 'src/pages/dashboard/ReportsPage.tsx', symbol: 'report creation' }, { path: 'src/lib/invoices.ts', symbol: 'raiseInvoice' }] },
        { id: 'UXD-02', severity: 'P1', dimension: 'ux', title: 'Several labels imply state that does not exist', detail: '“Sample #” can still be a report ID in legacy views, overdue sample alerts use registration time, and register totals/exports reflect loaded pages only.', refs: [{ path: 'src/components/ReportViewerDashboard.tsx', symbol: 'patientLine' }, { path: 'src/pages/dashboard/BillsPage.tsx', symbol: 'summary' }] },
        { id: 'UXD-03', severity: 'P1', dimension: 'ux', title: 'Workflow feedback can be ambiguous', detail: 'Order creation and specimen creation are separate async calls; failures can leave a partial journey. Workflow lists have loading/error states but no pagination or durable progress for long operations.', refs: [{ path: 'src/pages/dashboard/WorkflowPage.tsx', symbol: 'submit / load' }] },
        { id: 'UXD-04', severity: 'P2', dimension: 'microinteractions', title: 'Some success feedback remains fire-and-forget', detail: 'Settings is fixed, but price/custom-test writes and some report/patient side effects can still show success before every durable consequence is confirmed.', refs: [{ path: 'src/components/ManageTestsPanel.tsx', symbol: 'upsertPrice call' }, { path: 'src/pages/dashboard/ReportsPage.tsx', symbol: 'toast success' }] },
        { id: 'UXD-05', severity: 'P2', dimension: 'functionality', title: 'Marketing language can outrun implementation', detail: 'Copy must continue to avoid unsupported sign-off/sealed-delivery assurances because verifiable signatures and tamper evidence are not implemented.', refs: [{ path: 'src/components/Hero.tsx', symbol: 'workflow copy' }, { path: 'src/lib/report-compliance.ts', symbol: 'legal wording' }] }
      ],
      improvements: [
        { title: 'Design one integrated bench workflow', detail: 'Link order→collection→accession→result→issue→billing with clear ownership and status.', acceptance: 'A technician can complete a shift without external mental tracking.' },
        { title: 'Make every label evidence-based', detail: 'Tie KPIs, sample IDs, TATs, and export counts to authoritative full datasets.', acceptance: 'UI copy matches the data source and completeness shown.' },
        { title: 'Replace partial success with durable feedback', detail: 'Await writes, show real progress, preserve failed input, and expose retry.', acceptance: 'Success appears only after the authoritative store confirms persistence.' },
        { title: 'Add workflow polish with restraint', detail: 'Use status timelines, bulk actions, saved filters, and non-blocking progress; keep reduced-motion fallbacks.', acceptance: 'High-frequency bench tasks are faster without animation fatigue.' }
      ],
      scores: [8, 8, 8, 7, 5, 5, 5, 6, 4, 7, 6, 4]
    },
    {
      id: 'resilience', name: 'Business continuity & operational resilience', category: 'Cross-cutting', platforms: ['Android', 'Desktop', 'Web'],
      summary: 'Operates offline with local encrypted storage and manual backups, but has no backend, sync, high availability, automated recovery, multi-device continuity, or operational runbook.',
      strengths: ['No network dependency for core operation.', 'Local transactions and mutation queues.', 'Manual encrypted backup/restore and diagnostics.', 'Electron renderer recovery and native transaction healing.'],
      gaps: [
        { id: 'RSL-01', severity: 'P0', dimension: 'resilience', title: 'Single device is a single point of failure', detail: 'Loss, theft, corruption, forgotten passcode, or failed storage can take the entire lab history offline. There is no cloud/peer sync, read-only replica, or automated disaster recovery.', refs: [{ path: 'README.md', symbol: 'local-first design' }, { path: 'src/lib/backup.ts', symbol: 'manual snapshots' }] },
        { id: 'RSL-02', severity: 'P1', dimension: 'resilience', title: 'No tested restore drill or RPO/RTO', detail: 'Backups are manual and unverified; the product defines no recovery point/time objective, retention policy, alternate-device procedure, or scheduled restore validation.', refs: [{ path: 'src/components/DataBackupPanel.tsx', symbol: 'backup UI' }] },
        { id: 'RSL-03', severity: 'P1', dimension: 'functionality', title: 'Multi-user and multi-device operation is unsupported', detail: 'The single local admin and per-device database prevent shared lab workflows, role handoff, and concurrent work without divergence.', refs: [{ path: 'src/contexts/AuthContext.tsx', symbol: 'single account' }, { path: 'src/data/index.ts', symbol: 'per-runtime repository' }] },
        { id: 'RSL-04', severity: 'P1', dimension: 'resilience', title: 'Low-storage and corruption behavior is not operationalized', detail: 'Errors exist, but there is no storage-pressure monitoring, automatic write pause, safe mode, integrity scan, or guided recovery.', refs: [{ path: 'src/data/webRepository.ts', symbol: 'quota handling' }, { path: 'src/data/sqliteRepository.ts', symbol: 'open error message' }] },
        { id: 'RSL-05', severity: 'P1', dimension: 'observability', title: 'No operational runbook or support correlation', detail: 'There is no documented downtime procedure, backup owner, escalation path, restore drill record, or support correlation ID.', refs: [{ path: 'docs', symbol: 'operational documentation' }, { path: 'src/lib/telemetry.ts', symbol: 'diagnostics' }] }
      ],
      improvements: [
        { title: 'Define continuity requirements', detail: 'Document supported lab size, devices, users, RPO/RTO, retention, and disaster scenarios.', acceptance: 'Stakeholders sign off on measurable targets.' },
        { title: 'Add verified off-device backup and restore drills', detail: 'Encrypted export to lab-controlled storage, checksums, retention rotation, and periodic test restores.', acceptance: 'A second device restores and reconciles within the agreed RTO.' },
        { title: 'Add safe mode and integrity tooling', detail: 'Read-only mode, DB integrity check, orphan detection, storage-pressure alerts, and guided export/recovery.', acceptance: 'Corruption or low storage never silently destroys new work.' },
        { title: 'Plan multi-user/multi-device architecture', detail: 'Choose a local server or encrypted sync model with conflict resolution and audit.', acceptance: 'Concurrent staff work is attributable and conflict-safe.' }
      ],
      scores: [5, 5, 5, 5, 4, 3, 2, 4, 3, 4, 3, 3]
    }
  ],
  resolvedFixes: [
    { id: 'RF-01', feature: 'persistence', title: 'Shared entity contract restored', detail: 'ENTITY_NAMES is now consumed by renderer repositories, native schema, Electron IPC, backup, and erasure, including reportVersions and the new workflow collections.', refs: [{ path: 'src/data/entities.ts', symbol: 'ENTITY_NAMES' }, { path: 'electron/ipc.ts', symbol: 'assertEntity' }] },
    { id: 'RF-02', feature: 'desktop', title: 'Exact IPC sender validation', detail: 'isTrustedSender() compares protocol, exact host, credentials/port, and main-frame identity instead of a URL prefix or opaque origin.', refs: [{ path: 'electron/ipc.ts', symbol: 'isTrustedSender' }] },
    { id: 'RF-03', feature: 'printing', title: 'Shell-open/print targets confined', detail: 'Absolute print/open targets are limited to app-specific private/Documents folders, realpath-checked, extension-restricted, and verified as files.', refs: [{ path: 'electron/ipc.ts', symbol: 'withinAppRoots / resolveTarget' }] },
    { id: 'RF-04', feature: 'reports', title: 'Issuance snapshots added', detail: 'Final reports capture demographics, lab settings, test metadata, and exact range decisions; output prefers the snapshot.', refs: [{ path: 'src/lib/report-snapshot.ts', symbol: 'buildReportIssuanceSnapshot' }, { path: 'src/pages/dashboard/ReportsPage.tsx', symbol: 'patient_report' }] },
    { id: 'RF-05', feature: 'catalogue', title: 'Unverified range caveats surfaced', detail: 'Viewer rows carry a caveat and PDF reference labels print [UNVERIFIED: …] instead of presenting inherited ranges as authoritative.', refs: [{ path: 'src/components/ReportViewerDashboard.tsx', symbol: 'rows.caveat' }, { path: 'src/lib/report-pdf.ts', symbol: 'refLabel' }] },
    { id: 'RF-06', feature: 'reports', title: 'Issue preflight strengthened', detail: 'planReportWrite() rejects missing patient/tests/snapshot and now runs typed result validation plus a critical-screen gate.', refs: [{ path: 'src/lib/report-workflow.ts', symbol: 'planReportWrite' }] },
    { id: 'RF-07', feature: 'android', title: 'Android release workflow repaired', detail: 'Workflows use native build + cap sync + asset guards, require keystore secrets, verify the manifest, and exit non-zero on 16 KB alignment failure.', refs: [{ path: '.github/workflows/android.yml', symbol: 'build steps' }, { path: '.github/workflows/release.yml', symbol: 'alignment gate' }] },
    { id: 'RF-08', feature: 'settings', title: 'Settings save is awaitable and honest', detail: 'SettingsPage awaits persistSettingsNow() and only shows Saved after the encrypted store write succeeds.', refs: [{ path: 'src/pages/dashboard/SettingsPage.tsx', symbol: 'handleSave' }, { path: 'src/lib/settings-sync.ts', symbol: 'persistSettingsNow' }] },
    { id: 'RF-09', feature: 'web', title: 'Web demo boundary disclosed before onboarding', detail: 'AuthPage shows a blocking browser-storage notice and demo-only copy before account creation; StorageModeBanner remains persistent in production.', refs: [{ path: 'src/pages/auth/AuthPage.tsx', symbol: 'WebStorageNotice / FeaturePanel' }, { path: 'src/lib/storage-mode.ts', symbol: 'warning' }] },
    { id: 'RF-10', feature: 'auth', title: 'Clinical store opens lazily', detail: 'main.tsx no longer warms the database before authentication; repositories initialize on authenticated data access.', refs: [{ path: 'src/main.tsx', symbol: 'native shell bootstrap' }, { path: 'src/data/index.ts', symbol: 'initDataStore' }] },
    { id: 'RF-11', feature: 'backup', title: 'Erase now compacts and removes app artifacts', detail: 'Desktop/native clearAll use secure_delete and VACUUM; eraseLocalArtifacts removes app outputs, crash logs, price cache, and matching localStorage keys.', refs: [{ path: 'electron/db.ts', symbol: 'clearEntities / eraseDatabase' }, { path: 'src/data/sqliteRepository.ts', symbol: 'clearAll' }, { path: 'src/lib/erase-data.ts', symbol: 'eraseLocalArtifacts' }] },
    { id: 'RF-12', feature: 'patients', title: 'Patient edit and direct deep links improved', detail: 'Patient updates and draft synchronization run in one transaction; patient/report/doctor links resolve records directly by ID rather than a visible page slice.', refs: [{ path: 'src/pages/dashboard/PatientsPage.tsx', symbol: 'savePatient / initialPatientId' }, { path: 'src/App.tsx', symbol: 'deep-link actions' }] },
    { id: 'RF-13', feature: 'notifications', title: 'Partial invoices and offline refresh fixed', detail: 'Due alerts query pending + partial and the ten-minute local refresh no longer depends on navigator.onLine.', refs: [{ path: 'src/hooks/useNotifications.ts', symbol: 'invoice query / timer' }, { path: 'src/lib/notification-engine.ts', symbol: 'isInvoiceOutstanding' }] },
    { id: 'RF-14', feature: 'orders', title: 'Order/sample domain and UI foundation landed', detail: 'Orders/Samples are first-class entities and routes with lifecycle transitions, expected accessions, custody, rejection, recollection, and audit events.', refs: [{ path: 'src/lib/clinical-workflow.ts', symbol: 'workflow service' }, { path: 'src/pages/dashboard/WorkflowPage.tsx', symbol: 'workspace' }] },
    { id: 'RF-15', feature: 'billing', title: 'Invoice arithmetic and missing-bill planning hardened', detail: 'toInvoiceDoc recomputes non-adjustment line totals and planMissingBills reads full collections rather than the visible register.', refs: [{ path: 'src/lib/models.ts', symbol: 'toInvoiceDoc' }, { path: 'src/lib/invoices.ts', symbol: 'planMissingBills' }] },
    { id: 'RF-16', feature: 'security', title: 'Dependency high findings reduced', detail: 'Current production-only audit reports one low DOMPurify finding; the earlier Zod/Electron production high findings are not present in the current lockfile audit.', refs: [{ path: 'package-lock.json', symbol: 'current dependency tree' }] }
  ],
  releaseGates: [
    { id: 'G-01', priority: 'P0', title: 'Restore a green, supported quality gate', detail: 'Fix WorkflowPage type errors and the Node 26 Vitest runner failure; align CI, engines, and dependencies.', owner: 'Tooling + QA', gapIds: ['TST-01', 'TST-02', 'DSK-03', 'AND-02'], acceptance: 'Clean npm run verify passes on the exact CI Node version.' },
    { id: 'G-02', priority: 'P0', title: 'Close Desktop file-write and signing boundaries', detail: 'Restrict save IPC to app subfolders, validate types/size, and sign installer plus every PE/native module.', owner: 'Electron + release', gapIds: ['DSK-01', 'DSK-02', 'PRT-01', 'SEC-03'], acceptance: 'Adversarial IPC tests pass and check-desktop-package reports every PE/MSI Valid.' },
    { id: 'G-03', priority: 'P0', title: 'Make Android release identity real and proven', detail: 'Replace placeholder support/privacy identity, verify the live policy, and retain signed native artifacts.', owner: 'Release engineering', gapIds: ['AND-01'], acceptance: 'Strict build:android and verify:android pass without placeholder overrides.' },
    { id: 'G-04', priority: 'P0', title: 'Prevent unprotected web clinical use', detail: 'Technically enforce demo-only mode or implement a reviewed encrypted web store and key-custody design.', owner: 'Product + security', gapIds: ['WEB-01', 'SEC-02', 'AUT-04'], acceptance: 'A web user cannot enter real PHI under a false or merely acknowledged boundary.' },
    { id: 'G-05', priority: 'P0', title: 'Integrate order → sample → report → invoice atomically', detail: 'Create order/specimens in one transaction and require orderId across reports, invoices, and status transitions.', owner: 'Clinical domain', gapIds: ['ORD-01', 'ORD-02', 'BIL-07'], acceptance: 'The full journey is traceable, retry-safe, and cannot produce orphaned records.' },
    { id: 'G-06', priority: 'P0', title: 'Complete clinical validation and review controls', detail: 'Add critical-review UI/override audit, field-level validation, role separation, and trusted-boundary enforcement.', owner: 'Clinical governance + platform', gapIds: ['RES-01', 'RES-02', 'REP-02', 'REP-05', 'SEC-01'], acceptance: 'Invalid/critical/unreviewed reports cannot be silently issued and all overrides are attributable.' },
    { id: 'G-07', priority: 'P0', title: 'Make financial history ledger-based and atomic', detail: 'Implement payments/refunds/reversals, atomic numbering/payment writes, retention-safe voids, and full-register reconciliation.', owner: 'Billing + finance', gapIds: ['BIL-01', 'BIL-02', 'BIL-03', 'BIL-05', 'BIL-06'], acceptance: 'Concurrent billing, partial payments, refunds, large registers, and deletes reconcile exactly.' },
    { id: 'G-08', priority: 'P0', title: 'Define and prove business continuity', detail: 'Set RPO/RTO, verified off-device backups, restore drills, safe mode, and an operational runbook.', owner: 'Operations + data', gapIds: ['RSL-01', 'RSL-02', 'RSL-04', 'RSL-05'], acceptance: 'A second device restores within the agreed RTO and corruption/low storage never silently destroys work.' },
    { id: 'G-09', priority: 'P1', title: 'Harden backup, restore, and erasure', detail: 'Validate every entity, preview conflicts, write atomically, verify checksums, and report retained external copies.', owner: 'Data resilience', gapIds: ['BAK-01', 'BAK-02', 'BAK-03', 'BAK-04', 'BAK-05'], acceptance: 'Malformed/old backups cannot overwrite silently and interrupted writes never look valid.' },
    { id: 'G-10', priority: 'P1', title: 'Add platform, E2E, and accessibility evidence', detail: 'Cover real UI/native shells, keyboard/screen readers, contrast, PDF visuals, print, biometrics, upgrades, and process death.', owner: 'QA + accessibility', gapIds: ['AND-03', 'AND-04', 'DSK-05', 'A11Y-01', 'A11Y-04', 'TST-04'], acceptance: 'Core workflows pass on representative devices, Windows, keyboard, and screen readers.' },
    { id: 'G-11', priority: 'P1', title: 'Bound memory and large-data behavior', detail: 'Indexed queries, virtualized lists, persistent search, row-level Desktop writes, and streaming print.', owner: 'Performance', gapIds: ['PRT-03', 'PRF-01', 'PRF-02', 'PRF-03', 'SEA-01', 'SAM-05'], acceptance: 'Measured 50k-record and multi-page print workloads meet agreed latency/memory budgets.' },
    { id: 'G-12', priority: 'P1', title: 'Improve operational truth and attribution', detail: 'Use real sample milestones, full-dataset totals/exports, durable audit events, redacted diagnostics, and print/share audit.', owner: 'Operations + security', gapIds: ['SAM-03', 'SAM-04', 'NOT-02', 'NOT-03', 'EXP-01', 'ERR-01', 'PRT-05'], acceptance: 'KPIs, alerts, exports, and audit history match authoritative data and protect PHI.' }
  ],
  platforms: [
    {
      id: 'Android', name: 'Android / Capacitor', score: 4.8, verdict: 'NO', summary: 'Strong offline/native security posture and repaired release workflow, blocked by placeholder identity, failing test gate, and missing device evidence.',
      checks: [
        { label: 'SQLCipher + Keystore', status: 'PASS', detail: 'Encrypted repository and plugin secure-store secret.' },
        { label: 'Offline / permissions', status: 'PASS', detail: 'No INTERNET; six merged permissions; allowBackup false.' },
        { label: 'Native asset sync', status: 'PASS', detail: 'Workflows use sync:android and strip web-only assets.' },
        { label: 'Release identity', status: 'FAIL', detail: 'Reserved .example support/policy values block strict build.' },
        { label: 'Signing / alignment', status: 'PASS_WITH_CAVEAT', detail: 'CI requires secrets and fails alignment; no fresh signed AAB was produced here.' },
        { label: 'Device / TalkBack / print', status: 'NOT_RUN', detail: 'No emulator or physical-device matrix.' }
      ]
    },
    {
      id: 'Desktop', name: 'Desktop / Electron', score: 4.6, verdict: 'NO', summary: 'Strong shell isolation and encrypted storage, blocked by file-save IPC, unsigned artifacts, typecheck failure, and absent integration/CI evidence.',
      checks: [
        { label: 'Sandbox / CSP / network', status: 'PASS', detail: 'contextIsolation, sandbox, no Node, custom-scheme CSP, remote schemes blocked.' },
        { label: 'IPC sender / keyring', status: 'PASS', detail: 'Exact main-frame origin checks and namespaced credentials.' },
        { label: 'Shell-open path safety', status: 'PASS', detail: 'App roots, realpath, file type, and existence checks.' },
        { label: 'File-save IPC safety', status: 'FAIL', detail: 'Broad Documents-relative writes and no payload/type budget.' },
        { label: 'Authenticode / MSI', status: 'FAIL', detail: 'Seven unsigned PEs and unsigned installer.' },
        { label: 'Windows Hello / powerMonitor', status: 'FAIL', detail: 'Idle timer only; no OS biometric or suspend/minimize lock.' }
      ]
    },
    {
      id: 'Web', name: 'Web / PWA', score: 3.2, verdict: 'NO', summary: 'Responsive, honest demo UI with offline shell support, but not a protected clinical data platform.',
      checks: [
        { label: 'Responsive / lazy routes', status: 'PASS', detail: 'Mobile/desktop shells and route-level code splitting.' },
        { label: 'PWA offline shell', status: 'PASS_WITH_CAVEAT', detail: 'Cache-first assets and navigation fallback; minimal update UX.' },
        { label: 'Security headers', status: 'PASS_WITH_CAVEAT', detail: 'CSP/HSTS/frame denial present; unsafe-inline remains.' },
        { label: 'Storage disclosure', status: 'PASS', detail: 'Pre-onboarding demo notice and persistent production banner.' },
        { label: 'Clinical storage security', status: 'FAIL', detail: 'Plaintext localStorage; no encryption/transactions/quota guarantee.' },
        { label: 'Multi-tab / update lifecycle', status: 'FAIL', detail: 'No cross-tab conflict control or update prompt.' }
      ]
    }
  ],
  checks: [
    { name: 'Strict TypeScript typecheck', command: 'npm run typecheck', status: 'FAIL', detail: 'Latest observed: WorkflowPage unused React import and EmptyState icon type mismatch.', scope: 'Current source' },
    { name: 'Lint CI ratchet', command: 'npm run lint:ci', status: 'FAIL', detail: 'Blocked by typecheck errors; ESLint gate cannot complete cleanly.', scope: 'Current source' },
    { name: 'Production web build', command: 'npm run build', status: 'PASS', detail: 'Vite build passed. Main ~593 KB, Recharts ~398 KB, jsPDF ~379 KB, pdf.js ~485 KB, worker ~1.26 MB.', scope: 'Current source' },
    { name: 'Formatting check', command: 'npm run format:check', status: 'FAIL', detail: 'Prettier reports 32 unformatted source/test files.', scope: 'Current source' },
    { name: 'Coverage on declared Node 26', command: 'npm run test:coverage', status: 'FAIL', detail: '50/52 files failed runner/suite initialization; 47 tests ran in two pure-text files. Isolated test reproduces config error.', scope: 'Current toolchain' },
    { name: 'Production dependency audit', command: 'npm audit --omit=dev', status: 'FAIL', detail: '1 low finding: DOMPurify <=3.4.16. No high/critical production finding.', scope: 'Current lockfile' },
    { name: 'Full dependency audit', command: 'npm audit', status: 'FAIL', detail: '22 findings: 1 high (undici tooling), 20 moderate, 1 low.', scope: 'Current lockfile' },
    { name: 'Strict Android build', command: 'npm run build:android', status: 'FAIL', detail: 'Release identity still uses reserved .example support/policy domains.', scope: 'Current configuration' },
    { name: 'Merged Android manifest', command: 'npm run check:android', status: 'PASS_WITH_CAVEAT', detail: 'com.pathomitra.app 2.8.9, six permissions, no INTERNET, not debuggable, backups excluded; generated config has inert access origin="*".', scope: 'Local release manifest' },
    { name: 'Desktop package gate', command: 'npm run desktop:check-package', status: 'FAIL', detail: '9 PEs: 2 Valid, 7 NotSigned; 0 foreign binaries; resources 13 MB within budget; local MSI unsigned.', scope: 'Local MSI artifact' },
    { name: 'Android/Desktop runtime matrix', command: 'Device / emulator / print / biometric / screen-reader tests', status: 'NOT_RUN', detail: 'No physical Android, emulator, Windows spool, biometric prompt, or assistive-technology session was exercised.', scope: 'Audit limitation' },
    { name: 'Hosted web deployment', command: 'Cloudflare URL / privacy policy probe', status: 'NOT_RUN', detail: 'Hosted deployment and external privacy URL were not tested.', scope: 'Audit limitation' }
  ],
  vulnerabilities: [
    { name: 'DOMPurify', severity: 'LOW', direct: false, production: true, range: '<=3.4.16', impact: 'Specialized XSS guard bypasses in parser/template/shadow-root scenarios.', fix: 'Upgrade transitive DOMPurify; continue avoiding raw HTML sinks.' },
    { name: 'undici', severity: 'HIGH', direct: false, production: false, range: 'Multiple affected branches', impact: 'DoS, cache poisoning/cross-user disclosure, TLS, and WebSocket issues in tooling/runtime paths.', fix: 'Upgrade affected parents/transitives and verify lockfile audit.' },
    { name: 'fast-uri', severity: 'MODERATE', direct: false, production: false, range: '3.0.0 - 3.1.8', impact: 'URI scheme/host/path confusion in tooling dependencies.', fix: 'Upgrade via npm audit fix in a controlled batch.' },
    { name: 'glob / minimatch / rimraf', severity: 'MODERATE', direct: false, production: false, range: 'Multiple affected branches', impact: 'Filesystem traversal/DoS in build tooling.', fix: 'Upgrade affected tooling; assess breaking electron-builder changes separately.' },
    { name: 'uuid / xcode', severity: 'MODERATE', direct: false, production: false, range: '<11.1.1 / affected xcode branches', impact: 'Buffer bounds issue in uuid used by mobile tooling.', fix: 'Upgrade Capacitor CLI/xcode transitive dependencies.' }
  ],
  rubric: [
    { range: '9–10', verdict: 'YES', label: 'Production-ready', detail: 'No known release-blocking issue and adequate automated/manual evidence.' },
    { range: '5–8.9', verdict: 'PARTIALLY', label: 'Useful but incomplete', detail: 'Substantially implemented, but material gaps or unverified risks remain.' },
    { range: '1–4.9', verdict: 'NO', label: 'Not releasable', detail: 'Missing, unsafe, broken on a target, or below the minimum operational bar.' },
    { range: 'Any P0', verdict: 'NO', label: 'P0 override', detail: 'A correctness, security, clinical-safety, data-integrity, or release-provenance blocker forces NO regardless of average.' }
  ]
};

(() => {
  const D = globalThis.AUDIT_DATA;
  const ids = D.dimensions.map(d => d.id);
  D.features.forEach(feature => {
    feature.dimensions = Object.fromEntries(ids.map((id, index) => [id, feature.scores[index]]));
    feature.score = Math.round((feature.scores.reduce((a, b) => a + b, 0) / feature.scores.length) * 10) / 10;
    feature.verdict = feature.gaps.some(g => g.severity === 'P0') || feature.score < 5 ? 'NO' : feature.score >= 9 ? 'YES' : 'PARTIALLY';
    feature.resolved = D.resolvedFixes.filter(item => item.feature === feature.id);
  });
  D.meta.featureCount = D.features.length;
  D.meta.findingCount = D.features.reduce((sum, feature) => sum + feature.gaps.length, 0);
  D.meta.p0Count = D.features.reduce((sum, feature) => sum + feature.gaps.filter(g => g.severity === 'P0').length, 0);
  D.meta.p1Count = D.features.reduce((sum, feature) => sum + feature.gaps.filter(g => g.severity === 'P1').length, 0);
  D.meta.resolvedCount = D.resolvedFixes.length;
  D.meta.overallScore = Math.round((D.features.reduce((sum, feature) => sum + feature.score, 0) / D.features.length) * 10) / 10;
  D.meta.dimensionAverages = Object.fromEntries(ids.map(id => [id, Math.round((D.features.reduce((sum, feature) => sum + feature.dimensions[id], 0) / D.features.length) * 10) / 10]));
})();
