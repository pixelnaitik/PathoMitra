import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeReportSigningBridge {
  publicKey(): Promise<{ publicKey: JsonWebKey; keyId: string }>;
  sign(args: { manifest: string }): Promise<{ signature: string; signedAt: string }>;
  verify(args: {
    manifest: string;
    signature: string;
    publicKey?: JsonWebKey;
    keyId?: string;
  }): Promise<{ valid: boolean }>;
}

const NativeReportSigning = registerPlugin<NativeReportSigningBridge>('ReportSigning');

export function nativeReportSigning(): NativeReportSigningBridge | null {
  return Capacitor.isNativePlatform() ? NativeReportSigning : null;
}
