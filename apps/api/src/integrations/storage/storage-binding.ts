import type { AppConfig } from '../../config/config';
import { MockStorageProvider } from './storage.mock';
import type { StorageProvider } from './storage.provider';
import { S3StorageProvider } from './storage.s3';

/** Production stand-in when no bucket is configured: every call fails visibly, nothing is faked. */
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
  getObject(): Promise<never> {
    return this.unavailable();
  }
  deleteObject(): Promise<never> {
    return this.unavailable();
  }
  private unavailable(): Promise<never> {
    return Promise.reject(new Error('No storage adapter configured'));
  }
}

/**
 * The storage provider for a process: the S3 adapter whenever a bucket is configured (always in
 * production), the in-memory mock only outside production without one. The mock can never be
 * selected in production.
 */
export function storageProviderBinding(config: AppConfig): StorageProvider {
  if (config.storage) return new S3StorageProvider(config.storage);
  if (config.nodeEnv === 'production') return new UnconfiguredStorageProvider();
  return new MockStorageProvider();
}
