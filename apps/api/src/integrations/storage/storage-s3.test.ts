import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config/config';
import { storageProviderBinding, UnconfiguredStorageProvider } from './storage-binding';
import { MockStorageProvider } from './storage.mock';
import { contentDisposition } from './storage.provider';
import { S3StorageProvider } from './storage.s3';

const T1 = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const NOW = Date.UTC(2026, 9, 1, 8, 0, 0);
const S3_ENV = {
  STORAGE_S3_ENDPOINT: 'http://127.0.0.1:8333',
  STORAGE_S3_BUCKET: 'remix-dev',
  STORAGE_S3_ACCESS_KEY_ID: 'test-access',
  STORAGE_S3_SECRET_ACCESS_KEY: 'test-secret-value',
};
const PRODUCTION = {
  NODE_ENV: 'production',
  TENANT_BASE_DOMAINS: 'remix.lk',
  TRUST_PROXY: '10.0.0.0/8',
  VALKEY_URL: 'redis://valkey:6379',
  INTEGRATIONS_KEY: Buffer.alloc(32, 1).toString('base64'),
};
const provider = () =>
  new S3StorageProvider(
    {
      endpoint: 'https://account.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'remix-prod',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secret-example',
      forcePathStyle: true,
    },
    () => NOW,
  );

describe('storage configuration and binding', () => {
  it('needs endpoint, bucket and both keys together, and never echoes the secret', () => {
    expect(loadConfig(S3_ENV).storage).toMatchObject({ bucket: 'remix-dev', region: 'auto', forcePathStyle: true });
    expect(loadConfig({}).storage).toBeUndefined();
    expect(() => loadConfig({ ...S3_ENV, STORAGE_S3_SECRET_ACCESS_KEY: '' })).toThrow(/STORAGE_S3_SECRET_ACCESS_KEY/);
    try {
      loadConfig({ ...S3_ENV, STORAGE_S3_BUCKET: 'Bad_Bucket' });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toMatch(/STORAGE_S3_BUCKET/);
      expect(String(error)).not.toContain('test-secret-value');
    }
  });

  it('requires https for the bucket endpoint in production', () => {
    expect(() => loadConfig({ ...PRODUCTION, ...S3_ENV })).toThrow(/STORAGE_S3_ENDPOINT: must use https/);
    expect(
      loadConfig({ ...PRODUCTION, ...S3_ENV, STORAGE_S3_ENDPOINT: 'https://a.r2.cloudflarestorage.com' }).storage,
    ).toBeDefined();
  });

  it('selects S3 when configured, the mock only outside production, and never the mock in production', () => {
    expect(storageProviderBinding(loadConfig(S3_ENV))).toBeInstanceOf(S3StorageProvider);
    expect(storageProviderBinding(loadConfig({ NODE_ENV: 'test' }))).toBeInstanceOf(MockStorageProvider);
    expect(storageProviderBinding(loadConfig(PRODUCTION))).toBeInstanceOf(UnconfiguredStorageProvider);
    expect(
      storageProviderBinding(
        loadConfig({ ...PRODUCTION, ...S3_ENV, STORAGE_S3_ENDPOINT: 'https://a.r2.cloudflarestorage.com' }),
      ),
    ).toBeInstanceOf(S3StorageProvider);
  });
});

describe('S3StorageProvider signing (no network)', () => {
  it('signs a PUT that binds the content type and exact length to the tenant-prefixed key', async () => {
    const up = await provider().createUploadUrl({
      tenantId: T1,
      key: 'slips/2026/10/a.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 12345,
      expiresInSec: 600,
    });
    const url = new URL(up.url);
    expect(url.origin).toBe('https://account.r2.cloudflarestorage.com');
    expect(url.pathname).toBe(`/remix-prod/${T1}/slips/2026/10/a.jpg`);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect([...url.searchParams.keys()].some((k) => k.toLowerCase().includes('checksum'))).toBe(false);
    expect(up.headers).toEqual({ 'content-type': 'image/jpeg' });
    expect(up.objectKey).toBe(`${T1}/slips/2026/10/a.jpg`);
    expect(up.expiresAt.getTime()).toBe(NOW + 600_000);
  });

  it('signs browser URLs for the public endpoint when one is configured', async () => {
    const s = new S3StorageProvider({
      endpoint: 'http://s3:8333',
      publicEndpoint: 'http://127.0.0.1:8333',
      region: 'us-east-1',
      bucket: 'remix-dev',
      accessKeyId: 'a',
      secretAccessKey: 'b',
      forcePathStyle: true,
    });
    const up = await s.createUploadUrl({ tenantId: T1, key: 'a.jpg', contentType: 'image/png', sizeBytes: 9, expiresInSec: 60 });
    expect(new URL(up.url).origin).toBe('http://127.0.0.1:8333');
    const down = await s.createDownloadUrl({ tenantId: T1, key: 'a.jpg', expiresInSec: 60 });
    expect(new URL(down.url).origin).toBe('http://127.0.0.1:8333');
    s.destroy();
  });

  it('signs a GET with a server-set content disposition and a capped lifetime', async () => {
    const s = provider();
    const down = await s.createDownloadUrl({
      tenantId: T1,
      key: 'slips/2026/10/a.jpg',
      expiresInSec: 300,
      downloadName: 'slip "x".jpg\r\nSet-Cookie: a',
      disposition: 'inline',
    });
    const url = new URL(down.url);
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'inline; filename="slip__x_.jpg__Set-Cookie__a"',
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    await expect(s.createDownloadUrl({ tenantId: T1, key: 'a.jpg', expiresInSec: 601 })).rejects.toThrow(RangeError);
  });

  it('rejects foreign or malformed keys before any network call', async () => {
    const s = provider();
    for (const key of ['../other/a.jpg', `/${T1}/a.jpg`, 'a//b.jpg']) {
      await expect(
        s.createUploadUrl({ tenantId: T1, key, contentType: 'image/jpeg', sizeBytes: 1, expiresInSec: 60 }),
      ).rejects.toThrow(RangeError);
      await expect(s.getObject({ tenantId: T1, key, maxBytes: 1 })).rejects.toThrow(RangeError);
      await expect(s.deleteObject({ tenantId: T1, key })).rejects.toThrow(RangeError);
    }
    await expect(
      s.createUploadUrl({ tenantId: 'not-a-tenant', key: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 1, expiresInSec: 60 }),
    ).rejects.toThrow(RangeError);
    await expect(
      s.createUploadUrl({ tenantId: T1, key: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 0, expiresInSec: 60 }),
    ).rejects.toThrow(RangeError);
  });

  it('builds safe content-disposition values', () => {
    expect(contentDisposition('attachment', 'receipt-1.pdf')).toBe('attachment; filename="receipt-1.pdf"');
    expect(contentDisposition('inline', undefined)).toBe('inline');
    expect(contentDisposition('inline', '...')).toBe('inline');
  });
});
