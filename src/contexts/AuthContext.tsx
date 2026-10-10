import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Role } from '../lib/models';
import {
  createAccount as createLocalAccount,
  deleteAccount,
  getAccount,
  setBiometricEnabled as persistBiometricEnabled,
  changePassword as changeLocalPassword,
  updateAccountName,
  verifyAccountPassword,
  needsTermsAcceptance,
  acceptTerms as persistTermsAcceptance,
  type UnlockResult,
} from '../lib/local-account';
import { authenticate, checkBiometric } from '../lib/biometric';
import { getRepository } from '../data';
import { installSessionLock } from '../lib/session-lock';
import { SETTINGS_UPDATED_EVENT, readSettings } from '../lib/settings';

/**
 * Local, offline authentication for the single device admin.
 *
 * There is no Firebase, no server and no email verification. On a fresh
 * install the app shows onboarding (create a name + password); afterwards it
 * shows an unlock screen that accepts either the password or the device's
 * biometric / screen-lock credential. The account record (a PBKDF2 hash) lives
 * in the platform secure store; clinical data lives in the encrypted SQLCipher
 * database, which is independent of unlock.
 */

/** Fixed uid for the one local account. */
export const LOCAL_UID = 'local-admin';

/**
 * Unlock secret policy.
 *
 * This used to be `/^\d{4}$/` — *exactly* four digits, which both caps the
 * secret at 10,000 possibilities and actively rejects a lab that wants a longer
 * one for a device holding other people's medical records. A short numeric PIN
 * is still allowed (it is what a busy bench wants), but it is now a floor, not a
 * ceiling, and a longer alphanumeric passcode is accepted instead.
 */
export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 32;
const DIGITS_RE = /^[0-9]{4,12}$/;
const PASSPHRASE_RE = /^[A-Za-z0-9!@#$%^&*.\-_]{6,32}$/;

export const PIN_ERROR = `Use 4–12 digits, or 6–32 characters (letters, numbers or . ! @ # $ % ^ & * - _).`;

/** True when `value` satisfies either tier of the passcode policy. */
export function isValidPasscode(value: string): boolean {
  return DIGITS_RE.test(value) || PASSPHRASE_RE.test(value);
}

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

/** Kept as an alias so existing imports of `AuthRole` keep compiling. */
export type AuthRole = Role | null;

export type AuthStatus = 'loading' | 'onboarding' | 'locked' | 'unlocked';

interface AuthContextType {
  /** Coarse lifecycle state — drives which auth screen (if any) shows. */
  status: AuthStatus;
  user: AuthUser | null;
  /** Always `'admin'` once unlocked; `null` otherwise. Single-account model. */
  role: Role | null;
  loading: boolean;
  isAdmin: boolean;
  /** Whether the device can offer biometric / screen-lock unlock. */
  biometricAvailable: boolean;
  /** Whether the user turned biometric unlock on for this account. */
  biometricEnabled: boolean;
  /**
   * True until the operator has accepted the current terms text. Set on first
   * run (nothing has been accepted yet) and again whenever `TERMS_VERSION`
   * changes, so a revised clause is never silently applied.
   */
  termsPending: boolean;
  /** First-run account creation. Throws with a readable message on failure. */
  createAccount: (
    name: string,
    password: string,
    enableBiometric: boolean,
    termsAccepted: boolean,
  ) => Promise<void>;
  /** Record acceptance of the current terms and clear `termsPending`. */
  acceptCurrentTerms: () => Promise<void>;
  unlockWithPassword: (password: string) => Promise<UnlockResult>;
  unlockWithBiometric: () => Promise<boolean>;
  setBiometric: (enabled: boolean) => Promise<void>;
  changePassword: (nextPassword: string) => Promise<void>;
  renameAccount: (name: string) => Promise<void>;
  /** Lock the session (return to the unlock screen) without erasing data. */
  lock: () => void;
  /** Alias for `lock` — kept for existing call sites. */
  logout: () => Promise<void>;
  /** Erase the account and all local clinical data (settings → erase). */
  eraseAllData: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  status: 'loading',
  user: null,
  role: null,
  loading: true,
  isAdmin: false,
  biometricAvailable: false,
  biometricEnabled: false,
  termsPending: true,
  createAccount: async () => {},
  acceptCurrentTerms: async () => {},
  unlockWithPassword: async () => ({ ok: false, reason: 'wrong', attemptsLeft: 0 }),
  unlockWithBiometric: async () => false,
  setBiometric: async () => {},
  changePassword: async () => {},
  renameAccount: async () => {},
  lock: () => {},
  logout: async () => {},
  eraseAllData: async () => {},
});

export const useAuth = () => useContext(AuthContext);

