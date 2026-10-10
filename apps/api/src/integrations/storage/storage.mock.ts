import { CallRecorder } from '../recorder';
import {
  assertSignedUrlTtl,
  ObjectTooLargeError,
  type StoredObject,
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
  extends CallRecorder<
    'createUploadUrl' | 'createDownloadUrl' | 'deleteObject' | 'putObject' | 'getObject'
  >
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
    sizeBytes: number;
    expiresInSec: number;
  }): Promise<SignedUpload> {
    await this.record('createUploadUrl', input);
    assertSignedUrlTtl(input.expiresInSec);
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1) {
      throw new RangeError('sizeBytes must be a positive integer');
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
    disposition?: 'inline' | 'attachment';
  }): Promise<SignedDownload> {
    await this.record('createDownloadUrl', input);
    assertSignedUrlTtl(input.expiresInSec);
    const objectKey = tenantObjectKey(input.tenantId, input.key);
    return {
      url: `https://storage.mock.invalid/${objectKey}?sig=mock`,
      expiresAt: new Date(this.now() + input.expiresInSec * 1000),
    };
  }

  async getObject(input: { tenantId: string; key: string; maxBytes: number }): Promise<StoredObject | null> {
    await this.record('getObject', input);
    const stored = this.contents.get(tenantObjectKey(input.tenantId, input.key));
    if (!stored) return null;
    if (stored.body.length > input.maxBytes) throw new ObjectTooLargeError();
    return { body: Buffer.from(stored.body), contentType: stored.contentType };
  }

  async deleteObject(input: { tenantId: string; key: string }): Promise<void> {
    await this.record('deleteObject', input);
    this.objects.delete(tenantObjectKey(input.tenantId, input.key));
    this.contents.delete(tenantObjectKey(input.tenantId, input.key));
  }

  /** Simulate a completed upload (optionally with content, for the media worker). */
  put(tenantId: string, key: string, body?: Buffer, contentType = 'application/octet-stream'): void {
    const objectKey = tenantObjectKey(tenantId, key);
    this.objects.add(objectKey);
    if (body) this.contents.set(objectKey, { body: Buffer.from(body), contentType });
  }
}
