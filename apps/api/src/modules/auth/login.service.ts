import type { IncomingHttpHeaders } from 'node:http';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import {
  LOGIN_LIMITS,
  OTP_RULES,
  parseStaffIdentifier,
  staffLoginRequestSchema,
  studentLoginRequestSchema,
  tenantAccess,
  TRUSTED_DEVICE_DAYS,
  TWO_STEP_ROLES,
  type DeviceLimitChallenge,
  type StaffIdentifier,
  type StaffRole,
  type TwoStepChallenge,
  type UserKind,
} from '@remix/types/api';
import { AppException } from '../../common/errors/app-exception';
import { tenantUnavailable } from '../../common/tenant/tenant-access.guard';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { CLOCK, type Clock } from '../../common/time/clock';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { AuditService, maskIdentifier } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { AuthSmsService } from './auth-sms.service';
import { CodeSendLimits } from './code-send-limits';
import { digestsEqual, hashCode, maskPhone, newOtpCode } from './codes';
import { cookieNames, readCookie } from './cookies';
import { activeDevices, isTrusted, signOutDevice, type ActiveDevice } from './device-store';
import { sessionExpiresAt } from './lifetimes';
import { PasswordService } from './passwords';
import { SessionIssuer, type IssueUser, type LoginResult } from './session-issuer';
import {
  createTicket,
  failTicketAttempt,
  findOpenTicket,
  spendTicket,
  type OpenTicket,
} from './tickets';
import { hashToken, isOpaqueToken, newOpaqueToken } from './tokens';

export type { LoginResult } from './session-issuer';

const { tenantUsers, students, staffRoles, devices, tenants } = schema;

export interface LoginInput {
  password: string;
  staySignedIn: boolean;
  headers: IncomingHttpHeaders;
}

/** A finished sign-in, plus the trust cookie to set when "trust this computer" was ticked. */
export interface SignedIn extends LoginResult {
  trustToken?: string;
}

/** Why a login failed — audit detail only; the client sees one of a few fixed responses. */
type FailureReason =
  'unknown_user' | 'wrong_password' | 'not_active' | 'disabled' | 'archived' | 'locked';

interface Candidate extends IssueUser {
  phone: string | null;
  status: 'active' | 'disabled' | 'invited';
  passwordHash: string | null;
  archivedAt: Date | null;
  lockedAt: Date | null;
}

export const INVALID_CREDENTIALS_TITLE = 'Phone number or password is incorrect';

/** 401 `INVALID_CREDENTIALS` — identical for an unknown user and a wrong password. */
export function invalidCredentials(): AppException {
  return new AppException('INVALID_CREDENTIALS', 401, INVALID_CREDENTIALS_TITLE);
}

/** 423 `ACCOUNT_LOCKED` — after 10 failures, for accounts and unknown identifiers alike. */
export function accountLocked(): AppException {
  return new AppException('ACCOUNT_LOCKED', 423, 'This account is locked', {
    detail: 'Too many wrong passwords. Unlock it with a code sent by SMS.',
  });
}

/** 400 `CODE_INVALID` — the same for a wrong, expired, burnt or unknown code or ticket. */
export function codeInvalid(): AppException {
  return new AppException('CODE_INVALID', 400, 'That code is not valid', {
    detail: 'Check the code, or ask for a new one.',
  });
}

const twoStepRoles: readonly StaffRole[] = TWO_STEP_ROLES;
export const needsTwoStep = (roles: readonly StaffRole[]) =>
  roles.some((role) => twoStepRoles.includes(role));

const LK_MOBILE = /^\+947\d{8}$/;
const TRUST_MS = TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000;

/** Identifier key for the failure counter (normalised; the same for both login endpoints). */
function failureKey(identifier: StaffIdentifier | null, raw: string): string {
  if (!identifier) return `raw:${raw.trim().toLowerCase()}`;
  return identifier.kind === 'phone' ? `phone:${identifier.phone}` : `email:${identifier.email}`;
}

