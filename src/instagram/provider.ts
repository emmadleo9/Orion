import crypto from 'node:crypto';
import { config } from '../config.js';
import { InstagramApiError, InstagramClient } from './client.js';
import type { EngagementSummary, InstagramAccount, InstagramInsightsResponse, InstagramListResponse, InstagramMedia, PublishingLimit, PublishResult, CreateContainerInput, CarouselItemInput } from './types.js';

type ConnectorOperation = 'getAccount' | 'listMedia' | 'getPostInsights' | 'getEngagement' | 'getPublishingLimit' | 'publish' | 'publishCarousel';
export type InstagramService = {
  getAccount(): Promise<InstagramAccount>;
  listMedia(limit?: number, after?: string): Promise<InstagramListResponse<InstagramMedia>>;
  getPostInsights(postId: string): Promise<InstagramInsightsResponse>;
  getEngagement(postId: string): Promise<EngagementSummary>;
  getPublishingLimit(): Promise<PublishingLimit>;
  publish(input: CreateContainerInput): Promise<PublishResult>;
  publishCarousel(items: CarouselItemInput[], caption?: string): Promise<PublishResult>;
};

export interface AuthProvider {
  mode: 'direct-oauth' | 'connector' | 'token' | 'unconfigured';
  status(): { mode: AuthProvider['mode']; connected: boolean; accountId?: string; username?: string };
  authorizationUrl?(): string;
  completeAuthorization?(code: string, state: string): Promise<void>;
  logout?(): void;
}

export class DirectMetaOAuth implements AuthProvider {
  mode: AuthProvider['mode'] = 'direct-oauth';
  private token?: { accessToken: string; userId: string; expiresAt: number };
  private readonly states = new Map<string, number>();
  private readonly scopes = (process.env.INSTAGRAM_OAUTH_SCOPES ?? 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments').split(',').map((scope) => scope.trim()).filter(Boolean);

  constructor(private readonly clientId = config.oauth.clientId, private readonly clientSecret = config.oauth.clientSecret, private readonly redirectUri = config.oauth.redirectUri, private readonly fetchImpl: typeof fetch = fetch, private readonly endpoints = { authorize: config.oauth.authorizeUrl, token: config.oauth.tokenUrl, graph: config.oauth.graphUrl }) {}

  status() { return { mode: this.mode, connected: Boolean(this.token && this.token.expiresAt > Date.now()), accountId: this.token?.userId }; }

  authorizationUrl(): string {
    if (!this.clientId || !this.clientSecret) throw new InstagramApiError('Direct Meta OAuth is not configured. Set INSTAGRAM_OAUTH_CLIENT_ID and INSTAGRAM_OAUTH_CLIENT_SECRET.', 503);
    const state = crypto.randomBytes(24).toString('base64url');
    this.states.set(state, Date.now() + 10 * 60 * 1000);
    const query = new URLSearchParams({ client_id: this.clientId, redirect_uri: this.redirectUri, response_type: 'code', scope: this.scopes.join(','), state, force_reauth: 'false' });
    return `${this.endpoints.authorize}?${query}`;
  }

  async completeAuthorization(code: string, state: string): Promise<void> {
    const expiry = this.states.get(state); this.states.delete(state);
    if (!expiry || expiry <= Date.now()) throw new InstagramApiError('OAuth state is missing, expired, or already used.', 400);
    if (!code) throw new InstagramApiError('Instagram did not return an authorization code.', 400);
    const short = await this.formRequest(this.endpoints.token, { client_id: this.clientId, client_secret: this.clientSecret, grant_type: 'authorization_code', redirect_uri: this.redirectUri, code });
    const shortToken = this.extractToken(short); const userId = this.extractUserId(short);
    const long = await this.getJson(`${this.endpoints.graph}/access_token`, { grant_type: 'ig_exchange_token', client_secret: this.clientSecret, access_token: shortToken });
    const accessToken = this.extractToken(long); const expiresIn = Number(long.expires_in ?? 60 * 24 * 60 * 60);
    this.token = { accessToken, userId, expiresAt: Date.now() + Math.max(1, expiresIn) * 1000 };
  }

  logout(): void { this.token = undefined; }
  getTokenConfig() { if (!this.token || this.token.expiresAt <= Date.now()) throw new InstagramApiError('Instagram OAuth session is not connected or has expired.', 401); return { accessToken: this.token.accessToken, userId: this.token.userId }; }

  private async formRequest(url: string, values: Record<string, string>): Promise<Record<string, unknown>> { const body = new URLSearchParams(values); const response = await this.fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }); return this.readResponse(response); }
  private async getJson(url: string, values: Record<string, string>): Promise<Record<string, unknown>> { const response = await this.fetchImpl(`${url}?${new URLSearchParams(values)}`); return this.readResponse(response); }
  private async readResponse(response: Response): Promise<Record<string, unknown>> { const payload = await response.json() as Record<string, unknown>; if (!response.ok || payload.error) throw new InstagramApiError(String((payload.error as Record<string, unknown> | undefined)?.message ?? 'Instagram OAuth request failed'), response.status || 502); return payload.data && Array.isArray(payload.data) ? payload.data[0] as Record<string, unknown> : payload; }
  private extractToken(payload: Record<string, unknown>): string { const token = payload.access_token; if (typeof token !== 'string' || !token) throw new InstagramApiError('Instagram OAuth returned no access token.', 502); return token; }
  private extractUserId(payload: Record<string, unknown>): string { const value = payload.user_id; if (typeof value !== 'string' && typeof value !== 'number') throw new InstagramApiError('Instagram OAuth returned no user ID.', 502); return String(value); }
}

