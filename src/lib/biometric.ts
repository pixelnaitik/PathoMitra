/** Native Android biometrics and Windows Hello through platform WebAuthn. */
import { Capacitor } from '@capacitor/core';
import { BiometricAuth, BiometryErrorType } from '@aparajita/capacitor-biometric-auth';
import { isDesktopShell } from './desktop-bridge';
import { secureGet, secureRemove, secureSet } from './secure-store';

export interface BiometricStatus {
  available: boolean;
  reason: string;
}

export interface BiometricResult {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
}

const CANCEL_CODES: string[] = [
  BiometryErrorType.userCancel,
  BiometryErrorType.systemCancel,
  BiometryErrorType.appCancel,
  BiometryErrorType.userFallback,
];
const CREDENTIAL_KEY = 'webauthn-platform-credentials';

function randomBytes(length = 32): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  view.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function desktopAvailable(): Promise<boolean> {
  return (
    typeof PublicKeyCredential !== 'undefined' &&
    typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function' &&
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  );
}

async function desktopAssert(_reason: string): Promise<BiometricResult> {
  const ids = (await secureGet<string[]>(CREDENTIAL_KEY)) ?? [];
  if (ids.length === 0)
    return { ok: false, error: 'Enable Windows Hello once before using it to unlock.' };
  try {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(),
        allowCredentials: ids.map(id => ({ id: fromBase64Url(id), type: 'public-key' })),
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return credential
      ? { ok: true }
      : { ok: false, error: 'Windows Hello did not return a credential.' };
  } catch (error) {
    const name = (error as Error).name;
    return {
      ok: false,
      cancelled: name === 'NotAllowedError',
      error:
        name === 'NotAllowedError'
          ? 'Windows Hello prompt was cancelled or timed out.'
          : (error as Error).message,
    };
  }
}

/** Prove and persist a platform authenticator. On Windows this creates a WebAuthn credential backed by Hello. */
export async function setupBiometric(reason = 'Enable Windows Hello'): Promise<BiometricResult> {
  if (Capacitor.isNativePlatform()) return authenticate(reason);
  if (!isDesktopShell())
    return { ok: false, error: 'Biometric unlock is not available on this platform.' };
  if (!(await desktopAvailable()))
    return { ok: false, error: 'Windows Hello is not available for this Windows account.' };
  const existing = (await secureGet<string[]>(CREDENTIAL_KEY)) ?? [];
  if (existing.length > 0) return desktopAssert(reason);
  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(),
        rp: { id: window.location.hostname || 'app', name: 'PathoMitra' },
        user: {
          id: new TextEncoder().encode('pathomitra-platform-user'),
          name: 'PathoMitra operator',
          displayName: 'PathoMitra operator',
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    if (!credential) return { ok: false, error: 'Windows Hello did not create a credential.' };
    await secureSet(CREDENTIAL_KEY, [...existing, base64Url(credential.rawId)]);
    return { ok: true };
  } catch (error) {
    const name = (error as Error).name;
    return {
      ok: false,
      cancelled: name === 'NotAllowedError',
      error: (error as Error).message || 'Windows Hello setup failed.',
    };
  }
}

export async function clearBiometricCredentials(): Promise<void> {
  await secureRemove(CREDENTIAL_KEY);
}

export async function checkBiometric(): Promise<BiometricStatus> {
  if (isDesktopShell()) {
    const available = await desktopAvailable();
    return {
      available,
      reason: available ? '' : 'Windows Hello is not available for this Windows account.',
    };
  }
  if (!Capacitor.isNativePlatform())
    return { available: false, reason: 'Biometric unlock is not available on this platform.' };
  try {
    const result = await BiometricAuth.checkBiometry();
    const available = result.isAvailable || result.deviceIsSecure;
    return { available, reason: available ? '' : result.reason || 'No device lock is set up.' };
  } catch (error) {
    return { available: false, reason: (error as Error).message };
  }
}

export async function authenticate(reason = 'Unlock PathoMitra'): Promise<BiometricResult> {
  if (isDesktopShell()) return desktopAssert(reason);
  if (!Capacitor.isNativePlatform())
    return { ok: false, error: 'Biometric unlock is not available on this platform.' };
  try {
    await BiometricAuth.authenticate({ androidTitle: reason, allowDeviceCredential: true });
    return { ok: true };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code && CANCEL_CODES.includes(code)) return { ok: false, cancelled: true };
    return { ok: false, error: (error as Error).message || 'Authentication failed.' };
  }
}
