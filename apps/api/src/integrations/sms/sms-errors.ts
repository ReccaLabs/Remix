/**
 * Gateway outcomes the rest of the system distinguishes (MSG-01):
 * - {@link SmsRejectedError}: the gateway definitely refused this message (bad number, bad
 *   content). Retrying or switching gateway cannot help, so it is permanent: the job stops and
 *   the wallet debit is refunded.
 * - {@link SmsTransportError}: timeout, network failure, 5xx, 429 or a credentials/account
 *   problem on the platform side. Retry, and fail over to the other gateway.
 */
export class SmsRejectedError extends Error {
  constructor(
    readonly gateway: string,
    reason: string,
  ) {
    super(`${gateway} rejected the message: ${reason}`);
    this.name = 'SmsRejectedError';
  }
}

export class SmsTransportError extends Error {
  constructor(
    readonly gateway: string,
    reason: string,
    options?: { cause?: unknown },
  ) {
    super(`${gateway} unavailable: ${reason}`, options);
    this.name = 'SmsTransportError';
  }
}
