'use client';

import { cn } from '@remix/ui';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Modal dialog for forms (invite staff, move class, change role) on the native <dialog>:
 * `showModal()` makes the page inert and keeps focus inside, Escape and a click on the backdrop
 * close it, and focus returns to the control that opened it. The app owns `open`; the footer
 * buttons are `children` so each form decides its own actions.
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  busy = false,
  variant = 'modal',
  children,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  /** While a request runs, Escape and the backdrop do not close the dialog. */
  busy?: boolean;
  variant?: 'modal' | 'drawer';
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      const target = returnFocus.current;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
      returnFocus.current = null;
    }
  }, [open]);

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className={cn(
        'bg-surface text-ink rounded-card shadow-float m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto border-0 p-0',
        'backdrop:bg-scrim',
        variant === 'drawer' && 'mr-0 ml-auto h-dvh max-h-dvh w-full max-w-xl rounded-none',
      )}
    >
      {open ? (
        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-1.5">
            <h2 id={`${id}-title`} className="m-0 text-lg font-semibold leading-6">
              {title}
            </h2>
            {description ? (
              <p id={`${id}-description`} className="text-muted m-0 text-pretty text-sm">
                {description}
              </p>
            ) : null}
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
