import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { Checkbox } from './checkbox';
import { Field } from './field';
import { Input } from './input';
import { PasswordInput } from './password-input';
import { PhoneInput } from './phone-input';

describe('Field + Input', () => {
  it('labels the control and wires the hint', () => {
    render(
      <Field label="Full name" hint="As on the student ID">
        <Input name="name" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Full name' });
    expect(input).toHaveAccessibleDescription('As on the student ID');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks the control invalid and reads the error before the hint', () => {
    render(
      <Field label="Full name" hint="As on the student ID" error="Enter the student's name">
        <Input name="name" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Full name' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription("Enter the student's name As on the student ID");
    expect(input.className).toContain('border-danger');
  });

  it('keeps an id and describedby the app already set', () => {
    render(
      <>
        <p id="extra">Shown on receipts</p>
        <Field label="Email" error="Enter a valid email">
          <Input id="email" aria-describedby="extra" />
        </Field>
      </>,
    );
    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).toHaveAttribute('id', 'email');
    expect(input.getAttribute('aria-describedby')).toBe('email-error extra');
  });

  it('shows the localised optional marker in the label', () => {
    render(
      <Field label="Email" optional="optional">
        <Input />
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'Email (optional)' })).toBeInTheDocument();
  });

  it('has no axe violations, valid or invalid', async () => {
    const { container } = render(
      <form>
        <Field label="Full name" hint="As on the student ID">
          <Input />
        </Field>
        <Field label="Phone number" error="Enter a Sri Lankan mobile number">
          <PhoneInput />
        </Field>
        <Field label="Password">
          <PasswordInput showLabel="Show password" hideLabel="Hide password" />
        </Field>
      </form>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('PasswordInput', () => {
  it('toggles visibility with an accessible button and keeps the value', async () => {
    const user = userEvent.setup();
    render(
      <Field label="Password">
        <PasswordInput showLabel="Show password" hideLabel="Hide password" />
      </Field>,
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'current-password');
    await user.type(input, 'secret12');

    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-controls', input.id);
    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('secret12');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('does not submit the form when toggled', async () => {
    const user = userEvent.setup();
    let submitted = false;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitted = true;
        }}
      >
        <PasswordInput aria-label="Password" showLabel="Show" hideLabel="Hide" />
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(submitted).toBe(false);
  });
});

describe('PhoneInput', () => {
  it('uses the phone keypad and autofill, and announces the +94 prefix', () => {
    render(
      <Field label="Phone number" hint="e.g. 77 123 4567">
        <PhoneInput name="phone" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Phone number' });
    expect(input).toHaveAttribute('type', 'tel');
    expect(input).toHaveAttribute('inputmode', 'tel');
    expect(input).toHaveAttribute('autocomplete', 'tel');
    expect(input).toHaveAccessibleDescription('+94 e.g. 77 123 4567');
  });

  it('shows invalid state from the Field error', () => {
    render(
      <Field label="Phone number" error="Enter a Sri Lankan mobile number">
        <PhoneInput />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Phone number' });
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription('+94 Enter a Sri Lankan mobile number');
  });
});

describe('Checkbox', () => {
  it('is labelled, described and toggles from the label', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Checkbox label="Stay signed in for 30 days" hint="Only on your own phone" />,
    );
    const box = screen.getByRole('checkbox', { name: 'Stay signed in for 30 days' });
    expect(box).toHaveAccessibleDescription('Only on your own phone');
    await user.click(screen.getByText('Stay signed in for 30 days'));
    expect(box).toBeChecked();
    await expectNoAxeViolations(container);
  });
});
