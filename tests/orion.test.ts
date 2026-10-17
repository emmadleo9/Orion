import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { InstagramClient } from '../src/instagram/client.js';
import { createApp } from '../src/server.js';

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

describe('Orion HTTP API', () => {
  const fake = {
    getAccount: async () => ({ id: 'account-1', username: 'orion', followers_count: 42, media_count: 3, follows_count: 7 }),
    listMedia: async () => ({ data: [{ id: 'post-1', caption: 'hello', media_type: 'IMAGE' }] }),
    getPostInsights: async () => ({ data: [{ name: 'reach', values: [{ value: 10 }] }] }),
    getPublishingLimit: async () => ({ data: [{ quota_usage: 4, config: { quota_total: 100 } }] }),
    publish: async () => ({ containerId: 'container-1', mediaId: 'media-1' }),
    publishCarousel: async () => ({ containerId: 'carousel-1', mediaId: 'media-2' }),
  };
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let origin = '';
  before(async () => { server = createApp(fake).listen(0); await new Promise<void>((resolve) => server.once('listening', resolve)); const address = server.address(); if (address && typeof address !== 'string') origin = `http://127.0.0.1:${address.port}`; });
  after(() => server.close());
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
});
