import crypto from 'node:crypto';
import type { Role } from '../src/lib/models';
import { verifyPassword, type PasswordHash } from '../src/lib/password';
import { RENDERER_CREDENTIAL_PREFIX } from '../src/lib/renderer-credentials';
import { getSecret, setSecret } from './keyring';

export interface DesktopPrincipal {
  uid: string;
  role: Role;
  name: string;
}

interface StoredOperator {
  uid: string;
  username: string;
  name: string;
  role: Exclude<Role, 'guest'>;
  disabled: boolean;
  password: PasswordHash;
  biometricEnabled: boolean;
  failedAttempts: number;
  lockUntil: number;
  lastAttemptAt: number;
}

interface LocalAccount {
  name: string;
  password: PasswordHash;
  biometricEnabled: boolean;
  biometricOwnerUid?: string;
  failedAttempts: number;
  lockUntil: number;
  lastAttemptAt: number;
}

interface SessionRecord extends DesktopPrincipal {
  token: string;
  expiresAt: number;
}

const SESSION_MS = 30 * 60_000;
const sessions = new Map<string, SessionRecord>();
const ACCOUNT_KEY = RENDERER_CREDENTIAL_PREFIX + 'account';
const OPERATORS_KEY = RENDERER_CREDENTIAL_PREFIX + 'operators';
const WEBAUTHN_KEY = RENDERER_CREDENTIAL_PREFIX + 'webauthn-platform-credentials';
const LOCK_STEPS_MS = [30_000, 120_000, 300_000, 900_000, 3_600_000];

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function issue(principal: DesktopPrincipal): string {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { ...principal, token, expiresAt: Date.now() + SESSION_MS });
  return token;
}

export function getDesktopPrincipal(token: unknown): DesktopPrincipal {
  if (typeof token !== 'string' || !token) throw new Error('Desktop session required.');
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    throw new Error('Desktop session expired. Unlock again.');
  }
  session.expiresAt = Date.now() + SESSION_MS;
  return { uid: session.uid, role: session.role, name: session.name };
}

export function closeDesktopSession(token: unknown): void {
  if (typeof token === 'string') sessions.delete(token);
}

function lockUntilFor(attempts: number): number {
  if (attempts <= 5) return 0;
  const step = Math.min(attempts - 6, LOCK_STEPS_MS.length - 1);
  return Date.now() + LOCK_STEPS_MS[step];
}

async function openPasswordSession(identifier: string, password: string): Promise<string | null> {
  const normalized = identifier.trim().toLowerCase();
  const account = parse<LocalAccount>(await getSecret(ACCOUNT_KEY));
  const operators = parse<StoredOperator[]>(await getSecret(OPERATORS_KEY)) ?? [];
  const primary = normalized === 'admin' || normalized === 'local-admin';
  const operator = operators.find(
    item => item.username.toLowerCase() === normalized || item.uid === normalized,
  );
  const credential = primary ? account : operator;
  if (!credential || (operator && (operator.disabled || operator.lockUntil > Date.now())))
    return null;
  if (!(await verifyPassword(password, credential.password))) {
    const failedAttempts = (credential.failedAttempts || 0) + 1;
    const lockUntil = lockUntilFor(failedAttempts);
    if (primary && account) {
      await setSecret(
        ACCOUNT_KEY,
        JSON.stringify({ ...account, failedAttempts, lockUntil, lastAttemptAt: Date.now() }),
      );
    } else if (operator) {
      await setSecret(
        OPERATORS_KEY,
        JSON.stringify(
          operators.map(item =>
            item.uid === operator.uid
              ? { ...item, failedAttempts, lockUntil, lastAttemptAt: Date.now() }
              : item,
          ),
        ),
      );
    }
    return null;
  }
  if (primary && account) {
    await setSecret(
      ACCOUNT_KEY,
      JSON.stringify({ ...account, failedAttempts: 0, lockUntil: 0, lastAttemptAt: 0 }),
    );
    return issue({ uid: 'local-admin', role: 'admin', name: account.name });
  }
  if (operator) {
    await setSecret(
      OPERATORS_KEY,
      JSON.stringify(
        operators.map(item =>
          item.uid === operator.uid
            ? { ...item, failedAttempts: 0, lockUntil: 0, lastAttemptAt: 0 }
            : item,
        ),
      ),
    );
    return issue({ uid: operator.uid, role: operator.role, name: operator.name });
  }
  return null;
}

/** Called only after the renderer's Windows Hello assertion succeeded. */
export async function openBiometricSession(operatorId: string): Promise<string | null> {
  const account = parse<LocalAccount>(await getSecret(ACCOUNT_KEY));
  const credentials = parse<string[]>(await getSecret(WEBAUTHN_KEY)) ?? [];
  if (
    !account?.biometricEnabled ||
    account.biometricOwnerUid !== operatorId ||
    credentials.length === 0
  )
    return null;
  if (operatorId === 'local-admin')
    return issue({ uid: 'local-admin', role: 'admin', name: account.name });
  const operator = (parse<StoredOperator[]>(await getSecret(OPERATORS_KEY)) ?? []).find(
    item => item.uid === operatorId,
  );
  if (!operator || operator.disabled) return null;
  return issue({ uid: operator.uid, role: operator.role, name: operator.name });
}

export async function openDesktopSession(
  identifier: string,
  password: string,
): Promise<{ token: string; principal: DesktopPrincipal } | null> {
  const token = await openPasswordSession(identifier, password);
  return token ? { token, principal: getDesktopPrincipal(token) } : null;
}

export async function openDesktopBiometricSession(
  operatorId: string,
): Promise<{ token: string; principal: DesktopPrincipal } | null> {
  const token = await openBiometricSession(operatorId);
  return token ? { token, principal: getDesktopPrincipal(token) } : null;
}
