import type { IncomingHttpHeaders } from 'node:http';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import {
  parseStaffIdentifier,
  staffLoginRequestSchema,
  studentLoginRequestSchema,
  tenantAccess,
  type StaffIdentifier,
  type StaffRole,
  type UserKind,
} from '@remix/types/api';
import { AppException } from '../../common/errors/app-exception';
import { tenantUnavailable } from '../../common/tenant/tenant-access.guard';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { CLOCK, type Clock } from '../../common/time/clock';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { AuditService, maskIdentifier } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { cookieNames, readCookie } from './cookies';
import { deviceLabel, storedUserAgent } from './device-label';
import { sessionExpiresAt } from './lifetimes';
import { PasswordService } from './passwords';
import type { SessionRecord } from './session.service';
import {
  hashToken,
  isDeviceToken,
  newDeviceToken,
  newSessionToken,
  parseSessionToken,
} from './tokens';

const { tenantUsers, students, staffRoles, sessions, devices } = schema;

export interface LoginInput {
  password: string;
  staySignedIn: boolean;
  headers: IncomingHttpHeaders;
}

export interface LoginResult {
  session: SessionRecord;
  /** Fresh session token for the cookie — never in a response body or a log. */
  sessionToken: string;
  /** Device id for the device cookie (re-set on every login so it keeps its 400 days). */
  deviceToken: string;
}

/** Why a login failed — audit detail only; the client always sees the same response. */
type FailureReason = 'unknown_user' | 'wrong_password' | 'not_active' | 'disabled' | 'archived';

interface Candidate {
  id: string;
  kind: UserKind;
  status: 'active' | 'disabled' | 'invited';
  passwordHash: string | null;
  mustChangePassword: boolean;
  displayName: string;
  locale: SessionRecord['locale'];
  archivedAt: Date | null;
  roles: StaffRole[];
}

export const INVALID_CREDENTIALS_TITLE = 'Phone number or password is incorrect';

/** 401 `INVALID_CREDENTIALS` — identical for an unknown user and a wrong password. */
export function invalidCredentials(): AppException {
  return new AppException('INVALID_CREDENTIALS', 401, INVALID_CREDENTIALS_TITLE);
}

/**
 * AUTH-01 / AUTH-05 (basic) per ADR 0004:
 * - tenant status first (TEN-06): no credential work for a tenant that can't sign this kind in;
 * - lookup inside `withTenant(hostTenant)`, filtered by user kind, so a student at the staff
 *   endpoint (or vice versa) is simply "unknown";
 * - Argon2id verify outside the transaction (no pooled connection held while hashing); an
 *   unknown user verifies against the boot-time dummy hash, so timing and response match a
 *   wrong password;
 * - `ACCOUNT_DISABLED` only after a correct password (disabled user, archived student);
 * - success: a fresh token (no fixation; a session the browser already had is revoked), the
 *   known device reused or a new one recorded, a re-hash if the parameters changed, and the
 *   audit row — all in one transaction.
 */
