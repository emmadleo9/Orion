import 'dotenv/config';

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export const config = {
  port: positiveInt('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  instagram: {
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN ?? '',
    userId: process.env.INSTAGRAM_USER_ID ?? '',
    graphVersion: process.env.INSTAGRAM_GRAPH_VERSION ?? 'v26.0',
    baseUrl: process.env.INSTAGRAM_GRAPH_BASE_URL ?? 'https://graph.facebook.com',
    requestTimeoutMs: positiveInt('INSTAGRAM_REQUEST_TIMEOUT_MS', 15_000),
    pollIntervalMs: positiveInt('INSTAGRAM_PUBLISH_POLL_INTERVAL_MS', 2_500),
    pollTimeoutMs: positiveInt('INSTAGRAM_PUBLISH_POLL_TIMEOUT_MS', 120_000),
  },
} as const;

export function assertInstagramConfigured(): void {
  const missing = [
    !config.instagram.accessToken && 'INSTAGRAM_ACCESS_TOKEN',
    !config.instagram.userId && 'INSTAGRAM_USER_ID',
  ].filter((item): item is string => Boolean(item));

  if (missing.length > 0) {
    throw new Error(`Instagram integration is not configured. Missing: ${missing.join(', ')}`);
  }
}
