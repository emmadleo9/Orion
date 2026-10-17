import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { InstagramService } from './instagram/provider.js';

export type ConnectorGateway = Pick<InstagramService, 'getAccount' | 'listMedia' | 'getPostInsights' | 'getEngagement' | 'getPublishingLimit' | 'publish' | 'publishCarousel'>;

export function createConnectorBridge(gateway: ConnectorGateway, sharedSecret: string) {
  if (!sharedSecret) throw new Error('A non-empty connector bridge shared secret is required');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const expected = Buffer.from(sharedSecret);
    const actual = Buffer.from(supplied);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'Invalid connector bridge credentials' });
    next();
  });
  app.post('/instagram/:operation', async (req, res) => {
    try {
      const operation = req.params.operation;
      const result = await dispatch(gateway, operation, req.body as Record<string, unknown>);
      res.json({ result });
    } catch (error) {
      const status = error instanceof Error && /unknown operation/i.test(error.message) ? 404 : 502;
      res.status(status).json({ error: error instanceof Error ? error.message : 'Connector operation failed' });
    }
  });
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'orion-instagram-connector-bridge' }));
  return app;
}

async function dispatch(gateway: ConnectorGateway, operation: string, args: Record<string, unknown>) {
  switch (operation) {
    case 'getAccount': return gateway.getAccount();
    case 'listMedia': return gateway.listMedia(typeof args.limit === 'number' ? args.limit : undefined, typeof args.after === 'string' ? args.after : undefined);
    case 'getPostInsights': return gateway.getPostInsights(requiredString(args, 'postId'));
    case 'getEngagement': return gateway.getEngagement(requiredString(args, 'postId'));
    case 'getPublishingLimit': return gateway.getPublishingLimit();
    case 'publish': return gateway.publish(args.input as Parameters<ConnectorGateway['publish']>[0]);
    case 'publishCarousel': return gateway.publishCarousel(args.items as Parameters<ConnectorGateway['publishCarousel']>[0], typeof args.caption === 'string' ? args.caption : undefined);
    default: throw new Error(`Unknown operation: ${operation}`);
  }
}
function requiredString(args: Record<string, unknown>, name: string): string { if (typeof args[name] !== 'string' || !args[name]) throw new Error(`${name} is required`); return args[name]; }
