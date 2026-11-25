import { beforeEach, describe, expect, it, vi } from 'vitest';

const guard = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock('../data/write-guard', () => ({ setRepositoryWriteGuard: guard.set }));

const KEY = 'pathlab_safe_mode_v1';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  guard.set.mockClear();
});

describe('safe mode state', () => {
  it('fails closed when the persisted state is malformed', async () => {
    localStorage.setItem(KEY, '{broken');
    const mod = await import('./safe-mode');
    expect(mod.isSafeMode()).toBe(true);
    expect(mod.safeModeReason()).toMatch(/could not be read/);
    expect(guard.set).toHaveBeenCalledWith(expect.any(Function));
  });

  it('loads a valid inactive state without blocking writes', async () => {
    localStorage.setItem(KEY, JSON.stringify({ active: false, reason: '' }));
    const mod = await import('./safe-mode');
    expect(mod.isSafeMode()).toBe(false);
    expect(guard.set).toHaveBeenLastCalledWith(null);
  });

  it('pauses writes with a bounded reason and resumes only through the explicit path', async () => {
    const mod = await import('./safe-mode');
    mod.enableSafeMode('x'.repeat(400));
    expect(mod.isSafeMode()).toBe(true);
    expect(mod.safeModeReason()).toHaveLength(300);
    expect(guard.set).toHaveBeenLastCalledWith(expect.any(Function));
    mod.disableSafeMode();
    expect(mod.isSafeMode()).toBe(false);
    expect(guard.set).toHaveBeenLastCalledWith(null);
  });
});
