import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Microscope, Loader2, AlertCircle, Fingerprint, Eye, EyeOff } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import {
  useAuth,
  isValidPasscode,
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  PIN_ERROR,
} from '../../contexts/AuthContext';
import type { UnlockResult } from '../../lib/local-account';
import BackButton from '../../components/BackButton';
import { TermsSheet } from '../../components/Terms';
import { PrivacyPolicySheet } from '../../components/PrivacyPolicy';
import { ONBOARDING_ATTESTATION, TERMS_VERSION } from '../../lib/terms';
import { isNative } from '../../data';

/**
 * Offline authentication screen — no Google, no Firebase.
 *
 * Renders one of two forms based on the auth lifecycle:
 *   - `onboarding` (fresh install): create the device account (name + passcode),
 *     with an optional biometric / screen-lock unlock toggle.
 *   - `locked`: unlock with the passcode, or with biometrics when enabled.
 *
 * Every field carries a real `<label>`. These were previously placeholder-only,
 * which fails WCAG 1.3.1/3.3.2 — placeholder text disappears the moment you type
 * and TalkBack announces an unfilled "edit box" with no name, on the very first
 * screen an assistive-tech user has to operate.
 */

const inputClass =
  'h-12 w-full rounded-2xl border border-outline-variant/70 bg-surface px-4 text-[15px] text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 transition';

/** Digits or the full policy charset — the keypad follows the user's choice. */
type KeypadMode = 'digits' | 'letters';

function AuroraBackdrop() {
  return (
    <div
      className="pointer-events-none absolute inset-0 select-none overflow-hidden"
      aria-hidden="true"
    >
      <div className="absolute -top-32 -right-32 h-[480px] w-[480px] rounded-full bg-accent/15 blur-[110px]" />
      <div className="absolute -bottom-40 -left-32 h-[480px] w-[480px] rounded-full bg-secondary/15 blur-[110px]" />
      <div className="absolute top-1/3 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/8 blur-[90px]" />
    </div>
  );
}

/**
 * The card is 550-700px tall, so it cannot be vertically centred inside a fixed
 * clip box: every viewport shorter than it (landscape phones, a foldable propped
 * half-open, the APK with the IME raised) lost the top *and* the bottom of the
 * form with nothing left to scroll to. The shell is therefore a scroll host —
 * `my-auto` centres the card while there is free space and collapses to 0 once
 * the card is taller than the screen, letting the document scroll instead.
 * `overflow-hidden` went with it; the aurora blobs clip themselves inside
 * <AuroraBackdrop>, which still has its own box.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center bg-background p-6 font-sans">
      <AuroraBackdrop />
      {/* In the APK the unlock screen *is* the entry point — nothing to go back to. */}
      {!isNative && <BackButton />}
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="relative z-10 my-auto w-full max-w-md overflow-hidden rounded-4xl border border-[var(--elevated-border)] bg-surface-container-lowest shadow-float"
      >
        <div className="flex flex-col p-8 md:p-10">
          <div className="relative mb-6 self-center">
            <div className="absolute inset-0 scale-125 rounded-full bg-accent/20 blur-xl animate-soft-pulse" />
            <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-[22px] bg-primary text-on-primary shadow-raised">
              <Microscope className="h-8 w-8" />
            </div>
          </div>
          {children}
        </div>
        <div className="border-t border-outline-variant/40 bg-surface-container-low px-8 py-3.5 text-center">
          <p className="font-mono text-[10.5px] font-medium tracking-wide text-on-surface-variant">
            PATHLAB.OS // OFFLINE CLINICAL SYSTEM
          </p>
        </div>
      </motion.div>
    </div>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2.5 rounded-2xl bg-error-container p-3.5 text-xs font-semibold leading-relaxed text-on-error-container"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
      <span>{message}</span>
    </div>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-variant"
    >
      {children}
    </label>
  );
}

/**
 * Switches between the numeric keypad (what a bench wants for a 4–6 digit PIN)
 * and the full charset needed for a longer alphanumeric passcode. The policy
 * accepts both, so the input must not filter out characters it allows.
 */
