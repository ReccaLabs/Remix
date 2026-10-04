import type { z } from 'zod';
import {
  dashboardResponseSchema,
  generalSettingsSchema,
  themeSchema,
  updateGeneralSettingsSchema,
  updateThemeSchema,
} from './admin';
import {
  acceptInviteSchema,
  changePasswordSchema,
  devicesResponseSchema,
  invitePreviewSchema,
  inviteTokenSchema,
  otpRequestResponseSchema,
  otpRequestSchema,
  otpVerifyResponseSchema,
  otpVerifySchema,
  resolveDeviceLimitSchema,
  sessionResponseSchema,
  setPasswordSchema,
  staffLoginRequestSchema,
  studentLoginRequestSchema,
  twoStepChallengeSchema,
  twoStepResendSchema,
  twoStepVerifySchema,
  updateMeSchema,
} from './auth';
import {
  teachersResponseSchema,
  classDetailSchema,
  classInputSchema,
  classStudentsResponseSchema,
  enrolStudentsResponseSchema,
  enrolStudentsSchema,
  hallInputSchema,
  hallSchema,
  hallsResponseSchema,
  listClassesQuerySchema,
  listClassesResponseSchema,
  moveEnrollmentSchema,
  myClassesResponseSchema,
  publicTimetableResponseSchema,
  timetableQuerySchema,
  timetableResponseSchema,
  updateClassSchema,
  updateEnrollmentSchema,
} from './classes';
import { idParamsSchema } from './common';
import {
  approveSlipSchema,
  cashPaymentSchema,
  checkoutResponseSchema,
  checkoutStatusSchema,
  createCheckoutSchema,
  feeSettingsSchema,
  listInvoicesQuerySchema,
  listInvoicesResponseSchema,
  listPaymentsQuerySchema,
  listPaymentsResponseSchema,
  listSlipsQuerySchema,
  listSlipsResponseSchema,
  manualPaymentSchema,
  myFeesResponseSchema,
  paymentSchema,
  payhereSettingsSchema,
  receiptSchema,
  rejectSlipSchema,
  reminderPreviewSchema,
  reminderTargetSchema,
  reversePaymentSchema,
  sendRemindersResponseSchema,
  sendRemindersSchema,
  signedUrlSchema,
  slipSchema,
  slipUploadRequestSchema,
  slipUploadResponseSchema,
  smsTopUpRequestSchema,
  smsWalletSchema,
  studentFeesSchema,
  submitSlipSchema,
  updateFeeSettingsSchema,
  updatePayhereSettingsSchema,
} from './fees';

import { importJobSchema, importPreviewResponseSchema, studentImportSchema } from './imports';
import {
  inviteStaffSchema,
  staffMemberSchema,
  staffResponseSchema,
  updateStaffSchema,
} from './staff';
import {
  bulkResultSchema,
  bulkStudentActionSchema,
  createStudentSchema,
  listStudentsQuerySchema,
  listStudentsResponseSchema,
  studentDeviceParamsSchema,
  studentEnrollmentSchema,
  studentProfileSchema,
  updateStudentSchema,
} from './students';
import { tenantPublicSchema } from './tenant';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface EndpointDef {
  method: HttpMethod;
  /** Absolute path on the current host. The browser always calls it same-origin (ADR 0003). */
  path: `/api/v1/${string}`;
  /** Request body schema (strict). Absent → no body. */
  request?: z.ZodType;
  /** Success body schema. Absent → 204 No Content. */
  response?: z.ZodType;
  /** Values for the `:name` segments of `path` (strict). */
  params?: z.ZodType;
  /** Query string (strict; values arrive as strings, so numbers use `z.coerce`). */
  query?: z.ZodType;
}

/**
 * The API contract — one entry per endpoint. `apps/api` controllers validate with these schemas
 * and `apps/web` calls them through `createApiClient`. Change a schema here and both sides
 * fail typecheck until they agree.
 */
