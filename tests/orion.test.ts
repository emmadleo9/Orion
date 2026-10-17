import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import { InstagramClient } from '../src/instagram/client.js';
import { createApp } from '../src/server.js';
import { Scheduler } from '../src/scheduler.js';
import { ConnectorBackedInstagramService, DirectMetaOAuth } from '../src/instagram/provider.js';
import { createConnectorBridge } from '../src/connector-bridge.js';

process.env.INSTAGRAM_ACCESS_TOKEN = 'test-token';
process.env.INSTAGRAM_USER_ID = 'test-user';
process.env.NODE_ENV = 'test';

const options = {
  accessToken: 'test-token', userId: 'test-user', graphVersion: 'v26.0', baseUrl: 'https://graph.facebook.com',
  requestTimeoutMs: 1_000, pollIntervalMs: 1, pollTimeoutMs: 100,
};

describe('InstagramClient', () => {
  it('sends versioned requests with bearer auth and form data', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new InstagramClient(options, async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: 'container-1' }), { status: 200 });
    });
    const result = await client.createContainer({ mediaType: 'IMAGE', imageUrl: 'https://cdn.example.com/photo.jpg', caption: 'hello' });
    assert.equal(result.id, 'container-1');
    assert.equal(calls[0]?.url, 'https://graph.facebook.com/v26.0/test-user/media');
    assert.equal(new Headers(calls[0]?.init?.headers).get('Authorization'), 'Bearer test-token');
    assert.equal(await new Response(calls[0]?.init?.body).text(), 'media_type=IMAGE&caption=hello&image_url=https%3A%2F%2Fcdn.example.com%2Fphoto.jpg');
  });

  it('rejects non-public media URLs before making an API call', async () => {
    let called = false;
    const client = new InstagramClient(options, async () => { called = true; return new Response('{}'); });
    await assert.rejects(() => client.createContainer({ mediaType: 'IMAGE', imageUrl: 'http://localhost/photo.jpg' }), /must use HTTPS/);
    assert.equal(called, false);
  });

  it('assembles child containers into a carousel before publishing', async () => {
    const responses = [{ id: 'child-1' }, { id: 'child-2' }, { id: 'carousel-1' }, { id: 'media-2' }];
    const client = new InstagramClient(options, async () => new Response(JSON.stringify(responses.shift()), { status: 200 }));
    const result = await client.publishCarousel([
      { mediaType: 'IMAGE', imageUrl: 'https://cdn.example.com/one.jpg' },
      { mediaType: 'IMAGE', imageUrl: 'https://cdn.example.com/two.jpg' },
    ], 'carousel caption');
    assert.deepEqual(result, { containerId: 'carousel-1', mediaId: 'media-2' });
  });
});