export class ConnectorBackedInstagramService implements InstagramService {
  constructor(private readonly bridgeUrl = config.connector.bridgeUrl, private readonly secret = config.connector.sharedSecret, private readonly fetchImpl: typeof fetch = fetch) {}
  private async call<T>(operation: ConnectorOperation, args: Record<string, unknown> = {}): Promise<T> { if (!this.bridgeUrl) throw new InstagramApiError('Connector mode requires ORION_CONNECTOR_BRIDGE_URL.', 503); const response = await this.fetchImpl(`${this.bridgeUrl.replace(/\/$/, '')}/instagram/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.secret ? { Authorization: `Bearer ${this.secret}` } : {}) }, body: JSON.stringify(args) }); const payload = await response.json() as { result?: T; error?: string }; if (!response.ok || payload.error) throw new InstagramApiError(payload.error ?? 'Instagram connector bridge failed', response.status || 502); return payload.result as T; }
  getAccount() { return this.call<InstagramAccount>('getAccount'); }
  listMedia(limit?: number, after?: string) { return this.call<InstagramListResponse<InstagramMedia>>('listMedia', { limit, after }); }
  getPostInsights(postId: string) { return this.call<InstagramInsightsResponse>('getPostInsights', { postId }); }
  getEngagement(postId: string) { return this.call<EngagementSummary>('getEngagement', { postId }); }
  getPublishingLimit() { return this.call<PublishingLimit>('getPublishingLimit'); }
  publish(input: CreateContainerInput) { return this.call<PublishResult>('publish', { input }); }
  publishCarousel(items: CarouselItemInput[], caption?: string) { return this.call<PublishResult>('publishCarousel', { items, caption }); }
}

export function createInstagramRuntime(): { service: InstagramService; auth: AuthProvider } {
  if (config.connector.enabled) return { service: new ConnectorBackedInstagramService(), auth: { mode: 'connector' as const, status: () => ({ mode: 'connector' as const, connected: Boolean(config.connector.bridgeUrl) }) } };
  const oauth = new DirectMetaOAuth();
  if (config.oauth.clientId && config.oauth.clientSecret) {
    const service = new InstagramClient({ ...config.instagram, accessToken: '', userId: '' });
    const oauthService: InstagramService = { getAccount: () => serviceFor(oauth).getAccount(), listMedia: (limit, after) => serviceFor(oauth).listMedia(limit, after), getPostInsights: (id) => serviceFor(oauth).getPostInsights(id), getEngagement: (id) => serviceFor(oauth).getEngagement(id), getPublishingLimit: () => serviceFor(oauth).getPublishingLimit(), publish: (input) => serviceFor(oauth).publish(input), publishCarousel: (items, caption) => serviceFor(oauth).publishCarousel(items, caption) };
    void service;
    return { service: oauthService, auth: oauth };
  }
  return { service: new InstagramClient(), auth: { mode: 'token' as const, status: () => ({ mode: 'token' as const, connected: Boolean(config.instagram.accessToken && config.instagram.userId), accountId: config.instagram.userId }) } };

  function serviceFor(provider: DirectMetaOAuth): InstagramClient { const credentials = provider.getTokenConfig(); return new InstagramClient({ ...config.instagram, ...credentials, baseUrl: 'https://graph.instagram.com' }); }
}
