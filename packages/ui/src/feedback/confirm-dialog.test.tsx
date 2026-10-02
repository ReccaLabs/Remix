import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { ConfirmDialog, type ConfirmDialogProps } from './confirm-dialog';

type Extra = Partial<Pick<ConfirmDialogProps, 'variant' | 'requireText' | 'confirming'>>;

function Harness({ onConfirm = () => {}, ...extra }: Extra & { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Delete class
      </button>
      <ConfirmDialog
        open={open}
        title="Delete this class?"
        description="Students lose access to its lessons. This can't be undone."
        confirmLabel="Delete class"
        cancelLabel="Keep class"
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        {...extra}
      />
    </>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: 'Delete class' });
  await user.click(trigger);
  return { user, trigger, dialog: screen.getByRole('alertdialog') };
}

describe('ConfirmDialog', () => {
  it('is closed until opened, then labelled and described', async () => {
    render(<Harness />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const { dialog } = await openDialog();
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAccessibleName('Delete this class?');
    expect(dialog).toHaveAccessibleDescription(
      "Students lose access to its lessons. This can't be undone.",
    );
  });

  it('focuses Cancel first when destructive and returns focus on Escape', async () => {
    render(<Harness variant="destructive" />);
    const { user, trigger } = await openDialog();
    expect(screen.getByRole('button', { name: 'Keep class' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('focuses the confirm button first when not destructive', async () => {
    render(<Harness />);
    const { dialog } = await openDialog();
    const confirm = dialog.querySelectorAll('button')[1];
    expect(confirm).toHaveFocus();
  });

  it('confirm calls onConfirm; cancel does not', async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} variant="destructive" />);
    const first = await openDialog();
    await first.user.click(screen.getByRole('button', { name: 'Keep class' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    const second = await openDialog();
    const confirm = second.dialog.querySelectorAll('button')[1] as HTMLButtonElement;
    expect(confirm.className).toContain('bg-danger');
    await second.user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(second.trigger).toHaveFocus();
  });

  it('keeps confirm disabled until the name is typed', async () => {
    const onConfirm = vi.fn();
    render(
      <Harness
        onConfirm={onConfirm}
        variant="destructive"
        requireText={{ value: 'Physics 2027', label: 'Type Physics 2027 to confirm' }}
      />,
    );
    const { user, dialog } = await openDialog();
    const input = screen.getByRole('textbox', { name: 'Type Physics 2027 to confirm' });
    expect(input).toHaveFocus();
    const confirm = dialog.querySelectorAll('button')[1] as HTMLButtonElement;
    expect(confirm).toBeDisabled();

    await user.type(input, 'Physics 202');
    expect(confirm).toBeDisabled();
    await user.type(input, '7');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('blocks cancel and shows busy state while confirming', async () => {
    render(<Harness confirming />);
    const { user, dialog } = await openDialog();
    const confirm = dialog.querySelectorAll('button')[1] as HTMLButtonElement;
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('has no axe violations when open', async () => {
    const { container } = render(<Harness variant="destructive" />);
    await openDialog();
    await expectNoAxeViolations(container);
  });
});
