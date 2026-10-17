import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { InstagramApiError, InstagramClient } from './instagram/client.js';
import type { CaptionRequest, CarouselItemInput, CreateContainerInput, MediaType, ScheduledPost } from './instagram/types.js';
import { Scheduler } from './scheduler.js';

type InstagramService = Pick<InstagramClient, 'getAccount' | 'listMedia' | 'getPostInsights' | 'getPublishingLimit' | 'publish' | 'publishCarousel'> & Partial<Pick<InstagramClient, 'getEngagement'>>;
type PublishRequest = CreateContainerInput | (CreateContainerInput & { items: CarouselItemInput[] });

export function createApp(client: InstagramService = new InstagramClient(), scheduler?: Scheduler) {
  const app = express();
  const activeScheduler = scheduler ?? new Scheduler((payload) => payload.mediaType === 'CAROUSEL' && 'items' in payload ? client.publishCarousel(payload.items, payload.caption) : client.publish(payload));
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '32kb' }));
  app.use(morgan('tiny'));

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'orion', timestamp: new Date().toISOString() }));
  app.get('/api/account', asyncHandler(async (_req, res) => res.json(await client.getAccount())));
  app.get('/api/posts', asyncHandler(async (req, res) => {
    const limit = Number.parseInt(String(req.query.limit ?? '12'), 10);
    const after = typeof req.query.after === 'string' ? req.query.after : undefined;
    if (!Number.isFinite(limit)) return res.status(400).json({ error: 'limit must be a number' });
    res.json(await client.listMedia(limit, after));
  }));
  app.get('/api/posts/:postId/insights', asyncHandler(async (req, res) => res.json(await client.getPostInsights(String(req.params.postId)))));
  app.get('/api/posts/:postId/engagement', asyncHandler(async (req, res) => {
    if (!client.getEngagement) throw new InstagramApiError('Engagement analytics are not available', 503);
    res.json(await client.getEngagement(String(req.params.postId)));
  }));
  app.get('/api/publishing-limit', asyncHandler(async (_req, res) => res.json(await client.getPublishingLimit())));
  app.get('/api/schedules', (_req, res) => res.json(activeScheduler.list()));
  app.post('/api/schedules', asyncHandler(async (req, res) => {
    const candidate = req.body as Record<string, unknown>;
    if (typeof candidate.publishAt !== 'string') throw new InstagramApiError('publishAt is required and must be an ISO timestamp', 400);
    const payload = parsePublishRequest(candidate.payload);
    res.status(201).json(activeScheduler.create({ publishAt: candidate.publishAt, payload }));
  }));
  app.delete('/api/schedules/:id', (_req, res) => {
    try { res.json(activeScheduler.cancel(String(_req.params.id))); }
    catch (error) { throw new InstagramApiError(error instanceof Error ? error.message : 'Unable to cancel schedule', 404); }
  });
  app.post('/api/captions/generate', (req, res) => res.json(generateCaptions(parseCaptionRequest(req.body))));
  app.post('/api/publish', asyncHandler(async (req, res) => {
    const input = parsePublishRequest(req.body);
    if (input.mediaType === 'CAROUSEL' && 'items' in input) res.status(201).json(await client.publishCarousel(input.items, input.caption));
    else res.status(201).json(await client.publish(input));
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

function parsePublishRequest(body: unknown): PublishRequest {
  if (!body || typeof body !== 'object') throw new InstagramApiError('Request body must be a JSON object', 400);
  const candidate = body as Record<string, unknown>;
  const mediaType = candidate.mediaType;
  const allowed: MediaType[] = ['IMAGE', 'VIDEO', 'REELS', 'STORIES', 'CAROUSEL'];
  if (typeof mediaType !== 'string' || !allowed.includes(mediaType as MediaType)) throw new InstagramApiError(`mediaType must be one of ${allowed.join(', ')}`, 400);
  const text = (name: string): string | undefined => { const value = candidate[name]; return value === undefined ? undefined : typeof value === 'string' ? value : (() => { throw new InstagramApiError(`${name} must be a string`, 400); })(); };
  const children = candidate.children === undefined ? undefined : Array.isArray(candidate.children) && candidate.children.every((item) => typeof item === 'string') ? candidate.children as string[] : (() => { throw new InstagramApiError('children must be an array of strings', 400); })();
  if (mediaType === 'CAROUSEL') {
    const rawItems = candidate.items;
    if (!Array.isArray(rawItems) || rawItems.length < 2 || rawItems.length > 10) throw new InstagramApiError('Carousel publishing requires 2 to 10 items', 400);
    const items = rawItems.map((item): CarouselItemInput => { if (!item || typeof item !== 'object') throw new InstagramApiError('Each carousel item must be an object', 400); const value = item as Record<string, unknown>; if (value.mediaType !== 'IMAGE' && value.mediaType !== 'VIDEO') throw new InstagramApiError('Carousel items must be IMAGE or VIDEO', 400); const urlName = value.mediaType === 'IMAGE' ? 'imageUrl' : 'videoUrl'; if (typeof value[urlName] !== 'string') throw new InstagramApiError(`${urlName} is required for carousel items`, 400); return { mediaType: value.mediaType, [urlName]: value[urlName] } as CarouselItemInput; });
    return { mediaType: 'CAROUSEL', caption: text('caption'), items };
  }
  return { mediaType: mediaType as MediaType, imageUrl: text('imageUrl'), videoUrl: text('videoUrl'), caption: text('caption'), altText: text('altText'), isCarouselItem: candidate.isCarouselItem === true, children };
}

function parseCaptionRequest(body: unknown): CaptionRequest {
  const topic: string | undefined = body && typeof body === 'object' && typeof (body as Record<string, unknown>).topic === 'string' ? (body as Record<string, unknown>).topic as string : undefined;
  if (!topic?.trim()) throw new InstagramApiError('topic is required', 400);
  const value = body as Record<string, unknown>;
  const tones = ['bold', 'warm', 'playful', 'professional'] as const;
  const tone = typeof value.tone === 'string' && tones.includes(value.tone as typeof tones[number]) ? value.tone as CaptionRequest['tone'] : 'warm';
  const count = typeof value.hashtagCount === 'number' ? Math.min(Math.max(Math.floor(value.hashtagCount), 3), 20) : 8;
  return { topic: topic.trim(), tone, callToAction: typeof value.callToAction === 'string' ? value.callToAction.trim() : undefined, hashtagCount: count };
}

function generateCaptions(input: CaptionRequest) {
  const toneLead = { bold: 'Make room for what matters.', warm: 'A little moment worth sharing.', playful: 'Consider this your sign to press pause.', professional: 'A focused look at what is next.' }[input.tone ?? 'warm'];
  const topic = input.topic.replace(/[.!?]+$/, '');
  const cta = input.callToAction || 'What do you think?';
  const words = topic.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2).slice(0, 4);
  const hashtags = Array.from(new Set([...words, 'instagram', 'content', 'orion'])).slice(0, input.hashtagCount ?? 8).map((word) => `#${word}`);
  return { suggestions: [{ caption: `${toneLead} ${topic}. ${cta}`, hashtags }, { caption: `${topic} — behind the scenes, in the details. ${cta}`, hashtags: hashtags.slice().reverse() }, { caption: `More ${topic.toLowerCase()}, less noise. ${cta}`, hashtags }] };
}

function asyncHandler(handler: (req: Request, res: Response) => Promise<unknown>) { return (req: Request, res: Response, next: (error?: unknown) => void) => { Promise.resolve(handler(req, res)).catch(next); }; }
if (process.env.NODE_ENV !== 'test') createApp().listen(config.port, config.host, () => console.log(`Orion listening on http://${config.host}:${config.port}`));
