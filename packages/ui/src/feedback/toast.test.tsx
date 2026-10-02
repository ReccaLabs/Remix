import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { ToastProvider, useToast, type ToastOptions } from './toast';

function Trigger({ options, label = 'Show' }: { options: ToastOptions; label?: string }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(options)}>
      {label}
    </button>
  );
}

function setup(options: ToastOptions, duration?: number) {
  return render(
    <ToastProvider dismissLabel="Dismiss" regionLabel="Notifications" duration={duration}>
      <Trigger options={options} />
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('announces through a polite live region that exists before the toast', async () => {
    const user = userEvent.setup();
    setup({
      title: 'Payment recorded',
      description: 'Receipt R-1042 sent by SMS.',
      tone: 'success',
    });
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();

    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(status).toHaveTextContent('Payment recorded Receipt R-1042 sent by SMS.');
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region).toHaveTextContent('Payment recorded');
  });

  it('announces errors assertively and keeps them until dismissed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup({ title: 'Payment failed', tone: 'danger' }, 1000);

    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Payment failed');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region).toHaveTextContent('Payment failed');

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(region).not.toHaveTextContent('Payment failed');
  });

  it('auto-hides after the duration, pausing while hovered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup({ title: 'Saved' }, 3000);
    await user.click(screen.getByRole('button', { name: 'Show' }));
    const region = screen.getByRole('region', { name: 'Notifications' });
    const card = region.querySelector('li');
    expect(card).not.toBeNull();

    await user.hover(card as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(region).toHaveTextContent('Saved');

    await user.unhover(card as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(region).not.toHaveTextContent('Saved');
  });

  it('runs the action and closes on Escape', async () => {
    const user = userEvent.setup();
    const undo = vi.fn();
    setup({ title: 'Student archived', action: { label: 'Undo', onClick: undo } });
    await user.click(screen.getByRole('button', { name: 'Show' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region).not.toHaveTextContent('Student archived');

    await user.click(screen.getByRole('button', { name: 'Show' }));
    screen.getByRole('button', { name: 'Dismiss' }).focus();
    await user.keyboard('{Escape}');
    expect(region).not.toHaveTextContent('Student archived');
  });

  it('throws a clear error outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Trigger options={{ title: 'x' }} />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });

  it('has no axe violations with a toast showing', async () => {
    const user = userEvent.setup();
    const { container } = setup({ title: 'Saved', tone: 'success' });
    await user.click(screen.getByRole('button', { name: 'Show' }));
    await expectNoAxeViolations(container);
  });
});
