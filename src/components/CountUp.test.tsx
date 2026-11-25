import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CountUp from './CountUp';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CountUp accessibility', () => {
  it('keeps one stable live value while the animated copy is hidden', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });

    const { rerender } = render(<CountUp value={1200} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('1,200');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(containerText()).toBe('1,200');

    rerender(<CountUp value={2450} />);
    expect(screen.getByRole('status')).toHaveTextContent('2,450');
    expect(containerText()).toBe('2,450');
  });
});

function containerText(): string | null {
  return document.querySelector('[aria-hidden="true"]')?.textContent ?? null;
}
