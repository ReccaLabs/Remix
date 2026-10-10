import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { AppConfig } from '../../config/config';
import { storageProviderBinding } from './storage-binding';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.provider';
import { S3StorageProvider } from './storage.s3';

export { UnconfiguredStorageProvider } from './storage-binding';

const STORAGE_CONFIG = Symbol('StorageConfig');

/**
 * Development only: create the SeaweedFS bucket and a permissive CORS rule so `pnpm dev` works
 * out of the box. Production buckets (R2) and their CORS are set up by the operator.
 */
@Injectable()
class StorageLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Storage');
  constructor(
    @Inject(STORAGE_CONFIG) private readonly config: AppConfig,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    if (this.config.nodeEnv !== 'development' || !(this.storage instanceof S3StorageProvider)) return;
    try {
      await this.storage.ensureDevBucket(['*']);
    } catch (error) {
      this.logger.warn({ err: error instanceof Error ? error.name : 'unknown' }, 'Dev bucket setup failed');
    }
  }
  onApplicationShutdown(): void {
    if (this.storage instanceof S3StorageProvider) this.storage.destroy();
  }
}

@Global()
@Module({})
export class StorageModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: StorageModule,
      providers: [
        { provide: STORAGE_CONFIG, useValue: config },
        { provide: STORAGE_PROVIDER, useFactory: () => storageProviderBinding(config) },
        StorageLifecycle,
      ],
      exports: [STORAGE_PROVIDER],
    };
  }
}
