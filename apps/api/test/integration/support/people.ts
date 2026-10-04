import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { schema } from '@remix/db';
import type { StaffRole } from '@remix/types/api';
import {
  client,
  cookieValue,
  Factory,
  PASSWORD,
  setCookies,
  type DbTestApp,
  type TenantFixture,
  type UserFixture,
} from './db-app';
import { lastCode, P } from './auth-helpers';

/**
 * Helpers of the people tests (students, staff). Keeps "how a test signs in" in one place.
 */

/** Signs a staff member in and returns the `Cookie` header value. */
export async function signInStaff(
  t: DbTestApp,
  tenant: TenantFixture,
  user: UserFixture,
): Promise<string> {
  // Past the 45 s resend window, so repeated sign-ins of one member never hit the code limiter.
  t.clock.advance(60_000);
  let res = await client(t, tenant.host).post(P.staffLogin, {
    identifier: user.phone,
    password: PASSWORD,
    staySignedIn: true,
  });
  if (res.status === 401 && res.body.code === 'TWO_STEP_REQUIRED') {
    // Owner/admin/cashier: answer the SMS two-step with the code the queue captured (AUTH-05).
    const token = (res.body.challenge as { token: string }).token;
    res = await client(t, tenant.host).post(P.twoStep, {
      token,
      code: await lastCode(t, user.phone),
    });
  }
  if (res.status !== 200) throw new Error(`staff login failed: ${res.status} ${res.text}`);
  return `remix_session=${cookieValue(setCookies(res).get('remix_session'))}`;
}

export async function signInStudent(
  t: DbTestApp,
  tenant: TenantFixture,
  user: UserFixture,
): Promise<string> {
  const res = await client(t, tenant.host).post('/api/v1/auth/student/login', {
    phone: user.phone,
    password: PASSWORD,
    staySignedIn: true,
  });
  if (res.status !== 200) throw new Error(`student login failed: ${res.status} ${res.text}`);
  return `remix_session=${cookieValue(setCookies(res).get('remix_session'))}`;
}

const randomIp = () => `198.19.${randomBytes(1)[0] ?? 0}.${randomBytes(1)[0] ?? 0}`;

/** A tenant-host client with every verb the admin API uses. */
export function api(t: DbTestApp, host: string, cookie?: string) {
  const prep = (req: request.Test) => {
    const base = req.set('Host', host).set('X-Forwarded-For', randomIp());
    return cookie ? base.set('Cookie', cookie) : base;
  };
  return {
    get: (path: string) => prep(request(t.server).get(path)),
    post: (path: string, body: object = {}) =>
      prep(request(t.server).post(path))
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(body)),
    put: (path: string, body: object = {}) =>
      prep(request(t.server).put(path))
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(body)),
    patch: (path: string, body: object = {}) =>
      prep(request(t.server).patch(path))
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(body)),
    delete: (path: string) =>
      prep(request(t.server).delete(path)).set('Content-Type', 'application/json').send('{}'),
  };
}

export type Api = ReturnType<typeof api>;

/** One staff member per role, each with a ready session cookie. */
export async function staffByRole(
  t: DbTestApp,
  f: Factory,
  tenant: TenantFixture,
  roles: readonly StaffRole[] = ['owner', 'admin', 'teacher', 'cashier', 'gatekeeper'],
): Promise<Record<StaffRole, { user: UserFixture; api: Api }>> {
  const entries = await Promise.all(
    roles.map(async (role) => {
      const user = await f.staff(tenant, [role], { name: `${role} user` });
      const cookie = await signInStaff(t, tenant, user);
      return [role, { user, api: api(t, tenant.host, cookie) }] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<StaffRole, { user: UserFixture; api: Api }>;
}

/** Limit a teacher to some classes (STF-02). */
export async function scopeTeacher(
  f: Factory,
  teacher: UserFixture,
  classIds: string[],
): Promise<void> {
  await f.db
    .update(schema.staffRoles)
    .set({ classScope: classIds })
    .where(and(eq(schema.staffRoles.userId, teacher.id), eq(schema.staffRoles.role, 'teacher')));
}

/** Many students in two statements (pagination tests). */
export async function bulkStudents(
  f: Factory,
  tenant: TenantFixture,
  n: number,
  prefix: string,
): Promise<string[]> {
  const users = await f.db
    .insert(schema.tenantUsers)
    .values(
      Array.from({ length: n }, (_, i) => ({
        tenantId: tenant.id,
        kind: 'student' as const,
        phone: `+94750${String(Math.floor(Math.random() * 90_000) + 10_000 + i * 100_000).padStart(7, '0')}`,
        displayName: `${prefix} ${String(i).padStart(3, '0')}`,
        passwordHash: 'x',
      })),
    )
    .returning({ id: schema.tenantUsers.id });
  await f.db.insert(schema.students).values(
    users.map((u, i) => ({
      tenantId: tenant.id,
      userId: u.id,
      studentNo: `${prefix}-${String(i).padStart(4, '0')}`,
    })),
  );
  return users.map((u) => u.id);
}
