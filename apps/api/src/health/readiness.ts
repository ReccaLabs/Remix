import { type BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';

/** A dependency the API needs to serve traffic (database, Valkey…). */
export interface ReadinessCheck {
  /** Short, non-sensitive name shown in `/health/ready`: `database`, `valkey`. */
  name: string;
  /** Resolve when healthy; reject (or time out) when not. Must be cheap: `SELECT 1`, `PING`. */
  check(): Promise<void>;
}

export type CheckStatus = 'ok' | 'fail';

export interface ReadinessReport {
  ready: boolean;
  checks: Record<string, CheckStatus>;
}

/**
 * Collects readiness checks from the modules that own the dependencies. Register once at boot:
 *
 * ```ts
 * constructor(readiness: ReadinessRegistry, db: Db) {
 *   readiness.register({ name: 'database', check: () => db.execute(sql`select 1`).then(() => {}) });
 * }
 * ```
 *
 * During shutdown readiness turns false so the proxy stops routing before the server closes.
 */
@Injectable()
export class ReadinessRegistry implements BeforeApplicationShutdown {
  private readonly checks = new Map<string, ReadinessCheck>();
  private draining = false;
  private readonly logger = new Logger('Readiness');
  /** Per-check timeout; a hung dependency counts as down. */
  timeoutMs = 2000;

  register(check: ReadinessCheck): void {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(check.name)) {
      throw new Error(`Readiness check name "${check.name}" must be a short kebab-case word`);
    }
    if (this.checks.has(check.name)) {
      throw new Error(`Readiness check "${check.name}" is already registered`);
    }
    this.checks.set(check.name, check);
  }

  async run(): Promise<ReadinessReport> {
    const entries = await Promise.all(
      [...this.checks.values()].map(
        async (c) => [c.name, await this.runOne(c)] as [string, CheckStatus],
      ),
    );
    const checks = Object.fromEntries(entries);
    return { ready: !this.draining && entries.every(([, s]) => s === 'ok'), checks };
  }

  beforeApplicationShutdown(): void {
    this.draining = true;
  }

  private async runOne(check: ReadinessCheck): Promise<CheckStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('timeout'));
      }, this.timeoutMs);
    });
    try {
      await Promise.race([check.check(), timeout]);
      return 'ok';
    } catch (error) {
      // Details stay in the logs; the endpoint only says which check failed.
      this.logger.warn({ err: error, check: check.name }, 'Readiness check failed');
      return 'fail';
    } finally {
      clearTimeout(timer);
    }
  }
}
