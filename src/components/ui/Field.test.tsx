import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Field, TextInput } from './Field';

afterEach(cleanup);

describe('Field', () => {
  it('associates the label, hint, required state, and error with the control', () => {
    render(
      <Field label="Patient name" hint="Use the registered name" error="Name is required" required>
        <TextInput />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: /Patient name/ });
    const error = screen.getByRole('alert');
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    expect(error).toHaveTextContent('Name is required');
  });

  it('associates a hint when there is no error', () => {
    render(
      <Field label="Phone" hint="Include country code">
        <TextInput />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Phone' });
    const hint = screen.getByText('Include country code');
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
    expect(input).not.toHaveAttribute('aria-invalid');
  });
});