/**
 * AUTH-01/03/05/09 per ADR 0004 and its addendum:
 * - tenant status first (TEN-06): no credential work for a tenant that can't sign this kind in;
 * - lookup inside `withTenant(hostTenant)`, filtered by user kind;
 * - Argon2id verify outside any transaction, always (an unknown user verifies against the
 *   boot-time dummy hash), so timing does not depend on whether the account exists;
 * - lockout (AUTH-09): 10 consecutive failures lock an account until an `unlock` SMS code;
 *   a locked account answers `ACCOUNT_LOCKED` even to the right password (no password oracle),
 *   and an identifier without an account answers the same after the same number of failures;
 * - `ACCOUNT_DISABLED` only after a correct password;
 * - students: a third active device → 403 `DEVICE_LIMIT` with a single-use ticket (AUTH-03);
 * - owner/admin/cashier on an untrusted computer → 401 `TWO_STEP_REQUIRED`, code by SMS
 *   (AUTH-05); "trust this computer" sets a 30-day trust cookie stored hashed on the device.
 */
@Injectable()
export class LoginService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly issuer: SessionIssuer,
    private readonly limits: CodeSendLimits,
    private readonly sms: AuthSmsService,
  ) {}

  async studentLogin(
    tenant: ResolvedTenant,
    input: LoginInput & { phone: string },
  ): Promise<LoginResult> {
    if (!tenantAccess(tenant.status).studentPortal) throw tenantUnavailable();
    const identifier: StaffIdentifier = { kind: 'phone', phone: input.phone };
    return this.login(tenant, 'student', identifier, input.phone, input);
  }

  async staffLogin(
    tenant: ResolvedTenant,
    input: LoginInput & { identifier: string },
  ): Promise<LoginResult> {
    if (tenantAccess(tenant.status).staff === 'none') throw tenantUnavailable();
    const identifier = parseStaffIdentifier(input.identifier);
    return this.login(tenant, 'staff', identifier, input.identifier, input);
  }

  private async login(
    tenant: ResolvedTenant,
    kind: UserKind,
    identifier: StaffIdentifier | null,
    rawIdentifier: string,
    input: LoginInput,
  ): Promise<LoginResult> {
    const user = identifier ? await this.findUser(tenant.id, kind, identifier) : null;

    const passwordOk = user?.passwordHash
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);

    if (!user || !passwordOk || user.lockedAt) {
      // Counted for every failure, with or without an account (see CodeSendLimits).
      const counter = await this.limits.countFailure(
        tenant.id,
        failureKey(identifier, rawIdentifier),
      );
      if (!user) {
        await this.recordFailure(tenant.id, kind, null, identifier, 'unknown_user');
        throw counter.reachedLockout ? accountLocked() : invalidCredentials();
      }
      if (user.lockedAt) {
        await this.recordFailure(tenant.id, kind, user.id, identifier, 'locked');
        throw accountLocked();
      }
      const lockedNow = await this.registerFailure(tenant.id, user, identifier);
      throw lockedNow ? accountLocked() : invalidCredentials();
    }

    if (user.status === 'invited') {
      await this.recordFailure(tenant.id, kind, user.id, identifier, 'not_active');
      throw invalidCredentials();
    }
    if (user.status === 'disabled' || (kind === 'student' && user.archivedAt !== null)) {
      const reason = user.status === 'disabled' ? 'disabled' : 'archived';
      await this.recordFailure(tenant.id, kind, user.id, identifier, reason);
      throw new AppException('ACCOUNT_DISABLED', 403, 'This account is disabled', {
        detail: 'Contact your institute to restore access.',
      });
    }

    const rehash =
      user.passwordHash && this.passwords.needsRehash(user.passwordHash)
        ? await this.passwords.hash(input.password)
        : null;

    if (kind === 'staff' && needsTwoStep(user.roles)) {
      const trusted = await this.trustedComputer(tenant.id, user.id, input.headers);
      if (!trusted) return this.startTwoStep(tenant.id, user, input.staySignedIn, rehash);
    }

    const now = this.clock.now();
    const outcome = await withTenant(this.db, tenant.id, async (tx) => {
      const issued = await this.issuer.issue(tx, tenant.id, user, {
        staySignedIn: input.staySignedIn,
        headers: input.headers,
        now,
        expiresAt: sessionExpiresAt(now, input.staySignedIn),
        method: 'password',
        identifier,
        rehash,
        enforceDeviceLimit: true,
      });
      if (issued.status === 'issued') return issued;
      // Password was right but the student is on 2 devices: a 5-minute single-use ticket proves
      // it to resolveDeviceLimit; it grants nothing by itself.
      await tx
        .update(tenantUsers)
        .set({ failedLoginCount: 0 })
        .where(and(eq(tenantUsers.tenantId, tenant.id), eq(tenantUsers.id, user.id)));
      const ticket = await createTicket(tx, tenant.id, {
        userId: user.id,
        kind: 'device_limit',
        now,
        staySignedIn: input.staySignedIn,
      });
      return { status: 'device_limit' as const, ticket, devices: issued.devices };
    });

    if (outcome.status === 'issued') return outcome.result;
    const challenge: DeviceLimitChallenge = {
      token: outcome.ticket.token,
      devices: outcome.devices.map(publicDevice),
      expiresAt: outcome.ticket.expiresAt.toISOString(),
    };
    throw new AppException('DEVICE_LIMIT', 403, 'You are signed in on 2 devices', {
      detail: 'Sign one of them out to continue on this device.',
      challenge,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // AUTH-03 — finish a login blocked by the device limit

  async resolveDeviceLimit(
    tenant: ResolvedTenant,
    input: { token: string; signOutDeviceId: string; headers: IncomingHttpHeaders },
  ): Promise<LoginResult> {
    if (!tenantAccess(tenant.status).studentPortal) throw tenantUnavailable();
    const now = this.clock.now();
    return withTenant(this.db, tenant.id, async (tx) => {
      const ticket = await findOpenTicket(tx, tenant.id, 'device_limit', input.token, now, {
        forUpdate: true,
      });
      if (!ticket) throw codeInvalid();
      const user = await this.loadUser(tx, tenant.id, ticket.userId);
      if (!user || !this.canSignIn(user) || user.kind !== 'student') throw codeInvalid();

      const active = await activeDevices(tx, tenant.id, user.id, now);
      if (!active.some((d) => d.id === input.signOutDeviceId)) {
        throw new AppException('VALIDATION_FAILED', 400, 'Choose one of your devices', {
          errors: [{ path: 'signOutDeviceId', message: 'Not one of your signed-in devices' }],
        });
      }
      if (!(await spendTicket(tx, tenant.id, ticket.id, now))) throw codeInvalid();

      await signOutDevice(tx, tenant.id, {
        userId: user.id,
        deviceId: input.signOutDeviceId,
        by: user.id,
        reason: 'device_signed_out',
        now,
      });
      await this.audit.record(tx, tenant.id, {
        action: 'auth.device.signed_out',
        actorId: user.id,
        actorKind: 'student',
        entity: 'device',
        entityId: input.signOutDeviceId,
        after: { reason: 'device_limit', userId: user.id },
        at: now,
      });

      const issued = await this.issuer.issue(tx, tenant.id, user, {
        staySignedIn: ticket.staySignedIn,
        headers: input.headers,
        now,
        expiresAt: sessionExpiresAt(now, ticket.staySignedIn),
        method: 'device_limit',
        enforceDeviceLimit: true,
      });
      // Another device signed in between the two steps: roll everything back (the ticket stays
      // unspent) and let the student choose again.
      if (issued.status !== 'issued') {
        throw new AppException('CONFLICT', 409, 'Your devices changed. Try again.');
      }
      return issued.result;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // AUTH-05 — staff two-step

  async verifyTwoStep(
    tenant: ResolvedTenant,
    input: { token: string; code: string; trustDevice: boolean; headers: IncomingHttpHeaders },
  ): Promise<SignedIn> {
    if (tenantAccess(tenant.status).staff === 'none') throw tenantUnavailable();
    const now = this.clock.now();
    const outcome = await withTenant(this.db, tenant.id, async (tx) => {
      const ticket = await findOpenTicket(tx, tenant.id, 'two_step', input.token, now, {
        forUpdate: true,
      });
      if (!ticket?.codeHash) return { status: 'invalid' as const };
      const actual = hashCode(
        this.config.authCodeSecret,
        [tenant.id, ticket.userId, 'two_step'],
        input.code,
      );
      if (!digestsEqual(actual, ticket.codeHash)) {
        await failTicketAttempt(tx, tenant.id, ticket.id, now);
        return { status: 'invalid' as const };
      }
      const user = await this.loadUser(tx, tenant.id, ticket.userId);
      if (!user || !this.canSignIn(user) || user.kind !== 'staff') {
        return { status: 'invalid' as const };
      }
      if (!(await spendTicket(tx, tenant.id, ticket.id, now)))
        return { status: 'invalid' as const };

      const issued = await this.issuer.issue(tx, tenant.id, user, {
        staySignedIn: ticket.staySignedIn,
        headers: input.headers,
        now,
        expiresAt: sessionExpiresAt(now, ticket.staySignedIn),
        method: 'two_step',
        enforceDeviceLimit: false,
      });
      if (issued.status !== 'issued') throw new Error('Staff sessions are never device-limited');
      const result: SignedIn = issued.result;

      await this.audit.record(tx, tenant.id, {
        action: 'auth.two_step.verified',
        actorId: user.id,
        actorKind: 'staff',
        entity: 'session',
        entityId: result.session.id,
        after: { trustDevice: input.trustDevice },
        at: now,
      });
      if (input.trustDevice && result.session.deviceId) {
        const trustToken = newOpaqueToken();
        const trustedUntil = new Date(now.getTime() + TRUST_MS);
        await tx
          .update(devices)
          .set({ trustTokenHash: hashToken(trustToken), trustedUntil })
          .where(and(eq(devices.tenantId, tenant.id), eq(devices.id, result.session.deviceId)));
        await this.audit.record(tx, tenant.id, {
          action: 'auth.device.trusted',
          actorId: user.id,
          actorKind: 'staff',
          entity: 'device',
          entityId: result.session.deviceId,
          after: { trustedUntil: trustedUntil.toISOString() },
          at: now,
        });
        result.trustToken = trustToken;
      }
      return { status: 'ok' as const, result };
    });
    if (outcome.status === 'invalid') throw codeInvalid();
    return outcome.result;
  }

  /** A new code for a pending two-step: 45 s apart, 3 per ticket, and the per-phone window. */
  async resendTwoStep(tenant: ResolvedTenant, token: string): Promise<TwoStepChallenge> {
    if (tenantAccess(tenant.status).staff === 'none') throw tenantUnavailable();
    const now = this.clock.now();
    return withTenant(this.db, tenant.id, async (tx) => {
      const ticket = await findOpenTicket(tx, tenant.id, 'two_step', token, now, {
        forUpdate: true,
      });
      if (!ticket) throw codeInvalid();
      const user = await this.loadUser(tx, tenant.id, ticket.userId);
      if (!user?.phone || !this.canSignIn(user)) throw codeInvalid();

      const wait = resendWait(ticket, now);
      if (wait > 0) throw rateLimited(wait);
      if (ticket.sends >= OTP_RULES.maxPerWindow)
        throw rateLimited(secondsUntil(ticket.expiresAt, now));
      const decision = await this.limits.consumeSend(tenant.id, user.phone);
      if (!decision.allowed) throw rateLimited(decision.retryAfterSec);

      const code = newOtpCode();
      const expiresAt = new Date(now.getTime() + OTP_RULES.ttlSeconds * 1000);
      await tx
        .update(schema.authTickets)
        .set({
          codeHash: hashCode(this.config.authCodeSecret, [tenant.id, user.id, 'two_step'], code),
          attempts: 0,
          sends: ticket.sends + 1,
          lastSentAt: now,
          expiresAt,
        })
        .where(
          and(eq(schema.authTickets.tenantId, tenant.id), eq(schema.authTickets.id, ticket.id)),
        );
      await this.sms.send(tenant.id, `${ticket.id}-${ticket.sends + 1}`, user.phone, {
        kind: 'code',
        purpose: 'two_step',
        code,
        tenantName: await this.tenantName(tx, tenant.id),
      });
      return {
        token,
        maskedPhone: maskPhone(user.phone),
        resendAfterSeconds: OTP_RULES.resendAfterSeconds,
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  private async startTwoStep(
    tenantId: string,
    user: Candidate,
    staySignedIn: boolean,
    rehash: string | null,
  ): Promise<never> {
    // Fail closed: a role that needs 2-step cannot sign in without a mobile to send it to.
    if (!user.phone || !LK_MOBILE.test(user.phone)) {
      throw new AppException('FORBIDDEN', 403, 'Two-step sign-in needs a mobile number', {
        detail: 'Ask the institute owner to add your Sri Lankan mobile number.',
      });
    }
    const phone = user.phone;
    const decision = await this.limits.consumeSend(tenantId, phone);
    if (!decision.allowed) throw rateLimited(decision.retryAfterSec);

    const now = this.clock.now();
    const code = newOtpCode();
    const ticket = await withTenant(this.db, tenantId, async (tx) => {
      if (rehash) {
        await tx
          .update(tenantUsers)
          .set({ passwordHash: rehash })
          .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.id, user.id)));
      }
      const created = await createTicket(tx, tenantId, {
        userId: user.id,
        kind: 'two_step',
        now,
        staySignedIn,
        codeHash: hashCode(this.config.authCodeSecret, [tenantId, user.id, 'two_step'], code),
      });
      await this.sms.send(tenantId, `${created.id}-1`, phone, {
        kind: 'code',
        purpose: 'two_step',
        code,
        tenantName: await this.tenantName(tx, tenantId),
      });
      return created;
    });
    const challenge: TwoStepChallenge = {
      token: ticket.token,
      maskedPhone: maskPhone(phone),
      resendAfterSeconds: OTP_RULES.resendAfterSeconds,
      expiresAt: ticket.expiresAt.toISOString(),
    };
    throw new AppException('TWO_STEP_REQUIRED', 401, 'Enter the code we sent by SMS', {
      challenge,
    });
  }

  private async trustedComputer(
    tenantId: string,
    userId: string,
    headers: IncomingHttpHeaders,
  ): Promise<boolean> {
    const presented = readCookie(headers, cookieNames(this.config.cookieSecure).trust);
    if (!isOpaqueToken(presented)) return false;
    const now = this.clock.now();
    return withTenant(this.db, tenantId, (tx) =>
      isTrusted(tx, tenantId, userId, hashToken(presented), now),
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Users and failures

  private canSignIn(user: Candidate): boolean {
    return (
      user.status === 'active' &&
      user.lockedAt === null &&
      !(user.kind === 'student' && user.archivedAt !== null)
    );
  }

  private userColumns() {
    return {
      id: tenantUsers.id,
      kind: tenantUsers.kind,
      phone: tenantUsers.phone,
      status: tenantUsers.status,
      passwordHash: tenantUsers.passwordHash,
      mustChangePassword: tenantUsers.mustChangePassword,
      displayName: tenantUsers.displayName,
      locale: tenantUsers.locale,
      lockedAt: tenantUsers.lockedAt,
      archivedAt: students.archivedAt,
      roles: sql<StaffRole[]>`coalesce((
        select array_agg(${staffRoles.role}::text order by ${staffRoles.role})
        from ${staffRoles}
        where ${staffRoles.tenantId} = ${tenantUsers.tenantId}
          and ${staffRoles.userId} = ${tenantUsers.id}
      ), '{}')`,
    };
  }

  private async findUser(
    tenantId: string,
    kind: UserKind,
    identifier: StaffIdentifier,
  ): Promise<Candidate | null> {
    const match =
      identifier.kind === 'phone'
        ? eq(tenantUsers.phone, identifier.phone)
        : sql`lower(${tenantUsers.email}) = ${identifier.email}`;
    const rows = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select(this.userColumns())
        .from(tenantUsers)
        .leftJoin(
          students,
          and(eq(students.tenantId, tenantUsers.tenantId), eq(students.userId, tenantUsers.id)),
        )
        .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.kind, kind), match))
        .limit(1),
    );
    return rows[0] ?? null;
  }

  private async loadUser(tx: Tx, tenantId: string, userId: string): Promise<Candidate | null> {
    const rows = await tx
      .select(this.userColumns())
      .from(tenantUsers)
      .leftJoin(
        students,
        and(eq(students.tenantId, tenantUsers.tenantId), eq(students.userId, tenantUsers.id)),
      )
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.id, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async tenantName(tx: Tx, tenantId: string): Promise<string> {
    const [row] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return row?.name ?? 'ReMix';
  }

  /**
   * One more wrong password for an existing account: atomically count it and lock the account
   * at the threshold (audited once, when it locks). Returns true when this failure locked it.
   */
  private async registerFailure(
    tenantId: string,
    user: Candidate,
    identifier: StaffIdentifier | null,
  ): Promise<boolean> {
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .update(tenantUsers)
        .set({
          failedLoginCount: sql`least(${tenantUsers.failedLoginCount} + 1, 1000)`,
          lockedAt: sql`case
            when ${tenantUsers.lockedAt} is null
             and ${tenantUsers.failedLoginCount} + 1 >= ${LOGIN_LIMITS.lockoutAfterFailures}
            then ${now}::timestamptz else ${tenantUsers.lockedAt} end`,
        })
        .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.id, user.id)))
        .returning({ count: tenantUsers.failedLoginCount, lockedAt: tenantUsers.lockedAt });
      await this.audit.record(tx, tenantId, {
        action: 'auth.login.failed',
        actorId: user.id,
        actorKind: user.kind,
        entity: 'session',
        entityId: null,
        after: { reason: 'wrong_password', identifier: maskIdentifier(identifier) },
        at: now,
      });
      const lockedNow = row?.lockedAt?.getTime() === now.getTime();
      if (lockedNow) {
        await this.audit.record(tx, tenantId, {
          action: 'auth.lockout',
          actorId: user.id,
          actorKind: user.kind,
          entity: 'tenant_user',
          entityId: user.id,
          after: { failedLoginCount: row.count },
          at: now,
        });
      }
      return lockedNow;
    });
  }

  private async recordFailure(
    tenantId: string,
    kind: UserKind,
    userId: string | null,
    identifier: StaffIdentifier | null,
    reason: FailureReason,
  ): Promise<void> {
    const now = this.clock.now();
    await withTenant(this.db, tenantId, (tx) =>
      this.audit.record(tx, tenantId, {
        action: 'auth.login.failed',
        actorId: userId,
        actorKind: kind,
        entity: 'session',
        entityId: null,
        after: { reason, identifier: maskIdentifier(identifier) },
        at: now,
      }),
    );
  }
}

