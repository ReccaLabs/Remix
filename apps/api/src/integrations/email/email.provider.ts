/**
 * Transactional email from remix.lk (Resend): staff invites, impersonation notices, platform
 * invoices. Not used for marketing.
 */
export interface SendEmailInput {
  /** Tenant the email concerns, for logs/audit; null for platform mail. */
  tenantId: string | null;
  to: readonly string[];
  subject: string;
  text: string;
  html?: string;
  /** Same key → sent once (Resend `Idempotency-Key`). */
  idempotencyKey: string;
  /** Category for provider analytics, e.g. `staff-invite`. No personal data. */
  tag?: string;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<{ messageId: string }>;
}

/** DI token for {@link EmailProvider}. */
export const EMAIL_PROVIDER = Symbol('EmailProvider');
