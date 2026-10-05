import { describe, expect, it } from 'vitest';
import { MockStorageProvider } from './storage.mock';
import { UnconfiguredStorageProvider } from './storage.module';
import { tenantObjectKey } from './storage.provider';
const tenantId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
describe('StorageProvider server-side writes', () => {
  it('writes private tenant-prefixed content, copies the body, and overwrites the same object on retry', async () => {
    const storage = new MockStorageProvider();
    const body = Buffer.from('%PDF-test');
    const key = 'receipts/2026/10/test.pdf';
    await storage.putObject({ tenantId, key, body, contentType: 'application/pdf' });
    body[0] = 0;
    expect(storage.contents.get(tenantObjectKey(tenantId, key))?.body.toString()).toBe('%PDF-test');
    await storage.putObject({
      tenantId,
      key,
      body: Buffer.from('%PDF-test'),
      contentType: 'application/pdf',
    });
    expect(storage.objects.size).toBe(1);
    expect(JSON.stringify(storage.callsTo('putObject'))).not.toContain('%PDF-test');
  });
  it('rejects traversal before calling the provider and keeps tenants independent', async () => {
    const storage = new MockStorageProvider();
    await expect(
      storage.putObject({
        tenantId,
        key: '../other.pdf',
        body: Buffer.from('file'),
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow();
    expect(storage.callsTo('putObject')).toHaveLength(0);
    await storage.putObject({
      tenantId,
      key: 'receipts/test.pdf',
      body: Buffer.from('a'),
      contentType: 'application/pdf',
    });
    await storage.putObject({
      tenantId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
      key: 'receipts/test.pdf',
      body: Buffer.from('b'),
      contentType: 'application/pdf',
    });
    expect(storage.objects.size).toBe(2);
  });
  it('fails closed without a production adapter', async () => {
    await expect(new UnconfiguredStorageProvider().putObject()).rejects.toThrow(
      'No storage adapter',
    );
  });
});
