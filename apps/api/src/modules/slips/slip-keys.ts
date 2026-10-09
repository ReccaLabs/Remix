import { tenantObjectKey } from '../../integrations/storage/storage.provider';

/** File extension of an upload's original object, from its (declared, bound) content type. */
export const SLIP_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
} as const;

/**
 * `<tenantId>/slips/<yyyy>/<mm>/` for `now` (UTC month, ADR 0009 key layout). The server builds
 * every key; nothing in it comes from the client.
 */
export function slipKeyPrefix(tenantId: string, now: Date): string {
  const iso = now.toISOString();
  return `${tenantId}/slips/${iso.slice(0, 4)}/${iso.slice(5, 7)}/`;
}

/**
 * A stored full key (`<tenantId>/…`) back to the tenant-relative key the storage provider takes.
 * Throws if the key is not under this tenant's prefix or is malformed, so a row that somehow
 * names another tenant's object can never be signed or read.
 */
export function relativeKey(tenantId: string, fullKey: string): string {
  const prefix = `${tenantId}/`;
  if (!fullKey.startsWith(prefix)) throw new RangeError('Object key is outside the tenant prefix');
  const key = fullKey.slice(prefix.length);
  if (tenantObjectKey(tenantId, key) !== fullKey) throw new RangeError('Invalid object key');
  return key;
}
