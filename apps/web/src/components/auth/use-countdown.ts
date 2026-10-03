'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Seconds left until a resend is allowed (AUTH-02: 45 s). `restart(n)` starts a new countdown;
 * it ticks once a second and stops at 0. Display only — the API enforces the real limit.
 */
export function useCountdown(initialSeconds = 0) {
  const [endsAt, setEndsAt] = useState(() =>
    initialSeconds > 0 ? Date.now() + initialSeconds * 1000 : 0,
  );
  const [left, setLeft] = useState(initialSeconds);

  useEffect(() => {
    if (endsAt === 0) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setLeft(remaining);
      return remaining;
    };
    if (tick() === 0) return;
    const timer = setInterval(() => {
      if (tick() === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  const restart = useCallback((seconds: number) => {
    setLeft(seconds);
    setEndsAt(Date.now() + seconds * 1000);
  }, []);

  return { secondsLeft: left, restart };
}

/** `42` → `0:42` (the resend timer). */
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
