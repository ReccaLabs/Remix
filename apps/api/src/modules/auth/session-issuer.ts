import type { IncomingHttpHeaders } from 'node:http';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema, type Tx } from '@remix/db';
import {
  STUDENT_DEVICE_LIMIT,
  type AppLocale,
  type StaffIdentifier,
  type StaffRole,
  type UserKind,
} from '@remix/types/api';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { AuditService, maskIdentifier } from '../audit/audit.service';
import { cookieNames, readCookie } from './cookies';
import { deviceLabel, storedUserAgent } from './device-label';
import { activeDevices, type ActiveDevice } from './device-store';
import type { SessionRecord } from './session.service';
import {
  hashToken,
  isDeviceToken,
  newDeviceToken,
  newSessionToken,
  parseSessionToken,
} from './tokens';

const { tenantUsers, sessions, devices } = schema;

/** The user a session is issued to, as the sign-in flows know them. */
export interface IssueUser {
  id: string;
  kind: UserKind;
  roles: StaffRole[];
  displayName: string;
  locale: AppLocale;
  mustChangePassword: boolean;
}

/** How the user proved who they are (audit detail). */
export type SignInMethod = 'password' | 'two_step' | 'device_limit' | 'invite' | 'password_change';

export interface IssueInput {
  staySignedIn: boolean;
  headers: IncomingHttpHeaders;
  now: Date;
  /** Absolute expiry; defaults to 12 h / 30 days from `now` (never extended, ADR 0004). */
  expiresAt: Date;
  method: SignInMethod;
  identifier?: StaffIdentifier | null;
  /** Re-hashed password to store (parameters changed since the hash was made). */
  rehash?: string | null;
  /** Students only: refuse a third active device (AUTH-03). */
  enforceDeviceLimit: boolean;
}

export interface LoginResult {
  session: SessionRecord;
  /** Fresh session token for the cookie — never in a response body or a log. */
  sessionToken: string;
  /** Device id for the device cookie (re-set on every login so it keeps its 400 days). */
  deviceToken: string;
}

export type IssueOutcome =
  | { status: 'issued'; result: LoginResult }
  /** Nothing was written except the row lock; the caller issues a device-limit ticket. */
  | { status: 'device_limit'; devices: ActiveDevice[] };

/**
 * Creates a session at the end of every successful sign-in (password, two-step, device-limit
 * resolution, invite acceptance, password change), inside the caller's `withTenant` transaction:
 * - the user row is locked first, so concurrent sign-ins of one user are serialised and the
 *   device limit cannot be raced past;
 * - no fixation: the session this browser held on this host is revoked, never reused;
 * - the device cookie's device is reused while it is the user's and not signed out; otherwise a
 *   new device is recorded (stored hashed, labelled from the User-Agent);
 * - students: a device that is not already active, while 2 others are, is refused
 *   (`device_limit`) before anything is written;
 * - failed-login counter reset, `last_sign_in_at`, optional re-hash and the audit row.
 */
@Injectable()
export class SessionIssuer {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  async issue(tx: Tx, tenantId: string, user: IssueUser, input: IssueInput): Promise<IssueOutcome> {
    const { now } = input;
    const names = cookieNames(this.config.cookieSecure);
    const presentedDevice = readCookie(input.headers, names.device);
    const previousSession = parseSessionToken(readCookie(input.headers, names.session));
    const userAgent = readUserAgent(input.headers);

    await tx.execute(
      sql`select 1 from ${tenantUsers} where ${tenantUsers.tenantId} = ${tenantId} and ${tenantUsers.id} = ${user.id} for update`,
    );

    const known = isDeviceToken(presentedDevice)
      ? await this.findDevice(tx, tenantId, user.id, hashToken(presentedDevice))
      : null;

    if (input.enforceDeviceLimit && user.kind === 'student') {
      const active = await activeDevices(tx, tenantId, user.id, now);
      const alreadyActive = known !== null && active.some((d) => d.id === known.id);
      if (!alreadyActive && active.length >= STUDENT_DEVICE_LIMIT) {
        return { status: 'device_limit', devices: active };
      }
    }

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

    let device: { id: string; token: string; isNew: boolean };
    if (known && presentedDevice) {
      await tx
        .update(devices)
        .set({ lastSeenAt: now })
        .where(and(eq(devices.tenantId, tenantId), eq(devices.id, known.id)));
      device = { id: known.id, token: presentedDevice, isNew: false };
    } else {
      const token = newDeviceToken();
      const [created] = await tx
        .insert(devices)
        .values({
          tenantId,
          userId: user.id,
          tokenHash: hashToken(token),
          label: deviceLabel(userAgent),
          userAgent: storedUserAgent(userAgent),
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .returning({ id: devices.id });
      if (!created) throw new Error('Device insert returned nothing');
      device = { id: created.id, token, isNew: true };
    }

    const sessionToken = newSessionToken(now);
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
        expiresAt: input.expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: sessions.id, familyId: sessions.familyId });
    if (!created) throw new Error('Session insert returned nothing');

    await tx
      .update(tenantUsers)
      .set({
        failedLoginCount: 0,
        lastSignInAt: now,
        ...(input.rehash ? { passwordHash: input.rehash } : {}),
      })
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.id, user.id)));

    await this.audit.record(tx, tenantId, {
      action: 'auth.login.succeeded',
      actorId: user.id,
      actorKind: user.kind,
      entity: 'session',
      entityId: created.id,
      after: {
        identifier: maskIdentifier(input.identifier ?? null),
        method: input.method,
        staySignedIn: input.staySignedIn,
        deviceId: device.id,
        newDevice: device.isNew,
        ...(input.rehash ? { passwordRehashed: true } : {}),
      },
      at: now,
    });

    // A temporary password (tenant:create / reset CLI) still in use is flagged on every login
    // until the first-login change is enforced (owners; students set theirs by SMS code).
    if (user.mustChangePassword && input.method !== 'password_change') {
      await this.audit.record(tx, tenantId, {
        action: 'auth.login.temporary_password',
        actorId: user.id,
        actorKind: user.kind,
        entity: 'session',
        entityId: created.id,
        after: { identifier: maskIdentifier(input.identifier ?? null) },
        at: now,
      });
    }

    return {
      status: 'issued',
      result: {
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
          expiresAt: input.expiresAt,
          impersonatedBy: null,
          viaPreviousToken: false,
          presentedHash: hashToken(sessionToken),
        },
      },
    };
  }

  private async findDevice(
    tx: Tx,
    tenantId: string,
    userId: string,
    tokenHash: string,
  ): Promise<{ id: string } | null> {
    const [row] = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(
        and(
          eq(devices.tenantId, tenantId),
          eq(devices.userId, userId),
          eq(devices.tokenHash, tokenHash),
          isNull(devices.signedOutAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}

export function readUserAgent(headers: IncomingHttpHeaders): string | undefined {
  const ua = headers['user-agent'];
  return typeof ua === 'string' ? ua : undefined;
}
