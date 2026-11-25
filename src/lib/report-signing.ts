import type { ReportRecord } from './models';
import { secureGet, secureRemove, secureSet } from './secure-store';
import { canonicalReportManifest } from './report-manifest';
import { nativeReportSigning } from './report-signing-native';
import { desktopBridge } from './desktop-bridge';

export { canonicalReportManifest } from './report-manifest';

const KEY_ID = 'report-signing-key-v1';
const encoder = new TextEncoder();

export interface ReportIssuanceSignature {
  algorithm: 'ECDSA-P256-SHA256';
  publicKey: JsonWebKey;
  signature: string;
  manifestHash: string;
  keyId?: string;
  signedAt: string;
  clockSource?: 'device';
}

interface SigningKeyPair {
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function getSigningKeyPair(): Promise<SigningKeyPair> {
  const stored = await secureGet<SigningKeyPair>(KEY_ID);
  if (stored?.privateKey && stored?.publicKey) return stored;
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const next: SigningKeyPair = {
    privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey),
    publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey),
  };
  await secureSet(KEY_ID, next);
  return next;
}

export async function clearReportSigningKey(): Promise<void> {
  await secureRemove(KEY_ID);
}

/** Sign an issued report with this device's Keystore/Credential-Manager-backed key. */
export async function signReportIssuance(report: ReportRecord): Promise<ReportIssuanceSignature> {
  const manifest = canonicalReportManifest(report);
  const manifestHash = await sha256Hex(manifest);
  const native = nativeReportSigning();
  if (native) {
    const [key, signed] = await Promise.all([native.publicKey(), native.sign({ manifest })]);
    return {
      algorithm: 'ECDSA-P256-SHA256',
      publicKey: key.publicKey,
      keyId: key.keyId,
      signature: signed.signature,
      manifestHash,
      signedAt: signed.signedAt,
      clockSource: 'device',
    };
  }
  const desktop = desktopBridge()?.reportSigning;
  if (desktop) {
    const [key, signed] = await Promise.all([desktop.publicKey(), desktop.sign(manifest)]);
    return {
      algorithm: 'ECDSA-P256-SHA256',
      publicKey: key.publicKey,
      keyId: key.keyId,
      signature: signed.signature,
      manifestHash,
      signedAt: signed.signedAt,
      clockSource: 'device',
    };
  }
  const pair = await getSigningKeyPair();
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    pair.privateKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(manifest),
  );
  return {
    algorithm: 'ECDSA-P256-SHA256',
    publicKey: pair.publicKey,
    signature: toBase64Url(new Uint8Array(signature)),
    manifestHash,
    signedAt: new Date().toISOString(),
    clockSource: 'device',
  };
}

export async function verifyReportIssuance(
  report: ReportRecord,
): Promise<{ valid: boolean; reason?: string }> {
  const sealed = report.issuanceSignature;
  if (!sealed) return { valid: false, reason: 'This report has no issuance signature.' };
  try {
    const manifest = canonicalReportManifest(report);
    const hash = await sha256Hex(manifest);
    if (hash !== sealed.manifestHash)
      return { valid: false, reason: 'Issuance manifest hash does not match.' };
    const native = nativeReportSigning();
    if (native)
      return await native.verify({ manifest, signature: sealed.signature, keyId: sealed.keyId });
    const desktop = desktopBridge()?.reportSigning;
    if (desktop) return await desktop.verify(manifest, sealed.signature, sealed.keyId);
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      sealed.publicKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      fromBase64Url(sealed.signature),
      encoder.encode(manifest),
    );
    return valid ? { valid: true } : { valid: false, reason: 'Issuance signature is invalid.' };
  } catch {
    return { valid: false, reason: 'Issuance signature could not be verified.' };
  }
}
