import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { InstagramApiError, InstagramClient } from './instagram/client.js';
import type { CreateContainerInput, MediaType } from './instagram/types.js';

type InstagramService = Pick<InstagramClient, 'getAccount' | 'listMedia' | 'getPostInsights' | 'getPublishingLimit' | 'publish'>;

export function createApp(client: InstagramService = new InstagramClient()) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '32kb' }));
  app.use(morgan('tiny'));

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'orion', timestamp: new Date().toISOString() }));

  app.get('/api/account', asyncHandler(async (_req, res) => {
    res.json(await client.getAccount());
  }));

  app.get('/api/posts', asyncHandler(async (req, res) => {
    const limit = Number.parseInt(String(req.query.limit ?? '12'), 10);
    const after = typeof req.query.after === 'string' ? req.query.after : undefined;
    if (!Number.isFinite(limit)) return res.status(400).json({ error: 'limit must be a number' });
    res.json(await client.listMedia(limit, after));
  }));

  app.get('/api/posts/:postId/insights', asyncHandler(async (req, res) => {
    res.json(await client.getPostInsights(String(req.params.postId)));
  }));

  app.get('/api/publishing-limit', asyncHandler(async (_req, res) => {
    res.json(await client.getPublishingLimit());
  }));

  app.post('/api/publish', asyncHandler(async (req, res) => {
    const input = parsePublishRequest(req.body);
    res.status(201).json(await client.publish(input));
  }));

  app.use(express.static('public', { extensions: ['html'] }));
  app.use((_req, res) => res.sendFile('index.html', { root: 'public' }));

  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error instanceof InstagramApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    if (status >= 500) console.error(message);
    res.status(status).json({ error: message });
  };
  app.use(errors);
  return app;
}

function parsePublishRequest(body: unknown): CreateContainerInput {
  if (!body || typeof body !== 'object') throw new InstagramApiError('Request body must be a JSON object', 400);
  const candidate = body as Record<string, unknown>;
  const mediaType = candidate.mediaType;
  const allowed: MediaType[] = ['IMAGE', 'VIDEO', 'REELS', 'STORIES', 'CAROUSEL'];
  if (typeof mediaType !== 'string' || !allowed.includes(mediaType as MediaType)) {
    throw new InstagramApiError(`mediaType must be one of ${allowed.join(', ')}`, 400);
  }
  const text = (name: string): string | undefined => {
    const value = candidate[name];
    return value === undefined ? undefined : typeof value === 'string' ? value : (() => { throw new InstagramApiError(`${name} must be a string`, 400); })();
  };
  const children = candidate.children === undefined ? undefined : Array.isArray(candidate.children) && candidate.children.every((item) => typeof item === 'string') ? candidate.children as string[] : (() => { throw new InstagramApiError('children must be an array of strings', 400); })();
  return {
    mediaType: mediaType as MediaType,
    imageUrl: text('imageUrl'),
    videoUrl: text('videoUrl'),
    caption: text('caption'),
    altText: text('altText'),
    isCarouselItem: candidate.isCarouselItem === true,
    children,
  };
}

function asyncHandler(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: (error?: unknown) => void) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

if (process.env.NODE_ENV !== 'test') {
  createApp().listen(config.port, config.host, () => {
    console.log(`Orion listening on http://${config.host}:${config.port}`);
  });
}
