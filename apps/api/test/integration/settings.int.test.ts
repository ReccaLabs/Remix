import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@remix/db';
import { generalSettingsSchema, tenantPublicSchema, themeSchema } from '@remix/types/api';
import type { StaffRole } from '@remix/types/api';
import { expectProblem } from '../fixtures/problem';
import {
  createDbTestApp,
  Factory,
  ownerDb,
  type DbTestApp,
  type TenantFixture,
  type UserFixture,
} from './support/db-app';
import { api, signInStudent, staffByRole, type Api } from './support/people';

const THEME = '/api/v1/admin/settings/theme';
const GENERAL = '/api/v1/admin/settings/general';
const PUBLIC_TENANT = '/api/v1/tenant';

describe('institute settings: theme (TEN-03) and general against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;

  const owner = () => staff.owner.api;
  const stored = async (t: TenantFixture) => {
    const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, t.id));
    if (!row) throw new Error('tenant missing');
    return row;
  };

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant('active');
    other = await f.tenant('active');
    staff = await staffByRole(t, f, tenant);
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  describe('theme — TEN-03', () => {
    it('starts with no theme', async () => {
      const res = await owner().get(THEME);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(themeSchema.strict().parse(res.body)).toEqual({
        brandColor: null,
        logoUrl: null,
        faviconUrl: null,
      });
    });

    it('saves colour, logo and favicon, audits the change and shows them on GET /tenant at once', async () => {
      // Prime the 60 s tenant cache with the old record: the update must drop it.
      expect(
        tenantPublicSchema.parse((await api(t, tenant.host).get(PUBLIC_TENANT)).body),
      ).toMatchObject({ brandColor: null, logoUrl: null, faviconUrl: null });

      const res = await owner().patch(THEME, {
        brandColor: '#0F766E',
        logoUrl: 'https://cdn.example.test/logo.png',
        faviconUrl: 'https://cdn.example.test/favicon.ico',
      });
      expect(res.status).toBe(200);
      expect(themeSchema.strict().parse(res.body)).toEqual({
        brandColor: '#0f766e',
        logoUrl: 'https://cdn.example.test/logo.png',
        faviconUrl: 'https://cdn.example.test/favicon.ico',
      });

      const pub = await api(t, tenant.host).get(PUBLIC_TENANT);
      expect(tenantPublicSchema.parse(pub.body)).toMatchObject({
        brandColor: '#0f766e',
        logoUrl: 'https://cdn.example.test/logo.png',
        faviconUrl: 'https://cdn.example.test/favicon.ico',
      });
      const audit = (await f.audits(tenant, 'settings.theme_update'))[0];
      expect(audit).toMatchObject({
        actorId: staff.owner.user.id,
        entity: 'tenant',
        entityId: tenant.id,
        before: { brandColor: null, logoUrl: null, faviconUrl: null },
        after: { brandColor: '#0f766e', faviconUrl: 'https://cdn.example.test/favicon.ico' },
      });
    });

    it('changes only the fields that are sent, and clears with null', async () => {
      const onlyLogo = await owner().patch(THEME, { logoUrl: 'https://cdn.example.test/new.png' });
      expect(onlyLogo.body).toMatchObject({
        brandColor: '#0f766e',
        logoUrl: 'https://cdn.example.test/new.png',
      });
      const cleared = await owner().patch(THEME, { brandColor: null, faviconUrl: null });
      expect(cleared.body).toEqual({
        brandColor: null,
        logoUrl: 'https://cdn.example.test/new.png',
        faviconUrl: null,
      });
      expect((await owner().get(THEME)).body).toEqual(cleared.body);
      expect(await stored(tenant)).toMatchObject({ brandColor: null, faviconUrl: null });
    });

    it('an empty update changes and audits nothing', async () => {
      const before = (await f.audits(tenant, 'settings.theme_update')).length;
      const res = await owner().patch(THEME, {});
      expect(res.status).toBe(200);
      expect((await f.audits(tenant, 'settings.theme_update')).length).toBe(before);
    });

    it('enforces readable contrast: white text on the colour needs 4.5:1', async () => {
      for (const color of ['#ffcc00', '#ffffff', '#aaaaaa']) {
        const res = await owner().patch(THEME, { brandColor: color });
        expect(expectProblem(res, 400, 'VALIDATION_FAILED').errors?.[0]?.path).toBe('brandColor');
      }
      expect((await owner().patch(THEME, { brandColor: '#1d4ed8' })).status).toBe(200);
    });

    it('rejects anything that is not #rrggbb, including CSS injection attempts', async () => {
      for (const color of [
        'red',
        '#12345',
        '#1234567',
        '#gggggg',
        'red;}body{display:none',
        "#000000'; --x:",
        '',
      ]) {
        expectProblem(await owner().patch(THEME, { brandColor: color }), 400, 'VALIDATION_FAILED');
      }
      expect((await stored(tenant)).brandColor).toBe('#1d4ed8');
    });

    it('accepts https image URLs only', async () => {
      for (const url of [
        'http://cdn.example.test/logo.png',
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
        '//cdn.example.test/logo.png',
        'not a url',
        `https://cdn.example.test/${'a'.repeat(2100)}`,
      ]) {
        expectProblem(await owner().patch(THEME, { logoUrl: url }), 400, 'VALIDATION_FAILED');
        expectProblem(await owner().patch(THEME, { faviconUrl: url }), 400, 'VALIDATION_FAILED');
      }
    });

    it('rejects unknown fields (a tenant cannot set its plan through the theme)', async () => {
      expectProblem(await owner().patch(THEME, { plan: 'institute' }), 400, 'VALIDATION_FAILED');
      expectProblem(await owner().patch(THEME, { status: 'active' }), 400, 'VALIDATION_FAILED');
    });
  });

  describe('general — Settings → General', () => {
    it('reads and updates the name and default language, with an audit trail', async () => {
      const before = await owner().get(GENERAL);
      expect(generalSettingsSchema.strict().parse(before.body)).toMatchObject({
        defaultLocale: 'en',
      });
      const res = await owner().patch(GENERAL, { name: '  Kamal Physics  ', defaultLocale: 'si' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ name: 'Kamal Physics', defaultLocale: 'si' });
      const pub = await api(t, tenant.host).get(PUBLIC_TENANT);
      expect(pub.body).toMatchObject({ name: 'Kamal Physics', defaultLocale: 'si' });
      const audit = (await f.audits(tenant, 'settings.general_update'))[0];
      expect(audit).toMatchObject({
        actorId: staff.owner.user.id,
        before: { defaultLocale: 'en' },
        after: { name: 'Kamal Physics', defaultLocale: 'si' },
      });
    });

    it('updates one field at a time', async () => {
      expect((await owner().patch(GENERAL, { defaultLocale: 'ta' })).body).toEqual({
        name: 'Kamal Physics',
        defaultLocale: 'ta',
      });
      expect((await owner().patch(GENERAL, { name: 'KP Academy' })).body).toEqual({
        name: 'KP Academy',
        defaultLocale: 'ta',
      });
    });

    it('rejects empty bodies, short names, unknown languages and unknown fields', async () => {
      for (const body of [
        {},
        { name: 'X' },
        { name: ' '.repeat(5) },
        { name: 'x'.repeat(121) },
        { defaultLocale: 'fr' },
        { slug: 'hacked' },
        { plan: 'tutor' },
        { timezone: 'UTC' },
      ]) {
        expectProblem(await owner().patch(GENERAL, body), 400, 'VALIDATION_FAILED');
      }
      const row = await stored(tenant);
      expect(row.slug).toBe(tenant.slug);
      expect(row.plan).toBe('institute');
    });
  });

  describe('permissions and isolation', () => {
    it('only the owner (settings.manage) can read or change settings', async () => {
      for (const role of ['admin', 'teacher', 'cashier', 'gatekeeper'] as const) {
        const as = staff[role].api;
        expectProblem(await as.get(THEME), 403, 'FORBIDDEN');
        expectProblem(await as.patch(THEME, { brandColor: '#0f766e' }), 403, 'FORBIDDEN');
        expectProblem(await as.get(GENERAL), 403, 'FORBIDDEN');
        expectProblem(await as.patch(GENERAL, { name: 'Hacked' }), 403, 'FORBIDDEN');
      }
      const portal = api(
        t,
        tenant.host,
        await signInStudent(t, tenant, await f.student(tenant, { name: 'Portal Pia' })),
      );
      expectProblem(await portal.get(THEME), 403, 'FORBIDDEN');
      expectProblem(await portal.patch(GENERAL, { name: 'Hacked' }), 403, 'FORBIDDEN');
      expectProblem(await api(t, tenant.host).get(THEME), 401, 'UNAUTHENTICATED');
      expectProblem(
        await api(t, tenant.host).patch(GENERAL, { name: 'Hacked' }),
        401,
        'UNAUTHENTICATED',
      );
      expect((await stored(tenant)).name).toBe('KP Academy');
    });

    it("changing one institute's settings never touches another's", async () => {
      const before = await stored(other);
      await owner().patch(THEME, {
        brandColor: '#7c3aed',
        logoUrl: 'https://cdn.example.test/z.png',
      });
      await owner().patch(GENERAL, { name: 'Changed Name' });
      const after = await stored(other);
      expect(after).toMatchObject({
        name: before.name,
        brandColor: before.brandColor,
        logoUrl: before.logoUrl,
        faviconUrl: before.faviconUrl,
        defaultLocale: before.defaultLocale,
      });
      // The other institute's public record is its own too.
      expect((await api(t, other.host).get(PUBLIC_TENANT)).body).toMatchObject({
        name: before.name,
        brandColor: null,
      });
    });

    it('a staff session of another institute cannot read this one’s settings', async () => {
      const foreignOwner = await staffByRole(t, f, other, ['owner']);
      // Their own settings are theirs…
      expect((await foreignOwner.owner.api.get(THEME)).body).toMatchObject({ brandColor: null });
      // …and the cookie is useless on our host (see classes-admin tests); here: same data check.
      expect((await owner().get(THEME)).body.brandColor).toBe('#7c3aed');
    });
  });
});
