import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';
import { ConfigError, type AppConfig } from '../../config/config';
import { ReadinessRegistry } from '../../health/readiness';

/** DI token for the shared Valkey client (rate limiter, readiness, job producers). */
export const VALKEY = Symbol('Valkey');

/**
 * Options for request-path clients. They **fail fast**: no offline queue (a command issued while
 * the connection is down rejects at once) and one retry per command, so a Valkey outage turns
 * into a quick, handled error instead of hung requests. BullMQ workers need the opposite
 * (blocking commands, infinite retries) and build their own connections in `jobs/`.
 */
export const FAIL_FAST_OPTIONS: RedisOptions = {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 2000,
  commandTimeout: 2000,
};

/** Resolve once the client is ready, or false after `timeoutMs` (the app then boots degraded). */
export function waitUntilReady(client: Redis, timeoutMs: number): Promise<boolean> {
  if (client.status === 'ready') return Promise.resolve(true);
  return new Promise((resolve) => {
    const onReady = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      client.off('ready', onReady);
      resolve(false);
    }, timeoutMs);
    client.once('ready', onReady);
  });
}

/** Create a fail-fast client that logs (rather than throws on) connection errors. */
export function createValkeyClient(url: string, options: RedisOptions = {}): Redis {
  const logger = new Logger('Valkey');
  const client = new Redis(url, { ...FAIL_FAST_OPTIONS, ...options });
  let lastLoggedAt = 0;
  client.on('error', (error: Error) => {
    // ioredis emits one error per reconnect attempt: log at most one every 10 s.
    const now = Date.now();
    if (now - lastLoggedAt < 10_000) return;
    lastLoggedAt = now;
    logger.warn(`Valkey connection error: ${error.message}`);
  });
  return client;
}

/** Closes the shared client on shutdown and registers the `valkey` readiness check. */
@Injectable()
class ValkeyLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(VALKEY) private readonly client: Redis,
    @Optional() readiness?: ReadinessRegistry,
  ) {
    readiness?.register({
      name: 'valkey',
      check: async () => {
        await client.ping();
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

/**
 * Global Valkey connection ({@link VALKEY}) plus the `valkey` readiness check. Only imported when
 * `VALKEY_URL` is set; without it (development/tests) the in-memory limiter is used.
 */
@Global()
@Module({})
export class ValkeyModule {
  static forRoot(config: AppConfig): DynamicModule {
    const url = config.valkeyUrl;
    if (!url) throw new ConfigError(['VALKEY_URL: required to import ValkeyModule']);
    return {
      module: ValkeyModule,
      providers: [
        {
          provide: VALKEY,
          useFactory: async () => {
            const client = createValkeyClient(url);
            const ready = await waitUntilReady(client, 5000);
            if (!ready) new Logger('Valkey').warn('Valkey not reachable yet: starting degraded');
            return client;
          },
        },
        ValkeyLifecycle,
      ],
      exports: [VALKEY],
    };
  }
}