function KeypadToggle({ mode, onChange }: { mode: KeypadMode; onChange: (m: KeypadMode) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(mode === 'digits' ? 'letters' : 'digits')}
      className="text-xs font-semibold text-accent underline-offset-2 transition hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {mode === 'digits' ? 'Use letters too' : 'Digits only'}
    </button>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  onEnter,
  mode = 'digits',
  maxLength = 12,
  invalid = false,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
  onEnter?: () => void;
  /** 'digits' restricts entry and raises the numeric keypad. */
  mode?: KeypadMode;
  maxLength?: number;
  invalid?: boolean;
  /** Visible helper text, also wired to the field via aria-describedby. */
  hint?: string;
}) {
  const [reveal, setReveal] = useState(false);
  // A masked field can't be a plain number input, so we keep password/text type
  // and lean on inputMode="numeric" (the reliable way to raise the numpad in the
  // Android WebView) plus a digit filter that only applies in 'digits' mode.
  const numeric = mode === 'digits';
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {hintId && (
          <span id={hintId} className="text-[11px] leading-snug text-on-surface-variant">
            {hint}
          </span>
        )}
      </div>
      <div className="relative">
        <input
          id={id}
          type={reveal ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          inputMode={numeric ? 'numeric' : 'text'}
          pattern={numeric ? '[0-9]*' : undefined}
          maxLength={maxLength}
          enterKeyHint={onEnter ? 'go' : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={hintId}
          onChange={e => {
            const raw = e.target.value;
            onChange(
              numeric ? raw.replace(/\D/g, '').slice(0, maxLength) : raw.slice(0, maxLength),
            );
          }}
          onKeyDown={e => {
            if (numeric && !e.metaKey && !e.ctrlKey && e.key.length === 1 && !/\d/.test(e.key)) {
              e.preventDefault();
            }
            if (e.key === 'Enter' && onEnter) onEnter();
          }}
          placeholder={placeholder}
          className={`${inputClass} ${numeric ? 'pr-12 text-center text-2xl font-bold tracking-[0.6em]' : 'pr-12'}`}
        />
        <button
          type="button"
          onClick={() => setReveal(r => !r)}
          aria-label={reveal ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={reveal}
          className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-outline transition hover:bg-surface-container-low hover:text-on-surface-variant"
        >
          {reveal ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}

function CreateAccountForm() {
  const { createAccount, biometricAvailable } = useAuth();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [enableBio, setEnableBio] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [mode, setMode] = useState<KeypadMode>('digits');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!isValidPasscode(password)) {
      setError(PIN_ERROR);
      return;
    }
    if (password !== confirm) {
      setError('Passcodes do not match.');
      return;
    }
    setBusy(true);
    try {
      await createAccount(name, password, enableBio, acceptedTerms);
    } catch (e) {
      setError((e as Error).message || 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="mb-7 text-center">
        <h2 className="mb-1.5 text-[28px] font-bold leading-none tracking-[-0.03em] text-on-surface">
          Set up PathLab OS
        </h2>
        <p className="px-2 text-sm font-medium leading-relaxed text-on-surface-variant">
          Create the passcode that protects this device. Everything stays on-device — no account, no
          cloud.
        </p>
      </div>

      <ErrorNote message={error} />

      <div className="space-y-3.5">
        <div>
          <FieldLabel htmlFor="account-name">Your name</FieldLabel>
          <input
            id="account-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Printed on reports you issue"
            autoComplete="name"
            className={inputClass}
          />
        </div>
        <div className="flex justify-end">
          <KeypadToggle mode={mode} onChange={setMode} />
        </div>
        <PasswordField
          id="create-passcode"
          label="Passcode"
          value={password}
          onChange={setPassword}
          placeholder={
            mode === 'digits' ? `Create a ${MIN_PIN_LENGTH}+ digit PIN` : 'Create a passcode'
          }
          autoComplete="new-password"
          mode={mode}
          maxLength={MAX_PIN_LENGTH}
          hint={`${MIN_PIN_LENGTH}–12 digits, or 6+ characters`}
        />
        <PasswordField
          id="confirm-passcode"
          label="Confirm passcode"
          value={confirm}
          onChange={setConfirm}
          placeholder="Re-enter it"
          autoComplete="new-password"
          onEnter={submit}
          mode={mode}
          maxLength={MAX_PIN_LENGTH}
        />

        {biometricAvailable && (
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-outline-variant/60 bg-surface p-3.5">
            <input
              type="checkbox"
              checked={enableBio}
              onChange={e => setEnableBio(e.target.checked)}
              className="h-5 w-5 shrink-0 accent-[var(--md-sys-color-primary,#0a5ea6)]"
            />
            <span className="flex items-center gap-2 text-sm font-medium text-on-surface">
              <Fingerprint className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              Enable biometric / screen-lock unlock
            </span>
          </label>
        )}

        {/* Required, never pre-checked. This is the point where the operator
            takes on responsibility for the accreditation text they will print and
            for the patient data they will process. */}
        <div className="rounded-2xl border border-outline-variant/60 bg-surface p-3.5">
          <label className="flex min-h-12 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={e => setAcceptedTerms(e.target.checked)}
              aria-describedby="terms-links"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--md-sys-color-primary,#0a5ea6)]"
            />
            <span className="text-xs leading-relaxed text-on-surface">
              {ONBOARDING_ATTESTATION}
            </span>
          </label>
          <div id="terms-links" className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 pl-8">
            <button
              type="button"
              onClick={() => setShowTerms(true)}
              className="text-xs font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Read the Terms (v{TERMS_VERSION})
            </button>
            <button
              type="button"
              onClick={() => setShowPrivacy(true)}
              className="text-xs font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Read the Privacy Policy
            </button>
          </div>
        </div>

        <motion.button
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={submit}
          disabled={
            busy || !name.trim() || !isValidPasscode(password) || !confirm || !acceptedTerms
          }
          className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-on-primary shadow-card transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
          {busy ? 'Creating…' : 'Create account'}
        </motion.button>
      </div>

      <TermsSheet open={showTerms} onClose={() => setShowTerms(false)} />
      <PrivacyPolicySheet open={showPrivacy} onClose={() => setShowPrivacy(false)} />
    </Shell>
  );
}

/** Render a lockout wait as "2 min" / "45 sec" for the error line. */
function formatWait(seconds: number): string {
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min`;
  return `${seconds} sec`;
}

function UnlockForm() {
  const { unlockWithPassword, unlockWithBiometric, biometricEnabled, user } = useAuth();
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<KeypadMode>('digits');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const prompted = useRef(false);

  const waitSeconds = lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0;
  const locked = waitSeconds > 0;

  // Tick the lockout countdown once per second while it is running.
  useEffect(() => {
    if (lockedUntil <= Date.now()) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  /**
   * Surface the verifier's result. A lockout never says whether the last PIN was
   * right, and the field stops accepting input while locked — the delay itself is
   * enforced in lib/local-account, so this is presentation, not the control.
   */
  const applyResult = (result: UnlockResult) => {
    if (result.ok) {
      setError(null);
      setLockedUntil(0);
      setPassword('');
      return;
    }
    if (result.reason === 'locked') {
      setLockedUntil(result.unlocksAt);
      setNow(Date.now());
      setError(`Too many attempts. Try again in ${formatWait(result.waitSeconds)}.`);
      return;
    }
    setLockedUntil(0);
    setError(
      result.attemptsLeft > 0
        ? `Incorrect passcode. ${result.attemptsLeft} ${
            result.attemptsLeft === 1 ? 'attempt' : 'attempts'
          } left before a delay.`
        : 'Incorrect passcode.',
    );
  };

  const doPassword = async () => {
    setError(null);
    if (locked || !isValidPasscode(password)) return;
    setBusy(true);
    try {
      applyResult(await unlockWithPassword(password));
    } finally {
      setBusy(false);
    }
  };

  const doBiometric = async () => {
    setError(null);
    const ok = await unlockWithBiometric();
    if (!ok) setError('Biometric unlock did not succeed. Use your passcode.');
  };

  // Offer the biometric prompt once on arrival when it's enabled.
  useEffect(() => {
    if (biometricEnabled && !prompted.current) {
      prompted.current = true;
      void doBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricEnabled]);

  return (
    <Shell>
      <div className="mb-7 text-center">
        <h2 className="mb-1.5 text-[28px] font-bold leading-none tracking-[-0.03em] text-on-surface">
          Welcome back
        </h2>
        <p className="px-2 text-sm font-medium leading-relaxed text-on-surface-variant">
          {user?.displayName ? `Signed in as ${user.displayName}. ` : ''}Unlock to open the lab.
        </p>
      </div>

      <ErrorNote message={error} />

      <div className="space-y-3.5">
        <div className="flex justify-end">
          <KeypadToggle mode={mode} onChange={setMode} />
        </div>
        <PasswordField
          id="unlock-passcode"
          label="Passcode"
          value={password}
          onChange={setPassword}
          placeholder={mode === 'digits' ? 'Enter your PIN' : 'Enter your passcode'}
          autoComplete="current-password"
          onEnter={doPassword}
          mode={mode}
          maxLength={MAX_PIN_LENGTH}
          invalid={Boolean(error)}
          hint={locked ? `Locked for ${formatWait(waitSeconds)}` : undefined}
        />

        <motion.button
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={doPassword}
          disabled={busy || locked || !isValidPasscode(password)}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-on-primary shadow-card transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
          {busy ? 'Unlocking…' : locked ? `Locked · ${formatWait(waitSeconds)}` : 'Unlock'}
        </motion.button>

        {biometricEnabled && (
          <motion.button
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={doBiometric}
            disabled={locked}
            className="flex h-12 w-full items-center justify-center gap-2.5 rounded-full border border-outline-variant/70 bg-surface text-[15px] font-semibold text-on-surface shadow-card transition hover:bg-surface-container-low disabled:opacity-50"
          >
            <Fingerprint className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
            Use biometric / screen lock
          </motion.button>
        )}
      </div>
    </Shell>
  );
}

export default function AuthPage() {
  const { status, user } = useAuth();

  if (status === 'unlocked' || user) return <Navigate to="/dashboard" replace />;

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-accent" aria-label="Loading" />
      </div>
    );
  }

  return status === 'onboarding' ? <CreateAccountForm /> : <UnlockForm />;
}
