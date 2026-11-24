import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useModalFocus } from './useModalFocus';

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    onClose();
  };
  const { onKeyDown } = useModalFocus({ open, onClose: close, panelRef: panel, initialFocusRef: first });
  return (
    <>
      <div id="main-content"><button onClick={() => setOpen(true)}>Open</button></div>
      {open && (
        <div ref={panel} role="dialog" aria-modal="true" onKeyDown={onKeyDown}>
          <button ref={first}>First</button>
          <button>Last</button>
        </div>
      )}
    </>
  );
}

describe('useModalFocus', () => {
  it('moves focus in, wraps Tab, closes on Escape, and restores focus', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();
    await act(async () => { fireEvent.click(trigger); });
    expect(document.getElementById('main-content')).toHaveAttribute('inert');
    await waitFor(() => expect(screen.getByRole('button', { name: 'First' })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('button', { name: 'First' }), { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Last' }), { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
