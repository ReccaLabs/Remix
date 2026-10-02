/** Playback tokens never live longer than this (03-architecture §7: ≤ 2 h). */
export const MAX_PLAYBACK_TTL_SEC = 7200;

/** Per-tenant video library (Bunny Stream collection inside the platform library). */
export interface VideoLibraryConfig {
  provider: 'bunny';
  collectionId: string;
}

export interface VideoUpload {
  videoId: string;
  /** Resumable (TUS) upload target and signed headers for the browser. */
  upload: { endpoint: string; headers: Record<string, string>; expiresAt: Date };
}

/**
 * Protected lesson video (Bunny Stream). YouTube "unlisted" lessons don't go through a provider
 * call — only their id is stored — so they are not part of this interface.
 */
export interface VideoProvider {
  createUpload(input: {
    tenantId: string;
    library: VideoLibraryConfig;
    title: string;
    /** Same key → same video record; a retried request doesn't create duplicates. */
    idempotencyKey: string;
  }): Promise<VideoUpload>;
  /** Signed, expiring embed/playback URL for one viewer (token auth + referrer allow-list). */
  createPlaybackUrl(input: {
    tenantId: string;
    library: VideoLibraryConfig;
    videoId: string;
    expiresInSec: number;
  }): Promise<{ url: string; expiresAt: Date }>;
  deleteVideo(input: {
    tenantId: string;
    library: VideoLibraryConfig;
    videoId: string;
  }): Promise<void>;
}

/** DI token for {@link VideoProvider}. */
export const VIDEO_PROVIDER = Symbol('VideoProvider');
