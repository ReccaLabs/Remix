import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { AppConfig } from '../../config/config';
import { MockStorageProvider } from './storage.mock';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.provider';

/** 3-D supplies the real S3/R2 binding. Fail visibly in production until it is configured. */
export class UnconfiguredStorageProvider implements StorageProvider {
  putObject(): Promise<never> {
    return this.unavailable();
  }
  createUploadUrl(): Promise<never> {
    return this.unavailable();
  }
  createDownloadUrl(): Promise<never> {
    return this.unavailable();
  }
  deleteObject(): Promise<never> {
    return this.unavailable();
  }
  private unavailable(): Promise<never> {
    return Promise.reject(new Error('No storage adapter configured'));
  }
}
@Global()
@Module({})
export class StorageModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: StorageModule,
      providers: [
        {
          provide: STORAGE_PROVIDER,
          useFactory: () =>
            config.nodeEnv === 'production'
              ? new UnconfiguredStorageProvider()
              : new MockStorageProvider(),
        },
      ],
      exports: [STORAGE_PROVIDER],
    };
  }
}
