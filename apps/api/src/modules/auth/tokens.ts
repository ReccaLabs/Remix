import { createHash, randomBytes } from 'node:crypto';

/** 256 random bits → 43 base64url characters. */
const RANDOM_BYTES = 32;
const SESSION_TOKEN = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;
const DEVICE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface ParsedSessionToken {
  token: string;
  /**
   * Issue time from the prefix, epoch seconds. A hint only (the web proxy uses it to decide when
   * to refresh); the server decides from the stored `created_at`/`rotated_at`. Tampering with it
   * changes the hash, so the token no longer matches anything.
   */
  issuedAtSec: number;
}

/** A fresh session token, `<unixSeconds>.<base64url 256-bit random>` (ADR 0004). */
export function newSessionToken(now: Date): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return `${issuedAt}.${randomBytes(RANDOM_BYTES).toString('base64url')}`;
}

/** Strictly parse a cookie value as a session token; anything else is null (never hashed). */
export function parseSessionToken(raw: string | undefined): ParsedSessionToken | null {
  if (!raw) return null;
  const match = SESSION_TOKEN.exec(raw);
  if (!match) return null;
  return { token: raw, issuedAtSec: Number(match[1]) };
}

/** A fresh device id for the device cookie: 256 random bits, base64url. */
export function newDeviceToken(): string {
  return randomBytes(RANDOM_BYTES).toString('base64url');
}

export function isDeviceToken(raw: string | undefined): raw is string {
  return raw !== undefined && DEVICE_TOKEN.test(raw);
}

/**
 * SHA-256 (hex) — what the database stores instead of the token. A fast hash is enough for a
 * 256-bit random value, and a database dump yields no usable token (ADR 0004).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
