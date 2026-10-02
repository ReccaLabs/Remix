import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { Button } from './button';

describe('Button', () => {
  it('is a non-submitting button by default', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('can submit a form when asked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Log in</Button>
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('loading disables it, sets aria-busy and blocks clicks', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving…
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    // The spinner is decorative; the label stays the accessible name.
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is not busy when idle', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it('applies variant classes and keeps a touch-size minimum', () => {
    render(
      <Button variant="danger" size="sm">
        Delete
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button.className).toContain('bg-danger');
    expect(button.className).toContain('pointer-coarse:min-h-11');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <Button>Save</Button>
        <Button variant="secondary" loading>
          Saving…
        </Button>
      </div>,
    );
    await expectNoAxeViolations(container);
  });
});
