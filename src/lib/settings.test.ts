import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  readCustomTests,
  writeCustomTests,
  migrateSettings,
  sanitizeNotificationPrefs,
  SETTINGS_STORAGE_KEY,
  CUSTOM_TESTS_STORAGE_KEY,
} from './settings';
import { DEFAULT_NOTIFICATION_PREFS } from './notification-engine';

beforeEach(() => {
  localStorage.clear();
});

describe('readSettings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('migrates legacy margin values', () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ reportMarginTop: 20, reportMarginBottom: 10, reportMarginLeft: 15 }),
    );
    const s = readSettings();
    expect(s.reportMarginTop).toBe(50);
    expect(s.reportMarginBottom).toBe(20);
    expect(s.reportMarginLeft).toBe(8);
  });

  it('survives corrupted JSON', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{not json');
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges stored values over defaults', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ labName: 'My Lab' }));
    const s = readSettings();
    expect(s.labName).toBe('My Lab');
    expect(s.themeId).toBe(DEFAULT_SETTINGS.themeId);
  });
});

describe('writeSettings', () => {
  it('persists settings and dispatches the settings-updated event', () => {
    let fired = 0;
    window.addEventListener('settings-updated', () => fired++);
    writeSettings({ ...DEFAULT_SETTINGS, labName: 'Saved Lab' });
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!).labName).toBe('Saved Lab');
    expect(fired).toBe(1);
  });

  it('applies the selected palette + mode as data attributes on <html>', () => {
    writeSettings({ ...DEFAULT_SETTINGS, themeId: 'teal', themeMode: 'dark' });
    expect(document.documentElement.getAttribute('data-palette')).toBe('teal');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    // Colors themselves live in CSS blocks ([data-palette] / [data-theme]),
    // so applyTheme must NOT leave inline var overrides behind.
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
  });
});

describe('custom tests storage', () => {
  it('round-trips through write/read', () => {
    const tests = [{ id: 'x', name: 'X TEST', category: 'C' }];
    writeCustomTests(tests as any);
    expect(localStorage.getItem(CUSTOM_TESTS_STORAGE_KEY)).toBeTruthy();
    expect(readCustomTests()).toEqual(tests);
  });

  it('returns empty list on corrupted data', () => {
    localStorage.setItem(CUSTOM_TESTS_STORAGE_KEY, 'nope[');
    expect(readCustomTests()).toEqual([]);
  });
});

describe('migrateSettings', () => {
  it('fills in font-size fallbacks from the legacy shared field', () => {
    const m = migrateSettings({ tableBodyFontSize: 11 });
    expect(m.reportTableBodyFontSize).toBe(11);
    expect(m.shareTableBodyFontSize).toBe(11);
  });

  it('rejects unknown appearance values instead of letting them stick', () => {
    const m = migrateSettings({ textSize: 'huge', reduceMotion: 'yes', cornerStyle: 'pointy' });
    expect(m.textSize).toBe(DEFAULT_SETTINGS.textSize);
    expect(m.reduceMotion).toBe(false);
    expect(m.cornerStyle).toBe('rounded');
  });

  it('grows notification prefs out of the two legacy toggles', () => {
    const m = migrateSettings({ emailNotifications: false, smsNotifications: true });
    const prefs = m.notificationPrefs as ReturnType<typeof sanitizeNotificationPrefs>;
    expect(prefs.channels.email).toBe(false);
    expect(prefs.channels.sms).toBe(true);
    expect(prefs.categories).toEqual(DEFAULT_NOTIFICATION_PREFS.categories);
  });
});

describe('appearance prefs', () => {
  it('round-trips valid values and applies them as <html> attributes', () => {
    writeSettings({
      ...DEFAULT_SETTINGS,
      textSize: 'lg',
      reduceMotion: true,
      cornerStyle: 'sharp',
    });
    const reread = readSettings();
    expect(reread.textSize).toBe('lg');
    expect(reread.reduceMotion).toBe(true);
    expect(reread.cornerStyle).toBe('sharp');
    expect(document.documentElement.getAttribute('data-text-size')).toBe('lg');
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduced');
    expect(document.documentElement.getAttribute('data-radius')).toBe('sharp');
  });

  it('falls back to default attributes for default prefs', () => {
    writeSettings({ ...DEFAULT_SETTINGS });
    expect(document.documentElement.getAttribute('data-text-size')).toBe('md');
    expect(document.documentElement.getAttribute('data-motion')).toBe('full');
    expect(document.documentElement.getAttribute('data-radius')).toBe('rounded');
  });
});

describe('sanitizeNotificationPrefs', () => {
  it('repairs a partially-synced prefs object', () => {
    const prefs = sanitizeNotificationPrefs({ overdueHours: 12, categories: { due: false } });
    expect(prefs.overdueHours).toBe(12);
    expect(prefs.categories.due).toBe(false);
    // Keys a newer version added are filled from the defaults, never undefined.
    expect(prefs.channels.whatsapp).toBe(DEFAULT_NOTIFICATION_PREFS.channels.whatsapp);
    expect(prefs.draftHours).toBe(DEFAULT_NOTIFICATION_PREFS.draftHours);
  });

  it('clamps a hand-edited threshold instead of silencing alerts', () => {
    expect(sanitizeNotificationPrefs({ overdueHours: 99999 }).overdueHours).toBe(336);
    expect(sanitizeNotificationPrefs({ dueDays: 0 }).dueDays).toBe(1);
    expect(sanitizeNotificationPrefs({ draftHours: 'abc' }).draftHours).toBe(
      DEFAULT_NOTIFICATION_PREFS.draftHours,
    );
  });

  it('treats a non-object value as no preferences at all', () => {
    expect(sanitizeNotificationPrefs('nope')).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(sanitizeNotificationPrefs(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });
});

describe('notification prefs round-trip through storage', () => {
  it('survives a write and read', () => {
    const prefs = sanitizeNotificationPrefs({ dueDays: 3, channels: { whatsapp: true } });
    writeSettings({ ...DEFAULT_SETTINGS, notificationPrefs: prefs });
    const reread = readSettings();
    expect(reread.notificationPrefs.dueDays).toBe(3);
    expect(reread.notificationPrefs.channels.whatsapp).toBe(true);
  });

  it('keeps the legacy booleans mirrored so older documents stay truthful', () => {
    const prefs = sanitizeNotificationPrefs({ channels: { email: false, sms: true } });
    writeSettings({ ...DEFAULT_SETTINGS, notificationPrefs: prefs });
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!);
    expect(stored.emailNotifications).toBe(false);
    expect(stored.smsNotifications).toBe(true);
  });
});
