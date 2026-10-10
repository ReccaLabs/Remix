import { DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectTooLargeError } from '../../src/integrations/storage/storage.provider';
import { S3StorageProvider } from '../../src/integrations/storage/storage.s3';
import { reachable, testS3Config } from './support';

const T1 = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const T2 = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

describe.skipIf(!reachable)('S3StorageProvider against real S3-compatible storage', () => {
  const config = testS3Config();
  const storage = new S3StorageProvider(config);

  beforeAll(async () => {
    await storage.ensureDevBucket(['http://localhost:3001']);
  });
  afterAll(async () => {
    for (const [tenantId, key] of [
      [T1, 'slips/a.jpg'],
      [T1, 'slips/b.jpg'],
      [T2, 'slips/a.jpg'],
    ] as const) {
      await storage.deleteObject({ tenantId, key }).catch(() => undefined);
    }
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    await client.send(new DeleteBucketCommand({ Bucket: config.bucket })).catch(() => undefined);
    client.destroy();
    storage.destroy();
  });

  const upload = (url: string, body: Uint8Array, contentType: string) =>
    fetch(url, { method: 'PUT', body: Buffer.from(body), headers: { 'content-type': contentType } });

  it('accepts a PUT of exactly the signed type and size, and nothing else', async () => {
    const body = new Uint8Array(1000).fill(7);
    const signed = await storage.createUploadUrl({
      tenantId: T1,
      key: 'slips/a.jpg',
      contentType: 'image/jpeg',
      sizeBytes: body.length,
      expiresInSec: 120,
    });
    expect((await upload(signed.url, body.subarray(0, 999), 'image/jpeg')).ok).toBe(false);
    expect((await upload(signed.url, new Uint8Array(1001), 'image/jpeg')).ok).toBe(false);
    expect((await upload(signed.url, body, 'image/png')).ok).toBe(false);
    expect(await storage.getObject({ tenantId: T1, key: 'slips/a.jpg', maxBytes: 5000 })).toBeNull();
    const ok = await upload(signed.url, body, signed.headers['content-type'] ?? '');
    expect(ok.status).toBe(200);
    const stored = await storage.getObject({ tenantId: T1, key: 'slips/a.jpg', maxBytes: 5000 });
    expect(stored?.body.equals(Buffer.from(body))).toBe(true);
    await expect(storage.getObject({ tenantId: T1, key: 'slips/a.jpg', maxBytes: 999 })).rejects.toBeInstanceOf(
      ObjectTooLargeError,
    );
  });

  it('keeps tenants apart: the same relative key is a different object per tenant', async () => {
    await storage.putObject({ tenantId: T2, key: 'slips/a.jpg', body: Buffer.from('tenant-two'), contentType: 'image/jpeg' });
    const one = await storage.getObject({ tenantId: T1, key: 'slips/a.jpg', maxBytes: 5000 });
    const two = await storage.getObject({ tenantId: T2, key: 'slips/a.jpg', maxBytes: 5000 });
    expect(two?.body.toString()).toBe('tenant-two');
    expect(one?.body.toString()).not.toBe('tenant-two');
  });

  it('serves a signed GET with the server-chosen content disposition, then deletes', async () => {
    await storage.putObject({ tenantId: T1, key: 'slips/b.jpg', body: Buffer.from('jpeg-bytes'), contentType: 'image/jpeg' });
    const signed = await storage.createDownloadUrl({
      tenantId: T1,
      key: 'slips/b.jpg',
      expiresInSec: 60,
      downloadName: 'slip-1.jpg',
      disposition: 'inline',
    });
    const response = await fetch(signed.url);
    expect(response.status).toBe(200);
    // R2 echoes the signed `response-content-disposition`; SeaweedFS substitutes its own inline
    // value, so only the disposition type is portable here (the unit test pins the signed value).
    expect(response.headers.get('content-disposition')).toMatch(/^inline/);
    expect(await response.text()).toBe('jpeg-bytes');
    const tampered = new URL(signed.url);
    tampered.searchParams.set('response-content-disposition', 'attachment');
    expect((await fetch(tampered)).ok).toBe(false);
    await storage.deleteObject({ tenantId: T1, key: 'slips/b.jpg' });
    expect(await storage.getObject({ tenantId: T1, key: 'slips/b.jpg', maxBytes: 100 })).toBeNull();
  });
});
