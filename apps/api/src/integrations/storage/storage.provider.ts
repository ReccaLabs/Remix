/** Signed URLs never live longer than this (DEVELOPMENT.md §5.4: ≤ 10 min). */
export const MAX_SIGNED_URL_TTL_SEC = 600;

export interface SignedUpload {
  method: 'PUT';
  url: string;
  /** Headers the client must send unchanged (content type, length bound by the signature). */
  headers: Record<string, string>;
  /** Full object key, always `<tenantId>/…`. */
  objectKey: string;
  expiresAt: Date;
}

export interface SignedDownload {
  url: string;
  expiresAt: Date;
}

/** A server-side read: the whole object, bounded by `maxBytes`. */
export interface StoredObject {
  body: Buffer;
  /** The type the uploader declared. Informational only: never trust it (sniff the bytes). */
  contentType: string | undefined;
}

/** Thrown by {@link StorageProvider.getObject} when the object is larger than allowed. */
export class ObjectTooLargeError extends Error {
  constructor() {
    super('Stored object exceeds the allowed size');
    this.name = 'ObjectTooLargeError';
  }
}

/**
 * Private object storage (Cloudflare R2 in prod, SeaweedFS in dev, ADR 0009). Callers pass the tenant and a
 * key relative to it; the provider prefixes `<tenantId>/` itself, so one tenant can never sign
 * a URL for another tenant's object.
 */
export interface StorageProvider {
  /** Server-side write. `key` is relative to the tenant, just like the signed URL methods. */
  putObject(input: { tenantId: string; key: string; body: Buffer; contentType: string }): Promise<void>;
  /**
   * Presigned PUT. The signature binds `content-type` and the exact `content-length`
   * (`sizeBytes`), so the client cannot upload another type or size with it.
   */
  createUploadUrl(input: {
    tenantId: string;
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSec: number;
  }): Promise<SignedUpload>;
  /** Presigned GET; `Content-Disposition` is always set by the server, never by the caller's client. */
  createDownloadUrl(input: {
    tenantId: string;
    key: string;
    expiresInSec: number;
    /** `Content-Disposition` filename (sanitised to `[A-Za-z0-9._-]`). */
    downloadName?: string;
    /** `inline` for images shown in the app; `attachment` (default) for downloads. */
    disposition?: 'inline' | 'attachment';
  }): Promise<SignedDownload>;
  /** Server-side read; `null` when the object does not exist. Throws {@link ObjectTooLargeError}. */
  getObject(input: { tenantId: string; key: string; maxBytes: number }): Promise<StoredObject | null>;
  deleteObject(input: { tenantId: string; key: string }): Promise<void>;
}

/** DI token for {@link StorageProvider}. */
export const STORAGE_PROVIDER = Symbol('StorageProvider');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * `<tenantId>/<key>` after validating both: the tenant id is a UUID and every key segment is a
 * plain file-name-like token (no `..`, empty segments, backslashes or absolute paths).
 */
export function tenantObjectKey(tenantId: string, key: string): string {
  if (!UUID.test(tenantId)) throw new RangeError('tenantId must be a lower-case UUID');
  const segments = key.split('/');
  if (segments.length > 8 || !segments.every((s) => SEGMENT.test(s) && !s.includes('..'))) {
    throw new RangeError('Invalid object key');
  }
  return `${tenantId}/${key}`;
}

/** Validate a signed-URL lifetime: whole seconds, 1 to {@link MAX_SIGNED_URL_TTL_SEC}. */
export function assertSignedUrlTtl(seconds: number, max = MAX_SIGNED_URL_TTL_SEC): void {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > max) {
    throw new RangeError(`Signed URL lifetime must be 1–${max} seconds`);
  }
}

/** `Content-Disposition` value with a filename reduced to safe ASCII (no quotes, no header injection). */
export function contentDisposition(disposition: 'inline' | 'attachment', name: string | undefined): string {
  const safe = (name ?? '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._]+/, '').slice(0, 100);
  return safe ? `${disposition}; filename="${safe}"` : disposition;
}