export const API = {
  /** TEN-01 — public info about the institute that owns the request host. */
  tenant: { method: 'GET', path: '/api/v1/tenant', response: tenantPublicSchema },

  /** AUTH-01 — sets the host-only session cookie. 403 DEVICE_LIMIT carries a challenge (AUTH-03). */
  studentLogin: {
    method: 'POST',
    path: '/api/v1/auth/student/login',
    request: studentLoginRequestSchema,
    response: sessionResponseSchema,
  },
  /** AUTH-05 — 401 TWO_STEP_REQUIRED carries a challenge for owner/admin/cashier. */
  staffLogin: {
    method: 'POST',
    path: '/api/v1/auth/staff/login',
    request: staffLoginRequestSchema,
    response: sessionResponseSchema,
  },
  /** Revokes the current session and clears the cookie. Always 204, even without a session. */
  logout: { method: 'POST', path: '/api/v1/auth/logout' },
  /**
   * Rotates the session token when it is ≥ 15 min old (no-op otherwise) and re-sets the cookie.
   * Called only from the web app's `proxy.ts`, which can set cookies (ADR 0004).
   */
  refreshSession: {
    method: 'POST',
    path: '/api/v1/auth/session/refresh',
    response: sessionResponseSchema,
  },
  /** The signed-in user on this host, or 401 UNAUTHENTICATED. */
  session: { method: 'GET', path: '/api/v1/auth/session', response: sessionResponseSchema },

  /** The signed-in student's enrolled classes. */
  myClasses: { method: 'GET', path: '/api/v1/me/classes', response: myClassesResponseSchema },

  // ----- Phase 2: auth flows (AUTH-02/03/05/07/09) — public, rate-limited -----------------------

  /** AUTH-02/07/09 — same answer whether or not the phone has an account (no enumeration). */
  requestOtp: {
    method: 'POST',
    path: '/api/v1/auth/otp/request',
    request: otpRequestSchema,
    response: otpRequestResponseSchema,
  },
  /** 400 CODE_INVALID on a wrong, expired or burnt code. */
  verifyOtp: {
    method: 'POST',
    path: '/api/v1/auth/otp/verify',
    request: otpVerifySchema,
    response: otpVerifyResponseSchema,
  },
  /** Spends an OTP ticket, activates an invited student, revokes all sessions of the user. */
  setPassword: { method: 'POST', path: '/api/v1/auth/password/set', request: setPasswordSchema },
  /** AUTH-03 — finish a student login blocked by DEVICE_LIMIT by signing one device out. */
  resolveDeviceLimit: {
    method: 'POST',
    path: '/api/v1/auth/student/device-limit',
    request: resolveDeviceLimitSchema,
    response: sessionResponseSchema,
  },
  /** AUTH-05 — finish a staff login blocked by TWO_STEP_REQUIRED. */
  verifyTwoStep: {
    method: 'POST',
    path: '/api/v1/auth/staff/two-step',
    request: twoStepVerifySchema,
    response: sessionResponseSchema,
  },
  resendTwoStep: {
    method: 'POST',
    path: '/api/v1/auth/staff/two-step/resend',
    request: twoStepResendSchema,
    response: twoStepChallengeSchema,
  },
  /** AUTH-07 — POST so the token stays out of URLs and logs. 400 INVITE_INVALID when spent/expired. */
  previewInvite: {
    method: 'POST',
    path: '/api/v1/auth/invite/preview',
    request: inviteTokenSchema,
    response: invitePreviewSchema,
  },
  acceptInvite: {
    method: 'POST',
    path: '/api/v1/auth/invite/accept',
    request: acceptInviteSchema,
    response: sessionResponseSchema,
  },

  // ----- Phase 2: "Me" (AUTH-04) — any signed-in user ------------------------------------------

  updateMe: { method: 'PATCH', path: '/api/v1/me', request: updateMeSchema },
  /** Revokes the user's other sessions. */
  changePassword: { method: 'POST', path: '/api/v1/me/password', request: changePasswordSchema },
  myDevices: { method: 'GET', path: '/api/v1/me/devices', response: devicesResponseSchema },
  signOutMyDevice: { method: 'DELETE', path: '/api/v1/me/devices/:id', params: idParamsSchema },

  // ----- Phase 2: public institute site ---------------------------------------------------------

  /** CLS-06 — a week's timetable for the institute website. */
  publicTimetable: {
    method: 'GET',
    path: '/api/v1/tenant/timetable',
    query: timetableQuerySchema,
    response: publicTimetableResponseSchema,
  },

  // ----- Phase 2: admin (staff only; permission per `ROLE_PERMISSIONS`) -------------------------

  dashboard: { method: 'GET', path: '/api/v1/admin/dashboard', response: dashboardResponseSchema },

  /** STU-01 */
  listStudents: {
    method: 'GET',
    path: '/api/v1/admin/students',
    query: listStudentsQuerySchema,
    response: listStudentsResponseSchema,
  },
  /** STU-03 */
  createStudent: {
    method: 'POST',
    path: '/api/v1/admin/students',
    request: createStudentSchema,
    response: studentProfileSchema,
  },
  /** STU-05 */
  getStudent: {
    method: 'GET',
    path: '/api/v1/admin/students/:id',
    params: idParamsSchema,
    response: studentProfileSchema,
  },
  updateStudent: {
    method: 'PATCH',
    path: '/api/v1/admin/students/:id',
    params: idParamsSchema,
    request: updateStudentSchema,
    response: studentProfileSchema,
  },
  /** STU-02/07 and AUTH-08 bulk sign-out. */
  bulkStudents: {
    method: 'POST',
    path: '/api/v1/admin/students/bulk',
    request: bulkStudentActionSchema,
    response: bulkResultSchema,
  },
  /** AUTH-08 — sign out one device. */
  signOutStudentDevice: {
    method: 'DELETE',
    path: '/api/v1/admin/students/:id/devices/:deviceId',
    params: studentDeviceParamsSchema,
  },
  /** AUTH-08 — revokes sessions and texts a `password_reset` code to the student. */
  resetStudentPassword: {
    method: 'POST',
    path: '/api/v1/admin/students/:id/password-reset',
    params: idParamsSchema,
  },
  /** STU-04 / DAT-01 — dry run, nothing written. */
  previewStudentImport: {
    method: 'POST',
    path: '/api/v1/admin/imports/students/preview',
    request: studentImportSchema,
    response: importPreviewResponseSchema,
  },
  commitStudentImport: {
    method: 'POST',
    path: '/api/v1/admin/imports/students/commit',
    request: studentImportSchema,
    response: importJobSchema,
  },
  /** Status/result of a queued import (only the staff member's own tenant, `students.import`). */
  getImportJob: {
    method: 'GET',
    path: '/api/v1/admin/imports/:id',
    params: idParamsSchema,
    response: importJobSchema,
  },

  /** CLS-01 */
  listClasses: {
    method: 'GET',
    path: '/api/v1/admin/classes',
    query: listClassesQuerySchema,
    response: listClassesResponseSchema,
  },
  /** CLS-02 */
  createClass: {
    method: 'POST',
    path: '/api/v1/admin/classes',
    request: classInputSchema,
    response: classDetailSchema,
  },
  /** CLS-03 */
  getClass: {
    method: 'GET',
    path: '/api/v1/admin/classes/:id',
    params: idParamsSchema,
    response: classDetailSchema,
  },
  updateClass: {
    method: 'PATCH',
    path: '/api/v1/admin/classes/:id',
    params: idParamsSchema,
    request: updateClassSchema,
    response: classDetailSchema,
  },
  /** Archive keeps history; enrolments stay readable. */
  archiveClass: {
    method: 'POST',
    path: '/api/v1/admin/classes/:id/archive',
    params: idParamsSchema,
  },
  classStudents: {
    method: 'GET',
    path: '/api/v1/admin/classes/:id/students',
    params: idParamsSchema,
    response: classStudentsResponseSchema,
  },
  /** CLS-04 */
  enrolStudents: {
    method: 'POST',
    path: '/api/v1/admin/classes/:id/enrollments',
    params: idParamsSchema,
    request: enrolStudentsSchema,
    response: enrolStudentsResponseSchema,
  },
  updateEnrollment: {
    method: 'PATCH',
    path: '/api/v1/admin/enrollments/:id',
    params: idParamsSchema,
    request: updateEnrollmentSchema,
    response: studentEnrollmentSchema,
  },
  moveEnrollment: {
    method: 'POST',
    path: '/api/v1/admin/enrollments/:id/move',
    params: idParamsSchema,
    request: moveEnrollmentSchema,
    response: studentEnrollmentSchema,
  },
  /** CLS-06 */
  timetable: {
    method: 'GET',
    path: '/api/v1/admin/timetable',
    query: timetableQuerySchema,
    response: timetableResponseSchema,
  },

  /** CLS-05 */
  listHalls: { method: 'GET', path: '/api/v1/admin/halls', response: hallsResponseSchema },
  createHall: {
    method: 'POST',
    path: '/api/v1/admin/halls',
    request: hallInputSchema,
    response: hallSchema,
  },
  updateHall: {
    method: 'PUT',
    path: '/api/v1/admin/halls/:id',
    params: idParamsSchema,
    request: hallInputSchema,
    response: hallSchema,
  },
  /** 409 CONFLICT while a class still uses the hall. */
  deleteHall: { method: 'DELETE', path: '/api/v1/admin/halls/:id', params: idParamsSchema },

  /** STF-01/03 */
  listTeachers: { method: 'GET', path: '/api/v1/admin/teachers', response: teachersResponseSchema },
  listStaff: { method: 'GET', path: '/api/v1/admin/staff', response: staffResponseSchema },
  /** 403 PLAN_LIMIT when the plan's seats are used (STF-03). Sends the invite by SMS/email. */
  inviteStaff: {
    method: 'POST',
    path: '/api/v1/admin/staff/invites',
    request: inviteStaffSchema,
    response: staffMemberSchema,
  },
  revokeInvite: {
    method: 'DELETE',
    path: '/api/v1/admin/staff/invites/:id',
    params: idParamsSchema,
  },
  /** STF-02 scope, role change, disable (revokes sessions). */
  updateStaff: {
    method: 'PATCH',
    path: '/api/v1/admin/staff/:id',
    params: idParamsSchema,
    request: updateStaffSchema,
    response: staffMemberSchema,
  },

  /** TEN-03 */
  getTheme: { method: 'GET', path: '/api/v1/admin/settings/theme', response: themeSchema },
  updateTheme: {
    method: 'PATCH',
    path: '/api/v1/admin/settings/theme',
    request: updateThemeSchema,
    response: themeSchema,
  },
  getGeneralSettings: {
    method: 'GET',
    path: '/api/v1/admin/settings/general',
    response: generalSettingsSchema,
  },
  updateGeneralSettings: {
    method: 'PATCH',
    path: '/api/v1/admin/settings/general',
    request: updateGeneralSettingsSchema,
    response: generalSettingsSchema,
  },
  // ----- Phase 3: money (ADR 0008/0009). Permissions in ROLE_PERMISSIONS. -----------------------
  // PayHere notify is POST /api/v1/webhooks/payhere/:tenantSlug (form-encoded, `payhereNotifySchema`):
  // server-to-server only, exempt from the CSRF guard, never called by this client.

  /** FEE-03/10 - the signed-in student's open months, payments, slips and pay options. */
  myFees: { method: 'GET', path: '/api/v1/me/fees', response: myFeesResponseSchema },
  /** FEE-04 - PayHere checkout for whole open months. 409 ALREADY_PAID if a line is paid. */
  createCheckout: {
    method: 'POST',
    path: '/api/v1/me/payments/checkout',
    request: createCheckoutSchema,
    response: checkoutResponseSchema,
  },
  /** The return page polls this; the browser redirect itself proves nothing. */
  checkoutStatus: {
    method: 'GET',
    path: '/api/v1/me/payments/checkout/:id',
    params: idParamsSchema,
    response: checkoutStatusSchema,
  },
  /** FEE-05 - presigned PUT for a slip photo (ADR 0009). */
  requestSlipUpload: {
    method: 'POST',
    path: '/api/v1/me/slips/upload',
    request: slipUploadRequestSchema,
    response: slipUploadResponseSchema,
  },
  submitSlip: {
    method: 'POST',
    path: '/api/v1/me/slips',
    request: submitSlipSchema,
    response: slipSchema,
  },
  /** FEE-09 - the student's own receipt, or any receipt for staff with `fees.read`. */
  receiptPdf: {
    method: 'GET',
    path: '/api/v1/receipts/:id/pdf',
    params: idParamsSchema,
    response: signedUrlSchema,
  },

  /** FEE-02 */
  listInvoices: {
    method: 'GET',
    path: '/api/v1/admin/invoices',
    query: listInvoicesQuerySchema,
    response: listInvoicesResponseSchema,
  },
  /** FEE-02/12 - cost preview before sending (MSG-02 wallet). */
  previewReminders: {
    method: 'POST',
    path: '/api/v1/admin/invoices/reminders/preview',
    request: reminderTargetSchema,
    response: reminderPreviewSchema,
  },
  /** 409 INSUFFICIENT_BALANCE when the wallet cannot cover the cost; nothing is queued then. */
  sendReminders: {
    method: 'POST',
    path: '/api/v1/admin/invoices/reminders/send',
    request: sendRemindersSchema,
    response: sendRemindersResponseSchema,
  },
  /** FEE-07/10 - cash counter and the profile Payments tab. */
  studentFees: {
    method: 'GET',
    path: '/api/v1/admin/students/:id/fees',
    params: idParamsSchema,
    response: studentFeesSchema,
  },
  listPayments: {
    method: 'GET',
    path: '/api/v1/admin/payments',
    query: listPaymentsQuerySchema,
    response: listPaymentsResponseSchema,
  },
  getPayment: {
    method: 'GET',
    path: '/api/v1/admin/payments/:id',
    params: idParamsSchema,
    response: paymentSchema,
  },
  /** FEE-07 - idempotent on `idempotencyKey`: a retry returns the existing payment. */
  recordCashPayment: {
    method: 'POST',
    path: '/api/v1/admin/payments/cash',
    request: cashPaymentSchema,
    response: paymentSchema,
  },
  /** FEE-08 */
  recordManualPayment: {
    method: 'POST',
    path: '/api/v1/admin/payments/manual',
    request: manualPaymentSchema,
    response: paymentSchema,
  },
  /** FEE-11 - owner only; returns the reversal payment. 409 CONFLICT if already reversed. */
  reversePayment: {
    method: 'POST',
    path: '/api/v1/admin/payments/:id/reverse',
    params: idParamsSchema,
    request: reversePaymentSchema,
    response: paymentSchema,
  },
  /** FEE-09 - data for the 80 mm print layout and reprint. */
  getReceipt: {
    method: 'GET',
    path: '/api/v1/admin/receipts/:id',
    params: idParamsSchema,
    response: receiptSchema,
  },
  /** FEE-06 - oldest first. */
  listSlips: {
    method: 'GET',
    path: '/api/v1/admin/slips',
    query: listSlipsQuerySchema,
    response: listSlipsResponseSchema,
  },
  getSlip: {
    method: 'GET',
    path: '/api/v1/admin/slips/:id',
    params: idParamsSchema,
    response: slipSchema,
  },
  /** Signed URL (<= 10 min) of the processed slip image. */
  slipImage: {
    method: 'GET',
    path: '/api/v1/admin/slips/:id/image',
    params: idParamsSchema,
    response: signedUrlSchema,
  },
  /** Creates a `slip` payment for the expected amount (ADR 0008 section 5). */
  approveSlip: {
    method: 'POST',
    path: '/api/v1/admin/slips/:id/approve',
    params: idParamsSchema,
    request: approveSlipSchema,
    response: slipSchema,
  },
  rejectSlip: {
    method: 'POST',
    path: '/api/v1/admin/slips/:id/reject',
    params: idParamsSchema,
    request: rejectSlipSchema,
    response: slipSchema,
  },

  /** SET-02 - owner only; the secret is write-only. */
  getPayhereSettings: {
    method: 'GET',
    path: '/api/v1/admin/settings/payhere',
    response: payhereSettingsSchema,
  },
  updatePayhereSettings: {
    method: 'PATCH',
    path: '/api/v1/admin/settings/payhere',
    request: updatePayhereSettingsSchema,
    response: payhereSettingsSchema,
  },
  /** SET-02 "Test payment (LKR 10)" - a checkout paid by the owner, not tied to a student. */
  testPayhere: {
    method: 'POST',
    path: '/api/v1/admin/settings/payhere/test',
    response: checkoutResponseSchema,
  },
  /** SET-03, FEE-09 receipt template, FEE-12 due day and reminders. */
  getFeeSettings: {
    method: 'GET',
    path: '/api/v1/admin/settings/fees',
    response: feeSettingsSchema,
  },
  updateFeeSettings: {
    method: 'PATCH',
    path: '/api/v1/admin/settings/fees',
    request: updateFeeSettingsSchema,
    response: feeSettingsSchema,
  },
  /** MSG-02 */
  smsWallet: { method: 'GET', path: '/api/v1/admin/sms/wallet', response: smsWalletSchema },
  /** "Buy SMS": Recca staff invoice and credit it (platform billing is Phase 7). */
  requestSmsTopUp: {
    method: 'POST',
    path: '/api/v1/admin/sms/wallet/top-up',
    request: smsTopUpRequestSchema,
  },
} as const satisfies Record<string, EndpointDef>;

export type ApiName = keyof typeof API;
type Def<N extends ApiName> = (typeof API)[N];

/** What the caller passes (before schema defaults/transforms). */
export type ApiInput<N extends ApiName> =
  Def<N> extends { request: infer S extends z.ZodType } ? z.input<S> : undefined;

/** Path params and query for endpoints that declare them. */
export type ApiOptions<N extends ApiName> = (Def<N> extends { params: infer P extends z.ZodType }
  ? { params: z.input<P> }
  : unknown) &
  (Def<N> extends { query: infer Q extends z.ZodType } ? { query?: z.input<Q> } : unknown);

/** What the caller gets back (after parsing). */
export type ApiOutput<N extends ApiName> =
  Def<N> extends { response: infer S extends z.ZodType } ? z.output<S> : undefined;
