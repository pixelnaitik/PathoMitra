import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Role } from '../lib/models';
import {
  createAccountWithRecovery,
  deleteAccount,
  getAccount,
  setBiometricEnabled as persistBiometricEnabled,
  changePassword as changeLocalPassword,
  recoverAccountPassword,
  rotateRecoveryKey as rotateLocalRecoveryKey,
  updateAccountName,
  needsTermsAcceptance,
  acceptTerms as persistTermsAcceptance,
  type UnlockResult,
} from '../lib/local-account';
import {
  deleteOperators,
  findOperator,
  updateOperator,
  verifyOperatorPassword,
  type OperatorIdentity,
} from '../lib/operator-accounts';
import { authenticate, checkBiometric, setupBiometric } from '../lib/biometric';
import { can } from '../lib/permissions';
import { getRepository } from '../data';
import { installSessionLock } from '../lib/session-lock';
import { eraseLocalArtifacts } from '../lib/erase-data';
import { SETTINGS_UPDATED_EVENT, DEFAULT_SETTINGS, readSettings, writeSettings } from '../lib/settings';

/** Fixed uid retained for the original administrator so existing audit rows remain valid. */
export const LOCAL_UID = 'local-admin';
export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 32;
const DIGITS_RE = /^[0-9]{4,12}$/;
const PASSPHRASE_RE = /^[A-Za-z0-9!@#$%^&*.\-_]{6,32}$/;
export const PIN_ERROR = `Use 4–12 digits, or 6–32 characters (letters, numbers or . ! @ # $ % ^ & * - _).`;

export function isValidPasscode(value: string): boolean {
  return DIGITS_RE.test(value) || PASSPHRASE_RE.test(value);
}

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export type AuthRole = Role | null;
export type AuthStatus = 'loading' | 'onboarding' | 'locked' | 'unlocked' | 'error';

interface AuthContextType {
  status: AuthStatus;
  user: AuthUser | null;
  operator: OperatorIdentity | null;
  role: Role | null;
  loading: boolean;
  isAdmin: boolean;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  termsPending: boolean;
  /** Creates the primary administrator and returns its one-time recovery key. */
  createAccount: (
    name: string,
    password: string,
    enableBiometric: boolean,
    termsAccepted: boolean,
  ) => Promise<string>;
  completeOnboarding: () => void;
  acceptCurrentTerms: () => Promise<void>;
  unlockWithPassword: (identifier: string, password: string) => Promise<UnlockResult>;
  /** OS verification is followed by explicit operator attribution. */
  unlockWithBiometric: (operatorId: string) => Promise<boolean>;
  setBiometric: (enabled: boolean) => Promise<void>;
  changePassword: (nextPassword: string, currentPassword: string) => Promise<void>;
  renameAccount: (name: string) => Promise<void>;
  recoverPassword: (recoveryKey: string, nextPassword: string) => Promise<void>;
  rotateRecoveryKey: (currentPassword: string) => Promise<string>;
  lock: () => void;
  logout: () => Promise<void>;
  eraseAllData: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  status: 'loading', user: null, operator: null, role: null, loading: true, isAdmin: false,
  biometricAvailable: false, biometricEnabled: false, termsPending: true,
  createAccount: async () => '', completeOnboarding: () => {}, acceptCurrentTerms: async () => {},
  unlockWithPassword: async () => ({ ok: false, reason: 'wrong', attemptsLeft: 0 }),
  unlockWithBiometric: async () => false, setBiometric: async () => {},
  changePassword: async () => {}, renameAccount: async () => {}, recoverPassword: async () => {},
  rotateRecoveryKey: async () => '', lock: () => {}, logout: async () => {}, eraseAllData: async () => {},
});

export const useAuth = () => useContext(AuthContext);

function toUser(operator: OperatorIdentity): AuthUser {
  return { uid: operator.uid, email: null, displayName: operator.name, photoURL: null };
}

