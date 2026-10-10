import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import {
  User,
  Building2,
  Bell,
  Shield,
  ShieldCheck,
  KeyRound,
  Save,
  Check,
  FileSignature,
  Activity,
  Plus,
  Trash2,
  Palette,
  Sun,
  Moon,
  Undo2,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  FileDown,
  AlertTriangle,
  DatabaseBackup,
} from 'lucide-react';
import { useAuth, isValidPasscode, PIN_ERROR } from '../../contexts/AuthContext';
import { verifyAccountPassword } from '../../lib/local-account';
import { THEME_OPTIONS, applyAppearance, applyTheme } from '../../lib/theme';
import {
  SegmentedControl,
  Switch,
  Sheet,
  Button,
  IconButton,
  ConfirmSheet,
  useToast,
} from '../../components/ui';
import AvatarIcon from '../../components/AvatarIcon';
import { avatarPresetLabel } from '../../components/avatarPresets';
import ReportPreview from '../../components/ReportPreview';
import { ReportSettingsPanel } from '../../components/ReportSettingsPanel';
import { PrivacyPolicySheet } from '../../components/PrivacyPolicy';
import DataBackupPanel from '../../components/DataBackupPanel';
import {
  readSettings,
  writeSettings,
  readCustomTests,
  writeCustomTests,
  type LabSettings,
} from '../../lib/settings';
import { RECOMMENDED_LAYOUT_DEFAULTS } from '../../lib/report-layout';
import { buildReportLegalLines } from '../../lib/report-compliance';
import {
  CATEGORY_LABEL,
  resolvePrefs,
  type NotificationCategory,
  type NotificationPrefsPatch,
} from '../../lib/notification-engine';
import { useEditHistory, useHistoryShortcuts } from '../../lib/use-edit-history';
import { openSampleReportPdf } from '../../lib/report-sample-pdf';
import type { PathologyTest } from '../../lib/pathology-tests';

/** Keys that make up the report-layout slice of the settings — the part the
 * templates tab edits, previews, saves and undoes. */
const TEMPLATE_SETTING_KEYS = [
  'reportTemplate',
  'shareTemplate',
  'reportMarginTop',
  'reportMarginBottom',
  'reportMarginLeft',
  'reportMarginRight',
  'shareMarginTop',
  'shareMarginBottom',
  'shareMarginLeft',
  'shareMarginRight',
  'reportTableBodyFontSize',
  'shareTableBodyFontSize',
  'tableBodyFontSize',
  'reportTitleFontSize',
  'patientInfoFontSize',
  'patientLineHeight',
  'reportSectionGap',
  'tableHeaderFontSize',
  'tableCellPadding',
  'notesFontSize',
  'footerFontSize',
  'sharingTemplateImage',
] as const;

type TemplateSettings = Pick<LabSettings, (typeof TEMPLATE_SETTING_KEYS)[number]>;

const pickTemplateSettings = (s: LabSettings): TemplateSettings => {
  const out = {} as TemplateSettings;
  for (const k of TEMPLATE_SETTING_KEYS) (out as Record<string, unknown>)[k] = s[k];
  return out;
};

/** The four alert families the engine can produce, in the order the panel shows them. */
const ALERT_TYPES: { value: NotificationCategory; label: string; help: string }[] = [
  {
    value: 'overdue',
    label: CATEGORY_LABEL.overdue,
    help: 'A patient whose collected tests still have no report.',
  },
  {
    value: 'draft',
    label: CATEGORY_LABEL.draft,
    help: 'A report saved as draft that was never signed and issued.',
  },
  {
    value: 'amended',
    label: CATEGORY_LABEL.amended,
    help: 'An already-issued report that somebody changed afterwards.',
  },
  {
    value: 'due',
    label: CATEGORY_LABEL.due,
    help: 'An invoice still marked pending after its payment window.',
  },
];

type ThresholdKey = 'overdueHours' | 'draftHours' | 'dueDays';

/** Editable lateness thresholds, bounded exactly like `sanitizeNotificationPrefs`. */
const THRESHOLD_FIELDS: {
  key: ThresholdKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  fallback: number;
  help: string;
}[] = [
  {
    key: 'overdueHours',
    label: 'Awaiting report',
    unit: 'hrs',
    min: 1,
    max: 336,
    fallback: 24,
    help: 'Tests collected, no report issued.',
  },
  {
    key: 'draftHours',
    label: 'Unissued draft',
    unit: 'hrs',
    min: 1,
    max: 336,
    fallback: 24,
    help: 'Draft untouched since its last edit.',
  },
  {
    key: 'dueDays',
    label: 'Payment due',
    unit: 'days',
    min: 1,
    max: 90,
    fallback: 7,
    help: 'Invoice left pending after issue.',
  },
];

/** Patch that changes one threshold without touching the other two. */
const thresholdPatch = (key: ThresholdKey, value: number): NotificationPrefsPatch =>
  key === 'overdueHours'
    ? { overdueHours: value }
    : key === 'draftHours'
      ? { draftHours: value }
      : { dueDays: value };

/** Patch that changes one category flag without touching its siblings. */
const categoryPatch = (category: NotificationCategory, on: boolean): NotificationPrefsPatch => ({
  categories: { [category]: on } as NotificationPrefsPatch['categories'],
});

/** Patch that changes one delivery channel flag. */
const channelPatch = (
  channel: 'email' | 'sms' | 'whatsapp' | 'desktop',
  on: boolean,
): NotificationPrefsPatch => ({
  channels: { [channel]: on } as NotificationPrefsPatch['channels'],
});

/** Section ids, in nav order — also what a deep link is validated against. */
const SETTINGS_SECTIONS = [
  'profile',
  'theme',
  'organization',
  'templates',
  'tests',
  'notifications',
  'security',
  'data',
];

