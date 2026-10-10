import { randomUUID } from 'node:crypto';
import type { S3StorageConfig } from '../../src/integrations/storage/storage.s3';

/**
 * The dev-stack SeaweedFS (infra/docker/compose.yaml, keys in infra/docker/seaweedfs/s3.json —
 * dev-only values) unless `TEST_S3_ENDPOINT` says otherwise. Each run uses its own bucket.
 */
export const S3_ENDPOINT = process.env.TEST_S3_ENDPOINT || 'http://127.0.0.1:8333';

export function testS3Config(): S3StorageConfig {
  return {
    endpoint: S3_ENDPOINT,
    region: 'us-east-1',
    bucket: `remix-test-${randomUUID().slice(0, 8)}`,
    accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID || 'remix_s3_dev',
    secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY || 'remix_s3_dev_password',
    forcePathStyle: true,
  };
}

async function probe(): Promise<boolean> {
  try {
    await fetch(S3_ENDPOINT, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether S3-compatible storage answers at {@link S3_ENDPOINT}. Tests use
 * `describe.skipIf(!reachable)`; in CI an unreachable endpoint fails the run instead.
 */
export const reachable = await probe();
if (!reachable) {
  if (process.env.CI) throw new Error(`S3 storage is required in CI but not reachable at ${S3_ENDPOINT}`);
  // eslint-disable-next-line no-console -- tells the developer why the suite was skipped
  console.warn(`[s3 tests] skipped: no S3 at ${S3_ENDPOINT}. Start the dev stack or set TEST_S3_ENDPOINT.`);
}
