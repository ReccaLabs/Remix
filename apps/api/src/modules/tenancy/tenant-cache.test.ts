import { describe, expect, it } from 'vitest';
import { InMemoryTenantCache } from './tenant-cache';

describe('InMemoryTenantCache', () => {
  it('returns a value until its TTL passes', async () => {
    let now = 1_000;
    const cache = new InMemoryTenantCache(() => now);
    await cache.set('host:a', 'A', 60);
    expect(await cache.get('host:a')).toBe('A');
    now += 59_999;
    expect(await cache.get('host:a')).toBe('A');
    now += 1;
    expect(await cache.get('host:a')).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('is bounded: the oldest entries go first', async () => {
    const cache = new InMemoryTenantCache(() => 0, 2);
    await cache.set('host:a', 'A', 60);
    await cache.set('host:b', 'B', 60);
    await cache.set('host:c', 'C', 60);
    expect(cache.size).toBe(2);
    expect(await cache.get('host:a')).toBeNull();
    expect(await cache.get('host:c')).toBe('C');
  });

  it('forgets an entry on delete (settings changes), and deleting a missing key is fine', async () => {
    const cache = new InMemoryTenantCache();
    await cache.set('host:a', 'A', 60);
    await cache.delete('host:a');
    await cache.delete('host:never-there');
    expect(await cache.get('host:a')).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('misses unknown keys', async () => {
    expect(await new InMemoryTenantCache().get('host:none')).toBeNull();
  });
});
