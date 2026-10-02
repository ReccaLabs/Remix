'use client';

import { TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '../actions/button';
import { cn } from '../cn';
import { Input } from '../forms/input';

export interface ConfirmDialogProps {
  /** Controlled: the app owns the open state. */
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  /** Called for Cancel, Escape and a click on the backdrop. */
  onCancel: () => void;
  /**
   * `destructive` (delete, suspend, refund): red confirm button, warning icon, and initial focus
   * on Cancel so a stray Enter never destroys anything.
   */
  variant?: 'default' | 'destructive';
  /** Shows the confirm button's loading state while the action runs. */
  confirming?: boolean;
  /**
   * "Type the name to delete" (DESIGN.md §5): confirm stays disabled until the typed text
   * matches `value` exactly (surrounding spaces ignored).
   */
  requireText?: { value: string; label: ReactNode; hint?: ReactNode };
  /** Extra body content (a summary of what will change). */
  children?: ReactNode;
}

/**
 * Confirmation dialog on the native <dialog> element: `showModal()` gives a real modal (inert
 * page, focus kept inside, top layer), Escape cancels, and focus returns to the element that
 * opened it when it closes.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  variant = 'default',
  confirming = false,
  requireText,
  children,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const [typed, setTyped] = useState('');
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = description ? `${id}-description` : undefined;
  const destructive = variant === 'destructive';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      const initial = requireText ? textRef : destructive ? cancelRef : confirmRef;
      initial.current?.focus();
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      const target = returnFocus.current;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
      returnFocus.current = null;
    }
    // Initial focus depends only on how the dialog opens; re-running on prop changes would steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset the typed confirmation each time the dialog opens (adjusting state during render,
  // as React recommends, instead of an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTyped('');
  }

  const textMatches = !requireText || typed.trim() === requireText.value;

  const cancel = () => {
    if (!confirming) onCancel();
  };

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(e) => {
        // Native Escape / Android back: keep React in control of `open`.
        e.preventDefault();
        cancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
      onClick={(e) => {
        // A click on the <dialog> itself (not its content) is a click on the backdrop.
        if (e.target === e.currentTarget) cancel();
      }}
      className={cn(
        'bg-surface text-ink rounded-card shadow-float m-auto w-[calc(100%-2rem)] max-w-md border-0 p-0',
        'backdrop:bg-scrim',
      )}
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex items-start gap-4">
          {destructive ? (
            <span
              aria-hidden
              className="bg-danger-soft text-danger flex size-10 flex-none items-center justify-center rounded-full"
            >
              <TriangleAlert size={20} />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 id={titleId} className="m-0 text-lg font-semibold leading-6">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-muted m-0 text-pretty text-sm">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {children}
        {requireText ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-confirm-text`} className="text-sm font-medium">
              {requireText.label}
            </label>
            <Input
              ref={textRef}
              id={`${id}-confirm-text`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={requireText.hint ? `${id}-confirm-hint` : undefined}
            />
            {requireText.hint ? (
              <p id={`${id}-confirm-hint`} className="text-muted m-0 text-[13px] leading-5">
                {requireText.hint}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} variant="secondary" disabled={confirming} onClick={cancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={destructive ? 'danger' : 'primary'}
            loading={confirming}
            disabled={!textMatches}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
