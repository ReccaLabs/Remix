import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

/** The dev-stack Valkey (infra/docker/compose.yaml) unless `VALKEY_URL` says otherwise. */
export const VALKEY_URL = process.env.VALKEY_URL || 'redis://127.0.0.1:6379';

async function probe(): Promise<boolean> {
  const client = new Redis(VALKEY_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    connectTimeout: 1500,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

/**
 * Whether a real Valkey answers at {@link VALKEY_URL}. Tests use `describe.skipIf(!reachable)`.
 * In CI an unreachable Valkey fails the run instead of silently skipping it.
 */
export const reachable = await probe();
if (!reachable) {
  if (process.env.CI)
    throw new Error(`Valkey is required in CI but not reachable at ${VALKEY_URL}`);
  // eslint-disable-next-line no-console -- tells the developer why the suite was skipped
  console.warn(
    `[valkey tests] skipped: no Valkey at ${VALKEY_URL}. Start the dev stack or set VALKEY_URL.`,
  );
}

/** A unique key/prefix namespace so parallel runs and the dev stack's own keys never collide. */
export function uniqueName(label: string): string {
  return `test-${label}-${randomUUID()}`;
}

/** Delete every key under `prefix` (test clean-up). */
export async function deleteByPrefix(client: Redis, prefix: string): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
    cursor = next;
    if (keys.length) await client.del(...keys);
  } while (cursor !== '0');
}
