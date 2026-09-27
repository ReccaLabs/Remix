/**
 * Transactional email behind a provider interface (CLAUDE.md: integrations only behind
 * interfaces), so Resend can be swapped for SES or another provider without touching callers.
 * Not a route: this module exports no onRequest* handler.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<void>;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;

/** Resend over plain fetch (no SDK — nothing extra to bundle into the Function). */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(email: OutgoingEmail): Promise<void> {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    // Only the status is surfaced: provider error bodies can echo recipients or content.
    if (!res.ok) throw new Error(`email_provider_status_${res.status}`);
  }
}

export interface EmailEnv {
  RESEND_API_KEY?: string;
  LEAD_NOTIFY_FROM?: string;
}

export const DEFAULT_FROM = 'ReMix website <no-reply@remix.lk>';

/** Returns null when no provider is configured (local dev / previews): callers skip sending. */
export function emailProviderFromEnv(env: EmailEnv): EmailProvider | null {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return null;
  return new ResendEmailProvider(key, env.LEAD_NOTIFY_FROM?.trim() || DEFAULT_FROM);
}
