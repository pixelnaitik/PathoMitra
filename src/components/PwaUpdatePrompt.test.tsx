import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('../lib/desktop-bridge', () => ({ isDesktopShell: () => false }));

import { PwaUpdatePrompt } from './PwaUpdatePrompt';

class FakeWorker extends EventTarget {
  state = 'installed';
  postMessage = vi.fn();
}

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');

beforeEach(() => {
  const reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
  (window as unknown as { __reload: ReturnType<typeof vi.fn> }).__reload = reload;
});

afterEach(() => {
  cleanup();
  if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
  Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.restoreAllMocks();
});

describe('PwaUpdatePrompt lifecycle', () => {
  it('does not reload for first-worker control and reloads only after an accepted update', async () => {
    const worker = new FakeWorker();
    const registration = {
      installing: null,
      waiting: worker,
      update: vi.fn().mockResolvedValue(undefined),
    };
    const serviceWorker = new EventTarget() as EventTarget & {
      register: ReturnType<typeof vi.fn>;
    };
    serviceWorker.register = vi.fn().mockResolvedValue(registration);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker,
    });

    render(<PwaUpdatePrompt />);
    const apply = await screen.findByRole('button', { name: 'Reload and update' });
    const reload = (window as unknown as { __reload: ReturnType<typeof vi.fn> }).__reload;

    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(apply);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
