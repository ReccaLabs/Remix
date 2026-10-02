import type { TenantCache } from '@remix/db';

interface Entry {
  value: string;
  expiresAt: number;
}

/**
 * Process-local {@link TenantCache} for host → tenant lookups (`host:<host>`, 60 s, positive
 * results only — `resolveTenantByHost` decides what is cached and re-validates on read). The
 * Valkey implementation replaces it when the cache module lands, so a status change (e.g. a
 * suspension) takes effect on every node within the TTL. Memory is bounded: expired entries are
 * swept and, when still full, the oldest are dropped.
 */
export class InMemoryTenantCache implements TenantCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 10_000,
  ) {}

  get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.entries.size >= this.maxEntries) this.sweep();
    this.entries.delete(key); // re-insert so Map order stays oldest-first
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  /** Drop everything (tests, or an admin action that must take effect at once on this node). */
  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
    for (const key of this.entries.keys()) {
      if (this.entries.size < this.maxEntries) break;
      this.entries.delete(key);
    }
  }
}
