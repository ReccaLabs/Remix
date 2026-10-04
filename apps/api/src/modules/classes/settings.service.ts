import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema, withTenant, type Db, type TenantCache, type Tx } from '@remix/db';
import type { API, Theme } from '@remix/types/api';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { AppException } from '../../common/errors/app-exception';
import { CLOCK, type Clock } from '../../common/time/clock';
import type { EndpointBody, EndpointResult } from '../../common/validation/endpoint';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { TENANT_CACHE } from '../tenancy/db-tenant-resolver';
import { actor } from './class-support';

const { tenants, tenantDomains } = schema;

type ThemeBody = EndpointBody<typeof API.updateTheme>;
type GeneralBody = EndpointBody<typeof API.updateGeneralSettings>;

/**
 * TEN-03 and Settings → General (owner only, `settings.manage`). The database lets the app role
 * change exactly five columns of its own tenant row (migration 0008), so this service cannot touch
 * plan, status or slug even by mistake. Every change is audited with before/after values, and the
 * cached public tenant record of every host of the institute is dropped so the new colour or
 * name shows up at once on this node (other nodes within the 60 s cache TTL).
 */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TENANT_CACHE) private readonly cache: TenantCache,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  getTheme(tenantId: string): Promise<Theme> {
    return withTenant(this.db, tenantId, (tx) => this.readTheme(tx));
  }

  async updateTheme(tenantId: string, session: AuthSession, body: ThemeBody): Promise<Theme> {
    const now = this.clock.now();
    const result = await withTenant(this.db, tenantId, async (tx) => {
      const before = await this.readTheme(tx);
      const changes: Partial<typeof tenants.$inferInsert> = {};
      if (body.brandColor !== undefined)
        changes.brandColor = body.brandColor?.toLowerCase() ?? null;
      if (body.logoUrl !== undefined) changes.logoUrl = body.logoUrl;
      if (body.faviconUrl !== undefined) changes.faviconUrl = body.faviconUrl;
      if (Object.keys(changes).length === 0) return { theme: before, hosts: [] as string[] };

      await tx.update(tenants).set(changes).where(eq(tenants.id, tenantId));
      const theme = await this.readTheme(tx);
      await this.audit.record(tx, tenantId, {
        ...actor(session, now),
        action: 'settings.theme_update',
        entity: 'tenant',
        entityId: tenantId,
        before: { ...before },
        after: { ...theme },
      });
      return { theme, hosts: await this.hosts(tx, tenantId) };
    });
    await this.forget(result.hosts);
    return result.theme;
  }

  async getGeneral(tenantId: string): Promise<EndpointResult<typeof API.getGeneralSettings>> {
    return withTenant(this.db, tenantId, (tx) => this.readGeneral(tx));
  }

  async updateGeneral(
    tenantId: string,
    session: AuthSession,
    body: GeneralBody,
  ): Promise<EndpointResult<typeof API.updateGeneralSettings>> {
    const now = this.clock.now();
    const result = await withTenant(this.db, tenantId, async (tx) => {
      const before = await this.readGeneral(tx);
      const changes: Partial<typeof tenants.$inferInsert> = {};
      if (body.name !== undefined) changes.name = body.name;
      if (body.defaultLocale !== undefined) changes.defaultLocale = body.defaultLocale;
      await tx.update(tenants).set(changes).where(eq(tenants.id, tenantId));
      const general = await this.readGeneral(tx);
      await this.audit.record(tx, tenantId, {
        ...actor(session, now),
        action: 'settings.general_update',
        entity: 'tenant',
        entityId: tenantId,
        before: { ...before },
        after: { ...general },
      });
      return { general, hosts: await this.hosts(tx, tenantId) };
    });
    await this.forget(result.hosts);
    return result.general;
  }

  private async readTheme(tx: Tx): Promise<Theme> {
    const [row] = await tx
      .select({
        brandColor: tenants.brandColor,
        logoUrl: tenants.logoUrl,
        faviconUrl: tenants.faviconUrl,
      })
      .from(tenants);
    if (!row) throw new AppException('NOT_FOUND', 404, 'Institute not found');
    return row;
  }

  private async readGeneral(tx: Tx) {
    const [row] = await tx
      .select({ name: tenants.name, defaultLocale: tenants.defaultLocale })
      .from(tenants);
    if (!row) throw new AppException('NOT_FOUND', 404, 'Institute not found');
    return row;
  }

  /** Cache keys (`host:<host>`) under which this institute's public record may be stored. */
  private async hosts(tx: Tx, tenantId: string): Promise<string[]> {
    const [tenant] = await tx
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const domains = await tx.select({ host: tenantDomains.host }).from(tenantDomains);
    return [
      ...(tenant ? this.config.tenantBaseDomains.map((base) => `${tenant.slug}.${base}`) : []),
      ...domains.map((d) => d.host),
    ];
  }

  private async forget(hosts: readonly string[]): Promise<void> {
    for (const host of hosts) await this.cache.delete?.(`host:${host}`);
  }
}
