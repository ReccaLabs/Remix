import { SmsTransportError } from './sms-errors';

export type FetchLike = typeof fetch;

/** Marker sender id: "use the gateway's own approved platform sender". */
export const PLATFORM_SENDER_ID = 'ReMix';

/** `+94771234567` -> `+94*****567`: logs never carry a full number. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return '***';
  return `+${digits.slice(0, 2)}*****${digits.slice(-3)}`;
}

/** `+94771234567` -> `94771234567` (the form both gateways expect). */
export function toGatewayNumber(e164: string): string {
  return e164.replace(/^\+/, '');
}

/**
 * POST with a hard timeout. Network failures and timeouts become {@link SmsTransportError}; the
 * error message never carries the request URL, body or credentials.
 */
export async function postWithTimeout(
  gateway: string,
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, method: 'POST', signal: controller.signal });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    throw new SmsTransportError(gateway, timedOut ? 'timeout' : 'network error', {
      cause: error instanceof Error ? error.name : undefined,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
