import { getRepository } from '../data';
import type { Role } from './models';
import { hashPassword, verifyPassword } from './password';
import { getAccount, type LocalAccount, type UnlockResult } from './local-account';
import { can } from './permissions';
import { secureGet, secureRemove, secureSet } from './secure-store';

const KEY = 'operators';
const MAX_ADDITIONAL_OPERATORS = 20;

export interface OperatorIdentity {
  uid: string;
  username: string;
  name: string;
  role: Role;
  disabled: boolean;
}

export interface StoredOperator extends LocalAccount {
  uid: string;
  username: string;
  role: Exclude<Role, 'guest'>;
  disabled: boolean;
}

export interface Actor {
  uid: string;
  role: Role;
}

function publicProfile(operator: OperatorIdentity): OperatorIdentity {
  return {
    uid: operator.uid,
    username: operator.username,
    name: operator.name,
    role: operator.role,
    disabled: operator.disabled,
  };
}

async function readAdditional(): Promise<StoredOperator[]> {
  return (await secureGet<StoredOperator[]>(KEY)) ?? [];
}

async function writeAdditional(operators: StoredOperator[]): Promise<void> {
  await secureSet(KEY, operators);
}

async function syncUser(operator: OperatorIdentity): Promise<void> {
  await getRepository().set('users', operator.uid, {
    name: operator.name,
    username: operator.username,
    role: operator.role,
    disabled: operator.disabled,
    updatedAt: new Date().toISOString(),
  });
}

export async function listOperatorProfiles(): Promise<OperatorIdentity[]> {
  const primary = await getAccount();
  const profiles: OperatorIdentity[] = primary ? [{
    uid: 'local-admin', username: 'admin', name: primary.name, role: 'admin', disabled: false,
  }] : [];
  const additional = await readAdditional();
  return [...profiles, ...additional.map(publicProfile)];
}

export async function findOperator(identifier: string): Promise<OperatorIdentity | null> {
  const normalized = identifier.trim().toLowerCase();
  const profiles = await listOperatorProfiles();
  return profiles.find(profile => profile.username.toLowerCase() === normalized || profile.uid === normalized) ?? null;
}

async function verifyAdditional(operator: StoredOperator, password: string): Promise<UnlockResult> {
  if (operator.disabled) return { ok: false, reason: 'wrong', attemptsLeft: 0 };
  if (operator.lockUntil > Date.now()) {
    return {
      ok: false,
      reason: 'locked',
      unlocksAt: operator.lockUntil,
      waitSeconds: Math.ceil((operator.lockUntil - Date.now()) / 1000),
    };
  }
  if (await verifyPassword(password, operator.password)) {
    if (operator.failedAttempts || operator.lockUntil || operator.lastAttemptAt) {
      await writeAdditional((await readAdditional()).map(item => item.uid === operator.uid
        ? { ...item, failedAttempts: 0, lockUntil: 0, lastAttemptAt: 0 }
        : item));
    }
    return { ok: true };
  }
  const failedAttempts = operator.failedAttempts + 1;
  const lockUntil = failedAttempts > 5 ? Date.now() + 30_000 * Math.min(failedAttempts - 5, 20) : 0;
  await writeAdditional((await readAdditional()).map(item => item.uid === operator.uid
    ? { ...item, failedAttempts, lockUntil, lastAttemptAt: Date.now() }
    : item));
  if (lockUntil) return { ok: false, reason: 'locked', unlocksAt: lockUntil, waitSeconds: Math.ceil((lockUntil - Date.now()) / 1000) };
  return { ok: false, reason: 'wrong', attemptsLeft: Math.max(0, 5 - failedAttempts) };
}

export async function verifyOperatorPassword(identifier: string, password: string): Promise<UnlockResult> {
  const profile = await findOperator(identifier);
  if (!profile || profile.disabled) return { ok: false, reason: 'wrong', attemptsLeft: 0 };
  if (profile.uid === 'local-admin') {
    const { verifyAccountPassword } = await import('./local-account');
    return verifyAccountPassword(password);
  }
  const operator = (await readAdditional()).find(item => item.uid === profile.uid);
  return operator ? verifyAdditional(operator, password) : { ok: false, reason: 'wrong', attemptsLeft: 0 };
}

