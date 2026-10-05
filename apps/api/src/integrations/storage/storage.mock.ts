import { CallRecorder } from '../recorder';
import {
  assertSignedUrlTtl,
  type SignedDownload,
  type SignedUpload,
  type StorageProvider,
  tenantObjectKey,
} from './storage.provider';

/**
 * In-memory {@link StorageProvider}: issues fake signed URLs with the same key and TTL rules as
 * the real adapter, and tracks which objects "exist" (`put` simulates a finished upload).
 */
export class MockStorageProvider
  extends CallRecorder<'createUploadUrl' | 'createDownloadUrl' | 'deleteObject' | 'putObject'>
  implements StorageProvider
{
  readonly objects = new Set<string>();
  readonly contents = new Map<string, { body: Buffer; contentType: string }>();

  constructor(private readonly now: () => number = Date.now) {
    super();
  }
  async putObject(input: { tenantId: string; key: string; body: Buffer; contentType: string }): Promise<void> {
    const objectKey = tenantObjectKey(input.tenantId, input.key);
    if (!input.contentType || !input.body.length) throw new RangeError('Object needs a content type and body');
    // Record only metadata; neither file content nor signed URLs belong in logs.
    await this.record('putObject', { tenantId: input.tenantId, key: input.key, contentType: input.contentType, sizeBytes: input.body.length });
    this.objects.add(objectKey);
    this.contents.set(objectKey, { body: Buffer.from(input.body), contentType: input.contentType });
  }

  async createUploadUrl(input: {
    tenantId: string;
    key: string;
    contentType: string;
    maxBytes: number;
    expiresInSec: number;
  }): Promise<SignedUpload> {
    await this.record('createUploadUrl', input);
    assertSignedUrlTtl(input.expiresInSec);
    if (!Number.isInteger(input.maxBytes) || input.maxBytes < 1) {
      throw new RangeError('maxBytes must be a positive integer');
    }
    const objectKey = tenantObjectKey(input.tenantId, input.key);
    return {
      method: 'PUT',
      url: `https://storage.mock.invalid/${objectKey}?sig=mock`,
      headers: { 'content-type': input.contentType },
      objectKey,
      expiresAt: new Date(this.now() + input.expiresInSec * 1000),
    };
  }

  async createDownloadUrl(input: {
    tenantId: string;
    key: string;
    expiresInSec: number;
    downloadName?: string;
  }): Promise<SignedDownload> {
    await this.record('createDownloadUrl', input);
    assertSignedUrlTtl(input.expiresInSec);
    const objectKey = tenantObjectKey(input.tenantId, input.key);
    return {
      url: `https://storage.mock.invalid/${objectKey}?sig=mock`,
      expiresAt: new Date(this.now() + input.expiresInSec * 1000),
    };
  }

  async deleteObject(input: { tenantId: string; key: string }): Promise<void> {
    await this.record('deleteObject', input);
    this.objects.delete(tenantObjectKey(input.tenantId, input.key));
    this.contents.delete(tenantObjectKey(input.tenantId, input.key));
  }

  /** Simulate a completed upload. */
  put(tenantId: string, key: string): void {
    this.objects.add(tenantObjectKey(tenantId, key));
  }
}
