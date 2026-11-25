import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  createOperator,
  listOperatorProfiles,
  updateOperator,
  type OperatorIdentity,
} from '../lib/operator-accounts';
import { can, ROLE_LABELS } from '../lib/permissions';
import type { Role } from '../lib/models';
import { Button, ConfirmSheet, Field, Select, Sheet, TextInput, useToast } from './ui';

type ManagedRole = Exclude<Role, 'guest'>;

export default function OperatorAccountsPanel() {
  const { user, role, rotateRecoveryKey } = useAuth();
  const toast = useToast();
  const [profiles, setProfiles] = useState<OperatorIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newRole, setNewRole] = useState<ManagedRole>('technologist');
  const [busy, setBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState<OperatorIdentity | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [disableTarget, setDisableTarget] = useState<OperatorIdentity | null>(null);
  const [currentPasscode, setCurrentPasscode] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setProfiles(await listOperatorProfiles());
    } catch (cause) {
      setError((cause as Error).message || 'Could not load operator accounts.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!can(role, 'manageOperators')) return null;
  const actor = { uid: user?.uid ?? '', role: role ?? 'guest' };

  const submitCreate = async () => {
    setBusy(true);
    setError('');
    try {
      await createOperator({ name, username, password, role: newRole }, actor);
      toast.success('Operator account created.');
      setCreateOpen(false);
      setName('');
      setUsername('');
      setPassword('');
      await load();
    } catch (cause) {
      setError((cause as Error).message || 'Could not create operator.');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (profile: OperatorIdentity, next: ManagedRole) => {
    setBusy(true);
    try {
      await updateOperator(profile.uid, { role: next }, actor);
      await load();
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!resetTarget) return;
    setBusy(true);
    try {
      await updateOperator(resetTarget.uid, { password: resetPasswordValue }, actor);
      toast.success('Operator passcode reset.');
      setResetTarget(null);
      setResetPasswordValue('');
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleDisabled = async () => {
    if (!disableTarget) return;
    setBusy(true);
    try {
      await updateOperator(disableTarget.uid, { disabled: !disableTarget.disabled }, actor);
      toast.success(disableTarget.disabled ? 'Operator enabled.' : 'Operator disabled.');
      setDisableTarget(null);
      await load();
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rotateKey = async () => {
    setBusy(true);
    setError('');
    try {
      setRecoveryKey(await rotateRecoveryKey(currentPasscode));
      setCurrentPasscode('');
    } catch (cause) {
      setError((cause as Error).message || 'Could not rotate recovery key.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
        <div>
          <h4 className="flex items-center gap-2 font-bold text-primary">
            <ShieldCheck className="h-4 w-4" /> Operators &amp; roles
          </h4>
          <p className="mt-1 text-xs text-on-surface-variant">
            Each clinical and financial action records the signed-in operator&apos;s unique ID.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Add operator
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-error-container p-3 text-xs font-semibold text-error"
        >
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-sm text-on-surface-variant">Loading operators…</p>
      ) : (
        <div className="divide-y divide-outline-variant/30 overflow-hidden rounded-2xl border border-outline-variant/30">
          {profiles.map(profile => (
            <div key={profile.uid} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-on-surface">
                  {profile.name}{' '}
                  <span className="font-normal text-on-surface-variant">({profile.username})</span>
                </p>
                <p className="mt-0.5 text-xs text-on-surface-variant">
                  {profile.uid === 'local-admin'
                    ? 'Primary administrator'
                    : profile.disabled
                      ? 'Disabled'
                      : 'Active'}
                </p>
              </div>
              {profile.uid === 'local-admin' ? (
                <span className="text-xs font-semibold text-secondary">Administrator</span>
              ) : (
                <>
                  <Select
                    aria-label={`Role for ${profile.name}`}
                    value={profile.role}
                    disabled={busy}
                    onChange={event => void changeRole(profile, event.target.value as ManagedRole)}
                    className="w-40"
                  >
                    {(
                      ['technologist', 'pathologist', 'cashier', 'staff', 'admin'] as ManagedRole[]
                    ).map(item => (
                      <option key={item} value={item}>
                        {ROLE_LABELS[item]}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" variant="neutral" onClick={() => setResetTarget(profile)}>
                    Reset passcode
                  </Button>
                  <Button
                    size="sm"
                    variant={profile.disabled ? 'primary' : 'neutral'}
                    onClick={() => setDisableTarget(profile)}
                  >
                    {profile.disabled ? 'Enable' : 'Disable'}
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
        <h4 className="flex items-center gap-2 font-bold text-primary">
          <KeyRound className="h-4 w-4" /> Administrator recovery key
        </h4>
        <p className="mt-1 text-xs text-on-surface-variant">
          Rotating invalidates the previous key. Store the new key offline; it can reset only the
          primary administrator.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <TextInput
            type="password"
            autoComplete="current-password"
            aria-label="Current administrator passcode"
            placeholder="Current administrator passcode"
            value={currentPasscode}
            onChange={event => setCurrentPasscode(event.target.value)}
          />
          <Button onClick={rotateKey} disabled={busy || !currentPasscode}>
            Rotate recovery key
          </Button>
        </div>
        {recoveryKey && (
          <div className="mt-3 rounded-xl bg-secondary/10 p-3">
            <code className="break-all font-bold text-secondary">{recoveryKey}</code>
            <p className="mt-1 text-xs text-on-surface-variant">
              Shown once. Copy it before leaving this screen.
            </p>
          </div>
        )}
      </div>

      <Sheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add operator"
        description="Use a unique username and a strong passcode."
        footer={
          <Button
            className="w-full"
            onClick={submitCreate}
            disabled={busy || !name.trim() || !username.trim() || !password}
          >
            {busy ? 'Creating…' : 'Create operator'}
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="Full name">
            <TextInput
              value={name}
              onChange={event => setName(event.target.value)}
              autoComplete="name"
            />
          </Field>
          <Field label="Username" hint="3–32 letters, numbers, dot, underscore, or hyphen.">
            <TextInput
              value={username}
              onChange={event => setUsername(event.target.value.toLowerCase())}
              autoComplete="off"
            />
          </Field>
          <Field label="Temporary passcode">
            <TextInput
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Role">
            <Select
              value={newRole}
              onChange={event => setNewRole(event.target.value as ManagedRole)}
            >
              {(['technologist', 'pathologist', 'cashier', 'staff', 'admin'] as ManagedRole[]).map(
                item => (
                  <option key={item} value={item}>
                    {ROLE_LABELS[item]}
                  </option>
                ),
              )}
            </Select>
          </Field>
        </div>
      </Sheet>
      <Sheet
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title="Reset operator passcode"
        footer={
          <Button className="w-full" onClick={resetPassword} disabled={busy || !resetPasswordValue}>
            Reset passcode
          </Button>
        }
      >
        <Field label="New temporary passcode">
          <TextInput
            type="password"
            autoComplete="new-password"
            value={resetPasswordValue}
            onChange={event => setResetPasswordValue(event.target.value)}
          />
        </Field>
      </Sheet>
      <ConfirmSheet
        open={!!disableTarget}
        onClose={() => setDisableTarget(null)}
        onConfirm={toggleDisabled}
        title={disableTarget?.disabled ? 'Enable operator' : 'Disable operator'}
        confirmLabel={disableTarget?.disabled ? 'Enable' : 'Disable'}
        message={
          disableTarget?.disabled
            ? `Enable ${disableTarget.name}?`
            : `Disable ${disableTarget?.name}? Their audit history remains, but they will not be able to sign in.`
        }
      />
    </div>
  );
}
