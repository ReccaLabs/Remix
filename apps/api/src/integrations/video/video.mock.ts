import { CallRecorder } from '../recorder';
import { assertSignedUrlTtl } from '../storage/storage.provider';
import {
  MAX_PLAYBACK_TTL_SEC,
  type VideoLibraryConfig,
  type VideoProvider,
  type VideoUpload,
} from './video.provider';

/** In-memory {@link VideoProvider}: idempotent uploads, TTL-checked playback URLs. */
export class MockVideoProvider
  extends CallRecorder<'createUpload' | 'createPlaybackUrl' | 'deleteVideo'>
  implements VideoProvider
{
  /** tenantId:videoId of videos that exist. */
  readonly videos = new Set<string>();
  private readonly byKey = new Map<string, VideoUpload>();

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  async createUpload(input: {
    tenantId: string;
    library: VideoLibraryConfig;
    title: string;
    idempotencyKey: string;
  }): Promise<VideoUpload> {
    await this.record('createUpload', input);
    const key = `${input.tenantId}:${input.idempotencyKey}`;
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const videoId = `mock-video-${this.byKey.size + 1}`;
    const upload: VideoUpload = {
      videoId,
      upload: {
        endpoint: 'https://video.mock.invalid/tus',
        headers: { AuthorizationSignature: 'mock', VideoId: videoId },
        expiresAt: new Date(this.now() + 3600 * 1000),
      },
    };
    this.byKey.set(key, upload);
    this.videos.add(`${input.tenantId}:${videoId}`);
    return upload;
  }

  async createPlaybackUrl(input: {
    tenantId: string;
    library: VideoLibraryConfig;
    videoId: string;
    expiresInSec: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    await this.record('createPlaybackUrl', input);
    assertSignedUrlTtl(input.expiresInSec, MAX_PLAYBACK_TTL_SEC);
    if (!this.videos.has(`${input.tenantId}:${input.videoId}`)) {
      throw new Error('Video not found for this tenant');
    }
    return {
      url: `https://video.mock.invalid/embed/${input.videoId}?token=mock`,
      expiresAt: new Date(this.now() + input.expiresInSec * 1000),
    };
  }

  async deleteVideo(input: {
    tenantId: string;
    library: VideoLibraryConfig;
    videoId: string;
  }): Promise<void> {
    await this.record('deleteVideo', input);
    this.videos.delete(`${input.tenantId}:${input.videoId}`);
  }
}
