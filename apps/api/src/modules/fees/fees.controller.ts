import { Body, Controller, Header } from '@nestjs/common';
import { API, type IdParams } from '@remix/types/api';
import type { z } from 'zod';
import { CurrentSession, CurrentTenant, RequirePermission, SessionKinds } from '../../common/auth/auth.decorators';
import type { AuthSession } from '../../common/auth/session-authenticator';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { Endpoint, type EndpointBody } from '../../common/validation/endpoint';
import { EndpointParams, EndpointQuery } from '../../common/validation/request-input';
import { FeesService } from './fees.service';
import { ReceiptsService } from './receipts.service';

@Controller()
export class FeesController {
  constructor(private readonly fees: FeesService, private readonly receipts: ReceiptsService) {}
  @SessionKinds('student') @Header('cache-control', 'no-store') @Endpoint(API.myFees)
  myFees(@CurrentTenant() t: ResolvedTenant, @CurrentSession() s: AuthSession) { return this.fees.myFees(t.id, s); }
  @RequirePermission('fees.collect') @Header('cache-control', 'no-store') @Endpoint(API.recordCashPayment)
  recordCashPayment(@CurrentTenant() t: ResolvedTenant, @CurrentSession() s: AuthSession, @Body() b: EndpointBody<typeof API.recordCashPayment>) { return this.fees.recordCashPayment(t.id, s, b); }
  @RequirePermission('fees.collect') @Header('cache-control', 'no-store') @Endpoint(API.recordManualPayment)
  recordManualPayment(@CurrentTenant() t: ResolvedTenant, @CurrentSession() s: AuthSession, @Body() b: EndpointBody<typeof API.recordManualPayment>) { return this.fees.recordManualPayment(t.id, s, b); }
  @SessionKinds('staff', 'student') @Header('cache-control', 'no-store') @Endpoint(API.receiptPdf)
  receiptPdf(@CurrentTenant() t: ResolvedTenant, @CurrentSession() s: AuthSession, @EndpointParams() p: IdParams) { return this.receipts.pdf(t.id, s, p.id); }
  @RequirePermission('fees.read') @Header('cache-control', 'no-store') @Endpoint(API.listInvoices)
  listInvoices(@CurrentTenant() t: ResolvedTenant, @EndpointQuery() q: z.output<typeof API.listInvoices.query>) { return this.fees.listInvoices(t.id, q); }
  @RequirePermission('fees.read') @Header('cache-control', 'no-store') @Endpoint(API.studentFees)
  studentFees(@CurrentTenant() t: ResolvedTenant, @EndpointParams() p: IdParams) { return this.fees.studentFees(t.id, p.id); }
  @RequirePermission('fees.read') @Header('cache-control', 'no-store') @Endpoint(API.listPayments)
  listPayments(@CurrentTenant() t: ResolvedTenant, @EndpointQuery() q: z.output<typeof API.listPayments.query>) { return this.fees.listPayments(t.id, q); }
  @RequirePermission('fees.read') @Header('cache-control', 'no-store') @Endpoint(API.getPayment)
  getPayment(@CurrentTenant() t: ResolvedTenant, @EndpointParams() p: IdParams) { return this.fees.getPayment(t.id, p.id); }
  @RequirePermission('fees.reverse') @Header('cache-control', 'no-store') @Endpoint(API.reversePayment)
  reversePayment(@CurrentTenant() t: ResolvedTenant, @CurrentSession() s: AuthSession, @EndpointParams() p: IdParams, @Body() b: EndpointBody<typeof API.reversePayment>) { return this.fees.reversePayment(t.id, s, p.id, b.reason); }
  @RequirePermission('fees.read') @Header('cache-control', 'no-store') @Endpoint(API.getReceipt)
  getReceipt(@CurrentTenant() t: ResolvedTenant, @EndpointParams() p: IdParams) { return this.fees.getReceipt(t.id, p.id); }
}