function toUser(name: string): AuthUser {
  return { uid: LOCAL_UID, email: null, displayName: name, photoURL: null };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [userName, setUserName] = useState<string>('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [termsPending, setTermsPending] = useState(true);

  // On boot: probe biometric capability and decide onboarding vs locked.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const bio = await checkBiometric();
        const account = await getAccount();
        if (!active) return;
        setBiometricAvailable(bio.available);
        setTermsPending(needsTermsAcceptance(account));
        if (account) {
          setUserName(account.name);
          setBiometricEnabled(account.biometricEnabled && bio.available);
          setStatus('locked');
        } else {
          setStatus('onboarding');
        }
      } catch (error) {
        console.error('PathLab OS: auth bootstrap failed', error);
        if (active) setStatus('onboarding');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const enterUnlocked = useCallback((name: string) => {
    setUserName(name);
    setStatus('unlocked');
  }, []);

  const createAccount = useCallback(
    async (name: string, password: string, enableBiometric: boolean, termsAccepted: boolean) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Please enter your name.');
      if (!isValidPasscode(password)) throw new Error(PIN_ERROR);
      // Refused here, not only in the UI: an operator processing patient data has
      // to affirmatively accept before the account exists.
      if (!termsAccepted) throw new Error('Please accept the Terms to continue.');

      let useBiometric = enableBiometric;
      if (enableBiometric) {
        const bio = await checkBiometric();
        if (!bio.available) useBiometric = false;
      }

      const account = await createLocalAccount(
        trimmed,
        password,
        useBiometric,
        new Date().toISOString(),
      );

      // Seed a `users` document so any profile reads keep working, and so the
      // encrypted DB has the admin's identity mirrored in it.
      try {
        await getRepository().set('users', LOCAL_UID, {
          name: account.name,
          email: '',
          role: 'admin',
          createdAt: account.createdAt,
        });
      } catch (error) {
        console.error('PathLab OS: failed to seed local user profile', error);
      }

      setBiometricAvailable(useBiometric ? true : biometricAvailable);
      setBiometricEnabled(useBiometric);
      setTermsPending(false);
      enterUnlocked(account.name);
    },
    [biometricAvailable, enterUnlocked],
  );

  const unlockWithPassword = useCallback(
    async (password: string): Promise<UnlockResult> => {
      const result = await verifyAccountPassword(password);
      if (result.ok) {
        const account = await getAccount();
        enterUnlocked(account?.name ?? userName);
      }
      return result;
    },
    [enterUnlocked, userName],
  );

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    const result = await authenticate('Unlock PathLab OS');
    if (result.ok) {
      const account = await getAccount();
      enterUnlocked(account?.name ?? userName);
      return true;
    }
    return false;
  }, [enterUnlocked, userName]);

  const setBiometric = useCallback(async (enabled: boolean) => {
    if (enabled) {
      // Prove the user can actually authenticate before persisting the choice.
      const result = await authenticate('Enable biometric unlock');
      if (!result.ok) throw new Error(result.error || 'Biometric setup was cancelled.');
    }
    await persistBiometricEnabled(enabled);
    setBiometricEnabled(enabled);
  }, []);

  const changePassword = useCallback(async (nextPassword: string) => {
    if (!isValidPasscode(nextPassword)) throw new Error(PIN_ERROR);
    await changeLocalPassword(nextPassword);
  }, []);

  const renameAccount = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name cannot be empty.');
    await updateAccountName(trimmed);
    setUserName(trimmed);
    try {
      await getRepository().update('users', LOCAL_UID, { name: trimmed });
    } catch {
      // non-fatal
    }
  }, []);

  const lock = useCallback(() => {
    setStatus(prev => (prev === 'onboarding' ? 'onboarding' : 'locked'));
  }, []);

  const logout = useCallback(async () => {
    setStatus('locked');
  }, []);

  const acceptCurrentTerms = useCallback(async () => {
    await persistTermsAcceptance();
    setTermsPending(false);
  }, []);

  const eraseAllData = useCallback(async () => {
    try {
      await getRepository().clearAll();
    } catch (error) {
      console.error('PathLab OS: failed to clear local data', error);
    }
    await deleteAccount();
    setUserName('');
    setBiometricEnabled(false);
    // The account is gone, so there is no acceptance on record any more.
    setTermsPending(true);
    setStatus('onboarding');
  }, []);

  const unlocked = status === 'unlocked';
  const user = unlocked ? toUser(userName) : null;
  const role: Role | null = unlocked ? 'admin' : null;

  // Re-lock automatically while the session is open: on backgrounding, and after
  // the lab's chosen period of inactivity.
  //
  // `lockConfigVersion` exists because the interval lives in lab settings, which
  // can change mid-session. A settings write bumps the version so the effect
  // below tears down and reinstalls with the new value — without it, saving a new
  // interval would only ever *remove* the lock and leave the console unprotected,
  // which is worse than never offering the setting.
  const [lockConfigVersion, setLockConfigVersion] = useState(0);

  useEffect(() => {
    const resync = () => setLockConfigVersion(v => v + 1);
    window.addEventListener(SETTINGS_UPDATED_EVENT, resync);
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, resync);
  }, []);

  useEffect(() => {
    if (status !== 'unlocked') return undefined;
    return installSessionLock({
      onLock: () => setStatus(prev => (prev === 'unlocked' ? 'locked' : prev)),
      idleMs: Math.max(0, readSettings().autoLockSeconds) * 1000,
    });
  }, [status, lockConfigVersion]);

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        role,
        loading: status === 'loading',
        isAdmin: unlocked,
        biometricAvailable,
        biometricEnabled,
        termsPending,
        createAccount,
        acceptCurrentTerms,
        unlockWithPassword,
        unlockWithBiometric,
        setBiometric,
        changePassword,
        renameAccount,
        lock,
        logout,
        eraseAllData,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