/** Seed the letterhead only while it is empty or still mirrors the original lab name. */
function adoptLabNameFromAccount(accountName: string, previousName = ''): void {
  const trimmed = accountName.trim();
  if (!trimmed) return;
  const settings = readSettings();
  const current = settings.labName?.trim();
  const isPlaceholder = !current || current === DEFAULT_SETTINGS.labName;
  const wasMirroring = !!previousName && current === previousName.trim();
  if (isPlaceholder || wasMirroring) writeSettings({ ...settings, labName: trimmed });
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [operator, setOperator] = useState<OperatorIdentity | null>(null);
  const [pendingOperator, setPendingOperator] = useState<OperatorIdentity | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [termsPending, setTermsPending] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      let bio = { available: false };
      try { bio = await checkBiometric(); } catch (error) {
        console.error('PathoMitra: biometric probe failed, continuing without it', error);
      }
      let account;
      try { account = await getAccount(); } catch (error) {
        console.error('PathoMitra: secure storage could not be read', error);
        if (active) setStatus('error');
        return;
      }
      if (!active) return;
      setBiometricAvailable(bio.available);
      setTermsPending(needsTermsAcceptance(account));
      if (account) {
        setBiometricEnabled(account.biometricEnabled && bio.available);
        adoptLabNameFromAccount(account.name);
        setStatus('locked');
      } else {
        setStatus('onboarding');
      }
    })();
    return () => { active = false; };
  }, []);

  const enterUnlocked = useCallback((next: OperatorIdentity) => {
    if (next.disabled) throw new Error('This operator account is disabled.');
    setOperator(next);
    setStatus('unlocked');
  }, []);

  const createAccount = useCallback(async (
    name: string,
    password: string,
    enableBiometric: boolean,
    termsAccepted: boolean,
  ): Promise<string> => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Please enter your lab name.');
    if (!isValidPasscode(password)) throw new Error(PIN_ERROR);
    if (!termsAccepted) throw new Error('Please accept the Terms to continue.');
    let useBiometric = enableBiometric;
    if (enableBiometric) {
      const bio = await checkBiometric();
      if (!bio.available) useBiometric = false;
    }
    const { account, recoveryKey } = await createAccountWithRecovery(
      trimmed, password, useBiometric, new Date().toISOString(),
    );
    const profile: OperatorIdentity = {
      uid: LOCAL_UID, username: 'admin', name: account.name, role: 'admin', disabled: false,
    };
    try {
      await getRepository().set('users', LOCAL_UID, {
        name: account.name, username: 'admin', role: 'admin', createdAt: account.createdAt,
      });
    } catch (error) {
      console.error('PathoMitra: failed to seed local user profile', error);
    }
    setPendingOperator(profile);
    setBiometricAvailable(useBiometric ? true : biometricAvailable);
    setBiometricEnabled(useBiometric);
    setTermsPending(false);
    adoptLabNameFromAccount(account.name);
    return recoveryKey;
  }, [biometricAvailable]);

  const completeOnboarding = useCallback(() => {
    if (!pendingOperator) return;
    enterUnlocked(pendingOperator);
    setPendingOperator(null);
  }, [pendingOperator, enterUnlocked]);

  const unlockWithPassword = useCallback(async (identifier: string, password: string): Promise<UnlockResult> => {
    const result = await verifyOperatorPassword(identifier || 'admin', password);
    if (!result.ok) return result;
    const profile = await findOperator(identifier || 'admin');
    if (!profile) return { ok: false, reason: 'wrong', attemptsLeft: 0 };
    enterUnlocked(profile);
    return { ok: true };
  }, [enterUnlocked]);

  const unlockWithBiometric = useCallback(async (operatorId: string): Promise<boolean> => {
    const result = await authenticate('Unlock PathoMitra');
    if (!result.ok) return false;
    const profile = await findOperator(operatorId);
    if (!profile) return false;
    try { enterUnlocked(profile); } catch { return false; }
    return true;
  }, [enterUnlocked]);

  const setBiometric = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const result = await setupBiometric('Enable biometric unlock');
      if (!result.ok) throw new Error(result.error || 'Biometric setup was cancelled.');
    }
    await persistBiometricEnabled(enabled);
    setBiometricEnabled(enabled);
  }, []);

  const changePassword = useCallback(async (nextPassword: string, currentPassword: string) => {
    if (!isValidPasscode(nextPassword)) throw new Error(PIN_ERROR);
    if (!operator) throw new Error('No operator is signed in.');
    if (operator.uid === LOCAL_UID) {
      await changeLocalPassword(nextPassword, currentPassword);
      return;
    }
    const verified = await verifyOperatorPassword(operator.username, currentPassword);
    if (!verified.ok) throw new Error('Current passcode is incorrect or locked.');
    const { changeOwnOperatorPassword } = await import('../lib/operator-accounts');
    await changeOwnOperatorPassword(operator.uid, nextPassword);
  }, [operator]);

  const renameAccount = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name cannot be empty.');
    if (!operator) return;
    if (operator.uid === LOCAL_UID) {
      const previous = (await getAccount())?.name ?? '';
      await updateAccountName(trimmed);
      try { await getRepository().update('users', LOCAL_UID, { name: trimmed }); } catch { /* mirror is non-authoritative */ }
      adoptLabNameFromAccount(trimmed, previous);
    } else {
      await updateOperator(operator.uid, { name: trimmed }, { uid: operator.uid, role: operator.role });
    }
    setOperator({ ...operator, name: trimmed });
  }, [operator]);

  const recoverPassword = useCallback(async (recoveryKey: string, nextPassword: string) => {
    if (!isValidPasscode(nextPassword)) throw new Error(PIN_ERROR);
    await recoverAccountPassword(recoveryKey, nextPassword);
    await getRepository().set('auditEvents', `auth-recovery-${Date.now()}`, {
      action: 'auth.recovery', entity: 'users', entityId: LOCAL_UID,
      actor: LOCAL_UID, at: new Date().toISOString(), detail: { method: 'offline-recovery-key' },
    });
  }, []);

  const rotateRecoveryKey = useCallback(async (currentPassword: string) => {
    if (operator?.uid !== LOCAL_UID) throw new Error('Only the primary administrator can rotate the recovery key.');
    return rotateLocalRecoveryKey(currentPassword);
  }, [operator]);

  const lock = useCallback(() => {
    setOperator(null);
    setStatus(previous => previous === 'onboarding' ? 'onboarding' : 'locked');
  }, []);
  const logout = useCallback(async () => { lock(); }, [lock]);

  const acceptCurrentTerms = useCallback(async () => {
    await persistTermsAcceptance();
    setTermsPending(false);
  }, []);

  const eraseAllData = useCallback(async () => {
    try { await getRepository().clearAll(); } catch (error) {
      throw new Error('Clinical records could not be fully erased. Your account and this device lock were left in place. Please try again.', { cause: error });
    }
    try { await eraseLocalArtifacts(); } catch (error) {
      throw new Error('Clinical records were cleared, but backups, exports, settings, or diagnostics could not all be removed. Your account was retained so you can retry.', { cause: error });
    }
    await deleteAccount();
    await deleteOperators();
    setOperator(null);
    setPendingOperator(null);
    setBiometricEnabled(false);
    setTermsPending(true);
    setStatus('onboarding');
  }, []);

  const unlocked = status === 'unlocked';
  const user = unlocked && operator ? toUser(operator) : null;
  const role = unlocked ? operator?.role ?? null : null;
  const [lockConfigVersion, setLockConfigVersion] = useState(0);
  useEffect(() => {
    const resync = () => setLockConfigVersion(version => version + 1);
    window.addEventListener(SETTINGS_UPDATED_EVENT, resync);
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, resync);
  }, []);
  useEffect(() => {
    if (status !== 'unlocked') return undefined;
    return installSessionLock({
      onLock: () => setStatus(previous => previous === 'unlocked' ? 'locked' : previous),
      idleMs: Math.max(0, readSettings().autoLockSeconds) * 1000,
    });
  }, [status, lockConfigVersion]);

  return (
    <AuthContext.Provider value={{
      status, user, operator, role, loading: status === 'loading',
      isAdmin: can(role, 'manageOperators'), biometricAvailable, biometricEnabled, termsPending,
      createAccount, completeOnboarding, acceptCurrentTerms, unlockWithPassword, unlockWithBiometric,
      setBiometric, changePassword, renameAccount, recoverPassword, rotateRecoveryKey,
      lock, logout, eraseAllData,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