export async function createOperator(input: {
  name: string;
  username: string;
  password: string;
  role: Exclude<Role, 'guest'>;
}, actor: Actor): Promise<OperatorIdentity> {
  if (!can(actor.role, 'manageOperators')) throw new Error('Only an administrator can manage operators.');
  const name = input.name.trim();
  const username = input.username.trim().toLowerCase();
  if (!name || !/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error('Enter a name and a 3–32 character username using letters, numbers, dot, underscore, or hyphen.');
  }
  if (username === 'admin') throw new Error('The username admin is reserved.');
  if (input.role === 'admin' && actor.uid !== 'local-admin') throw new Error('Only the primary administrator can create another administrator.');
  const operators = await readAdditional();
  if (operators.length >= MAX_ADDITIONAL_OPERATORS) throw new Error('This device supports at most 21 operator accounts.');
  if (operators.some(item => item.username.toLowerCase() === username)) throw new Error('That username already exists.');
  const now = new Date().toISOString();
  const operator: StoredOperator = {
    uid: `op-${globalThis.crypto.randomUUID()}`,
    username,
    name,
    role: input.role,
    disabled: false,
    password: await hashPassword(input.password),
    biometricEnabled: false,
    failedAttempts: 0,
    lockUntil: 0,
    lastAttemptAt: 0,
    createdAt: now,
    termsAcceptedAt: now,
    termsVersion: 'operators-covered-by-admin',
  };
  await writeAdditional([...operators, operator]);
  await syncUser(publicProfile(operator));
  await getRepository().set('auditEvents', `operator-create-${operator.uid}`, {
    action: 'operator.create', entity: 'users', entityId: operator.uid,
    actor: actor.uid, at: now, detail: { role: operator.role, username: operator.username },
  });
  return publicProfile(operator);
}

export async function updateOperator(
  uid: string,
  patch: { name?: string; role?: Exclude<Role, 'guest'>; disabled?: boolean; password?: string },
  actor: Actor,
): Promise<void> {
  const selfRename = !!patch.name && actor.uid === uid && Object.keys(patch).length === 1;
  if (!selfRename && !can(actor.role, 'manageOperators')) throw new Error('Only an administrator can manage operators.');
  if (uid === 'local-admin') throw new Error('The primary administrator is managed through account recovery.');
  const operators = await readAdditional();
  const current = operators.find(item => item.uid === uid);
  if (!current) throw new Error('Operator not found.');
  if (current.role === 'admin' && patch.role && patch.role !== 'admin' && actor.uid !== 'local-admin') {
    throw new Error('Only the primary administrator can change another administrator.');
  }
  const next: StoredOperator = {
    ...current,
    ...(patch.name?.trim() ? { name: patch.name.trim() } : {}),
    ...(patch.role ? { role: patch.role } : {}),
    ...(patch.disabled !== undefined ? { disabled: patch.disabled } : {}),
    ...(patch.password ? { password: await hashPassword(patch.password), failedAttempts: 0, lockUntil: 0, lastAttemptAt: 0 } : {}),
  };
  await writeAdditional(operators.map(item => item.uid === uid ? next : item));
  await syncUser(publicProfile(next));
  await getRepository().set('auditEvents', `operator-update-${uid}-${Date.now()}`, {
    action: 'operator.update', entity: 'users', entityId: uid, actor: actor.uid,
    at: new Date().toISOString(), detail: { role: next.role, disabled: next.disabled, passwordReset: !!patch.password },
  });
}

export async function changeOwnOperatorPassword(uid: string, nextPassword: string): Promise<void> {
  const operators = await readAdditional();
  const current = operators.find(item => item.uid === uid);
  if (!current || current.disabled) throw new Error('Operator account is unavailable.');
  const next = {
    ...current,
    password: await hashPassword(nextPassword),
    failedAttempts: 0,
    lockUntil: 0,
    lastAttemptAt: 0,
  };
  await writeAdditional(operators.map(item => item.uid === uid ? next : item));
}

export async function deleteOperators(): Promise<void> {
  await secureRemove(KEY);
}