function publicDevice(device: ActiveDevice) {
  return {
    id: device.id,
    label: device.label,
    firstSeenAt: device.firstSeenAt.toISOString(),
    lastSeenAt: device.lastSeenAt.toISOString(),
  };
}

function secondsUntil(at: Date, now: Date): number {
  return Math.max(1, Math.ceil((at.getTime() - now.getTime()) / 1000));
}

function resendWait(ticket: OpenTicket, now: Date): number {
  if (!ticket.lastSentAt) return 0;
  const next = ticket.lastSentAt.getTime() + OTP_RULES.resendAfterSeconds * 1000;
  return next > now.getTime() ? secondsUntil(new Date(next), now) : 0;
}

export function rateLimited(retryAfterSec: number): AppException {
  return new AppException('RATE_LIMITED', 429, 'Too many attempts. Try again later.', {
    headers: { 'retry-after': String(Math.max(1, Math.ceil(retryAfterSec))) },
  });
}

/** Bucket for a body that is not a valid login request; never `null` (= "skip the rule"). */
export const INVALID_LOGIN_KEY = 'invalid';

/**
 * Login endpoints' per-identifier rate-limit key. Guards run before the validation interceptor,
 * so the raw body is parsed here with the same schema the endpoint uses: the key is built from
 * the value the login would actually use (trimmed, phone/email normalised), never from the raw
 * string. Padding, case or number format therefore cannot move an attempt to a fresh budget,
 * and the staff and student endpoints share one budget per account. A body that does not parse
 * (validation rejects it anyway) counts against one shared bucket instead of being skipped.
 */
export function loginIdentifierKey(kind: UserKind, body: unknown): string {
  if (kind === 'student') {
    const parsed = studentLoginRequestSchema.safeParse(body);
    return parsed.success ? `phone:${parsed.data.phone}` : INVALID_LOGIN_KEY;
  }
  const parsed = staffLoginRequestSchema.safeParse(body);
  if (!parsed.success) return INVALID_LOGIN_KEY;
  const identifier = parseStaffIdentifier(parsed.data.identifier);
  if (!identifier) return `raw:${parsed.data.identifier.toLowerCase()}`;
  return identifier.kind === 'phone' ? `phone:${identifier.phone}` : `email:${identifier.email}`;
}
