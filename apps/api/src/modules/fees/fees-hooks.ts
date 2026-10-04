import { Injectable, Logger } from '@nestjs/common';

export interface PaymentCommittedEvent {
  tenantId: string; paymentId: string; receiptId: string;
  /** Receipt PDF/SMS handlers use this immutable payment business key for retry-safe jobs. */
  jobKey: string;
}

/** Delivery seam for tracks 3-B/3-F, invoked only after the enclosing transaction commits. */
@Injectable()
export class FeesHooks {
  private readonly logger = new Logger('FeesHooks');
  private readonly handlers: ((event: PaymentCommittedEvent) => Promise<void>)[] = [];
  registerPaymentCommitted(handler: (event: PaymentCommittedEvent) => Promise<void>): void {
    this.handlers.push(handler);
  }
  async onPaymentCommitted(event: PaymentCommittedEvent): Promise<void> {
    for (const handler of this.handlers) {
      try { await handler(event); }
      catch (error) { this.logger.error({ tenantId: event.tenantId, paymentId: event.paymentId, err: error instanceof Error ? error.name : 'unknown' }, 'Receipt job enqueue failed after commit'); }
    }
  }
}
