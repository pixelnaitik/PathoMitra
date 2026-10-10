/**
 * The single local account for this device — replaces Firebase Auth users.
 *
 * Stored as one record in `secure-store` (Keystore/Keychain on device). It
 * holds the display name, a PBKDF2 password hash, whether biometric unlock is
 * enabled, and the failed-attempt state used to slow brute force. There is
 * exactly one account (the lab admin); no roles, no server, no email
 * verification.
 *
 * Why the attempt counter matters: the unlock secret is a short PIN, so without
 * a delay between failures the on-screen lockout can be walked through in a few
 * minutes by anyone holding the device. The backoff is enforced here rather than
 * in the UI so no screen can bypass it.
 */
import { hashPassword, verifyPassword, type PasswordHash } from './password';
import { secureGet, secureRemove, secureSet } from './secure-store';
import { TERMS_VERSION } from './terms';

const KEY = 'account';

/** Free tries before the first delay, then one delay step per further failure. */
export const MAX_FREE_ATTEMPTS = 5;

/**
 * Lock durations (ms) applied after the 5th, 6th, 7th… consecutive failure.
 * The last value repeats for every further attempt.
 */
const LOCK_STEPS_MS = [30_000, 120_000, 300_000, 900_000, 3_600_000];

export interface LocalAccount {
  name: string;
  createdAt: string;
  password: PasswordHash;
  biometricEnabled: boolean;
  /** Consecutive failed unlocks since the last success. */
  failedAttempts: number;
  /** Epoch ms the current lockout ends; 0 when not locked. */
  lockUntil: number;
  /**
   * When and which version of the terms the operator accepted. Kept on the
   * account rather than in settings so "erase all data & delete account" removes
   * the acceptance record along with everything else.
   */
  termsAcceptedAt: string;
  termsVersion: string;
}

/**
 * Outcome of an unlock attempt. `reason: 'locked'` deliberately does not say
 * whether the PIN was right — telling an attacker "that was correct but you are
 * locked out" would leak the answer out of a timing-style probe.
 */
export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }
  | { ok: false; reason: 'locked'; unlocksAt: number; waitSeconds: number };

function lockDurationFor(attempts: number): number {
  if (attempts <= MAX_FREE_ATTEMPTS) return 0;
  const step = Math.min(attempts - MAX_FREE_ATTEMPTS - 1, LOCK_STEPS_MS.length - 1);
  return LOCK_STEPS_MS[step];
}

/** Fill in lockout fields for accounts written before they existed. */
function normalize(account: LocalAccount | null): LocalAccount | null {
  if (!account || !account.password) return null;
  return {
    ...account,
    failedAttempts: Number.isFinite(account.failedAttempts) ? account.failedAttempts : 0,
    lockUntil: Number.isFinite(account.lockUntil) ? account.lockUntil : 0,
    // An account predating the terms screen is not treated as having accepted
    // something it never saw: these stay empty and re-prompt once on unlock.
    termsAcceptedAt: typeof account.termsAcceptedAt === 'string' ? account.termsAcceptedAt : '',
    termsVersion: typeof account.termsVersion === 'string' ? account.termsVersion : '',
  };
}

/** The stored account, or `null` on a fresh install (drives create-vs-unlock). */
export async function getAccount(): Promise<LocalAccount | null> {
  return normalize(await secureGet<LocalAccount>(KEY));
}

/** True once an account exists — used to pick the first-run screen. */
export async function hasAccount(): Promise<boolean> {
  return (await getAccount()) !== null;
}

/** Create the device's account. Call only when `hasAccount()` is false. */
export async function createAccount(
  name: string,
  password: string,
  biometricEnabled = false,
  termsAcceptedAt = '',
): Promise<LocalAccount> {
  const hash = await hashPassword(password);
  const account: LocalAccount = {
    name: name.trim(),
    createdAt: new Date().toISOString(),
    password: hash,
    biometricEnabled,
    failedAttempts: 0,
    lockUntil: 0,
    termsAcceptedAt,
    termsVersion: termsAcceptedAt ? TERMS_VERSION : '',
  };
  await secureSet(KEY, account);
  return account;
}

/**
 * True when the stored acceptance predates the current terms text, so the
 * operator has to re-accept. A silent terms change is not an accepted one.
 */
export function needsTermsAcceptance(account: LocalAccount | null): boolean {
  if (!account) return true;
  return !account.termsAcceptedAt || account.termsVersion !== TERMS_VERSION;
}

/** Record acceptance of the current terms version against the account. */
export async function acceptTerms(): Promise<void> {
  const account = await getAccount();
  if (!account) return;
  await secureSet(KEY, {
    ...account,
    termsAcceptedAt: new Date().toISOString(),
    termsVersion: TERMS_VERSION,
  });
}

/**
 * Verify an unlock attempt, applying the backoff. Never throws and never
 * reveals whether the supplied PIN was correct while a lockout is running.
 */
export async function verifyAccountPassword(password: string): Promise<UnlockResult> {
  const account = await getAccount();
  if (!account) return { ok: false, reason: 'wrong', attemptsLeft: 0 };

  const now = Date.now();
  if (account.lockUntil > now) {
    return {
      ok: false,
      reason: 'locked',
      unlocksAt: account.lockUntil,
      waitSeconds: Math.ceil((account.lockUntil - now) / 1000),
    };
  }

  // A lockout that has expired no longer blocks the attempt, but the counter is
  // kept so escalation continues from where it stopped.
  if (account.lockUntil !== 0 && account.lockUntil <= now) {
    await secureSet(KEY, { ...account, lockUntil: 0 });
  }

  const current = (await getAccount()) ?? account;

  if (await verifyPassword(password, current.password)) {
    if (current.failedAttempts !== 0 || current.lockUntil !== 0) {
      await secureSet(KEY, { ...current, failedAttempts: 0, lockUntil: 0 });
    }
    return { ok: true };
  }

  const failedAttempts = current.failedAttempts + 1;
  const lockMs = lockDurationFor(failedAttempts);
  await secureSet(KEY, {
    ...current,
    failedAttempts,
    lockUntil: lockMs > 0 ? now + lockMs : 0,
  });

  if (lockMs > 0) {
    return {
      ok: false,
      reason: 'locked',
      unlocksAt: now + lockMs,
      waitSeconds: Math.ceil(lockMs / 1000),
    };
  }
  return {
    ok: false,
    reason: 'wrong',
    attemptsLeft: Math.max(0, MAX_FREE_ATTEMPTS - failedAttempts),
  };
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  const account = await getAccount();
  if (!account) return;
  await secureSet(KEY, { ...account, biometricEnabled: enabled });
}

export async function changePassword(nextPassword: string): Promise<void> {
  const account = await getAccount();
  if (!account) return;
  const hash = await hashPassword(nextPassword);
  await secureSet(KEY, { ...account, password: hash });
}

export async function updateAccountName(name: string): Promise<void> {
  const account = await getAccount();
  if (!account) return;
  await secureSet(KEY, { ...account, name: name.trim() });
}

/** Erase the account (used by "erase all data" in settings). */
export async function deleteAccount(): Promise<void> {
  await secureRemove(KEY);
}
