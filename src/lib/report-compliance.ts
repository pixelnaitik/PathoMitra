/**
 * The only place the wording on an issued report is decided.
 *
 * Why this exists: four separate renderers used to state their own version of
 * the laboratory's credentials — the live A4 preview (`ReportPreview.tsx`), the
 * PDF the lab actually hands over (`ReportsPage.tsx`), the sample PDF
 * (`report-sample-pdf.ts`) and the canvas background baked into share templates
 * (`default-template.ts`). Three of them hardcoded "Certified Diagnostic
 * Pathology Laboratory" and the canvas asserted "NABL ACCREDITED LAB •
 * ISO 9001:2015 CERTIFIED REPORT" plus "This document is electronically
 * verified" — none of which the app can substantiate. There is no signing
 * service, no verification endpoint and no registry check, and the `signature`
 * column is written empty (`ReportsPage.tsx`, `models.ts`).
 *
 * A pathology report is a clinical document. Asserting an accreditation the
 * operator does not hold, or an electronic verification that does not happen,
 * is a misrepresentation to the patient and the referring doctor — and, for a
 * Google Play submission, an Impersonation and Deceptive-Behaviour violation.
 *
 * So: every claim-bearing string is derived here from operator-supplied,
 * attested data, and renders nothing when that data is absent. Neutral,
 * factual wording is the floor.
 */

/** Factual descriptor used when the lab has supplied no accreditation. */
export const NEUTRAL_TAGLINE = 'Diagnostic Pathology Report';

/**
 * Always printed. The app stores and formats clinical data; it does not
 * interpret it, and nothing here replaces a qualified reader's judgement.
 */
export const PROFESSIONAL_USE_DISCLAIMER =
  'For use by qualified healthcare professionals. Not a substitute for clinical judgement.';

/**
 * What the offline build can honestly say about how the report was issued.
 * Deliberately avoids "verified", "sealed", "tamper-evident" and "certified":
 * the report is stored on-device and carries no signature a third party could
 * check, so the sentence describes the act of issuing, not an assurance.
 */
export const SIGNER_SUFFIX =
  "from the operator's device. No external verification service is available.";

export interface ReportLegalInput {
  /** Values from `LabSettings`. All optional — absent means nothing is printed. */
  accreditationBody?: string;
  accreditationNumber?: string;
  licenceNumber?: string;
  /** Timestamp of the operator's attestation; empty/absent disables the claim. */
  accreditationAttestedAt?: string;
  /** Display name of the authenticated local account that issued the report. */
  signerName?: string;
  /** ISO issue timestamp from the report record. */
  signedAt?: string;
}

export interface ReportLegalLines {
  /** Descriptor printed under the lab name in the masthead. */
  tagline: string;
  /** Accreditation claim, or '' when not attested. */
  accreditation: string;
  /** Statutory lab registration/licence number, or ''. */
  licence: string;
  /** Issuance/signer statement — never empty. */
  signer: string;
  /** Professional-use disclaimer — never empty. */
  disclaimer: string;
}

const clean = (value: string | undefined): string => (value ?? '').trim();

/**
 * True only when the operator has actually attested to holding the credential
 * AND supplied both the body and its number. An unchecked half-filled record
 * must not put a certification mark on a patient document.
 */
export function hasAttestedAccreditation(input: ReportLegalInput): boolean {
  return Boolean(
    clean(input.accreditationAttestedAt) &&
    clean(input.accreditationBody) &&
    clean(input.accreditationNumber),
  );
}

/** Render an ISO timestamp without ever throwing or printing "Invalid Date". */
export function formatIssuedStamp(iso: string | undefined): string {
  const raw = clean(iso);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Build every claim-bearing line on the report from one input. */
export function buildReportLegalLines(input: ReportLegalInput = {}): ReportLegalLines {
  const attested = hasAttestedAccreditation(input);
  const stamp = formatIssuedStamp(input.signedAt);
  const signer = clean(input.signerName);

  return {
    // A claimed accreditation replaces the neutral descriptor; it never stacks
    // on top of it, so an accredited report still reads as one line.
    tagline: attested ? clean(input.accreditationBody) : NEUTRAL_TAGLINE,
    accreditation: attested
      ? `${clean(input.accreditationBody)} · Accreditation no. ${clean(input.accreditationNumber)}`
      : '',
    licence: clean(input.licenceNumber) ? `Registration no. ${clean(input.licenceNumber)}` : '',
    signer: signer
      ? `Electronically signed by ${signer}${stamp ? ` on ${stamp}` : ''} ${SIGNER_SUFFIX}`
      : `Issued by the laboratory${stamp ? ` on ${stamp}` : ''} from the operator's device. No external verification service is available.`,
    disclaimer: PROFESSIONAL_USE_DISCLAIMER,
  };
}

/**
 * The masthead line, then any attested credential lines, in print order.
 * Callers that only have room for one line use `lines[0]`.
 */
export function legalLinesForPrint(input: ReportLegalInput = {}): string[] {
  const { tagline, accreditation, licence, signer, disclaimer } = buildReportLegalLines(input);
  return [
    tagline,
    ...(accreditation && accreditation !== tagline ? [accreditation] : []),
    licence,
    signer,
    disclaimer,
  ].filter(Boolean);
}

/**
 * Strings that must never reappear in the product. Kept here so a test can
 * assert against the same list the auditors read, rather than a copy that can
 * drift out of date.
 */
export const FORBIDDEN_CLAIMS = [
  'NABL',
  'ISO 9001',
  'Certified Diagnostic Pathology Laboratory',
  'electronically verified',
  'No physical signature required',
  'Tamper-proof',
  'tamper-evident',
  'SHA-256 sealed',
  'Report verified',
  'HIPAA Compliant',
] as const;
