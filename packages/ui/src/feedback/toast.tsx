'use client';

import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '../cn';
import type { StatusTone } from './status-badge';

export type ToastTone = StatusTone;

export interface ToastOptions {
  /** Short message ("Payment recorded"). Localised by the app. */
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /**
   * Milliseconds before it hides; `null` keeps it until dismissed. Default: provider's
   * `duration`, except `danger`, which stays until dismissed so nobody misses an error.
   */
  duration?: number | null;
  /** One follow-up action ("Undo", "View receipt"). */
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: string;
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export interface ToastProviderProps {
  children: ReactNode;
  /** Accessible name of each toast's close button ("Dismiss"). */
  dismissLabel: string;
  /** Accessible name of the toast area ("Notifications"). */
  regionLabel: string;
  /** Default auto-hide time in ms. */
  duration?: number;
  /** Most toasts visible at once; older ones are dropped. */
  max?: number;
  /** Extra classes for the fixed toast area (e.g. a different bottom offset). */
  className?: string;
}

const toneIcon: Record<ToastTone, ReactNode> = {
  success: <CircleCheck size={20} className="text-success" />,
  danger: <CircleAlert size={20} className="text-danger" />,
  warning: <TriangleAlert size={20} className="text-warning" />,
  info: <Info size={20} className="text-info" />,
  neutral: null,
};

/**
 * Toast notifications. Messages are announced through live regions that exist before any toast
 * appears (`role="status"`, or `role="alert"` for `danger`), so screen readers reliably read them.
 * Timers pause while a toast is hovered or focused (WCAG 2.2.1); Escape dismisses a focused toast.
 *
 * On phones the stack sits above the shells' bottom tab bar.
 */
export function ToastProvider({
  children,
  dismissLabel,
  regionLabel,
  duration = 5000,
  max = 3,
  className,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [announcement, setAnnouncement] = useState<{
    id: string;
    urgent: boolean;
    text: ReactNode;
  }>();
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      setToasts((list) => [...list, { ...options, id }].slice(-max));
      setAnnouncement({
        id,
        urgent: options.tone === 'danger',
        text: (
          <>
            {options.title}
            {options.description ? <> {options.description}</> : null}
          </>
        ),
      });
      return id;
    },
    [max],
  );

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Announcers: always mounted, text swapped in per toast. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement && !announcement.urgent ? (
          <span key={announcement.id}>{announcement.text}</span>
        ) : null}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
        {announcement?.urgent ? <span key={announcement.id}>{announcement.text}</span> : null}
      </div>
      <section
        aria-label={regionLabel}
        className={cn(
          'pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4',
          'bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:items-end lg:px-6',
          className,
        )}
      >
        {toasts.length > 0 ? (
          <ol className="m-0 flex w-full max-w-sm list-none flex-col gap-2 p-0">
            {toasts.map((t) => (
              <ToastCard
                key={t.id}
                item={t}
                dismissLabel={dismissLabel}
                duration={
                  t.duration === undefined ? (t.tone === 'danger' ? null : duration) : t.duration
                }
                onDismiss={dismiss}
              />
            ))}
          </ol>
        ) : null}
      </section>
    </ToastContext.Provider>
  );
}

function ToastCard({
  item,
  duration,
  dismissLabel,
  onDismiss,
}: {
  item: ToastItem;
  duration: number | null;
  dismissLabel: string;
  onDismiss: (id: string) => void;
}) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);

  useEffect(() => {
    if (paused || remaining.current === null) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      if (remaining.current !== null) {
        remaining.current = Math.max(0, remaining.current - (Date.now() - started));
      }
    };
  }, [paused, item.id, onDismiss]);

  const icon = toneIcon[item.tone ?? 'neutral'];

  return (
    <li
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDismiss(item.id);
      }}
      className="bg-surface border-line shadow-card text-ink pointer-events-auto flex items-start gap-3 rounded-md border py-3 pl-4 pr-1 text-sm"
    >
      {icon ? (
        <span aria-hidden className="mt-px flex flex-none">
          {icon}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
        <p className="m-0 font-semibold">{item.title}</p>
        {item.description ? <p className="text-muted m-0">{item.description}</p> : null}
        {item.action ? (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              onDismiss(item.id);
            }}
            className="text-brand rounded-xs pointer-coarse:min-h-11 -ml-1 mt-1 min-h-8 self-start px-1 font-semibold hover:underline"
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={() => onDismiss(item.id)}
        className="text-muted hover:text-ink hover:bg-canvas pointer-coarse:size-11 flex size-9 flex-none items-center justify-center rounded-sm"
      >
        <X aria-hidden size={18} />
      </button>
    </li>
  );
}

/** Access the toast API. Must be inside <ToastProvider>. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>.');
  return ctx;
}
