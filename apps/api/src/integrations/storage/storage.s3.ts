import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  assertSignedUrlTtl,
  contentDisposition,
  ObjectTooLargeError,
  type SignedDownload,
  type SignedUpload,
  type StorageProvider,
  type StoredObject,
  tenantObjectKey,
} from './storage.provider';

/** Connection settings for an S3-compatible bucket (R2 in production, SeaweedFS in dev/CI). */
export interface S3StorageConfig {
  /** `https://<account>.r2.cloudflarestorage.com` or `http://127.0.0.1:8333`. */
  endpoint: string;
  /**
   * Origin browsers use for presigned URLs when it differs from `endpoint` (e.g. the API in a
   * container reaches `http://s3:8333`, the browser `http://127.0.0.1:8333`). The signature
   * covers the host, so URLs are signed for this origin.
   */
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style URLs (`<endpoint>/<bucket>/<key>`): one origin for every object, which CSP needs. */
  forcePathStyle: boolean;
}

/**
 * {@link StorageProvider} for S3-compatible storage (ADR 0009). Every method derives the full key
 * with {@link tenantObjectKey} before any network call, so a caller can only ever name objects
 * under its own tenant prefix. Signed URLs and object bodies are never logged.
 */
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  /** Signs browser URLs; the same client unless a separate public endpoint is configured. */
  private readonly signer: S3Client;

  constructor(
    private readonly config: S3StorageConfig,
    private readonly now: () => number = Date.now,
  ) {
    const client = (endpoint: string) =>
      new S3Client({
        endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        // Default CRC32 checksums would be signed into presigned PUTs (for an empty body) and
        // break browser uploads; R2 and SeaweedFS need no checksum.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        maxAttempts: 3,
      });
    this.client = client(config.endpoint);
    this.signer =
      config.publicEndpoint && config.publicEndpoint !== config.endpoint ? client(config.publicEndpoint) : this.client;
  }

  async putObject(input: { tenantId: string; key: string; body: Buffer; contentType: string }): Promise<void> {
    const objectKey = tenantObjectKey(input.tenantId, input.key);
    if (!input.contentType || !input.body.length) throw new RangeError('Object needs a content type and body');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: objectKey,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.body.length,
      }),
    );
  }

  async createUploadUrl(input: {
    tenantId: string;
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSec: number;
  }): Promise<SignedUpload> {
    const objectKey = tenantObjectKey(input.tenantId, input.key);
    assertSignedUrlTtl(input.expiresInSec);
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) {
      throw new RangeError('sizeBytes must be a positive integer');
    }
    const expiresAt = new Date(this.now() + input.expiresInSec * 1000);
    const url = await getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: objectKey,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes,
      }),
      {
        expiresIn: input.expiresInSec,
        signingDate: new Date(this.now()),
        // Keep both as signed headers (not query parameters): a different type or byte count
        // changes the canonical request and the storage rejects the PUT.
        signableHeaders: new Set(['content-type', 'content-length']),
        unhoistableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    // Browsers set Content-Length from the body themselves (a forbidden header for scripts).
    return { method: 'PUT', url, headers: { 'content-type': input.contentType }, objectKey, expiresAt };
  }

  async createDownloadUrl(input: {
    tenantId: string;
    key: string;
    expiresInSec: number;
    downloadName?: string;
    disposition?: 'inline' | 'attachment';
  }): Promise<SignedDownload> {
    const objectKey = tenantObjectKey(input.tenantId, input.key);
    assertSignedUrlTtl(input.expiresInSec);
    const url = await getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: objectKey,
        ResponseContentDisposition: contentDisposition(input.disposition ?? 'attachment', input.downloadName),
        ResponseCacheControl: 'private, no-store',
      }),
      { expiresIn: input.expiresInSec, signingDate: new Date(this.now()) },
    );
    return { url, expiresAt: new Date(this.now() + input.expiresInSec * 1000) };
  }

  async getObject(input: { tenantId: string; key: string; maxBytes: number }): Promise<StoredObject | null> {
    const objectKey = tenantObjectKey(input.tenantId, input.key);
    let response;
    try {
      response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: objectKey }));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    const body = response.Body;
    if (!body) return null;
    if (response.ContentLength !== undefined && response.ContentLength > input.maxBytes) {
      await body.transformToWebStream().cancel();
      throw new ObjectTooLargeError();
    }
    // Read with a hard cap: never trust the reported length alone.
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of body.transformToWebStream() as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > input.maxBytes) throw new ObjectTooLargeError();
      chunks.push(chunk);
    }
    return { body: Buffer.concat(chunks), contentType: response.ContentType };
  }

  async deleteObject(input: { tenantId: string; key: string }): Promise<void> {
    const objectKey = tenantObjectKey(input.tenantId, input.key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: objectKey }));
  }

  /**
   * Development/CI only: create the bucket if it is missing and allow browser PUT/GET from the
   * given origins. Production buckets (R2) are created and their CORS set by the operator.
   */
  async ensureDevBucket(allowedOrigins: readonly string[]): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
    }
    await this.client.send(
      new PutBucketCorsCommand({
        Bucket: this.config.bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [...allowedOrigins],
              AllowedMethods: ['PUT', 'GET'],
              AllowedHeaders: ['content-type'],
              MaxAgeSeconds: 600,
            },
          ],
        },
      }),
    );
  }

  destroy(): void {
    this.client.destroy();
    if (this.signer !== this.client) this.signer.destroy();
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === 'NoSuchKey' || error.name === 'NotFound' || error.name === 'NoSuchBucket' || error.$metadata.httpStatusCode === 404)
  );
}
