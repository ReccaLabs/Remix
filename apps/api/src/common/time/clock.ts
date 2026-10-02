/**
 * Source of "now" for every time-based security decision (session expiry, rotation age, the
 * reuse grace window, last-seen throttling). Injected so tests can move time; production uses
 * the system clock. Instants are passed to Postgres explicitly — the auth code never relies on
 * the database's `now()` for a decision.
 */
export interface Clock {
  now(): Date;
}

/** DI token for {@link Clock}. */
export const CLOCK = Symbol('Clock');

export const systemClock: Clock = { now: () => new Date() };

/** Test clock: starts at `start` and only moves when told to. */
export class ManualClock implements Clock {
  private ms: number;

  constructor(start: Date | number) {
    this.ms = typeof start === 'number' ? start : start.getTime();
  }

  now(): Date {
    return new Date(this.ms);
  }

  /** Current time in epoch milliseconds (for limiters that take `() => number`). */
  nowMs(): number {
    return this.ms;
  }

  advance(ms: number): void {
    this.ms += ms;
  }

  set(at: Date | number): void {
    this.ms = typeof at === 'number' ? at : at.getTime();
  }
}
