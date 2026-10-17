import { config } from '../config.js';
import type {
  ContainerStatus,
  CreateContainerInput,
  GraphErrorPayload,
  InstagramAccount,
  InstagramInsightsResponse,
  InstagramListResponse,
  InstagramMedia,
  PublishResult,
  PublishingLimit,
  CarouselItemInput,
} from './types.js';

export class InstagramApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number,
  ) {
    super(message);
    this.name = 'InstagramApiError';
  }
}

function publicMediaUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS because Meta fetches it server-side`);
  }
  return url.toString();
}

export class InstagramClient {
  constructor(
    private readonly options = config.instagram,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.options.accessToken || !this.options.userId) {
      throw new InstagramApiError('Instagram integration is not configured. Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID.', 503);
    }
    const url = new URL(`/${this.options.graphVersion}/${path.replace(/^\//, '')}`, this.options.baseUrl);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.options.accessToken}`);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(url, { ...init, headers, signal: controller.signal });
      const payload = (await response.json().catch(() => ({}))) as T & GraphErrorPayload;
      if (!response.ok || payload.error) {
        const graphError = payload.error;
        throw new InstagramApiError(
          graphError?.message ?? `Instagram Graph API request failed (${response.status})`,
          response.status,
          graphError?.code,
        );
      }
      return payload as T;
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new InstagramApiError('Instagram Graph API request timed out', 504);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async getAccount(): Promise<InstagramAccount> {
    return this.request<InstagramAccount>(`${this.options.userId}?fields=id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count`);
  }

  async listMedia(limit = 12, after?: string): Promise<InstagramListResponse<InstagramMedia>> {
    const boundedLimit = Math.min(Math.max(limit, 1), 50);
    const query = new URLSearchParams({
      fields: 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
      limit: String(boundedLimit),
    });
    if (after) query.set('after', after);
    return this.request<InstagramListResponse<InstagramMedia>>(`${this.options.userId}/media?${query}`);
  }

  async getPostInsights(postId: string): Promise<InstagramInsightsResponse> {
    const metrics = 'reach,impressions,likes,comments,saved,shares,total_interactions,plays';
    return this.request<InstagramInsightsResponse>(`${encodeURIComponent(postId)}/insights?metric=${metrics}`);
  }

  async getPublishingLimit(): Promise<PublishingLimit> {
    return this.request<PublishingLimit>(`${this.options.userId}/content_publishing_limit`);
  }

  async createContainer(input: CreateContainerInput): Promise<{ id: string }> {
    const body = new URLSearchParams();
    body.set('media_type', input.mediaType);
    if (input.caption) body.set('caption', input.caption);
    if (input.altText) body.set('alt_text', input.altText);
    if (input.isCarouselItem) body.set('is_carousel_item', 'true');
    if (input.children?.length) body.set('children', input.children.join(','));
    if (input.imageUrl) body.set('image_url', publicMediaUrl(input.imageUrl, 'imageUrl'));
    if (input.videoUrl) body.set('video_url', publicMediaUrl(input.videoUrl, 'videoUrl'));

    const needsImage = input.mediaType === 'IMAGE' && !input.imageUrl;
    const needsVideo = ['VIDEO', 'REELS', 'STORIES'].includes(input.mediaType) && !input.videoUrl;
    if (needsImage || needsVideo) throw new Error(`${input.mediaType} publishing requires the matching public media URL`);
    if (input.mediaType === 'CAROUSEL' && (!input.children || input.children.length < 2 || input.children.length > 10)) {
      throw new Error('CAROUSEL publishing requires 2 to 10 child container IDs');
    }

    return this.request<{ id: string }>(`${this.options.userId}/media`, { method: 'POST', body });
  }

  async getContainerStatus(containerId: string): Promise<ContainerStatus> {
    return this.request<ContainerStatus>(`${encodeURIComponent(containerId)}?fields=id,status_code,status,error_message`);
  }

  async waitForContainer(containerId: string): Promise<ContainerStatus> {
    const deadline = Date.now() + this.options.pollTimeoutMs;
    let last: ContainerStatus = { id: containerId, status_code: 'IN_PROGRESS' };
    while (Date.now() < deadline) {
      last = await this.getContainerStatus(containerId);
      if (last.status_code === 'FINISHED' || last.status_code === 'PUBLISHED') return last;
      if (last.status_code === 'ERROR' || last.status_code === 'EXPIRED') {
        throw new InstagramApiError(last.error_message ?? `Container failed with status ${last.status_code}`, 422);
      }
      await new Promise((resolve) => setTimeout(resolve, this.options.pollIntervalMs));
    }
    throw new InstagramApiError(`Container ${containerId} did not finish before the polling timeout`, 504);
  }

  async publishContainer(containerId: string): Promise<{ id: string }> {
    const body = new URLSearchParams({ creation_id: containerId });
    return this.request<{ id: string }>(`${this.options.userId}/media_publish`, { method: 'POST', body });
  }

  async publish(input: CreateContainerInput): Promise<PublishResult> {
    const container = await this.createContainer(input);
    if (['VIDEO', 'REELS', 'STORIES'].includes(input.mediaType)) await this.waitForContainer(container.id);
    const published = await this.publishContainer(container.id);
    return { containerId: container.id, mediaId: published.id };
  }

  async publishCarousel(items: CarouselItemInput[], caption?: string): Promise<PublishResult> {
    if (items.length < 2 || items.length > 10) {
      throw new Error('Carousel posts require 2 to 10 items');
    }
    const childContainers = await Promise.all(items.map((item) => this.createContainer({
      mediaType: item.mediaType,
      imageUrl: item.imageUrl,
      videoUrl: item.videoUrl,
      isCarouselItem: true,
    })));
    for (const [index, item] of items.entries()) {
      const child = childContainers[index];
      if (!child) throw new Error(`Carousel child container ${index + 1} was not created`);
      if (item.mediaType === 'VIDEO') await this.waitForContainer(child.id);
    }
    const carousel = await this.createContainer({ mediaType: 'CAROUSEL', children: childContainers.map((item) => item.id), caption });
    const published = await this.publishContainer(carousel.id);
    return { containerId: carousel.id, mediaId: published.id };
  }
}