export default function SettingsPage({
  initialSection,
}: {
  /**
   * Section to open, from `?section=` — used by the Notification Center's
   * "Alert settings" link. Unknown values fall back to the profile.
   */
  initialSection?: string | null;
}) {
  const {
    user,
    role,
    eraseAllData,
    changePassword,
    setBiometric,
    biometricEnabled,
    biometricAvailable,
  } = useAuth();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState(() =>
    initialSection && SETTINGS_SECTIONS.includes(initialSection) ? initialSection : 'profile',
  );
  const [activeTemplateTab, setActiveTemplateTab] = useState<'print' | 'share'>('print');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);
  const [openingSample, setOpeningSample] = useState(false);
  // Security tab: privacy-policy modal + account/data erasure (Play requires a
  // user-reachable deletion path — see Settings → Security → Danger zone).
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [erasing, setErasing] = useState(false);

  const handleEraseAllData = useCallback(async () => {
    setErasing(true);
    try {
      await eraseAllData();
      toast.success('All data erased and account deleted.');
    } catch {
      toast.error('Could not erase data. Please try again.');
    } finally {
      setErasing(false);
      setEraseOpen(false);
    }
  }, [eraseAllData, toast]);

  const [formData, setFormData] = useState<LabSettings>(() => ({
    ...readSettings(),
    name: user?.displayName || '',
    email: user?.email || '',
    avatarSeed: user?.photoURL || readSettings().avatarSeed || 'default',
  }));

  /**
   * The exact lines the report footer will print for the *unsaved* form, so the
   * "Will print as" preview cannot drift from what `lib/report-layout` resolves
   * at export time — both call the same builder.
   */
  const formLegal = buildReportLegalLines(formData);

  // ---- Passcode change --------------------------------------------------
  // This panel used to be inert markup: uncontrolled inputs and a button with no
  // handler. An operator who believed they had rotated their passcode here had
  // changed nothing, which for a device holding patient records is worse than not
  // offering the control at all. Wired to the real local-account path now.
  const [currentPasscode, setCurrentPasscode] = useState('');
  const [newPasscode, setNewPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [passcodeBusy, setPasscodeBusy] = useState(false);

  const handlePasscodeChange = useCallback(async () => {
    setPasscodeError(null);
    if (!currentPasscode || !newPasscode) {
      setPasscodeError('Enter your current passcode and the new one.');
      return;
    }
    if (!isValidPasscode(newPasscode)) {
      setPasscodeError(PIN_ERROR);
      return;
    }
    if (newPasscode !== confirmPasscode) {
      setPasscodeError('New passcodes do not match.');
      return;
    }
    if (newPasscode === currentPasscode) {
      setPasscodeError('Choose a passcode different from the current one.');
      return;
    }
    setPasscodeBusy(true);
    try {
      // Checked through the same path as unlocking, so repeated guesses here run
      // into the same exponential backoff rather than being a free oracle.
      const verified = await verifyAccountPassword(currentPasscode);
      if (!verified.ok) {
        setPasscodeError(
          verified.reason === 'locked'
            ? `Too many attempts — try again in ${Math.ceil(verified.waitSeconds / 60)} min.`
            : 'Current passcode is incorrect.',
        );
        return;
      }
      await changePassword(newPasscode);
      setCurrentPasscode('');
      setNewPasscode('');
      setConfirmPasscode('');
      toast.success('Passcode updated.');
    } catch (e) {
      setPasscodeError((e as Error).message || 'Could not update the passcode.');
    } finally {
      setPasscodeBusy(false);
    }
  }, [currentPasscode, newPasscode, confirmPasscode, changePassword, toast]);

  const [biometricBusy, setBiometricBusy] = useState(false);
  const handleBiometricToggle = useCallback(
    async (enabled: boolean) => {
      setBiometricBusy(true);
      try {
        await setBiometric(enabled);
        toast.success(enabled ? 'Biometric unlock enabled.' : 'Biometric unlock turned off.');
      } catch (e) {
        toast.error((e as Error).message || 'Could not change biometric unlock.');
      } finally {
        setBiometricBusy(false);
      }
    },
    [setBiometric, toast],
  );

  const [showAvatarOptions, setShowAvatarOptions] = useState(false);
  const avatarOptions = [
    'microscope',
    'droplets',
    'activity',
    'flask',
    'syringe',
    'dna',
    'stethoscope',
    'pill',
    user?.photoURL?.startsWith('http') ? user.photoURL : 'user',
  ];

  const [customTests, setCustomTests] = useState<PathologyTest[]>(() => readCustomTests());

  const [newTestDraft, setNewTestDraft] = useState({
    isGroup: false,
    name: '',
    category: '',
    unit: '',
    rangeLower: '',
    rangeUpper: '',
    includedTestsStr: '',
  });

  const {
    themeId,
    themeMode,
    textSize,
    reduceMotion,
    reduceTransparency,
    cornerStyle,
    hapticsEnabled,
  } = formData;
  useEffect(() => {
    if (themeId) applyTheme(themeId, themeMode === 'dark' ? 'dark' : 'light');
    applyAppearance({
      textSize,
      reduceMotion,
      reduceTransparency,
      cornerStyle,
      hapticsEnabled,
    });
  }, [themeId, themeMode, textSize, reduceMotion, reduceTransparency, cornerStyle, hapticsEnabled]);

  // A second deep link while this page is already mounted (opening another
  // alert from the bell) must still switch sections.
  useEffect(() => {
    if (initialSection && SETTINGS_SECTIONS.includes(initialSection)) {
      setActiveTab(initialSection);
    }
  }, [initialSection]);

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      writeSettings(formData);
      writeCustomTests(customTests);
      setSavedSnapshot(readSettings());
      templateHistory.reset(pickTemplateSettings(formData));
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 800);
  };

  // ---- Report-template editing: history, dirty state, sample PDF ----------
  const [savedSnapshot, setSavedSnapshot] = useState<LabSettings>(() => readSettings());
  const templateSlice = useMemo(() => pickTemplateSettings(formData), [formData]);
  const templateHistory = useEditHistory<TemplateSettings>(templateSlice);
  // Latest formData for event handlers (assigned in an effect, never during
  // render). History entries are pushed from handlers — never from inside a
  // state updater, which StrictMode double-invokes.
  const latestFormRef = useRef(formData);
  useEffect(() => {
    latestFormRef.current = formData;
  }, [formData]);
  useHistoryShortcuts({
    undo: templateHistory.undo,
    redo: templateHistory.redo,
  });

  // Undo/redo restore: `current` only changes when the cursor moves, so the
  // edit flow (push) never loops through this effect.
  useEffect(() => {
    setFormData(prev => {
      const cur = templateHistory.current;
      return JSON.stringify(cur) === JSON.stringify(pickTemplateSettings(prev))
        ? prev
        : { ...prev, ...cur };
    });
  }, [templateHistory.current]);

  const patchTemplate = useCallback(
    (patch: Partial<LabSettings>, commit: boolean) => {
      setFormData(prev => ({ ...prev, ...patch }));
      if (commit)
        templateHistory.push(pickTemplateSettings({ ...latestFormRef.current, ...patch }));
    },
    [templateHistory],
  );

  /**
   * Edit one slice of the notification preferences. `channels` and `categories`
   * are nested, so a partial patch is merged instead of replacing the group —
   * flipping SMS off must not switch WhatsApp on.
   */
  const patchPrefs = useCallback((patch: NotificationPrefsPatch) => {
    setFormData(prev => {
      const current = resolvePrefs(prev.notificationPrefs);
      return {
        ...prev,
        notificationPrefs: {
          ...current,
          ...patch,
          channels: { ...current.channels, ...(patch.channels ?? {}) },
          categories: { ...current.categories, ...(patch.categories ?? {}) },
        },
      };
    });
  }, []);

  /**
   * Desktop banners need the browser's permission, not just our preference — so
   * the toggle asks for it and reflects whatever the user actually answered.
   */
  const toggleDesktopChannel = useCallback(
    async (next: boolean) => {
      if (!next) {
        patchPrefs({ channels: { desktop: false } });
        return;
      }
      if (typeof Notification === 'undefined') {
        toast.error('This browser cannot show desktop notifications.');
        return;
      }
      const result = await Notification.requestPermission();
      patchPrefs({ channels: { desktop: result === 'granted' } });
      if (result !== 'granted') {
        toast.warning(
          result === 'denied'
            ? 'The browser is blocking notifications for this site. Allow it in your site settings first.'
            : 'Choose “Allow” in the browser prompt to get desktop banners.',
        );
      }
    },
    [patchPrefs, toast],
  );

  const notificationPrefs = resolvePrefs(formData.notificationPrefs);
  const desktopPermission =
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';

  const isDirty = useMemo(
    () =>
      JSON.stringify(pickTemplateSettings(formData)) !==
      JSON.stringify(pickTemplateSettings(savedSnapshot)),
    [formData, savedSnapshot],
  );

  const resetToRecommended = () => {
    const next = { ...latestFormRef.current, ...RECOMMENDED_LAYOUT_DEFAULTS };
    setFormData(next);
    templateHistory.push(pickTemplateSettings(next), true);
  };

  const handlePreviewPdf = async () => {
    setOpeningSample(true);
    try {
      // The panel's Print / Share choice decides which margins, template and
      // font sizes the sample must be drawn with — previewing the other one is
      // how the button used to disagree with the page on screen.
      const message = await openSampleReportPdf(formData, activeTemplateTab);
      if (message) toast.warning(message);
    } catch (err) {
      console.error('Could not build the sample PDF:', err);
      toast.error('Could not build the sample PDF. Check the margin values first.');
    } finally {
      setOpeningSample(false);
    }
  };

  // Leaving Report Templates with unsaved edits must not silently discard
  // them — ask first (simple, predictable; no other tab edits these fields).
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  const goToTab = (nextTab: string) => {
    if (activeTab === 'templates' && nextTab !== 'templates' && isDirty) {
      setDiscardTarget(nextTab);
      return;
    }
    setActiveTab(nextTab);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Sidebar Nav */}
        <div className="col-span-1 space-y-2">
          {[
            { id: 'profile', label: 'My Profile', icon: User },
            { id: 'theme', label: 'Theme Settings', icon: Palette },
            { id: 'organization', label: 'Lab Organization', icon: Building2 },
            { id: 'templates', label: 'Report Templates', icon: FileSignature },
            { id: 'tests', label: 'Custom Tests', icon: Activity },
            { id: 'notifications', label: 'Notifications', icon: Bell },
            { id: 'security', label: 'Security', icon: Shield },
            { id: 'data', label: 'Data & Diagnostics', icon: DatabaseBackup },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => goToTab(tab.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${
                activeTab === tab.id
                  ? 'bg-primary-container text-on-primary-container shadow-card'
                  : 'bg-surface-container-lowest hover:bg-surface-container-low text-on-surface-variant hover:text-primary border border-outline-variant/30'
              }`}
            >
              <tab.icon className="w-5 h-5 shrink-0" />
              <span className="font-bold text-sm">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="col-span-1 md:col-span-3">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-surface-container-lowest rounded-3xl p-8 border border-outline-variant/30 shadow-card"
          >
            {activeTab === 'profile' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-primary mb-1">My Profile</h3>
                  <p className="text-sm text-on-surface-variant">
                    Update your personal information and contact details.
                  </p>
                </div>

                <div className="flex items-center gap-6 pb-6 border-b border-outline-variant/20">
                  <div className="w-20 h-20 rounded-full bg-surface-container border border-outline-variant/30 overflow-hidden shadow-inner flex items-center justify-center">
                    <AvatarIcon seed={formData.avatarSeed} pad="p-3" />
                  </div>
                  <div className="relative">
                    <button
                      onClick={() => setShowAvatarOptions(!showAvatarOptions)}
                      className="px-4 py-2 bg-surface-container-low hover:bg-surface-container text-primary font-bold text-sm rounded-xl border border-outline-variant/30 transition"
                    >
                      Change Avatar
                    </button>
                    {showAvatarOptions && (
                      <div className="absolute top-full mt-2 left-0 w-64 bg-surface-container-lowest border border-outline-variant/30 rounded-2xl shadow-float z-50 p-4 grid grid-cols-3 gap-2">
                        {avatarOptions.map(seed => (
                          <button
                            key={seed}
                            title={avatarPresetLabel(seed)}
                            aria-label={avatarPresetLabel(seed)}
                            onClick={() => {
                              setFormData({ ...formData, avatarSeed: seed });
                              setShowAvatarOptions(false);
                            }}
                            className={`w-14 h-14 flex items-center justify-center rounded-full overflow-hidden border-2 transition-transform duration-150 hover:scale-105 active:scale-95 ${formData.avatarSeed === seed ? 'border-primary shadow-card' : 'border-transparent hover:border-outline-variant/60'}`}
                          >
                            <AvatarIcon seed={seed} pad="p-3" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 fold:grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label
                      htmlFor="profile-name"
                      className="text-xs font-black text-primary uppercase ml-1"
                    >
                      Full Name
                    </label>
                    <input
                      id="profile-name"
                      type="text"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-xl focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="profile-email"
                      className="text-xs font-black text-primary uppercase ml-1"
                    >
                      Email Address
                    </label>
                    <input
                      id="profile-email"
                      type="email"
                      disabled
                      value={formData.email}
                      className="w-full px-4 py-3 bg-surface-container border border-outline-variant/30 rounded-xl text-on-surface-variant cursor-not-allowed outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="profile-phone"
                      className="text-xs font-black text-primary uppercase ml-1"
                    >
                      Phone Number
                    </label>
                    <input
                      id="profile-phone"
                      type="tel"
                      value={formData.phone}
                      onChange={e => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+91 98765 43210"
                      className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-xl focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-black text-primary uppercase ml-1">Role</label>
                    <div className="w-full px-4 py-3 bg-surface-container border border-outline-variant/30 rounded-xl text-on-surface-variant capitalize">
                      {role || 'Staff'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'theme' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-primary mb-1">Theme Settings</h3>
                  <p className="text-sm text-on-surface-variant">
                    Personalize the workspace — appearance and accent palette update instantly.
                  </p>
                </div>

                {/* Appearance — light / dark */}
                <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div>
                      <p className="text-sm font-bold text-on-surface">Appearance</p>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Choose light or dark mode. Saved on this device.
                      </p>
                    </div>
                    <div className="w-full sm:w-56 sm:shrink-0">
                      <SegmentedControl
                        id="appearance"
                        aria-label="Color mode"
                        value={
                          (formData.themeMode === 'dark' ? 'dark' : 'light') as 'light' | 'dark'
                        }
                        onChange={v => setFormData({ ...formData, themeMode: v })}
                        items={[
                          { value: 'light', label: 'Light', icon: <Sun className="w-3.5 h-3.5" /> },
                          { value: 'dark', label: 'Dark', icon: <Moon className="w-3.5 h-3.5" /> },
                        ]}
                      />
                    </div>
                  </div>
                </div>

                {/* Comfort & accessibility — text scale, corners, motion */}
                <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-5 space-y-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div>
                      <p className="text-sm font-bold text-on-surface">Text size</p>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Scales interface text across the whole app.
                      </p>
                    </div>
                    <div className="w-full sm:w-56 sm:shrink-0">
                      <SegmentedControl
                        id="text-size"
                        aria-label="Text size"
                        value={formData.textSize}
                        onChange={v => setFormData({ ...formData, textSize: v })}
                        items={[
                          { value: 'sm', label: 'Small' },
                          { value: 'md', label: 'Default' },
                          { value: 'lg', label: 'Large' },
                        ]}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 border-t border-outline-variant/30 pt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div>
                      <p className="text-sm font-bold text-on-surface">Corner style</p>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Rounded or sharp corners on cards and controls.
                      </p>
                    </div>
                    <div className="w-full sm:w-56 sm:shrink-0">
                      <SegmentedControl
                        id="corner-style"
                        aria-label="Corner style"
                        value={formData.cornerStyle}
                        onChange={v => setFormData({ ...formData, cornerStyle: v })}
                        items={[
                          { value: 'rounded', label: 'Rounded' },
                          { value: 'sharp', label: 'Sharp' },
                        ]}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-t border-outline-variant/30 pt-5">
                    <div>
                      <p className="text-sm font-bold text-on-surface">Reduce motion</p>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Minimise animations and transitions everywhere.
                      </p>
                    </div>
                    <Switch
                      checked={!!formData.reduceMotion}
                      onChange={v => setFormData({ ...formData, reduceMotion: v })}
                      label="Reduce motion"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4 border-t border-outline-variant/30 pt-5">
                    <div>
                      <p className="text-sm font-bold text-on-surface">Reduce transparency</p>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Replace frosted blur with solid surfaces — lighter on older phones.
                      </p>
                    </div>
                    <Switch
                      checked={!!formData.reduceTransparency}
                      onChange={v => setFormData({ ...formData, reduceTransparency: v })}
                      label="Reduce transparency"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4 border-t border-outline-variant/30 pt-5">
                    <div>
                      <p className="text-sm font-bold text-on-surface">Haptic feedback</p>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Subtle vibration on taps and alerts (on supported devices).
                      </p>
                    </div>
                    <Switch
                      checked={formData.hapticsEnabled !== false}
                      onChange={v => setFormData({ ...formData, hapticsEnabled: v })}
                      label="Haptic feedback"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 fold:grid-cols-2 gap-4">
                  {THEME_OPTIONS.map(theme => {
                    const isSelected = (formData.themeId || 'navy') === theme.id;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => setFormData({ ...formData, themeId: theme.id })}
                        className={`p-5 rounded-2xl border text-left flex items-center justify-between transition duration-250 cursor-pointer ${
                          isSelected
                            ? 'border-primary bg-primary/5 ring-1 ring-primary shadow-card scale-[1.01]'
                            : 'border-outline-variant/30 bg-surface-container-lowest hover:bg-surface-container-low hover:border-primary/45'
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className="w-10 h-10 rounded-full border border-black/10 shadow-card flex items-center justify-center transition-transform"
                            style={{ backgroundColor: theme.swatches[1] }}
                          >
                            {isSelected && <Check className="w-5 h-5 text-white" />}
                          </div>
                          <div>
                            <span
                              className={`font-bold block text-sm ${isSelected ? 'text-primary' : 'text-on-surface'}`}
                            >
                              {theme.name}
                            </span>
                            <span className="text-xs text-on-surface-variant font-medium">
                              {(theme.id === 'navy' && 'Confident blue — the signature look') ||
                                (theme.id === 'teal' && 'Calm clinical teal for busy benches') ||
                                (theme.id === 'amethyst' && 'Refined violet with depth') ||
                                (theme.id === 'slate' && 'Neutral graphite, zero noise') ||
                                (theme.id === 'maroon' && 'Bold hematology crimson')}
                            </span>
                          </div>
                        </div>

                        <div className="flex gap-1 shrink-0 bg-surface-container/50 p-2 rounded-xl border border-outline-variant/10">
                          <span
                            className="w-4 h-4 rounded-full border border-black/5"
                            style={{ backgroundColor: theme.swatches[0] }}
                          />
                          <span
                            className="w-4 h-4 rounded-full border border-black/5"
                            style={{ backgroundColor: theme.swatches[1] }}
                          />
                          <span
                            className="w-4 h-4 rounded-full border border-black/5"
                            style={{ backgroundColor: theme.swatches[2] }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'organization' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-primary mb-1">Lab Organization</h3>
                  <p className="text-sm text-on-surface-variant">
                    Manage your laboratory details and facility information.
                  </p>
                </div>

                <div className="space-y-6">
                  <div className="space-y-1">
                    <label
                      htmlFor="lab-name"
                      className="text-xs font-black text-primary uppercase ml-1"
                    >
                      Laboratory Name
                    </label>
                    <input
                      id="lab-name"
                      type="text"
                      value={formData.labName}
                      onChange={e => setFormData({ ...formData, labName: e.target.value })}
                      className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-xl focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="lab-address"
                      className="text-xs font-black text-primary uppercase ml-1"
                    >
                      Physical Address
                    </label>
                    <textarea
                      id="lab-address"
                      value={formData.address}
                      onChange={e => setFormData({ ...formData, address: e.target.value })}
                      placeholder="Enter full lab address..."
                      className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-xl focus:border-accent focus:outline-none resize-none min-h-[100px]"
                    />
                  </div>
                </div>

                {/* Report credentials & legal footer.
                    PathLab OS cannot verify an accreditation or sign a report —
                    there is no signing service and no registry check. So the
                    accreditation line is opt-in, gated on an explicit
                    attestation, and prints nothing at all when unset. */}
                <div className="space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-5">
                  <div>
                    <h4 className="text-sm font-bold text-on-surface">Report footer credentials</h4>
                    <p className="text-xs text-on-surface-variant leading-relaxed mt-1">
                      What appears on every issued report under your laboratory name. Leave this
                      empty unless you personally hold the credential — the app prints exactly what
                      you enter here and nothing else.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="lab-licence-number"
                      className="text-xs font-black text-primary uppercase ml-1"
                    >
                      Lab Registration / Licence No.
                    </label>
                    <input
                      id="lab-licence-number"
                      type="text"
                      maxLength={120}
                      value={formData.licenceNumber}
                      onChange={e => setFormData({ ...formData, licenceNumber: e.target.value })}
                      placeholder="e.g. the number your state authority issued to this lab"
                      className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-xl focus:border-accent focus:outline-none"
                    />
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-outline-variant/40 bg-surface p-4">
                    <input
                      type="checkbox"
                      checked={formData.accreditationAttestedAt !== ''}
                      onChange={e => {
                        if (e.target.checked) {
                          setFormData({
                            ...formData,
                            accreditationAttestedAt: new Date().toISOString(),
                          });
                        } else {
                          // Claim withdrawn: clear the credential too, so a stale
                          // body/number can't keep printing after the tick is gone.
                          setFormData({
                            ...formData,
                            accreditationAttestedAt: '',
                            accreditationBody: '',
                            accreditationNumber: '',
                          });
                        }
                      }}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--md-sys-color-primary,#0a5ea6)]"
                      aria-describedby="accreditation-attestation-help"
                    />
                    <span
                      className="text-xs leading-relaxed text-on-surface"
                      id="accreditation-attestation-help"
                    >
                      I confirm this laboratory personally holds the accreditation entered below,
                      and I accept full responsibility for that claim appearing on issued patient
                      reports.
                    </span>
                  </label>

                  {formData.accreditationAttestedAt !== '' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label
                          htmlFor="lab-accreditation-body"
                          className="text-xs font-black text-primary uppercase ml-1"
                        >
                          Accrediting Body
                        </label>
                        <input
                          id="lab-accreditation-body"
                          type="text"
                          maxLength={120}
                          value={formData.accreditationBody}
                          onChange={e =>
                            setFormData({ ...formData, accreditationBody: e.target.value })
                          }
                          className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-xl focus:border-accent focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor="lab-accreditation-number"
                          className="text-xs font-black text-primary uppercase ml-1"
                        >
                          Accreditation No.
                        </label>
                        <input
                          id="lab-accreditation-number"
                          type="text"
                          maxLength={120}
                          value={formData.accreditationNumber}
                          onChange={e =>
                            setFormData({ ...formData, accreditationNumber: e.target.value })
                          }
                          className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-xl focus:border-accent focus:outline-none"
                        />
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl bg-surface-container-lowest p-3.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant mb-1.5">
                      Will print as
                    </p>
                    <div className="space-y-0.5 text-[11px] italic leading-relaxed text-on-surface-variant">
                      {[
                        formLegal.tagline,
                        formData.licenceNumber.trim()
                          ? `Registration no. ${formData.licenceNumber.trim()}`
                          : '',
                        formLegal.signer,
                        formLegal.disclaimer,
                      ]
                        .filter(Boolean)
                        .map(line => (
                          <p key={line} className="break-words">
                            {line}
                          </p>
                        ))}
                    </div>
                    {formData.accreditationAttestedAt !== '' &&
                      !formData.accreditationBody.trim() && (
                        <p className="mt-2 text-[10.5px] font-semibold text-warning">
                          Accreditation is ticked but no body and number are entered, so nothing
                          prints yet.
                        </p>
                      )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-8">
                <div>
                  <h3 className="text-xl font-bold text-primary mb-1">Notifications</h3>
                  <p className="text-sm text-on-surface-variant">
                    Alerts are computed from your own records — nothing is scheduled or pushed by a
                    server. Choose what the lab should be told about, how long it may take, and
                    where an alert can be sent from the bell in the header.
                  </p>
                </div>

                {/* --- What to alert on --- */}
                <section className="space-y-3">
                  <h4 className="text-xs font-black text-primary uppercase ml-1">Alert types</h4>
                  <div className="space-y-3">
                    {ALERT_TYPES.map(type => (
                      <div
                        key={type.value}
                        className="flex items-center justify-between gap-4 p-4 bg-surface-container-low border border-outline-variant/30 rounded-2xl"
                      >
                        <div className="min-w-0">
                          <h4 className="font-bold text-primary">{type.label}</h4>
                          <p className="text-xs text-on-surface-variant mt-1">{type.help}</p>
                        </div>
                        <Switch
                          checked={notificationPrefs.categories[type.value]}
                          onChange={v => patchPrefs(categoryPatch(type.value, v))}
                          label={`Alert me about ${type.label.toLowerCase()}`}
                        />
                      </div>
                    ))}
                  </div>
                </section>

                {/* --- Thresholds --- */}
                <section className="space-y-3">
                  <h4 className="text-xs font-black text-primary uppercase ml-1">
                    How long before something counts as late
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {THRESHOLD_FIELDS.map(field => (
                      <div key={field.key} className="space-y-1">
                        <label
                          htmlFor={`notification-${field.key}`}
                          className="text-xs font-black text-primary uppercase ml-1"
                        >
                          {field.label}
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id={`notification-${field.key}`}
                            type="number"
                            inputMode="numeric"
                            min={field.min}
                            max={field.max}
                            step={1}
                            value={notificationPrefs[field.key]}
                            onChange={e =>
                              patchPrefs(
                                thresholdPatch(field.key, Number(e.target.value) || field.fallback),
                              )
                            }
                            className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-xl focus:border-accent focus:outline-none"
                          />
                          <span className="text-xs font-bold text-on-surface-variant shrink-0">
                            {field.unit}
                          </span>
                        </div>
                        <p className="text-[11px] text-on-surface-variant ml-1">{field.help}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-on-surface-variant ml-1">
                    Anything past twice these limits is escalated to <strong>critical</strong> and
                    shows a red badge.
                  </p>
                </section>

                {/* --- Delivery --- */}
                <section className="space-y-3">
                  <h4 className="text-xs font-black text-primary uppercase ml-1">
                    Where alerts can be sent
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4 p-4 bg-surface-container-low border border-outline-variant/30 rounded-2xl">
                      <div className="min-w-0">
                        <h4 className="font-bold text-primary">Email</h4>
                        <p className="text-xs text-on-surface-variant mt-1">
                          {formData.email
                            ? `Composes the alert or the daily summary to ${formData.email}.`
                            : 'No email on this account — add one in My Profile first.'}
                        </p>
                      </div>
                      <Switch
                        checked={notificationPrefs.channels.email}
                        onChange={v => patchPrefs(channelPatch('email', v))}
                        label="Send alerts by email"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4 p-4 bg-surface-container-low border border-outline-variant/30 rounded-2xl">
                      <div className="min-w-0">
                        <h4 className="font-bold text-primary">SMS</h4>
                        <p className="text-xs text-on-surface-variant mt-1">
                          {formData.phone
                            ? `Opens your phone’s messaging app with the alert addressed to ${formData.phone}.`
                            : 'No lab phone saved — add one in My Profile to enable text delivery.'}
                        </p>
                      </div>
                      <Switch
                        checked={notificationPrefs.channels.sms}
                        onChange={v => patchPrefs(channelPatch('sms', v))}
                        label="Send alerts by SMS"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4 p-4 bg-surface-container-low border border-outline-variant/30 rounded-2xl">
                      <div className="min-w-0">
                        <h4 className="font-bold text-primary">WhatsApp</h4>
                        <p className="text-xs text-on-surface-variant mt-1">
                          {formData.phone
                            ? `Opens WhatsApp with the alert text ready to send to ${formData.phone}.`
                            : 'Uses the same lab phone number as SMS — add one in My Profile.'}
                        </p>
                      </div>
                      <Switch
                        checked={notificationPrefs.channels.whatsapp}
                        onChange={v => patchPrefs(channelPatch('whatsapp', v))}
                        label="Send alerts on WhatsApp"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4 p-4 bg-surface-container-low border border-outline-variant/30 rounded-2xl">
                      <div className="min-w-0">
                        <h4 className="font-bold text-primary">Desktop banners</h4>
                        <p className="text-xs text-on-surface-variant mt-1">
                          {desktopPermission === 'granted'
                            ? 'Allowed by the browser. Critical and warning alerts appear as banners while the dashboard is open.'
                            : desktopPermission === 'denied'
                              ? 'The browser is blocking notifications for this site. Allow them in your address-bar site settings, then switch this back on.'
                              : 'Asks the browser for permission when you switch this on.'}
                        </p>
                      </div>
                      <Switch
                        checked={notificationPrefs.channels.desktop}
                        onChange={toggleDesktopChannel}
                        disabled={
                          desktopPermission === 'unsupported' || desktopPermission === 'denied'
                        }
                        label="Show desktop banners"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-on-surface-variant ml-1 leading-relaxed">
                    Delivery uses your own mail, messaging or WhatsApp client — the lab never sends
                    anything on its own, and no result values are put into an SMS or chat message.
                  </p>
                </section>
              </div>
            )}

            {activeTab === 'templates' && (
              <div className="@container space-y-4">
                {/* Action bar — the only place save/undo/redo/reset live */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <SegmentedControl
                      id="report-template-tab"
                      aria-label="Report template type"
                      className="w-40 shrink-0 sm:w-60"
                      size="sm"
                      value={activeTemplateTab}
                      onChange={v => setActiveTemplateTab(v)}
                      items={[
                        { value: 'print', label: 'Print' },
                        { value: 'share', label: 'Share' },
                      ]}
                    />
                    <span
                      className={`whitespace-nowrap text-xs font-semibold ${isDirty ? 'text-warning' : 'text-on-surface-variant'}`}
                      aria-live="polite"
                    >
                      {isDirty ? '● Unsaved changes' : 'All changes saved'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <IconButton
                      label="Undo"
                      size="sm"
                      variant="neutral"
                      disabled={!templateHistory.canUndo}
                      onClick={templateHistory.undo}
                    >
                      <Undo2 className="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      label="Redo"
                      size="sm"
                      variant="neutral"
                      disabled={!templateHistory.canRedo}
                      onClick={templateHistory.redo}
                    >
                      <Redo2 className="h-4 w-4" />
                    </IconButton>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handlePreviewPdf}
                      loading={openingSample}
                    >
                      <FileDown className="h-4 w-4" /> Preview PDF
                    </Button>
                    <button
                      type="button"
                      onClick={resetToRecommended}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reset
                    </button>
                    <Button
                      size="sm"
                      variant="brand"
                      onClick={handleSave}
                      loading={saving}
                      disabled={saved}
                    >
                      {saved ? (
                        <>
                          <Check className="h-4 w-4" /> Saved
                        </>
                      ) : (
                        'Save'
                      )}
                    </Button>
                  </div>
                </div>

                {/* Side-by-side splits the remaining width roughly in half. The
                    old 1fr / 360-440px split starved the controls column: on a
                    1280px screen (sidebar + section nav already spent) the editor
                    collapsed to ~215px while the preview kept 440px. The 18rem
                    floor keeps the sliders legible; the preview re-fits itself to
                    whatever width is left.

                    Split on the COLUMN, not the viewport (`@container` is on the
                    wrapper above): the column has already paid for the nav rail, this
                    page's section nav and the card's own padding, so a viewport `xl:`
                    edge was 1280px of *window* for whatever width happened to be
                    left — it fired too early behind an expanded rail (a 616px column
                    starved both halves) and too late behind a collapsed one. `@xl` =
                    36rem = 576px of real editing width gets the split with a 15rem
                    controls floor; from `@2xl` (42rem) the 18rem floor takes over.
                    Below 576 the preview owns the column and the settings live in
                    the sheet — a 455px column cannot hold an A4 page and a slider.
                    Note the `1fr` split is weighted to the preview, which is the
                    point of the tab. */}
                <div className="grid grid-cols-1 items-start gap-6 @xl:grid-cols-[minmax(15rem,0.85fr)_minmax(0,1.15fr)] @2xl:grid-cols-[minmax(18rem,1fr)_minmax(0,1fr)]">
                  {/* Live preview first — it is the point of the whole tab */}
                  <div className="@xl:order-2 @xl:sticky @xl:top-6">
                    <ReportPreview
                      settings={formData}
                      mode={activeTemplateTab}
                      onModeChange={m => setActiveTemplateTab(m)}
                      onPreviewPdf={handlePreviewPdf}
                      onMarginChange={(patch, commit) => patchTemplate(patch, commit)}
                    />
                  </div>

                  {/* Wide column: controls inline */}
                  <div className="hidden @xl:order-1 @xl:block">
                    <ReportSettingsPanel
                      settings={formData}
                      mode={activeTemplateTab}
                      onChange={patch => patchTemplate(patch, false)}
                      onCommit={patch => patchTemplate(patch, true)}
                    />
                  </div>

                  {/* Narrow column: preview owns the screen, settings live in a sheet */}
                  <div className="@xl:hidden">
                    <Button
                      fullWidth
                      size="lg"
                      variant="primary"
                      onClick={() => setSettingsSheetOpen(true)}
                    >
                      <SlidersHorizontal className="h-4 w-4" /> Edit layout
                      {isDirty && (
                        <span className="ml-1 h-2 w-2 rounded-full bg-warning" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>

                <Sheet
                  open={settingsSheetOpen}
                  onClose={() => setSettingsSheetOpen(false)}
                  title={activeTemplateTab === 'print' ? 'Print template' : 'Share template'}
                  description="Changes appear live on the report behind this panel."
                  width="md"
                  footer={
                    <div className="flex items-center gap-3">
                      <Button variant="ghost" size="md" onClick={resetToRecommended}>
                        <RotateCcw className="h-4 w-4" /> Reset
                      </Button>
                      <Button
                        className="flex-1"
                        size="lg"
                        variant="brand"
                        onClick={() => {
                          handleSave();
                          setSettingsSheetOpen(false);
                        }}
                        loading={saving}
                      >
                        {saved ? 'Saved' : isDirty ? 'Save changes' : 'Done'}
                      </Button>
                    </div>
                  }
                >
                  <ReportSettingsPanel
                    settings={formData}
                    mode={activeTemplateTab}
                    onChange={patch => patchTemplate(patch, false)}
                    onCommit={patch => patchTemplate(patch, true)}
                  />
                </Sheet>
              </div>
            )}

            {activeTab === 'tests' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-primary mb-1">Custom Tests</h3>
                  <p className="text-sm text-on-surface-variant">
                    Add new individual tests or test groups (like CBC).
                  </p>
                </div>

                <div className="space-y-4">
                  {customTests.map((test, idx) => (
                    <div
                      key={idx}
                      className="p-4 border border-outline-variant/30 rounded-2xl bg-surface-container-low flex justify-between items-start"
                    >
                      <div>
                        <h4 className="font-bold text-primary flex items-center gap-2">
                          {test.name}{' '}
                          {test.isGroup && (
                            <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                              Group
                            </span>
                          )}
                        </h4>
                        <p className="text-xs text-on-surface-variant mt-1">
                          Category: {test.category}
                        </p>
                        {!test.isGroup && test.unit && (
                          <p className="text-xs text-on-surface-variant">Unit: {test.unit}</p>
                        )}
                        {!test.isGroup && test.ranges?.general?.text && (
                          <p className="text-xs text-on-surface-variant">
                            Range: {test.ranges.general.text}
                          </p>
                        )}
                        {test.isGroup && (
                          <p className="text-xs text-on-surface-variant mt-1">
                            Includes: {test.includedTests?.join(', ')}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => setCustomTests(tests => tests.filter((_, i) => i !== idx))}
                        className="text-error hover:bg-error-container p-2 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {customTests.length === 0 && (
                    <div className="text-center py-8 text-on-surface-variant text-sm border-2 border-dashed border-outline-variant/30 rounded-2xl">
                      No custom tests added yet.
                    </div>
                  )}

                  <div className="mt-6 border-t border-outline-variant/20 pt-6">
                    <h4 className="font-bold text-primary mb-4">Add New Test</h4>
                    <div className="grid grid-cols-1 fold:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label
                          htmlFor="new-test-type"
                          className="text-xs font-black text-primary uppercase ml-1"
                        >
                          Type
                        </label>
                        <select
                          id="new-test-type"
                          value={newTestDraft.isGroup ? 'group' : 'individual'}
                          onChange={e =>
                            setNewTestDraft({
                              ...newTestDraft,
                              isGroup: e.target.value === 'group',
                            })
                          }
                          className="w-full px-4 py-3 bg-surface-container border border-outline-variant/30 rounded-xl outline-none"
                        >
                          <option value="individual">Individual Test</option>
                          <option value="group">Test Group</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor="new-test-name"
                          className="text-xs font-black text-primary uppercase ml-1"
                        >
                          Test/Group Name
                        </label>
                        <input
                          id="new-test-name"
                          type="text"
                          value={newTestDraft.name}
                          onChange={e => setNewTestDraft({ ...newTestDraft, name: e.target.value })}
                          className="w-full px-4 py-3 bg-surface-container border border-outline-variant/30 rounded-xl outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor="new-test-category"
                          className="text-xs font-black text-primary uppercase ml-1"
                        >
                          Category
                        </label>
                        <input
                          id="new-test-category"
                          type="text"
                          value={newTestDraft.category}
                          onChange={e =>
                            setNewTestDraft({ ...newTestDraft, category: e.target.value })
                          }
                          className="w-full px-4 py-3 bg-surface-container border border-outline-variant/30 rounded-xl outline-none"
                        />
                      </div>
                      {!newTestDraft.isGroup && (
                        <>
                          <div className="space-y-1">
                            <label
                              htmlFor="new-test-unit"
                              className="text-xs font-black text-primary uppercase ml-1"
                            >
                              Unit
                            </label>
                            <select
                              id="new-test-unit"
                              value={newTestDraft.unit}
                              onChange={e =>
                                setNewTestDraft({ ...newTestDraft, unit: e.target.value })
                              }
                              className="w-full px-4 py-3 bg-surface-container border border-outline-variant/30 rounded-xl outline-none"
                            >
                              <option value="">— None —</option>
                              <option value="%">%</option>
                              <option value="mg/dL">mg/dL</option>
                              <option value="g/dL">g/dL</option>
                              <option value="gm/dl">gm/dl</option>
                              <option value="gm%">gm%</option>
                              <option value="x10³/Cu.mm">x10³/Cu.mm</option>
                              <option value="mill/cumm">mill/cumm</option>
                              <option value="lakh/cumm">lakh/cumm</option>
                              <option value="fL">fL</option>
                              <option value="pg">pg</option>
                              <option value="titer">titer</option>
                              <option value="/HPF">/HPF</option>
                              <option value="/LPF">/LPF</option>
                              <option value="U/L">U/L</option>
                              <option value="unit/l">unit/l</option>
                              <option value="mm">mm</option>
                              <option value="min">min</option>
                              <option value="sec">sec</option>
                              <option value="IU/mL">IU/mL</option>
                              <option value="mm induration">mm induration</option>
                            </select>
                          </div>
                          <div
                            className="space-y-1 md:col-span-2"
                            role="group"
                            aria-labelledby="new-test-range-label"
                          >
                            <span
                              id="new-test-range-label"
                              className="block text-xs font-black text-primary uppercase ml-1"
                            >
                              Reference Range
                            </span>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="Lower"
                                aria-label="Reference range lower bound"
                                value={newTestDraft.rangeLower}
                                onChange={e =>
                                  setNewTestDraft({ ...newTestDraft, rangeLower: e.target.value })
                                }
                                className="w-full px-4 py-3 bg-surface-container border border-outline-variant/30 rounded-xl outline-none"
                              />
                              <span
                                className="flex items-center text-on-surface-variant"
                                aria-hidden="true"
                              >
                                -
                              </span>
                              <input
                                type="text"
                                placeholder="Higher"
                                aria-label="Reference range upper bound"
                                value={newTestDraft.rangeUpper}
                                onChange={e =>
                                  setNewTestDraft({ ...newTestDraft, rangeUpper: e.target.value })
                                }
                                className="w-full px-4 py-3 bg-surface-container border border-outline-variant/30 rounded-xl outline-none"
                              />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    {newTestDraft.isGroup && (
                      <div className="mt-4 space-y-1">
                        <label className="text-xs font-black text-primary uppercase ml-1">
                          Tests to Include (comma separated exact names)
                        </label>
                        <textarea
                          value={newTestDraft.includedTestsStr}
                          onChange={e =>
                            setNewTestDraft({ ...newTestDraft, includedTestsStr: e.target.value })
                          }
                          className="w-full px-4 py-3 bg-surface-container border border-outline-variant/30 rounded-xl outline-none resize-none min-h-[80px]"
                          placeholder="e.g. Hemoglobin, WBC Count"
                        />
                      </div>
                    )}
                    <button
                      onClick={() => {
                        if (!newTestDraft.name) return;

                        const test: any = {
                          id: `custom_${Date.now()}`,
                          name: newTestDraft.name,
                          category: newTestDraft.category || 'CUSTOM',
                          isGroup: newTestDraft.isGroup,
                        };

                        if (newTestDraft.isGroup) {
                          test.includedTests = newTestDraft.includedTestsStr
                            .split(',')
                            .map((s: string) => s.trim())
                            .filter(Boolean);
                        } else {
                          test.unit = newTestDraft.unit;
                          const rangeStr =
                            newTestDraft.rangeLower || newTestDraft.rangeUpper
                              ? `${newTestDraft.rangeLower || ''} - ${newTestDraft.rangeUpper || ''}`.replace(
                                  /^ - | - $/g,
                                  '',
                                )
                              : '';
                          test.ranges = { general: { text: rangeStr } };
                        }

                        setCustomTests([...customTests, test]);
                        setNewTestDraft({
                          isGroup: false,
                          name: '',
                          category: '',
                          unit: '',
                          rangeLower: '',
                          rangeUpper: '',
                          includedTestsStr: '',
                        });
                      }}
                      className="mt-4 flex items-center gap-2 px-4 py-3 bg-surface-container-low hover:bg-surface-container border border-outline-variant/30 rounded-xl font-bold text-primary transition text-sm"
                    >
                      <Plus className="w-4 h-4" /> Add to List
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-primary mb-1">Security</h3>
                  <p className="text-sm text-on-surface-variant">
                    Manage your passcode, auto-lock and account protection.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-surface-container-low border border-outline-variant/30 rounded-2xl space-y-4">
                    <h4 className="font-bold text-primary flex items-center gap-2">
                      <KeyRound className="w-4 h-4" aria-hidden="true" /> Change passcode
                    </h4>
                    {passcodeError && (
                      <p
                        role="alert"
                        className="rounded-xl bg-error-container px-3 py-2 text-xs font-semibold text-on-error-container"
                      >
                        {passcodeError}
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label
                          htmlFor="current-passcode"
                          className="mb-1 block text-[11px] font-bold uppercase text-on-surface-variant"
                        >
                          Current passcode
                        </label>
                        <input
                          id="current-passcode"
                          type="password"
                          autoComplete="current-password"
                          value={currentPasscode}
                          onChange={e => setCurrentPasscode(e.target.value)}
                          className="w-full px-4 py-2 bg-surface-container-lowest border border-outline-variant/30 rounded-xl outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="new-passcode"
                          className="mb-1 block text-[11px] font-bold uppercase text-on-surface-variant"
                        >
                          New passcode
                        </label>
                        <input
                          id="new-passcode"
                          type="password"
                          autoComplete="new-password"
                          value={newPasscode}
                          onChange={e => setNewPasscode(e.target.value)}
                          aria-describedby="passcode-policy-help"
                          className="w-full px-4 py-2 bg-surface-container-lowest border border-outline-variant/30 rounded-xl outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="confirm-passcode"
                          className="mb-1 block text-[11px] font-bold uppercase text-on-surface-variant"
                        >
                          Confirm new passcode
                        </label>
                        <input
                          id="confirm-passcode"
                          type="password"
                          autoComplete="new-password"
                          value={confirmPasscode}
                          onChange={e => setConfirmPasscode(e.target.value)}
                          className="w-full px-4 py-2 bg-surface-container-lowest border border-outline-variant/30 rounded-xl outline-none focus:border-accent"
                        />
                      </div>
                    </div>
                    <p id="passcode-policy-help" className="text-xs text-on-surface-variant">
                      {PIN_ERROR}
                    </p>
                    <button
                      type="button"
                      onClick={handlePasscodeChange}
                      disabled={passcodeBusy}
                      className="px-4 py-2 bg-primary-container hover:opacity-90 disabled:opacity-50 text-on-primary-container text-sm font-bold rounded-xl transition"
                    >
                      {passcodeBusy ? 'Updating…' : 'Update passcode'}
                    </button>
                  </div>

                  {/* Auto-lock. Before this the only way to lock the console was
                      the manual Log out button, so an abandoned desk kept every
                      patient record open indefinitely. */}
                  <div className="p-4 bg-surface-container-low border border-outline-variant/30 rounded-2xl space-y-3">
                    <h4 className="font-bold text-primary flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4" aria-hidden="true" /> Auto-lock
                    </h4>
                    <div>
                      <label
                        htmlFor="auto-lock-select"
                        className="mb-1 block text-[11px] font-bold uppercase text-on-surface-variant"
                      >
                        Re-lock after inactivity
                      </label>
                      <select
                        id="auto-lock-select"
                        value={String(formData.autoLockSeconds)}
                        onChange={e =>
                          setFormData({ ...formData, autoLockSeconds: Number(e.target.value) })
                        }
                        className="w-full px-4 py-2 bg-surface-container-lowest border border-outline-variant/30 rounded-xl outline-none focus:border-accent"
                      >
                        <option value="30">30 seconds</option>
                        <option value="120">2 minutes</option>
                        <option value="300">5 minutes</option>
                        <option value="900">15 minutes</option>
                        <option value="0">Never on idle</option>
                      </select>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      Swapping to another app always locks the console, whatever you choose here.
                      Save these settings to apply the new interval.
                    </p>
                  </div>

                  {biometricAvailable && (
                    <div className="flex items-center justify-between gap-4 p-4 bg-surface-container-low border border-outline-variant/30 rounded-2xl">
                      <div>
                        <h4 className="font-bold text-primary">Biometric / screen-lock unlock</h4>
                        <p className="text-xs text-on-surface-variant mt-1">
                          Verified by the operating system; your biometrics never leave the device
                          and are not stored by this app.
                        </p>
                      </div>
                      <Switch
                        checked={biometricEnabled}
                        disabled={biometricBusy}
                        onChange={v => void handleBiometricToggle(v)}
                        label="Use biometric or screen-lock unlock"
                      />
                    </div>
                  )}

                  {/* Screenshot capture (Android's FLAG_SECURE) was deliberately
                      removed at the lab's request — the screen is capturable, so
                      there is no toggle to offer. */}

                  <div className="p-4 bg-surface-container-low border border-outline-variant/30 rounded-2xl space-y-3">
                    <h4 className="font-bold text-primary flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4" /> Data &amp; privacy
                    </h4>
                    <p className="text-xs text-on-surface-variant">
                      Your records never leave this device — the app has no network access. Read how
                      your data and your patients&rsquo; health information are stored and
                      protected.
                    </p>
                    <button
                      type="button"
                      onClick={() => setPrivacyOpen(true)}
                      className="px-4 py-2 bg-primary-container hover:opacity-90 text-on-primary-container text-sm font-bold rounded-xl transition"
                    >
                      View Privacy Policy
                    </button>
                  </div>

                  <div className="p-4 bg-error-container/40 border border-error/30 rounded-2xl space-y-3">
                    <h4 className="font-bold text-error flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> Danger zone
                    </h4>
                    <p className="text-xs text-on-surface-variant">
                      Permanently delete this account and wipe the entire local clinical database —
                      every patient, report and invoice on this device. Export anything you need
                      first; this cannot be undone.
                    </p>
                    <button
                      type="button"
                      onClick={() => setEraseOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-error hover:brightness-110 text-on-error text-sm font-bold rounded-xl transition"
                    >
                      <Trash2 className="w-4 h-4" /> Erase all data &amp; delete account
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'data' && <DataBackupPanel />}

            {/* Save Button Footer — hidden on Report Templates, whose action
                bar owns saving (avoids two Save buttons on one screen), and on
                Data & Diagnostics, which has nothing to save. */}
            {activeTab !== 'templates' && activeTab !== 'data' && (
              <div className="mt-8 pt-6 border-t border-outline-variant/20 flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={saving || saved}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition ${
                    saved
                      ? 'bg-success-container text-on-success-container'
                      : 'bg-primary-container hover:opacity-90 text-on-primary-container shadow-card'
                  }`}
                >
                  {saving ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : saved ? (
                    <>
                      <Check className="w-5 h-5" /> Saved Successfully
                    </>
                  ) : (
                    <>
                      <Save className="w-5 h-5" /> Save Changes
                    </>
                  )}
                </button>
              </div>
            )}
          </motion.div>
        </div>
      </div>

      <ConfirmSheet
        open={discardTarget !== null}
        onClose={() => setDiscardTarget(null)}
        onConfirm={() => {
          if (discardTarget) setActiveTab(discardTarget);
          setDiscardTarget(null);
        }}
        title="Unsaved template changes"
        message="You have unsaved changes in Report Templates. Leaving this tab discards them — the live preview resets to your saved settings."
        confirmLabel="Discard changes"
      />

      <PrivacyPolicySheet open={privacyOpen} onClose={() => setPrivacyOpen(false)} />

      <ConfirmSheet
        open={eraseOpen}
        onClose={() => setEraseOpen(false)}
        onConfirm={handleEraseAllData}
        loading={erasing}
        title="Erase all data & delete account?"
        message="This permanently deletes your account and wipes every patient record, report and invoice stored on this device. It cannot be undone. Export anything you need first."
        confirmLabel="Erase everything"
      />
    </div>
  );
}