@Injectable()
export class LoginService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async studentLogin(
    tenant: ResolvedTenant,
    input: LoginInput & { phone: string },
  ): Promise<LoginResult> {
    if (!tenantAccess(tenant.status).studentPortal) throw tenantUnavailable();
    const identifier: StaffIdentifier = { kind: 'phone', phone: input.phone };
    return this.login(tenant, 'student', identifier, input);
  }

  async staffLogin(
    tenant: ResolvedTenant,
    input: LoginInput & { identifier: string },
  ): Promise<LoginResult> {
    if (tenantAccess(tenant.status).staff === 'none') throw tenantUnavailable();
    return this.login(tenant, 'staff', parseStaffIdentifier(input.identifier), input);
  }

  private async login(
    tenant: ResolvedTenant,
    kind: UserKind,
    identifier: StaffIdentifier | null,
    input: LoginInput,
  ): Promise<LoginResult> {
    const user = identifier ? await this.findUser(tenant.id, kind, identifier) : null;

    const passwordOk = user?.passwordHash
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);

    if (!user || !passwordOk) {
      await this.recordFailure(tenant.id, kind, user?.id ?? null, identifier, {
        reason: user ? 'wrong_password' : 'unknown_user',
      });
      throw invalidCredentials();
    }
    if (user.status === 'invited') {
      await this.recordFailure(tenant.id, kind, user.id, identifier, { reason: 'not_active' });
      throw invalidCredentials();
    }
    if (user.status === 'disabled' || (kind === 'student' && user.archivedAt !== null)) {
      const reason = user.status === 'disabled' ? 'disabled' : 'archived';
      await this.recordFailure(tenant.id, kind, user.id, identifier, { reason });
      throw new AppException('ACCOUNT_DISABLED', 403, 'This account is disabled', {
        detail: 'Contact your institute to restore access.',
      });
    }

    const rehash =
      user.passwordHash && this.passwords.needsRehash(user.passwordHash)
        ? await this.passwords.hash(input.password)
        : null;
    return this.createSession(tenant.id, user, input, identifier, rehash);
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
        .select({
          id: tenantUsers.id,
          kind: tenantUsers.kind,
          status: tenantUsers.status,
          passwordHash: tenantUsers.passwordHash,
          mustChangePassword: tenantUsers.mustChangePassword,
          displayName: tenantUsers.displayName,
          locale: tenantUsers.locale,
          archivedAt: students.archivedAt,
          roles: sql<StaffRole[]>`coalesce((
            select array_agg(${staffRoles.role}::text order by ${staffRoles.role})
            from ${staffRoles}
            where ${staffRoles.tenantId} = ${tenantUsers.tenantId}
              and ${staffRoles.userId} = ${tenantUsers.id}
          ), '{}')`,
        })
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

  private async createSession(
    tenantId: string,
    user: Candidate,
    input: LoginInput,
    identifier: StaffIdentifier | null,
    rehash: string | null,
  ): Promise<LoginResult> {
    const now = this.clock.now();
    const names = cookieNames(this.config.cookieSecure);
    const sessionToken = newSessionToken(now);
    const expiresAt = sessionExpiresAt(now, input.staySignedIn);
    const userAgent = readUserAgent(input.headers);
    const presentedDevice = readCookie(input.headers, names.device);
    const previousSession = parseSessionToken(readCookie(input.headers, names.session));

    return withTenant(this.db, tenantId, async (tx) => {
      // No fixation: whatever session this browser held on this host is replaced, not reused.
      if (previousSession) {
        await tx
          .update(sessions)
          .set({ revokedAt: now, revokedReason: 'replaced' })
          .where(
            and(
              eq(sessions.tenantId, tenantId),
              eq(sessions.tokenHash, hashToken(previousSession.token)),
              isNull(sessions.revokedAt),
            ),
          );
      }

      const device = await this.useDevice(tx, tenantId, user.id, presentedDevice, userAgent, now);

      const [created] = await tx
        .insert(sessions)
        .values({
          tenantId,
          userId: user.id,
          tokenHash: hashToken(sessionToken),
          familyId: sql`uuidv7()`,
          deviceId: device.id,
          staySignedIn: input.staySignedIn,
          lastSeenAt: now,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: sessions.id, familyId: sessions.familyId });
      if (!created) throw new Error('Session insert returned nothing');

      if (rehash) {
        await tx
          .update(tenantUsers)
          .set({ passwordHash: rehash })
          .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.id, user.id)));
      }

      await this.audit.record(tx, tenantId, {
        action: 'auth.login.succeeded',
        actorId: user.id,
        actorKind: user.kind,
        entity: 'session',
        entityId: created.id,
        after: {
          identifier: maskIdentifier(identifier),
          staySignedIn: input.staySignedIn,
          deviceId: device.id,
          newDevice: device.isNew,
          ...(rehash ? { passwordRehashed: true } : {}),
        },
        at: now,
      });

      // The owner's first password is temporary (tenant:create / reset). Until the first-login
      // change is enforced (AUTH-07, Phase 2) every login that still uses it is flagged, so a
      // never-rotated temporary password shows up in the audit trail.
      if (user.mustChangePassword) {
        await this.audit.record(tx, tenantId, {
          action: 'auth.login.temporary_password',
          actorId: user.id,
          actorKind: user.kind,
          entity: 'session',
          entityId: created.id,
          after: { identifier: maskIdentifier(identifier) },
          at: now,
        });
      }

      return {
        sessionToken,
        deviceToken: device.token,
        session: {
          id: created.id,
          tenantId,
          userId: user.id,
          familyId: created.familyId,
          deviceId: device.id,
          kind: user.kind,
          roles: user.kind === 'staff' ? user.roles : [],
          displayName: user.displayName,
          locale: user.locale,
          staySignedIn: input.staySignedIn,
          createdAt: now,
          rotatedAt: null,
          expiresAt,
          impersonatedBy: null,
          viaPreviousToken: false,
          presentedHash: hashToken(sessionToken),
        },
      };
    });
  }

  /**
   * Reuse the device the cookie names when it is this user's and not signed out; otherwise
   * record a new one (stored hashed, labelled from the User-Agent). The 2-device limit is
   * AUTH-03 (Phase 2): devices are recorded now, not limited.
   */
  private async useDevice(
    tx: Tx,
    tenantId: string,
    userId: string,
    presented: string | undefined,
    userAgent: string | undefined,
    now: Date,
  ): Promise<{ id: string; token: string; isNew: boolean }> {
    if (isDeviceToken(presented)) {
      const [known] = await tx
        .update(devices)
        .set({ lastSeenAt: now })
        .where(
          and(
            eq(devices.tenantId, tenantId),
            eq(devices.userId, userId),
            eq(devices.tokenHash, hashToken(presented)),
            isNull(devices.signedOutAt),
          ),
        )
        .returning({ id: devices.id });
      if (known) return { id: known.id, token: presented, isNew: false };
    }
    const token = newDeviceToken();
    const [created] = await tx
      .insert(devices)
      .values({
        tenantId,
        userId,
        tokenHash: hashToken(token),
        label: deviceLabel(userAgent),
        userAgent: storedUserAgent(userAgent),
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning({ id: devices.id });
    if (!created) throw new Error('Device insert returned nothing');
    return { id: created.id, token, isNew: true };
  }

  private async recordFailure(
    tenantId: string,
    kind: UserKind,
    userId: string | null,
    identifier: StaffIdentifier | null,
    detail: { reason: FailureReason },
  ): Promise<void> {
    const now = this.clock.now();
    await withTenant(this.db, tenantId, (tx) =>
      this.audit.record(tx, tenantId, {
        action: 'auth.login.failed',
        actorId: userId,
        actorKind: kind,
        entity: 'session',
        entityId: null,
        after: { reason: detail.reason, identifier: maskIdentifier(identifier) },
        at: now,
      }),
    );
  }
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

function readUserAgent(headers: IncomingHttpHeaders): string | undefined {
  const ua = headers['user-agent'];
  return typeof ua === 'string' ? ua : undefined;
}
