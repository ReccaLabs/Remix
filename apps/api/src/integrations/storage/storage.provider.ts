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

/**
 * Private object storage (Cloudflare R2 in prod, MinIO in dev). Callers pass the tenant and a
 * key relative to it; the provider prefixes `<tenantId>/` itself, so one tenant can never sign
 * a URL for another tenant's object.
 */
export interface StorageProvider {
  createUploadUrl(input: {
    tenantId: string;
    key: string;
    contentType: string;
    maxBytes: number;
    expiresInSec: number;
  }): Promise<SignedUpload>;
  createDownloadUrl(input: {
    tenantId: string;
    key: string;
    expiresInSec: number;
    /** `Content-Disposition` filename for downloads. */
    downloadName?: string;
  }): Promise<SignedDownload>;
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
