import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { createDb, verifyAppRole, type Db } from '@remix/db';
import { ConfigError, type AppConfig } from '../../config/config';
import { ReadinessRegistry } from '../../health/readiness';

/** DI token for the `remix_app` connection pool (RLS enforced). */
export const DB = Symbol('Db');

/**
 * Boot check, readiness and shutdown for the pool. Refuses to start when the configured role
 * could bypass RLS (superuser, BYPASSRLS) or owns tables — the API must run as `remix_app`
 * (ADR 0005). The thrown error is generic: no URL, no role name from the environment.
 */
@Injectable()
export class DbLifecycle implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Database');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly readiness: ReadinessRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await verifyAppRole(this.db);
    } catch (error) {
      await this.db.$client.end().catch(() => undefined);
      throw error;
    }
    this.readiness.register({
      name: 'database',
      check: async () => {
        await this.db.execute(sql`select 1`);
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.db.$client.end();
    } catch (error) {
      this.logger.warn({ err: error }, 'Closing the database pool failed');
    }
  }
}

/** The database pool, global so tenancy, auth and business modules can inject {@link DB}. */
@Global()
@Module({})
export class DbModule {
  static forRoot(config: AppConfig): DynamicModule {
    const url = config.databaseUrl;
    if (!url) throw new ConfigError(['DATABASE_URL: required (connects as remix_app)']);
    return {
      module: DbModule,
      providers: [
        { provide: DB, useFactory: (): Db => createDb(url, { applicationName: 'remix-api' }) },
        DbLifecycle,
      ],
      exports: [DB],
    };
  }
}