describe('Direct Meta OAuth', () => {
  it('creates a stateful login URL and exchanges the callback code server-side', async () => {
    const oauth = new DirectMetaOAuth('app-1', 'secret-1', 'http://localhost:3000/api/auth/instagram/callback', async (url, init) => {
      if (String(url).startsWith('https://api.instagram.com/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'short-token', user_id: 'ig-user-1' }), { status: 200 });
      assert.equal(String(url).startsWith('https://graph.instagram.com/access_token?'), true);
      assert.equal(init?.method, undefined);
      return new Response(JSON.stringify({ access_token: 'long-token', expires_in: 5_184_000 }), { status: 200 });
    });
    const login = new URL(oauth.authorizationUrl());
    assert.equal(login.searchParams.get('client_id'), 'app-1');
    const state = login.searchParams.get('state');
    assert.ok(state);
    await oauth.completeAuthorization('one-time-code', state);
    assert.deepEqual(oauth.status(), { mode: 'direct-oauth', connected: true, accountId: 'ig-user-1' });
  });
});

describe('OAuth HTTP integration', () => {
  it('redirects to Meta, handles the callback, and exposes connected status', async () => {
    const oauth = new DirectMetaOAuth('app-1', 'secret-1', 'http://localhost:3000/api/auth/instagram/callback', async (url) => {
      if (String(url).startsWith('https://api.instagram.com/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'short-token', user_id: 'ig-user-1' }), { status: 200 });
      return new Response(JSON.stringify({ access_token: 'long-token', expires_in: 3_600 }), { status: 200 });
    });
    const service = { getAccount: async () => ({ id: 'ig-user-1' }), listMedia: async () => ({ data: [] }), getPostInsights: async () => ({ data: [] }), getEngagement: async () => ({ mediaId: 'x', likes: 0, comments: 0, saves: 0, shares: 0, reach: 0, impressions: 0, totalInteractions: 0, recentComments: [] }), getPublishingLimit: async () => ({ data: [] }), publish: async () => ({ containerId: 'c', mediaId: 'm' }), publishCarousel: async () => ({ containerId: 'c', mediaId: 'm' }) };
    const scheduler = new Scheduler(async () => ({ containerId: 'c', mediaId: 'm' }), `/tmp/orion-oauth-http-${process.pid}.json`);
    const server = createApp(service, scheduler, oauth).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      const login = await fetch(`${origin}/api/auth/instagram/login`, { redirect: 'manual' });
      assert.equal(login.status, 302);
      const redirect = new URL(login.headers.get('location')!);
      const callback = await fetch(`${origin}/api/auth/instagram/callback?code=mock-code&state=${encodeURIComponent(redirect.searchParams.get('state')!)}`, { redirect: 'manual' });
      assert.equal(callback.status, 302);
      const status = await fetch(`${origin}/api/auth/instagram/status`);
      assert.deepEqual(await status.json(), { mode: 'direct-oauth', connected: true, accountId: 'ig-user-1' });
    } finally { scheduler.close(); server.close(); fs.rmSync(`/tmp/orion-oauth-http-${process.pid}.json`, { force: true }); }
  });
});

describe('Connector provider integration', () => {
  it('routes account, media, engagement, publishing, and quota calls through a local bridge', async () => {
    const calls: string[] = [];
    const bridge = http.createServer(async (request, response) => {
      calls.push(request.url ?? '');
      response.setHeader('content-type', 'application/json');
      if (request.url === '/instagram/getAccount') return response.end(JSON.stringify({ result: { id: 'ig-user-1', username: 'orion' } }));
      if (request.url === '/instagram/listMedia') return response.end(JSON.stringify({ result: { data: [{ id: 'post-1' }] } }));
      if (request.url === '/instagram/getPostInsights') return response.end(JSON.stringify({ result: { data: [{ name: 'reach', values: [{ value: 10 }] }] } }));
      if (request.url === '/instagram/getEngagement') return response.end(JSON.stringify({ result: { mediaId: 'post-1', likes: 2, comments: 3, saves: 4, shares: 5, reach: 10, impressions: 12, totalInteractions: 14, recentComments: [] } }));
      if (request.url === '/instagram/getPublishingLimit') return response.end(JSON.stringify({ result: { data: [{ quota_usage: 1, config: { quota_total: 100 } }] } }));
      if (request.url === '/instagram/publish') return response.end(JSON.stringify({ result: { containerId: 'container-1', mediaId: 'media-1' } }));
      if (request.url === '/instagram/publishCarousel') return response.end(JSON.stringify({ result: { containerId: 'carousel-1', mediaId: 'media-2' } }));
      response.statusCode = 404; response.end(JSON.stringify({ error: 'unknown operation' }));
    }).listen(0);
    await new Promise<void>((resolve) => bridge.once('listening', resolve));
    const address = bridge.address(); assert.ok(address && typeof address !== 'string');
    const client = new ConnectorBackedInstagramService(`http://127.0.0.1:${address.port}`, 'bridge-secret');
    try {
      assert.equal((await client.getAccount()).username, 'orion');
      assert.equal((await client.listMedia()).data[0]?.id, 'post-1');
      assert.equal((await client.getEngagement('post-1')).shares, 5);
      assert.equal((await client.getPublishingLimit()).data?.[0]?.quota_usage, 1);
      assert.equal((await client.publish({ mediaType: 'IMAGE', imageUrl: 'https://cdn.example.com/a.jpg' })).mediaId, 'media-1');
      assert.equal((await client.publishCarousel([{ mediaType: 'IMAGE', imageUrl: 'https://cdn.example.com/a.jpg' }, { mediaType: 'IMAGE', imageUrl: 'https://cdn.example.com/b.jpg' }])).mediaId, 'media-2');
      assert.deepEqual(calls, ['/instagram/getAccount', '/instagram/listMedia', '/instagram/getEngagement', '/instagram/getPublishingLimit', '/instagram/publish', '/instagram/publishCarousel']);
    } finally { bridge.close(); }
  });
});

describe('Host-side connector bridge', () => {
  it('protects bridge operations with the shared secret', async () => {
    const gateway = { getAccount: async () => ({ id: 'ig-user-1' }), listMedia: async () => ({ data: [] }), getPostInsights: async () => ({ data: [] }), getEngagement: async () => ({ mediaId: 'x', likes: 0, comments: 0, saves: 0, shares: 0, reach: 0, impressions: 0, totalInteractions: 0, recentComments: [] }), getPublishingLimit: async () => ({ data: [] }), publish: async () => ({ containerId: 'c', mediaId: 'm' }), publishCarousel: async () => ({ containerId: 'c', mediaId: 'm' }) };
    const bridge = createConnectorBridge(gateway, 'bridge-secret').listen(0);
    await new Promise<void>((resolve) => bridge.once('listening', resolve));
    const address = bridge.address(); assert.ok(address && typeof address !== 'string');
    try {
      const denied = await fetch(`http://127.0.0.1:${address.port}/instagram/getAccount`, { method: 'POST' });
      assert.equal(denied.status, 401);
      const allowed = await fetch(`http://127.0.0.1:${address.port}/instagram/getAccount`, { method: 'POST', headers: { authorization: 'Bearer bridge-secret', 'content-type': 'application/json' }, body: '{}' });
      assert.deepEqual(await allowed.json(), { result: { id: 'ig-user-1' } });
    } finally { bridge.close(); }
  });
});

describe('Orion HTTP API', () => {
  const fake = {
    getAccount: async () => ({ id: 'account-1', username: 'orion', followers_count: 42, media_count: 3, follows_count: 7 }),
    listMedia: async () => ({ data: [{ id: 'post-1', caption: 'hello', media_type: 'IMAGE' }] }),
    getPostInsights: async () => ({ data: [{ name: 'reach', values: [{ value: 10 }] }] }),
    getPublishingLimit: async () => ({ data: [{ quota_usage: 4, config: { quota_total: 100 } }] }),
    publish: async () => ({ containerId: 'container-1', mediaId: 'media-1' }),
    publishCarousel: async () => ({ containerId: 'carousel-1', mediaId: 'media-2' }),
    getEngagement: async () => ({ mediaId: 'post-1', likes: 20, comments: 3, saves: 4, shares: 5, reach: 100, impressions: 140, totalInteractions: 32, recentComments: [] }),
  };
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  const scheduleFile = `/tmp/orion-schedules-${process.pid}.json`;
  let scheduler: Scheduler;
  let origin = '';
  before(async () => { scheduler = new Scheduler(async () => ({ containerId: 'scheduled-container', mediaId: 'scheduled-media' }), scheduleFile); server = createApp(fake, scheduler).listen(0); await new Promise<void>((resolve) => server.once('listening', resolve)); const address = server.address(); if (address && typeof address !== 'string') origin = `http://127.0.0.1:${address.port}`; });
  after(() => { scheduler.close(); server.close(); fs.rmSync(scheduleFile, { force: true }); });
  it('serves health and dashboard API routes', async () => {
    const health = await fetch(`${origin}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    const account = await fetch(`${origin}/api/account`);
    assert.equal((await account.json()).username, 'orion');
  });
  it('validates publish requests', async () => {
    const response = await fetch(`${origin}/api/publish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mediaType: 'INVALID' }) });
    assert.equal(response.status, 400);
  });
  it('generates caption suggestions and serves engagement data', async () => {
    const caption = await fetch(`${origin}/api/captions/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: 'launch day', tone: 'bold' }) });
    assert.equal(caption.status, 200);
    assert.equal((await caption.json()).suggestions.length, 3);
    const engagement = await fetch(`${origin}/api/posts/post-1/engagement`);
    assert.equal((await engagement.json()).shares, 5);
  });
  it('creates and cancels a future scheduled post', async () => {
    const scheduled = await fetch(`${origin}/api/schedules`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ publishAt: new Date(Date.now() + 60_000).toISOString(), payload: { mediaType: 'IMAGE', imageUrl: 'https://cdn.example.com/scheduled.jpg', caption: 'scheduled' } }) });
    assert.equal(scheduled.status, 201);
    const job = await scheduled.json();
    assert.equal(job.status, 'SCHEDULED');
    const cancelled = await fetch(`${origin}/api/schedules/${job.id}`, { method: 'DELETE' });
    assert.equal((await cancelled.json()).status, 'CANCELLED');
  });
});
